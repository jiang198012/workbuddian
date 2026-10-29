/**
 * CodeBuddy 官方 CLI 的“一键登录”服务端逻辑（纯 Node，无 Obsidian 依赖）。
 *
 * 思路：官方 CLI 自带 Web UI 登录页（Chinese Site / iOA / 企业域名 等），
 * 插件只需：
 *   1. 以 `--serve --acp` 启动官方 CLI（随机回环端口）；
 *   2. 把打印出来的 Web UI URL 交给 Obsidian 打开浏览器；
 *   3. 用 ACP `session/new` 轮询登录状态（未登录时返回 Authentication required）。
 * 登录完成后 CLI 自己落盘凭据，插件下次启动即复用，无需终端 /login。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { request as httpRequest } from 'http';
import { statSync } from 'fs';
import {
    findNodeExecutable, isBareFallback, isWindowsWrapper, needsWindowsShell,
} from '../utils/cliPath';
import { WorkbuddyHostConnection } from '../providers/codebuddy/workbuddyHost';

export interface CodebuddyLoginServer {
    /** 官方 CLI 打印的 ACP 端点（不带尾部斜杠） */
    endpoint: string;
    /** 带 password 查询参数的 Web UI 登录页，直接交给系统浏览器打开 */
    url: string;
    /** 网关 Bearer token：ACP /connect 需要它（Web UI 用同一 token 自动登录） */
    authToken: string;
    dispose(): Promise<void>;
}

export interface StartLoginServerOptions {
    cliPath: string;
    nodePath?: string;
    cwd: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}

export type CodebuddyLoginProbe = 'authenticated' | 'auth-required' | 'unknown';

const DEFAULT_START_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60_000;

/** 去掉 CLI 输出里的 ANSI 颜色，便于稳定解析 */
function stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function isLoopbackHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'http:'
            && ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
    } catch { return false; }
}

export function parseLoginServerOutput(text: string): { endpoint?: string; webUiUrl?: string } {
    const clean = stripAnsi(text);
    const endpoint = /Endpoint\s+(http:\/\/[^\s]+)/.exec(clean)?.[1]?.replace(/\/$/, '');
    const webUiUrl = /Web UI\s+(http:\/\/[^\s]+)/.exec(clean)?.[1];
    return {
        ...(endpoint && isLoopbackHttpUrl(endpoint) ? { endpoint } : {}),
        ...(webUiUrl && isLoopbackHttpUrl(webUiUrl) ? { webUiUrl } : {}),
    };
}

function loginCommand(cliPath: string, nodePath: string | undefined, args: string[]): {
    command: string; args: string[]; shell: boolean;
} {
    if (isWindowsWrapper(cliPath) || isBareFallback(cliPath)) {
        return { command: cliPath, args, shell: needsWindowsShell(cliPath) };
    }
    const node = nodePath?.trim() || findNodeExecutable() || 'node';
    return { command: node, args: [cliPath, ...args], shell: false };
}

/**
 * 启动官方 CLI 的临时 Web UI/ACP 服务。只有官方完整包才有 Web UI；
 * WorkBuddy 内置的精简 CLI 会因缺少 Web UI 而在这里明确报错。
 */
export async function startCodebuddyLoginServer(opts: StartLoginServerOptions): Promise<CodebuddyLoginServer> {
    if (!opts.cliPath.trim()) throw new Error('未找到 CodeBuddy CLI');
    try {
        if (!statSync(opts.cwd).isDirectory()) throw new Error();
    } catch { throw new Error('Vault 路径不存在，无法启动 CodeBuddy 登录服务'); }
    if (opts.signal?.aborted) throw new Error('登录已取消');

    const timeoutMs = opts.timeoutMs ?? DEFAULT_START_TIMEOUT_MS;
    const args = ['--serve', '--acp', '--acp-transport', 'streamable-http', '--port', '0', '--host', '127.0.0.1'];
    const { command, args: spawnArgs, shell } = loginCommand(opts.cliPath, opts.nodePath, args);
    let child: ChildProcessWithoutNullStreams;
    try {
        child = spawn(command, spawnArgs, {
            cwd: opts.cwd,
            env: { ...process.env },
            shell,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        }) as ChildProcessWithoutNullStreams;
    } catch (e) {
        throw new Error(`无法启动 CodeBuddy 登录服务：${(e as Error).message}`);
    }

    let disposed = false;
    let ready = false;
    let output = '';
    let timer: ReturnType<typeof setTimeout> | undefined;

    const exit = new Promise<void>((resolve) => {
        child.once('close', () => resolve());
        child.once('error', () => resolve());
    });

    const dispose = async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        if (child.exitCode === null && !child.killed) {
            try { child.kill('SIGTERM'); } catch { /* 已退出 */ }
            await Promise.race([
                exit,
                new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
            ]);
            if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch { /* 已退出 */ } }
        }
    };

    const onAbort = () => {
        void dispose();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    return await new Promise<CodebuddyLoginServer>((resolve, reject) => {
        const fail = (message: string) => {
            if (ready) return;
            ready = true;
            void dispose();
            reject(new Error(message));
        };
        timer = setTimeout(() => fail('CodeBuddy 登录服务启动超时（30 秒）'), timeoutMs);

        const consume = (text: string) => {
            if (ready) return;
            output = (output + text).slice(-16_384);
            const parsed = parseLoginServerOutput(output);
            if (!parsed.endpoint || !parsed.webUiUrl) return;
            ready = true;
            if (timer) clearTimeout(timer);
            // Web UI 的 ?password= 同时是网关密码；换成 Bearer token 后才能连 ACP。
            exchangeLoginToken(parsed.endpoint, parsed.webUiUrl).then((authToken) => {
                resolve({ endpoint: parsed.endpoint!, url: parsed.webUiUrl!, authToken, dispose });
            }, (error) => {
                void dispose();
                reject(error);
            });
        };
        child.stdout.on('data', (chunk: Buffer) => consume(chunk.toString('utf8')));
        child.stderr.on('data', () => { /* 启动日志不落插件日志，可能含密码 */ });
        child.once('error', () => fail('CodeBuddy CLI 无法启动，请检查安装是否完整'));
        child.once('close', (code) => {
            if (!ready) fail(`CodeBuddy 登录服务提前退出（code=${code ?? 'null'}）`);
        });
    });
}

/**
 * 用 Web UI 的 password 换取网关 Bearer token（ACP /connect 必需）。
 * 必须用 Node http，不能用 renderer 的 fetch：Obsidian 的 app:// 源对
 * 127.0.0.1 的 POST 会触发 CORS 预检，CLI 网关不返回 CORS 头 → Failed to fetch。
 */
export async function exchangeLoginToken(
    endpoint: string, webUiUrl: string, timeoutMs = 5_000,
): Promise<string> {
    let password = '';
    try { password = new URL(webUiUrl).searchParams.get('password') ?? ''; } catch { /* 无密码参数 */ }
    if (!password) return '';
    let target: URL;
    try { target = new URL('/api/v1/auth/login', endpoint); } catch { throw new Error('CodeBuddy 登录服务地址无效'); }
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(target.hostname)) {
        throw new Error('CodeBuddy 登录服务必须是本机回环地址');
    }
    const body = JSON.stringify({ password });
    return await new Promise<string>((resolve, reject) => {
        let settled = false;
        const finish = (error: Error | null, token = '') => {
            if (settled) return;
            settled = true;
            if (error) reject(error); else resolve(token);
        };
        const req = httpRequest({
            hostname: target.hostname === 'localhost' ? '127.0.0.1' : target.hostname,
            port: target.port,
            path: target.pathname,
            method: 'POST',
            headers: {
                'x-codebuddy-request': '1',
                'x-codebuddy-web-ui': '1',
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body),
                accept: 'application/json',
            },
        }, (res) => {
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > 64 * 1024) { finish(new Error('CodeBuddy 登录服务响应过大')); req.destroy(); return; }
                chunks.push(chunk);
            });
            res.on('error', () => finish(new Error('CodeBuddy 登录服务响应失败')));
            res.on('end', () => {
                if (settled) return;
                const status = res.statusCode ?? 0;
                if (status < 200 || status >= 300) { finish(new Error(`CodeBuddy 登录服务鉴权失败（HTTP ${status}）`)); return; }
                try {
                    const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { success?: unknown; token?: unknown };
                    if (data.success !== true) { finish(new Error('CodeBuddy 登录服务密码不匹配')); return; }
                    finish(null, typeof data.token === 'string' && data.token ? data.token : password);
                } catch { finish(new Error('CodeBuddy 登录服务返回无效 JSON')); }
            });
        });
        req.on('error', () => finish(new Error('连不上 CodeBuddy 登录服务（本机回环）')));
        req.setTimeout(timeoutMs, () => { req.destroy(); finish(new Error('CodeBuddy 登录服务鉴权超时')); });
        req.end(body);
    });
}

/**
 * 用 ACP `session/new` 判断登录状态。CLI 未登录时返回 Authentication required；
 * 已登录时返回 sessionId。连接失败/服务未就绪返回 unknown。
 */
export async function probeCodebuddyLogin(
    endpoint: string, cwd: string, authToken = '', timeoutMs = 15_000,
): Promise<CodebuddyLoginProbe> {
    let connection: WorkbuddyHostConnection | undefined;
    const pending = new Map<number, {
        resolve(value: unknown): void;
        reject(error: Error): void;
        timer: ReturnType<typeof setTimeout>;
    }>();
    let nextId = 1;
    const settleAll = (error: Error) => {
        for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
        pending.clear();
    };
    try {
        const extraHeaders: Record<string, string> = authToken
            ? { Authorization: `Bearer ${authToken}`, 'x-codebuddy-web-ui': '1' }
            : {};
        connection = await WorkbuddyHostConnection.connect(endpoint, (message) => {
            const rec = message as { id?: unknown; error?: { message?: unknown }; result?: unknown };
            const id = typeof rec.id === 'number' ? rec.id : null;
            if (id === null) return;
            const entry = pending.get(id);
            if (!entry) return;
            pending.delete(id);
            clearTimeout(entry.timer);
            if (rec.error) entry.reject(new Error(String(rec.error.message ?? 'acp rpc error')));
            else entry.resolve(rec.result);
        }, (error) => settleAll(error), extraHeaders);

        const request = (method: string, params: Record<string, unknown>): Promise<unknown> => new Promise((resolve, reject) => {
            const id = nextId++;
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`${method} timeout`));
            }, timeoutMs);
            (timer as unknown as { unref?: () => void }).unref?.();
            pending.set(id, { resolve, reject, timer });
            void connection!.send({ jsonrpc: '2.0', id, method, params }).catch((error) => {
                const entry = pending.get(id);
                if (!entry) return;
                pending.delete(id);
                clearTimeout(entry.timer);
                reject(error as Error);
            });
        });

        await request('initialize', {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        });
        const session = await request('session/new', { cwd, mcpServers: [] }) as { sessionId?: unknown };
        return typeof session?.sessionId === 'string' && session.sessionId ? 'authenticated' : 'unknown';
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return /authentication required|not logged in|not authenticated|unauthorized|login required|http 401|请先登录|未登录/i.test(message)
            ? 'auth-required' : 'unknown';
    } finally {
        settleAll(new Error('probe closed'));
        await connection?.dispose().catch(() => {});
    }
}

export interface WaitForLoginOptions {
    signal?: AbortSignal;
    intervalMs?: number;
    timeoutMs?: number;
    onProgress?: (attempt: number, status: CodebuddyLoginProbe) => void;
    /** 网关 Bearer token；官方 CLI 登录服务必需 */
    authToken?: string;
    /** 测试注入；默认使用 probeCodebuddyLogin */
    probe?: (endpoint: string, cwd: string) => Promise<CodebuddyLoginProbe>;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new Error('cancelled'));
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
        const onAbort = () => { clearTimeout(timer); cleanup(); reject(new Error('cancelled')); };
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/** 轮询到登录成功；用户取消/超时抛错 */
export async function waitForCodebuddyLogin(
    endpoint: string, cwd: string, options: WaitForLoginOptions = {},
): Promise<void> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
    const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const probe = options.probe ?? ((endpoint, cwd) => probeCodebuddyLogin(endpoint, cwd, options.authToken));
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;
    while (Date.now() < deadline) {
        if (options.signal?.aborted) throw new Error('cancelled');
        attempt += 1;
        const status = await probe(endpoint, cwd);
        options.onProgress?.(attempt, status);
        if (status === 'authenticated') return;
        if (Date.now() >= deadline) break;
        await delay(intervalMs, options.signal);
    }
    throw new Error('登录等待超时，请重新打开登录页完成登录');
}
