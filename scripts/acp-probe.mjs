#!/usr/bin/env node
/**
 * ACP 行为探针（手动运行，不进 jest）：抓 wire 流量回答复测暴露的四个问题。
 * 用法：node scripts/acp-probe.mjs <write-perm|reactivate|bypass|agent> [vaultPath]
 *
 * - write-perm  ：default 模式 Write 全链事件转储（权限请求与 tool_call* 的 toolCallId 对照、completed 是否带 rawInput）
 * - reactivate  ：A→B→A 交叉 prompt 是否空响应；prompt 前重发 session/load 是否恢复（WB-RT-001/005 根因）
 * - bypass      ：bypassPermissions 下 Write 是否仍弹权限请求（WB-RT 第 10 条）
 * - agent       ：--agents reviewer 子代理调用的 agent_message_chunk 序列转储（WB-RT-007 重复形态）
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scenario = process.argv[2];
const vault = process.argv[3] || mkdtempSync(join(tmpdir(), 'acp-probe-'));
const CLI_CANDIDATES = [
    process.env.CODEBUDDY_PATH,
    '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
    'codebuddy',
].filter(Boolean);
const cli = CLI_CANDIDATES.find((p) => p === 'codebuddy' || existsSync(p));

class AcpProc {
    constructor(bin, cwd, extraArgs = []) {
        this.buf = '';
        this.nextId = 1;
        this.pending = new Map();
        this.handlers = [];
        this.proc = spawn(bin, ['--acp', ...extraArgs], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
        this.proc.stdout.on('data', (d) => {
            this.buf += d.toString('utf8');
            let i;
            while ((i = this.buf.indexOf('\n')) >= 0) {
                const line = this.buf.slice(0, i).trim();
                this.buf = this.buf.slice(i + 1);
                if (line) this.onLine(line);
            }
        });
        this.proc.stderr.on('data', () => { /* 探针不关心 stderr */ });
    }
    onLine(line) {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method) { for (const h of this.handlers) h(msg); return; }
        const p = this.pending.get(msg.id);
        if (p) {
            this.pending.delete(msg.id);
            msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        }
    }
    onMessage(fn) { this.handlers.push(fn); }
    request(method, params, timeoutMs = 90_000) {
        const id = this.nextId++;
        this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, timeoutMs);
            this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
        });
    }
    respond(id, result) { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
    kill() { try { this.proc.kill(); } catch { /* noop */ } }
}

const toolNameOf = (tc) => tc?._meta?.['codebuddy.ai/toolName'] ?? tc?.title ?? '?';

/** 跑一轮 prompt 并转储所有 tool 相关事件；autoAllow 时权限请求一律 allow_once */
async function promptDump(p, sessionId, text, { autoAllow = false, tag = '' } = {}) {
    let textChunks = 0;
    let textBody = '';
    const off = (msg) => {
        if (msg.method === 'session/request_permission') {
            const tc = msg.params?.toolCall ?? {};
            console.log(`  [perm] reqId=${msg.id} toolCallId=${tc.toolCallId} tool=${toolNameOf(tc)} rawInput=${JSON.stringify(tc.rawInput ?? null)?.slice(0, 140)}`);
            if (autoAllow) p.respond(msg.id, { outcome: { outcome: 'selected', optionId: 'allow' } });
            return;
        }
        if (msg.method !== 'session/update') return;
        const u = msg.params?.update ?? {};
        if (u.sessionUpdate === 'agent_message_chunk') { textChunks++; textBody += u.content?.text ?? ''; return; }
        if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
            console.log(`  [${u.sessionUpdate}] id=${u.toolCallId} status=${u.status ?? '-'} tool=${toolNameOf(u)} hasRawInput=${u.rawInput !== undefined} rawInput=${JSON.stringify(u.rawInput ?? null)?.slice(0, 120)}`);
            return;
        }
        if (u.sessionUpdate !== 'agent_thought_chunk') {
            console.log(`  [${u.sessionUpdate}] ${JSON.stringify(u).slice(0, 140)}`);
        }
    };
    p.onMessage(off);
    const result = await p.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, 180_000);
    console.log(`  [done] ${tag} stopReason=${result?.stopReason} textChunks=${textChunks} body=${JSON.stringify(textBody.slice(0, 80))}`);
    return result;
}

async function main() {
    console.log(`scenario: ${scenario}\nvault: ${vault}\ncli: ${cli}\n`);
    if (!cli) { console.log('CLI not found'); process.exit(1); }
    const agents = scenario === 'agent'
        ? ['--agents', JSON.stringify({ reviewer: { description: '审查代码', prompt: '你是简洁的代码审查员，只回一行。' } })]
        : [];
    const p = new AcpProc(cli, vault, agents);
    try {
        await p.request('initialize', {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        });

        if (scenario === 'write-perm') {
            const s = await p.request('session/new', { cwd: vault, mcpServers: [] });
            console.log('— Write 默认模式全链转储 —');
            await promptDump(p, s.sessionId, '创建文件 probe-write.md，内容为 ok。必须实际调用写入工具。', { autoAllow: true, tag: 'write' });
        } else if (scenario === 'reactivate') {
            const a = await p.request('session/new', { cwd: vault, mcpServers: [] });
            const b = await p.request('session/new', { cwd: vault, mcpServers: [] });
            console.log('— A 首轮（记暗号） —');
            await promptDump(p, a.sessionId, '记住暗号 PROBE-ALPHA。只回复两个字：收到。不要调用任何工具。', { autoAllow: true });
            console.log('— B 首轮 —');
            await promptDump(p, b.sessionId, '只回复两个字：乙到。不要调用任何工具。', { autoAllow: true });
            console.log('— A 第二轮（不重载，直接 prompt） —');
            await promptDump(p, a.sessionId, '暗号是什么？只回复暗号本身。不要调用任何工具。', { autoAllow: true });
            console.log('— A 重 session/load 后再 prompt —');
            await p.request('session/load', { sessionId: a.sessionId, cwd: vault, mcpServers: [] });
            await promptDump(p, a.sessionId, '暗号是什么？只回复暗号本身。不要调用任何工具。', { autoAllow: true });
        } else if (scenario === 'reactivate2') {
            // 复刻 GUI 自动标题的精确序列：A prompt → load(随机uuid)失败 → new T → prompt T → prompt A
            const a = await p.request('session/new', { cwd: vault, mcpServers: [] });
            console.log('A.sessionId =', a.sessionId);
            p.onMessage((msg) => { // 全部更新的归属 sessionId 转储（看交叉污染）
                if (msg.method === 'session/update' && msg.params?.update?.sessionUpdate === 'agent_message_chunk') {
                    console.log(`  [text@] sid=${msg.params?.sessionId}`);
                }
            });
            console.log('— A 首轮 —');
            await promptDump(p, a.sessionId, '只回复两个字：收到。不要调用任何工具。', { autoAllow: true });
            console.log('— 标题流：load(不存在的uuid) → new → prompt —');
            const ghostKey = 'ghost-' + Math.random().toString(16).slice(2);
            console.log('ghostKey =', ghostKey);
            try {
                const lr = await p.request('session/load', { sessionId: ghostKey, cwd: vault, mcpServers: [] });
                console.log('  load(ghost) 意外成功, result =', JSON.stringify(lr).slice(0, 120));
            } catch (e) {
                console.log('  load(ghost) 如预期失败:', e.message.slice(0, 60));
            }
            const t = await p.request('session/new', { cwd: vault, mcpServers: [] });
            console.log('T.sessionId =', t.sessionId, '| T===A ?', t.sessionId === a.sessionId);
            await promptDump(p, t.sessionId, '请为以下内容生成一个不超过 20 字的会话标题，只输出标题本身：\n\n只回复两个字：收到', { autoAllow: true, tag: 'title' });
            console.log('— A 第二轮（标题轮之后） —');
            await promptDump(p, a.sessionId, '我们刚才说了什么？不要调用任何工具。', { autoAllow: true });
        } else if (scenario === 'titlefix') {
            // 验证修复组合：prompt 前重发 session/load 激活 → 事件与上下文是否归 A
            const a = await p.request('session/new', { cwd: vault, mcpServers: [] });
            console.log('A.sessionId =', a.sessionId);
            let misTagged = 0, wellTagged = 0;
            p.onMessage((msg) => {
                if (msg.method === 'session/update' && msg.params?.update?.sessionUpdate === 'agent_message_chunk') {
                    if (msg.params?.sessionId === a.sessionId) wellTagged++; else misTagged++;
                }
            });
            await promptDump(p, a.sessionId, '记住暗号 FIX-OMEGA，只回复两个字：收到。不要调用任何工具。', { autoAllow: true });
            const ghostKey = 'ghost-' + Math.random().toString(16).slice(2);
            await p.request('session/load', { sessionId: ghostKey, cwd: vault, mcpServers: [] }).catch(() => {});
            const t = await p.request('session/new', { cwd: vault, mcpServers: [] });
            console.log('T.sessionId =', t.sessionId);
            await promptDump(p, t.sessionId, '请为以下内容生成一个不超过 20 字的会话标题，只输出标题本身：\n\n只回复两个字：收到', { autoAllow: true, tag: 'title' });
            console.log('— 修复动作：prompt 前重发 session/load(A) —');
            await p.request('session/load', { sessionId: a.sessionId, cwd: vault, mcpServers: [] });
            console.log('— A 第二轮 —');
            await promptDump(p, a.sessionId, '暗号是什么？只回复暗号本身。不要调用任何工具。', { autoAllow: true });
            console.log(`归属统计（全程）:  tagged A = ${wellTagged}, 误标其它 = ${misTagged}`);
        } else if (scenario === 'cadence') {
            // 吐字节奏：基线 turn vs 标题幽灵插足+再激活 turn —— 对比 chunk 到达时间分布
            const a = await p.request('session/new', { cwd: vault, mcpServers: [] });
            let tStart = Date.now();
            const events = [];
            p.onMessage((msg) => {
                const u = msg.params?.update ?? {};
                if (msg.method === 'session/update' && u.sessionUpdate === 'agent_message_chunk') {
                    events.push(Date.now() - tStart);
                }
            });
            const span = (ev) => ev.length > 1 ? `首chunk=${ev[0]}ms 末chunk=${ev[ev.length - 1]}ms 共${ev.length}个` : `共${ev.length}个`;
            tStart = Date.now(); events.length = 0;
            await promptDump(p, a.sessionId, '从 1 数到 30，每个数字一行。', { autoAllow: true, tag: 'baseline' });
            console.log('  基线节奏:', span(events));
            // 标题幽灵插足（另一个会话 new + prompt）
            const t = await p.request('session/new', { cwd: vault, mcpServers: [] });
            await promptDump(p, t.sessionId, '请为以下内容生成一个不超过 20 字的会话标题，只输出标题本身：\n\n从 1 数到 30', { autoAllow: true, tag: 'title' });
            // 再激活 + 第二轮
            await p.request('session/load', { sessionId: a.sessionId, cwd: vault, mcpServers: [] });
            tStart = Date.now(); events.length = 0;
            await promptDump(p, a.sessionId, '再从 31 数到 60，每个数字一行。', { autoAllow: true, tag: 'reactivated' });
            console.log('  再激活后节奏:', span(events));
        } else if (scenario === 'attach') {
            // 复刻"带附件对话卡死"现场：bypass 模式下 prompt 里注入外部文件路径（插件 attachment block 形态），
            // 观察 CLI 是否发出 fs/read_text_file 等 agent→client 请求（不答复会挂死）或权限请求
            const externalDir = mkdtempSync(join(tmpdir(), 'acp-attach-'));
            const externalFile = join(externalDir, 'big-note.txt');
            writeFileSync(externalFile, '这不是办法。\n'.repeat(3000), 'utf8'); // ~30k
            const s = await p.request('session/new', { cwd: vault, mcpServers: [] });
            await p.request('session/set_mode', { sessionId: s.sessionId, modeId: 'bypassPermissions' })
                .catch(() => p.request('session/set_config_option', { sessionId: s.sessionId, configId: 'mode', value: 'bypassPermissions' }));
            p.onMessage((msg) => {
                if (msg.method && msg.method !== 'session/update' && msg.id !== undefined) {
                    console.log(`  [agent→client 请求!] method=${msg.method} id=${msg.id} params=${JSON.stringify(msg.params)?.slice(0, 120)}`);
                    if (msg.method === 'session/request_permission') {
                        p.respond(msg.id, { outcome: { outcome: 'selected', optionId: 'allow' } });
                    } else {
                        console.log('  → 探针不应答，观察是否挂死（插件修复前行为）');
                    }
                }
            });
            const text = `用户附加了以下文件（请用你的文件读取工具查看其内容）：\n\n- ${externalFile}\n\n---\n\n复述附件内容的前 20 个字。`;
            await promptDump(p, s.sessionId, text, { autoAllow: true, tag: 'attach' });
        } else if (scenario === 'configroute') {
            // set_mode 是否跟随活动会话指针：A、B 两会话；B 激活后对 A set_mode(bypass) → A 再 prompt 是否弹卡
            const a = await p.request('session/new', { cwd: vault, mcpServers: [] });
            const b = await p.request('session/new', { cwd: vault, mcpServers: [] });
            console.log('A =', a.sessionId, ' B =', b.sessionId);
            await promptDump(p, b.sessionId, '只回复两个字：乙到。不要调用任何工具。', { autoAllow: true }); // B 成为活动会话
            console.log('— B 活动期间对 A set_mode(bypassPermissions) —');
            await p.request('session/set_mode', { sessionId: a.sessionId, modeId: 'bypassPermissions' })
                .catch(async () => p.request('session/set_config_option', { sessionId: a.sessionId, configId: 'mode', value: 'bypassPermissions' }));
            console.log('— prompt A（先重 load 激活，模拟修复后行为） —');
            await p.request('session/load', { sessionId: a.sessionId, cwd: vault, mcpServers: [] });
            let sawPerm = false;
            p.onMessage((msg) => { if (msg.method === 'session/request_permission') { sawPerm = true; p.respond(msg.id, { outcome: { outcome: 'selected', optionId: 'allow' } }); } });
            await promptDump(p, a.sessionId, '创建文件 probe-configroute.md，内容为 ok。必须实际调用写入工具。', { autoAllow: true, tag: 'A-write' });
            console.log('结论: A 的 Write', sawPerm ? '弹了权限卡（set_mode 没作用到 A）' : '未弹卡（set_mode 正确作用于 A）');
        } else if (scenario === 'agent2') {
            // 中继 chunk 识别：每个 agent_message_chunk 的 params.sessionId 与 _meta 转储
            const s = await p.request('session/new', { cwd: vault, mcpServers: [] });
            console.log('main sessionId =', s.sessionId);
            let seq = 0;
            p.onMessage((msg) => {
                if (msg.method !== 'session/update') return;
                if (msg.params?.sessionId !== s.sessionId) {
                    console.log(`  [非主会话更新] sid=${msg.params?.sessionId} kind=${msg.params?.update?.sessionUpdate}`);
                    return;
                }
                const u = msg.params?.update ?? {};
                if (u.sessionUpdate === 'agent_message_chunk') {
                    seq++;
                    console.log(`  [chunk ${seq}] len=${(u.content?.text ?? '').length} meta=${JSON.stringify(u._meta ?? null)}`);
                }
            });
            await promptDump(p, s.sessionId, '用 reviewer 子代理审查 const a=1 这行代码', { autoAllow: true, tag: 'agent' });
        } else if (scenario === 'bypass') {
            const s = await p.request('session/new', { cwd: vault, mcpServers: [] });
            await p.request('session/set_mode', { sessionId: s.sessionId, modeId: 'bypassPermissions' })
                .catch(async () => p.request('session/set_config_option', { sessionId: s.sessionId, configId: 'mode', value: 'bypassPermissions' }));
            console.log('— bypassPermissions 下 Write —');
            await promptDump(p, s.sessionId, '创建文件 probe-bypass.md，内容为 ok。必须实际调用写入工具。', { autoAllow: true, tag: 'write' });
        } else if (scenario === 'agent') {
            const s = await p.request('session/new', { cwd: vault, mcpServers: [] });
            console.log('— Agent 子代理 chunk 序列 —');
            let seq = 0;
            p.onMessage((msg) => {
                const u = msg.params?.update ?? {};
                if (msg.method === 'session/update' && u.sessionUpdate === 'agent_message_chunk') {
                    seq++;
                    console.log(`  [chunk ${seq}] len=${(u.content?.text ?? '').length} ${JSON.stringify((u.content?.text ?? '').slice(0, 100))}`);
                }
            });
            await promptDump(p, s.sessionId, '用 reviewer 子代理审查 const a=1 这行代码', { autoAllow: true, tag: 'agent' });
        } else {
            console.log('未知场景，用法：node scripts/acp-probe.mjs <write-perm|reactivate|bypass|agent>');
        }
    } catch (e) {
        console.log(`异常: ${e.message}`);
    } finally {
        p.kill();
    }
}

main();
