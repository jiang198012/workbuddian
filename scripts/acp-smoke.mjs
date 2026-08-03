#!/usr/bin/env node
/**
 * ACP 冒烟回归（手动运行，不进 jest）：用真实 codebuddy CLI 回归 spike 七问。
 * 用法：node scripts/acp-smoke.mjs [vaultPath]
 * 环境变量 CODEBUDDY_PATH 可指定 CLI 路径；否则依次探测 WorkBuddy.app 默认路径与 PATH。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
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
        const created2 = await p.request('session/new', { cwd: vault, mcpServers: [] });
        const planSession = created2?.sessionId;
        const setModeResult = await p.request('session/set_mode', { sessionId: planSession, modeId: 'plan' })
            .catch(async (e) => {
                console.log(`  set_mode 失败(${e.message})，回退 set_config_option`);
                return p.request('session/set_config_option', { sessionId: planSession, configId: 'mode', value: 'plan' }).catch(() => ({}));
            });
        console.log('  set_mode(plan) 响应:', JSON.stringify(setModeResult ?? {}).slice(0, 120));
        const r8 = await promptRound(p, planSession,
            '给 smoke-acp.txt 追加一行「第二行」。先只做计划，不要执行。',
            { autoAllow: true, timeoutMs: 180_000 });
        const sawDefer = r8.permissionSeen.some((params) =>
            params?.toolCall?._meta?.['codebuddy.ai/toolName'] === 'DeferExecuteTool'
            || params?.toolCall?.rawInput?.toolName === 'ExitPlanMode');
        check('plan 模式收到 DeferExecuteTool 计划批准请求', sawDefer);
    } catch (e) {
        check(`运行异常: ${e.message}`, false);
    } finally {
        p.kill();
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
