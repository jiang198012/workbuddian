import { spawn } from 'child_process';
import {
    findNodeExecutable, isBareFallback, isWindowsWrapper, needsWindowsShell, resolveCodebuddyPath,
} from '../../../utils/cliPath';
import { bbLog, bbError } from '../../../shared/logBuffer';
import type { AcpUpdate } from './events';

export type AcpStartTier = 'cli-not-found' | 'acp-unsupported' | 'auth-required' | 'handshake-failed';

export class AcpStartError extends Error {
    constructor(readonly tier: AcpStartTier, message: string) {
        super(message);
        this.name = 'AcpStartError';
    }
}

export interface AcpClientEvents {
    onSessionUpdate(sessionId: string, update: AcpUpdate): void;
    onPermissionRequest(requestId: number, params: unknown): void;
    onAgentNotification(method: string, params: unknown): void;
    onModels(models: string[]): void;
    onExit(code: number | null, signal: string | null): void;
}

/** 三分支 spawn 构建（与 v1 内联逻辑同策略，收敛为纯函数便于测试）：wrapper/bare 直起，脚本走 node */
export function buildSpawnCommand(scriptPath: string, nodePathOverride: string, args: string[]):
    { command: string; args: string[]; shell: boolean } {
    if (isWindowsWrapper(scriptPath) || isBareFallback(scriptPath)) {
        return { command: scriptPath, args, shell: needsWindowsShell(scriptPath) };
    }
    const node = nodePathOverride || findNodeExecutable() || 'node';
    return { command: node, args: [scriptPath, ...args], shell: false };
}

/** 握手期早退的 stderr 分类：命中"未知选项/命令"=旧版 CLI 无 --acp */
export function classifyHandshakeFailure(stderr: string): AcpStartTier {
    return /unrecogni[sz]ed|unknown (option|command|flag)|invalid option|unknown argument/i.test(stderr)
        ? 'acp-unsupported' : 'handshake-failed';
}

export function isAuthError(message: string): boolean {
    return /auth|logged|login|unauthorized|登录|未登录/i.test(message);
}

const HANDSHAKE_TIMEOUT_MS = 10_000;
/** 普通 RPC 的兜底超时：请求发出后无人应答不能永久悬挂（WB-005 的"会话正在响应中"即悬挂后遗症） */
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;

/** RPC 出站日志的参数摘要：prompt 只留块数与文本总长，避免把用户正文灌进 300 条环形日志 */
function summarizeRpcParams(method: string, params: Record<string, unknown>): string {
    try {
        let p = params;
        if (method === 'session/prompt' && Array.isArray(params.prompt)) {
            const blocks = params.prompt as Array<{ type?: unknown; text?: unknown }>;
            const textLen = blocks.reduce((n, b) => n + (typeof b?.text === 'string' ? b.text.length : 0), 0);
            p = { ...params, prompt: `<${blocks.length} blocks, ${textLen} chars>` };
        }
        const s = JSON.stringify(p);
        return s.length > 300 ? s.slice(0, 297) + '...' : s;
    } catch {
        return '';
    }
}

/**
 * ACP 传输层：单进程 `codebuddy --acp`，stdio ndjson JSON-RPC。
 * 懒启动（首次 ensureStarted 才 spawn+握手）；请求表 id 递增；通知与 agent 请求按 events 回调分发。
 * session/prompt 串行化：单 CLI 进程对并发 prompt 不可靠（丢 chunk / 不应答，见 WB-001/WB-005），
 * 自动标题、分叉、双面板的 prompt 一律排队，同一时刻只跑一个。
 */
export class AcpClient {
    private scriptPath = '';
    private nodePath = '';
    private extraArgs: string[] = []; // 追加在 --acp 之后的 CLI 旗标（如 --agents）
    private proc: ReturnType<typeof spawn> | null = null;
    private nextId = 1;
    private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    private buffer = '';
    private stderrTail = '';
    private startPromise: Promise<void> | null = null;
    private disposed = false;
    private handshakeDone = false;
    private promptChain: Promise<void> = Promise.resolve(); // session/prompt 串行队列
    private promptQueued = 0; // 队列中未落账的 prompt 数（>0 时后续 prompt 记排队日志）
    /** prompt 挂死兜底（provider 轮级超时 + 宽限）：CLI 连 cancel 都不应答时由此断链，队列才能放行后续 prompt */
    promptTimeoutMs = 6 * 60_000;

    constructor(private readonly events: AcpClientEvents) {
        this.scriptPath = resolveCodebuddyPath('');
    }

    setCodebuddyPath(p: string): void {
        const next = resolveCodebuddyPath(p);
        if (next === this.scriptPath) return;
        this.scriptPath = next;
        if (this.proc) this.dispose(); // 变更即重启：下次 ensureStarted 用新路径，会话经 load 恢复
    }
    setNodePath(p: string): void {
        if (p === this.nodePath) return;
        this.nodePath = p;
        if (this.proc) this.dispose();
    }
    setExtraArgs(args: string[]): void {
        if (args.join('\n') === this.extraArgs.join('\n')) return;
        this.extraArgs = args;
        if (this.proc) this.dispose();
    }
    getScriptPath(): string { return this.scriptPath; }
    get running(): boolean { return this.proc !== null; }

    ensureStarted(): Promise<void> {
        if (this.proc) return Promise.resolve();
        if (this.startPromise) return this.startPromise;
        this.disposed = false;
        this.startPromise = this.spawnAndHandshake().then(
            () => { this.startPromise = null; },
            (e) => { this.startPromise = null; throw e; },
        );
        return this.startPromise;
    }

    request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
        if (method === 'session/prompt') {
            // 串行队列：等前一个 prompt 落账（含失败）再发；挂死由 promptTimeoutMs 断链
            return this.enqueuePrompt(() => this.doRequest<T>(method, params, this.promptTimeoutMs));
        }
        return this.doRequest<T>(method, params, DEFAULT_REQUEST_TIMEOUT_MS);
    }

    /**
     * 把一组操作作为原子单元排进 prompt 串行队列（session 层用来把"再激活 load + prompt"绑在一起：
     * 排队期间别的会话不会把 CLI 的活动会话指针抢走）。fn 内发 prompt 本体必须走 rawRequest，否则自排队死锁。
     */
    enqueuePrompt<T>(fn: () => Promise<T>): Promise<T> {
        if (this.promptQueued > 0) bbLog('[WB] prompt 排队等待（前面有未落账轮次）');
        this.promptQueued++;
        const run = this.promptChain.then(async () => {
            try {
                return await fn();
            } finally {
                this.promptQueued--;
            }
        });
        this.promptChain = run.then(() => undefined, () => undefined);
        return run;
    }

    /** 绕过串行队列直接发请求：仅供 enqueuePrompt 的 fn 内部使用（prompt 超时仍按 promptTimeoutMs） */
    rawRequest<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
        const timeout = method === 'session/prompt' ? this.promptTimeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;
        return this.doRequest<T>(method, params, timeout);
    }

    private doRequest<T = unknown>(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<T> {
        if (!this.proc) return Promise.reject(new Error('acp client not started'));
        const id = this.nextId++;
        this.write({ jsonrpc: '2.0', id, method, params });
        bbLog('[WB] acp 请求:', method, summarizeRpcParams(method, params));
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                bbError('[WB] acp 请求超时:', method);
                reject(new Error(`acp request timeout: ${method}`));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (v) => { clearTimeout(timer); resolve(v as T); },
                reject: (e) => { clearTimeout(timer); reject(e); },
            });
        });
    }

    notify(method: string, params: Record<string, unknown>): void {
        if (!this.proc) { bbLog('[WB] acp notify 时进程不在:', method); return; }
        this.write({ jsonrpc: '2.0', method, params });
        bbLog('[WB] acp 通知出站:', method);
    }

    respond(requestId: number, result: unknown): void {
        if (!this.proc) { bbLog('[WB] acp respond 时进程不在:', requestId); return; }
        this.write({ jsonrpc: '2.0', id: requestId, result });
    }

    /** 对 agent→client 请求的错误应答（未支持的方法）：防止 CLI 干等响应把 prompt 挂死 */
    respondError(requestId: number, message: string): void {
        if (!this.proc) return;
        this.write({ jsonrpc: '2.0', id: requestId, error: { code: -32601, message } });
    }

    dispose(): void {
        this.disposed = true;
        const proc = this.proc;
        this.proc = null;
        this.startPromise = null;
        this.failAllPending(new Error('acp client disposed'));
        if (proc) { try { proc.kill(); } catch { /* 已退出 */ } }
    }

    // ---- 内部 ----

    private write(msg: Record<string, unknown>): void {
        this.proc?.stdin?.write(JSON.stringify(msg) + '\n');
    }

    private failAllPending(err: Error): void {
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
    }

    private handleLine(line: string): void {
        let msg: { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: { message?: string } };
        try {
            msg = JSON.parse(line);
        } catch {
            bbLog('[WB] acp 非 JSON 行:', line.slice(0, 200));
            return;
        }
        if (typeof msg.method === 'string' && msg.id !== undefined) {
            // agent → client 请求（目前只见 session/request_permission）
            if (msg.method === 'session/request_permission' && typeof msg.id === 'number') {
                this.events.onPermissionRequest(msg.id, msg.params);
            } else if (typeof msg.id === 'number') {
                // 未实现的 agent 请求必须回错误应答：JSON-RPC 请求没有响应，CLI 会一直等，
                // 表现为 prompt 挂死（附件触发的 fs/read_text_file 即嫌疑路径）
                bbLog('[WB] 未支持的 agent 请求，回 method not found:', msg.method);
                this.respondError(msg.id, `client does not support ${msg.method}`);
            }
            return;
        }
        if (typeof msg.method === 'string') {
            this.handleNotification(msg.method, msg.params);
            return;
        }
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.error) {
                p.reject(new Error(msg.error.message || 'acp rpc error'));
                return;
            }
            this.reportModels(msg.result);
            p.resolve(msg.result);
        }
    }

    private handleNotification(method: string, params: unknown): void {
        if (method === 'session/update') {
            const rec = params && typeof params === 'object' ? params as Record<string, unknown> : {};
            const sessionId = typeof rec.sessionId === 'string' ? rec.sessionId : '';
            const update = rec.update as AcpUpdate | undefined;
            if (sessionId && update) this.events.onSessionUpdate(sessionId, update);
            return;
        }
        this.events.onAgentNotification(method, params);
    }

    private reportModels(result: unknown): void {
        const models = (result as { models?: { availableModels?: Array<{ modelId?: unknown }> } })
            ?.models?.availableModels;
        if (Array.isArray(models) && models.length) {
            this.events.onModels(models.map((m) => String(m.modelId)).filter(Boolean));
        }
    }

    private spawnAndHandshake(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const { command, args, shell } = buildSpawnCommand(this.scriptPath, this.nodePath, ['--acp', ...this.extraArgs]);
            let proc: ReturnType<typeof spawn>;
            try {
                proc = spawn(command, args, { shell });
            } catch (e) {
                reject(new AcpStartError('cli-not-found', String(e)));
                return;
            }
            this.proc = proc;
            this.buffer = '';
            this.stderrTail = '';
            let settled = false;
            const fail = (err: AcpStartError) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.proc = null;
                try { proc.kill(); } catch { /* noop */ }
                this.failAllPending(err); // 握手期的 initialize 请求也要落账，否则其超时计时器悬挂（jest 实测泄漏）
                reject(err);
            };
            const timer = setTimeout(() => {
                fail(new AcpStartError('handshake-failed', `handshake timeout after ${HANDSHAKE_TIMEOUT_MS}ms`));
            }, HANDSHAKE_TIMEOUT_MS);

            proc.stdout.on('data', (data: Buffer) => {
                this.buffer += data.toString('utf8');
                let idx: number;
                while ((idx = this.buffer.indexOf('\n')) >= 0) {
                    const line = this.buffer.slice(0, idx).trim();
                    this.buffer = this.buffer.slice(idx + 1);
                    if (line) this.handleLine(line);
                }
            });
            proc.stderr.on('data', (data: Buffer) => {
                const text = data.toString('utf8');
                bbLog('[WB] acp stderr:', text.trim());
                this.stderrTail = (this.stderrTail + text).slice(-2000);
            });
            proc.on('error', (e: Error) => {
                fail(new AcpStartError(e.message.includes('ENOENT') ? 'cli-not-found' : 'handshake-failed', e.message));
            });
            proc.on('close', (code: number | null, signal: string | null) => {
                const wasStarting = !settled;
                const wasDisposed = this.disposed;
                const hadStarted = this.handshakeDone;
                this.handshakeDone = false;
                this.proc = null;
                this.buffer = '';
                this.failAllPending(new Error('acp process exited'));
                if (wasStarting) {
                    fail(new AcpStartError(
                        classifyHandshakeFailure(this.stderrTail),
                        this.stderrTail.trim().slice(-300) || `process exited (${code}) before handshake`,
                    ));
                    return;
                }
                // error(ENOENT)+close 是同一次死亡的两声炮：握手没成过就不重复报 onExit
                if (!wasDisposed && hadStarted) this.events.onExit(code, signal);
            });

            // 握手：initialize 成功即启动完成
            this.request('initialize', {
                protocolVersion: 1,
                clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
            }).then(() => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.handshakeDone = true;
                resolve();
            }, (e: Error) => {
                fail(new AcpStartError(isAuthError(e.message) ? 'auth-required' : 'handshake-failed', e.message));
            });
        });
    }
}
