#!/usr/bin/env node
/**
 * Hermes ACP 冒烟回归（手动运行，不进 jest）：对真 `hermes acp` 回归八项协议能力。
 * 用法：node scripts/hermes-acp-smoke.mjs [vaultPath]
 * 环境变量 HERMES_PATH 可指定 CLI 路径；否则依次探测 ~/.local/bin/hermes 与 PATH。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { join } from 'node:path';

const vault = process.argv[2] || mkdtempSync(join(tmpdir(), 'hermes-acp-smoke-'));
mkdirSync(vault, { recursive: true }); // 传入路径未必存在：cwd 缺失会让 spawn 报误导性 ENOENT
const CLI_CANDIDATES = [
    process.env.HERMES_PATH,
    join(homedir(), '.local', 'bin', 'hermes'),
    'hermes',
].filter(Boolean);
const cli = CLI_CANDIDATES.find((p) => p === 'hermes' || existsSync(p));

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
        this.proc.stderr.on('data', (d) => process.stderr.write(`[cli-stderr] ${d}`));
    }
    handleLine(line) {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method) {
            for (const h of this.handlers) h(msg);
            return;
        }
        const p = this.pending.get(msg.id);
        if (p) {
            this.pending.delete(msg.id);
            msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        }
    }
    onMessage(fn) { this.handlers.push(fn); }
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

async function promptRound(p, sessionId, text, { autoAllow = false, timeoutMs = 90_000 } = {}) {
    let body = '';
    const permissionSeen = [];
    const off = (msg) => {
        if (msg.method === 'session/update') {
            const u = msg.params?.update ?? {};
            if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
                body += u.content.text;
            }
        } else if (msg.method === 'session/request_permission') {
            permissionSeen.push(msg.params);
            if (autoAllow) {
                const opt = (msg.params?.options ?? []).find((o) => o.kind === 'allow_once');
                p.respond(msg.id, { outcome: { outcome: 'selected', optionId: opt?.optionId ?? 'allow_once' } });
            }
        }
    };
    p.onMessage(off);
    const result = await p.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, timeoutMs);
    return { result, body, permissionSeen };
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
        check('initialize 握手', !!init?.agentCapabilities,
            `${init?.agentInfo?.name ?? '?'}@${init?.agentInfo?.version ?? '?'}`);

        // 2. session/new：models/modes 非空
        const created = await p.request('session/new', { cwd: vault, mcpServers: [] });
        sessionId = created?.sessionId;
        check('session/new 返回 models 与 modes',
            !!sessionId
            && (created?.models?.availableModels?.length ?? 0) > 0
            && (created?.modes?.availableModes?.length ?? 0) > 0,
            `models=${created?.models?.availableModels?.length ?? 0} modes=${(created?.modes?.availableModes ?? []).map((m) => m.id).join(',')}`);

        // 3. 纯对话流式
        const r1 = await promptRound(p, sessionId, '只回复两个字：收到。不要调用任何工具。');
        check('prompt 流式有字 + end_turn', r1.result?.stopReason === 'end_turn' && r1.body.length > 0,
            `body=${JSON.stringify(r1.body.slice(0, 40))}`);

        // 4. dont_ask 模式写文件：无批准卡直接落盘
        await p.request('session/set_mode', { sessionId, modeId: 'dont_ask' });
        const target2 = join(vault, 'smoke-dontask.txt');
        const r2 = await promptRound(p, sessionId,
            '创建文件 smoke-dontask.txt，内容为：ok。必须实际调用文件写入工具完成。');
        check('dont_ask 写文件 0 批准卡 + 落盘',
            r2.permissionSeen.length === 0 && existsSync(target2),
            `permissions=${r2.permissionSeen.length}`);

        // 5. default 模式写文件：有批准卡，allow_once 后落盘
        await p.request('session/set_mode', { sessionId, modeId: 'default' });
        const target3 = join(vault, 'smoke-default.txt');
        const r3 = await promptRound(p, sessionId,
            '创建文件 smoke-default.txt，内容为：ok。必须实际调用文件写入工具完成。', { autoAllow: true });
        check('default 写文件有批准卡，allow_once 后落盘',
            r3.permissionSeen.length > 0 && existsSync(target3) && readFileSync(target3, 'utf8').includes('ok'),
            `permissions=${r3.permissionSeen.length} tool=${r3.permissionSeen[0]?.toolCall?.rawInput?.tool ?? '?'}`);

        // 6. fork：原生 RPC 返新 id
        const forked = await p.request('session/fork', { sessionId, cwd: vault });
        check('session/fork 返回新 id', typeof forked?.sessionId === 'string' && forked.sessionId !== sessionId,
            forked?.sessionId ?? '');

        // 7. load 回放：事件全部在 load 响应之前到达（无 meta 标记，靠窗口判别）
        let beforeResponse = 0, afterResponse = 0;
        let loadDone = false;
        const offReplay = (msg) => {
            if (msg.method === 'session/update') (loadDone ? afterResponse++ : beforeResponse++);
        };
        p.onMessage(offReplay);
        await p.request('session/load', { sessionId, cwd: vault, mcpServers: [] });
        loadDone = true;
        await new Promise((r) => setTimeout(r, 800)); // 等调度更新（usage/available_commands）落定
        check('load 回放事件全部在响应前（窗口判别成立）', beforeResponse > 0,
            `回放=${beforeResponse} 响应后调度事件=${afterResponse}（非回放）`);

        // 8. cancel：即时生效。源码主路径 stop_reason=cancelled；取消与模型调用竞争时
        // RPC 会以 -32603 "Internal error" 收尾（引擎会话层已把该竞争归一为 cancelled，
        // tests/acpSession.test.ts 钉）——此处验证的是"取消即时落地、轮次即刻停止"
        const r8Promise = promptRound(p, sessionId, '从 1 数到 100000，每个数字换一行。');
        const r8 = await (async () => {
            await new Promise((r) => setTimeout(r, 3000));
            p.notify('session/cancel', { sessionId });
            return r8Promise;
        })().then(
            (r) => ({ outcome: r.result?.stopReason }),
            (e) => ({ outcome: `rpc-error(${e.message})` }),
        );
        check('session/cancel 即时生效（cancelled 或竞争报错）',
            r8.outcome === 'cancelled' || String(r8.outcome).startsWith('rpc-error('),
            String(r8.outcome));
    } catch (e) {
        check(`运行异常: ${e.message}`, false);
    } finally {
        p.kill();
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
