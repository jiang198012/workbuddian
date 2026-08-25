#!/usr/bin/env node
/**
 * Hermes ACP 活探针（手动运行，不进 jest）：实证 hermes acp 方言十问。
 * 用法：node scripts/probe-hermes-acp.mjs [vaultPath]
 * 环境变量 HERMES_PATH 可指定 CLI 路径；否则 ~/.local/bin/hermes → PATH。
 * 十问：握手/new(含models+modes)/纯对话流/dont_ask写文件(无批准)/default写文件(有批准)/
 *       set_model/fork/load回放(无meta标记且在响应前)/load不存在会话(返回null)/cancel。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homedir } from 'node:os';

const vault = process.argv[2] || mkdtempSync(join(tmpdir(), 'hermes-probe-'));
const CLI_CANDIDATES = [
    process.env.HERMES_PATH,
    join(homedir(), '.local', 'bin', 'hermes'),
    'hermes',
].filter(Boolean);
const cli = CLI_CANDIDATES.find((p) => p === 'hermes' || existsSync(p));

let passed = 0, failed = 0;
const findings = [];
const check = (name, ok, extra = '') => {
    ok ? passed++ : failed++;
    const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`;
    console.log(line);
    findings.push(line);
};
const record = (s) => { findings.push(s); };

class AcpProc {
    constructor(bin, cwd) {
        this.buf = '';
        this.nextId = 1;
        this.pending = new Map();
        this.handlers = [];
        this.proc = spawn(bin, ['acp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
        this.proc.stdout.on('data', (d) => {
            this.buf += d.toString('utf8');
            let i;
            while ((i = this.buf.indexOf('\n')) >= 0) {
                const line = this.buf.slice(0, i).trim();
                this.buf = this.buf.slice(i + 1);
                if (line) this.handleLine(line);
            }
        });
        this.proc.stderr.on('data', () => { /* hermes 日志走 stderr,忽略 */ });
    }
    handleLine(line) {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method !== undefined) {
            for (const h of this.handlers) h(msg);
            return;
        }
        const p = this.pending.get(msg.id);
        if (p) {
            this.pending.delete(msg.id);
            msg.error ? p.reject(new Error(msg.error.message ?? 'rpc error')) : p.resolve(msg.result);
        }
    }
    onMessage(fn) { this.handlers.push(fn); }
    request(method, params, timeoutMs = 180_000) {
        const id = this.nextId++;
        this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, timeoutMs);
            this.pending.set(id, {
                resolve: (v) => { clearTimeout(timer); resolve(v === undefined ? null : v); },
                reject: (e) => { clearTimeout(timer); reject(e); },
            });
        });
    }
    notify(method, params) { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
    respond(id, result) { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
    kill() { try { this.proc.kill(); } catch { /* noop */ } }
}

function pickAllowOptionId(options) {
    const list = Array.isArray(options) ? options : [];
    const once = list.find((o) => o?.kind === 'allow_once');
    if (once) return once.optionId;
    const anyAllow = list.find((o) => typeof o?.kind === 'string' && o.kind.startsWith('allow'));
    return (anyAllow ?? list[0])?.optionId;
}

async function promptRound(p, sessionId, text, { autoAllow = false, onFirstChunk = null, timeoutMs = 180_000 } = {}) {
    let body = '';
    const events = [];
    const permissionSeen = [];
    const off = (msg) => {
        if (msg.method === 'session/update') {
            const u = msg.params?.update ?? {};
            events.push(u.sessionUpdate ?? '(unknown)');
            if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
                body += u.content.text;
                if (onFirstChunk) { onFirstChunk(); onFirstChunk = null; }
            }
        } else if (msg.method === 'session/request_permission') {
            permissionSeen.push(msg.params);
            if (autoAllow) {
                const optionId = pickAllowOptionId(msg.params?.options);
                p.respond(msg.id, { outcome: { outcome: 'selected', optionId } });
            }
        }
    };
    p.onMessage(off);
    const result = await p.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, timeoutMs);
    return { result, body, events, permissionSeen };
}

async function main() {
    console.log(`vault: ${vault}\ncli:   ${cli}`);
    record(`vault: ${vault}  cli: ${cli}  date: ${new Date().toISOString()}`);
    if (!cli) { check('CLI 可定位', false); process.exit(1); }
    const p = new AcpProc(cli, vault);
    try {
        // 1. 握手
        const init = await p.request('initialize', {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        });
        const caps = init?.agentCapabilities ?? {};
        check('1 initialize 握手', !!init?.agentInfo,
            `agent=${init?.agentInfo?.name}@${init?.agentInfo?.version} loadSession=${caps.loadSession} image=${caps.promptCapabilities?.image} fork=${!!caps.sessionCapabilities?.fork}`);
        record('init=' + JSON.stringify(init).slice(0, 800));

        // 2. session/new：models + modes
        const created = await p.request('session/new', { cwd: vault, mcpServers: [] });
        const sessionId = created?.sessionId;
        const models = created?.models?.availableModels ?? [];
        const modes = created?.modes?.availableModes ?? [];
        check('2 session/new 返回 sessionId+models+modes',
            !!sessionId && models.length > 0 && modes.length > 0,
            `models=${models.length} modes=[${modes.map((m) => m.id).join(',')}] current=${created?.modes?.currentModeId}`);
        record('new.models=' + JSON.stringify(models).slice(0, 600));
        record('new.modes=' + JSON.stringify(created?.modes).slice(0, 400));

        // 3. 纯对话流
        const r3 = await promptRound(p, sessionId, '回复两个字：你好。不要任何其他内容。');
        check('3 纯对话流式', r3.body.length > 0, `body=${r3.body.slice(0, 30)} stop=${r3.result?.stopReason}`);

        // 4. dont_ask 写文件：有工具事件、零批准
        await p.request('session/set_mode', { sessionId, modeId: 'dont_ask' });
        const r4 = await promptRound(p, sessionId, '在当前目录创建文件 probe-hello.txt，内容为 hi。用工具直接落盘，不要只给说明。', { autoAllow: false });
        const fileOk = existsSync(join(vault, 'probe-hello.txt'));
        const toolEvents4 = r4.events.filter((e) => e === 'tool_call' || e === 'tool_call_update').length;
        check('4 dont_ask 写文件免批准', fileOk && toolEvents4 > 0 && r4.permissionSeen.length === 0,
            `file=${fileOk} toolEvents=${toolEvents4} perms=${r4.permissionSeen.length}`);

        // 5. default 写文件：收到批准请求，options 含 allow_*，应答后落盘
        await p.request('session/set_mode', { sessionId, modeId: 'default' });
        const r5 = await promptRound(p, sessionId, '在当前目录创建文件 probe-hello2.txt，内容为 hi2。用工具直接落盘。', { autoAllow: true });
        const fileOk5 = existsSync(join(vault, 'probe-hello2.txt'));
        const perm0 = r5.permissionSeen[0];
        check('5 default 写文件触发批准卡', r5.permissionSeen.length > 0 && fileOk5,
            `perms=${r5.permissionSeen.length} file=${fileOk5} toolCall.title=${perm0?.toolCall?.title} metaKeys=${Object.keys(perm0?.toolCall?._meta ?? {}).join('|') || '(none)'}`);
        if (perm0) record('perm.options=' + JSON.stringify(perm0.options).slice(0, 400));
        if (perm0) record('perm.toolCall=' + JSON.stringify(perm0.toolCall).slice(0, 600));

        // 6. set_model（取第一个 modelId）
        const mid = models[0]?.modelId;
        const sm = await p.request('session/set_model', { sessionId, modelId: mid }).then(() => 'ok', (e) => `ERR:${e.message}`);
        check('6 session/set_model', sm === 'ok', `modelId=${mid} -> ${sm}`);

        // 7. fork
        const forked = await p.request('session/fork', { sessionId, cwd: vault });
        const newId = forked?.sessionId;
        check('7 session/fork 返回新 id', typeof newId === 'string' && newId.length > 0 && newId !== sessionId,
            `new=${newId}`);

        // 8. load 回放：事件在响应前到达、无 codebuddy.ai history meta
        const replayMeta = new Set();
        let replayCount = 0;
        let postResponseEvents = 0;
        const offR = (msg) => {
            if (msg.method === 'session/update' && msg.params?.sessionId === sessionId) {
                replayCount++;
                for (const k of Object.keys(msg.params?.update?._meta ?? {})) replayMeta.add(k);
            }
        };
        p.onMessage(offR);
        await p.request('session/load', { sessionId, cwd: vault, mcpServers: [] });
        const offPost = (msg) => {
            if (msg.method === 'session/update' && msg.params?.sessionId === sessionId) postResponseEvents++;
        };
        p.onMessage(offPost);
        await new Promise((r) => setTimeout(r, 800));
        check('8 load 回放:事件在响应前且无 history meta',
            replayCount > 0 && postResponseEvents === 0 && ![...replayMeta].some((k) => String(k).includes('codebuddy.ai')),
            `replayEvents=${replayCount} postResp=${postResponseEvents} metaKeys=[${[...replayMeta].join('|') || '(none)'}]`);

        // 9. load 不存在会话 → null(不抛错)
        let miss;
        try { miss = await p.request('session/load', { sessionId: 'nonexistent-probe-id-000', cwd: vault, mcpServers: [] }); }
        catch (e) { miss = `THREW:${e.message}`; }
        check('9 load 不存在会话返回 null', miss === null || miss === undefined, `got=${JSON.stringify(miss)}`);

        // 10. cancel
        let cancelReason = '';
        await promptRound(p, sessionId, '从 1 数到 300，每行一个数字，中间不要停。', {
            onFirstChunk: () => p.notify('session/cancel', { sessionId }),
        }).then((r) => { cancelReason = r.result?.stopReason ?? ''; }, (e) => { cancelReason = `ERR:${e.message}`; });
        check('10 session/cancel', cancelReason === 'cancelled', `stopReason=${cancelReason}`);
    } catch (e) {
        check('探针主流程异常中断', false, e instanceof Error ? e.message : String(e));
    } finally {
        p.kill();
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    record(`\nRESULT: ${passed} passed, ${failed} failed`);
    writeFileSync('/tmp/hermes-probe-findings.txt', findings.join('\n') + '\n');
    process.exit(failed ? 1 : 0);
}

main();
