#!/usr/bin/env node
/**
 * ACP 冒烟回归（手动运行，不进 jest）：用真实 codebuddy CLI 回归 spike 七问。
 * 用法：node scripts/acp-smoke.mjs [vaultPath]
 * 环境变量 CODEBUDDY_PATH 可指定 CLI 路径；否则依次探测 WorkBuddy.app 默认路径与 PATH。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const vault = process.argv[2] || mkdtempSync(join(tmpdir(), 'acp-smoke-'));
const CLI_CANDIDATES = [
    process.env.CODEBUDDY_PATH,
    '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
    'codebuddy',
].filter(Boolean);
const cli = CLI_CANDIDATES.find((p) => p === 'codebuddy' || existsSync(p));

let passed = 0, failed = 0;
const check = (name, ok, extra = '') => {
    ok ? passed++ : failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

class AcpProc {
    constructor(bin, cwd) {
        this.buf = '';
        this.nextId = 1;
        this.pending = new Map();
        this.notificationHandlers = [];
        this.proc = spawn(bin, ['--acp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
        this.proc.stdout.on('data', (d) => {
            this.buf += d.toString('utf8');
            let i;
            while ((i = this.buf.indexOf('\n')) >= 0) {
                const line = this.buf.slice(0, i).trim();
                this.buf = this.buf.slice(i + 1);
                if (line) this.handleLine(line);
            }
        });
        this.proc.stderr.on('data', (d) => process.stderr.write(`[cli-stderr] ${d}`));
    }
    handleLine(line) {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method && msg.id !== undefined) {
            for (const h of this.notificationHandlers) h(msg);
            return;
        }
        if (msg.method) {
            for (const h of this.notificationHandlers) h(msg);
            return;
        }
        const p = this.pending.get(msg.id);
        if (p) {
            this.pending.delete(msg.id);
            msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        }
    }
    onMessage(fn) { this.notificationHandlers.push(fn); }
    request(method, params, timeoutMs = 60_000) {
        const id = this.nextId++;
        this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, timeoutMs);
            this.pending.set(id, {
                resolve: (v) => { clearTimeout(timer); resolve(v); },
                reject: (e) => { clearTimeout(timer); reject(e); },
            });
        });
    }
    notify(method, params) { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
    respond(id, result) { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
    kill() { try { this.proc.kill(); } catch { /* noop */ } }
}

/** 发一轮 prompt，收集正文/权限请求；autoAllow 时权限请求一律答 allow_once */
async function promptRound(p, sessionId, text, { autoAllow = false, onFirstChunk = null, timeoutMs = 60_000 } = {}) {
    let body = '';
    const permissionSeen = [];
    const off = (msg) => {
        if (msg.method === 'session/update') {
            const u = msg.params?.update ?? {};
            if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
                body += u.content.text;
                if (onFirstChunk) { onFirstChunk(); onFirstChunk = null; }
            }
        } else if (msg.method === 'session/request_permission') {
            permissionSeen.push(msg.params);
            if (autoAllow) p.respond(msg.id, { outcome: { outcome: 'selected', optionId: 'allow' } });
        }
    };
    p.onMessage(off);
    const startedAt = Date.now();
    const result = await p.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, timeoutMs);
    return { result, body, permissionSeen, ms: Date.now() - startedAt };
}

async function main() {
    console.log(`vault: ${vault}\ncli:   ${cli}`);
    if (!cli) { check('CLI 可定位', false); process.exit(1); }
    const p = new AcpProc(cli, vault);
    let sessionId = null;
    try {
        // 1. 握手
        const init = await p.request('initialize', {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        });
        check('initialize 握手', init?.protocolVersion === 1 && !!init?.agentCapabilities);

        // 2. session/new
        const created = await p.request('session/new', { cwd: vault, mcpServers: [] });
        sessionId = created?.sessionId;
        check('session/new 返回 sessionId 与模型列表',
            !!sessionId && (created?.models?.availableModels?.length ?? 0) > 0,
            `models=${created?.models?.availableModels?.length ?? 0}`);

        // 3/4. 多轮：第二轮应显著更快（上下文真保持）
        const r1 = await promptRound(p, sessionId, '只回复两个字：收到。不要调用任何工具。');
        check('第 1 轮 prompt end_turn', r1.result?.stopReason === 'end_turn', `${(r1.ms / 1000).toFixed(1)}s body=${JSON.stringify(r1.body)}`);
        const r2 = await promptRound(p, sessionId, '再说一次。');
        check('第 2 轮 prompt end_turn（同 session 上下文保持）', r2.result?.stopReason === 'end_turn',
            `${(r2.ms / 1000).toFixed(1)}s vs 首轮 ${(r1.ms / 1000).toFixed(1)}s`);

        // 5. 权限请求：批准一次真实落盘
        const target = join(vault, 'smoke-acp.txt');
        const r5 = await promptRound(p, sessionId,
            '创建文件 smoke-acp.txt，内容为：ok。必须实际调用文件写入工具完成，不要只描述。', { autoAllow: true });
        check('收到 session/request_permission 权限请求', r5.permissionSeen.length > 0,
            r5.permissionSeen[0]?.toolCall?._meta?.['codebuddy.ai/toolName'] ?? '');
        check('批准 allow_once 后文件真实落盘', existsSync(target) && readFileSync(target, 'utf8').includes('ok'));

        // 6. cancel：即时生效，stopReason cancelled
        const r6Promise = promptRound(p, sessionId, '从 1 数到 100000，每个数字换一行，慢慢数。');
        const r6 = await Promise.race([
            (async () => {
                await new Promise((r) => setTimeout(r, 3000));
                p.notify('session/cancel', { sessionId });
                return r6Promise;
            })(),
        ]);
        check('session/cancel 即时生效 stopReason=cancelled', r6.result?.stopReason === 'cancelled');

        // 7. session/load 全量回放
        let replayCount = 0;
        p.onMessage((msg) => { if (msg.method === 'session/update') replayCount++; });
        await p.request('session/load', { sessionId, cwd: vault, mcpServers: [] });
        check('session/load 回放历史事件', replayCount > 0, `replay=${replayCount}`);

        // 8. plan 模式：DeferExecuteTool 权限请求（真·计划批准链）。
        // 用全新会话跑（与 spike probe5 场景同构）：带历史/被 cancel 过的会话里模型行为有随机性，
        // 本步回归的是 set_mode → 计划 → DeferExecuteTool → 批准 → 自动继续 的协议链，非模型创意。
        // 实测模型约有一半概率只回文本计划不走工具：失败时用全新会话重试一次，两次都空才判 FAIL。
        const planAttempt = async () => {
            const created = await p.request('session/new', { cwd: vault, mcpServers: [] });
            const planSession = created?.sessionId;
            await p.request('session/set_mode', { sessionId: planSession, modeId: 'plan' })
                .catch(async (e) => {
                    console.log(`  set_mode 失败(${e.message})，回退 set_config_option`);
                    return p.request('session/set_config_option', { sessionId: planSession, configId: 'mode', value: 'plan' }).catch(() => ({}));
                });
            const r = await promptRound(p, planSession,
                '给 smoke-acp.txt 追加一行「第二行」。先只做计划，不要执行。',
                { autoAllow: true, timeoutMs: 180_000 });
            const saw = r.permissionSeen.some((params) =>
                params?.toolCall?._meta?.['codebuddy.ai/toolName'] === 'DeferExecuteTool'
                || params?.toolCall?.rawInput?.toolName === 'ExitPlanMode');
            const tools = r.permissionSeen.map((params) =>
                params?.toolCall?._meta?.['codebuddy.ai/toolName'] ?? params?.toolCall?.rawInput?.toolName ?? '?').join(',');
            return { saw, diag: `seen=[${tools}] body=${JSON.stringify(r.body.slice(0, 80))}` };
        };
        const plan1 = await planAttempt();
        const plan2 = plan1.saw ? plan1 : await planAttempt();
        check('plan 模式收到 DeferExecuteTool 计划批准请求（至多两次尝试）', plan1.saw || plan2.saw,
            plan1.saw || plan2.saw ? (plan1.saw ? '' : '第二次尝试命中') : `${plan1.diag} | ${plan2.diag}`);

        // 9. fork：/branch → session_info_update 回报 newSessionId → load 验证
        let forkedId = null;
        let forkedCnId = null;
        p.onMessage((msg) => {
            const u = msg.params?.update ?? {};
            const meta = u._meta ?? {};
            if (msg.method === 'session/update' && u.sessionUpdate === 'session_info_update'
                && meta['codebuddy.ai/sessionReset'] && meta['codebuddy.ai/newSessionId']) {
                if (!forkedId) forkedId = meta['codebuddy.ai/newSessionId'];
                else forkedCnId = meta['codebuddy.ai/newSessionId'];
            }
        });
        await promptRound(p, sessionId, '/branch smoke-fork');
        check('/branch 回报 newSessionId', !!forkedId, forkedId ?? '');
        if (forkedId) {
            await p.request('session/load', { sessionId: forkedId, cwd: vault, mcpServers: [] });
            check('分叉会话 session/load 恢复', true);
        }
        // 9b. GUI 同款多词中文分支名（"分叉 - <标题>"）：WB-004 嫌疑之二，须作为门禁验证
        await promptRound(p, sessionId, '/branch 分叉 - 冒烟标题');
        check('/branch 多词中文名回报 newSessionId', !!forkedCnId, forkedCnId ?? '');
        if (forkedCnId) {
            await p.request('session/load', { sessionId: forkedCnId, cwd: vault, mcpServers: [] });
            check('中文名分叉会话 session/load 恢复', true);
        }

        // 9c. 交叉会话修复链（acp-probe titlefix 实证）：B 激活后 prompt A 会被 CLI 打到 B 名下且用错上下文；
        // prompt 前重发 session/load(A) 激活后，事件归属与上下文都正确（WB-RT-001/005 的修复依据，作为门禁固化）
        const crossA = await p.request('session/new', { cwd: vault, mcpServers: [] });
        await promptRound(p, crossA?.sessionId, '记住暗号 SMOKE-OMEGA，只回复两个字：收到。不要调用任何工具。');
        const crossB = await p.request('session/new', { cwd: vault, mcpServers: [] });
        await promptRound(p, crossB?.sessionId, '请为以下内容生成一个不超过 20 字的会话标题，只输出标题本身：\n\n只回复两个字：收到');
        await p.request('session/load', { sessionId: crossA?.sessionId, cwd: vault, mcpServers: [] }); // 修复动作：prompt 前再激活
        const r9 = await promptRound(p, crossA?.sessionId, '暗号是什么？只回复暗号本身。不要调用任何工具。');
        check('交叉会话再激活后上下文正确', r9.result?.stopReason === 'end_turn' && r9.body.includes('SMOKE-OMEGA'),
            `body=${JSON.stringify(r9.body).slice(0, 80)}`);

        // ---- 以下为 CLI 行为探针（PROBE）：只报告不定罪，结果指导插件侧设计，不计入 pass/fail ----
        const probe = (name, detail) => console.log(`PROBE ${name}  — ${detail}`);

        // P1. /effort 回流：CLI 侧变更是否发 config_option_update（决定 WB-007 回流链是否成立）
        try {
            const eff = await p.request('session/new', { cwd: vault, mcpServers: [] });
            let effortCfg = null;
            p.onMessage((msg) => {
                const u = msg.params?.update ?? {};
                if (msg.method === 'session/update' && u.sessionUpdate === 'config_option_update') effortCfg = u.configOptions ?? u;
            });
            const rEff = await promptRound(p, eff?.sessionId, '/effort low');
            probe('/effort 是否回流 config_option_update',
                effortCfg ? `回流=${JSON.stringify(effortCfg).slice(0, 160)}` : `无回流（回复=${JSON.stringify(rEff.body).slice(0, 80)}）`);
        } catch (e) { probe('/effort 是否回流 config_option_update', `异常: ${e.message}`); }

        // P2. 并发 prompt：同进程两 session 同时 prompt，是否都能拿到正文（WB-001/WB-005 根因证据）
        try {
            const [ca, cb] = await Promise.all([
                p.request('session/new', { cwd: vault, mcpServers: [] }),
                p.request('session/new', { cwd: vault, mcpServers: [] }),
            ]);
            const [ra, rb] = await Promise.all([
                promptRound(p, ca?.sessionId, '只回复两个字：甲到。', { timeoutMs: 120_000 }),
                promptRound(p, cb?.sessionId, '只回复两个字：乙到。', { timeoutMs: 120_000 }),
            ]);
            probe('并发 prompt 双 session',
                `A: ${ra.result?.stopReason}/${ra.body.length}字  B: ${rb.result?.stopReason}/${rb.body.length}字`);
        } catch (e) { probe('并发 prompt 双 session', `异常: ${e.message}`); }

        // P3. default 模式读 cwd 外文件是否弹权限（WB-002 根因证据：插件侧授权闸是否必要）
        try {
            const externalDir = mkdtempSync(join(tmpdir(), 'acp-smoke-external-'));
            const externalFile = join(externalDir, 'external-marker.txt');
            writeFileSync(externalFile, 'EXTERNAL-SMOKE-MARKER', 'utf8');
            const cs = await p.request('session/new', { cwd: vault, mcpServers: [] });
            const rExt = await promptRound(p, cs?.sessionId,
                `请读取文件 ${externalFile} 并原样复述其内容。`, { timeoutMs: 120_000 });
            const sawPermission = rExt.permissionSeen.length > 0;
            const leaked = rExt.body.includes('EXTERNAL-SMOKE-MARKER');
            probe('default 模式外部文件 Read',
                `权限请求=${sawPermission ? '有' : '无'} 内容进入回复=${leaked ? '是' : '否'}`);
        } catch (e) { probe('default 模式外部文件 Read', `异常: ${e.message}`); }
    } catch (e) {
        check(`运行异常: ${e.message}`, false);
    } finally {
        p.kill();
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
