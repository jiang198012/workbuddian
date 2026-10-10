import * as fs from 'fs';
import * as path from 'path';
import { createServer } from 'http';
import type { Socket } from 'net';
import { spawn } from 'child_process';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { connectWorkbuddyBroker, type WorkbuddyBroker } from './workbuddyBroker';
import { loadWorkbuddyModelConfig } from './workbuddyModels';

const cancelled = () => new Error('WorkBuddy worker creation cancelled');

/** Windows 包装器参数不含脚本；Electron Node 模式必须显式带 JS 入口。 */
export function workbuddyNativeArgs(scriptPath: string, args: string[], bundledScript?: string): string[] {
    return bundledScript ? [bundledScript, ...args.slice(args[0] === scriptPath ? 1 : 0)] : args;
}

function ownedDirectory(dir: string, create = false): void {
    if (create && !fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())
        || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('WorkBuddy 本插件运行目录不可信');
}

export function installedRuntime(scriptPath: string): { command: string; app: string; script: string } | null {
    try { scriptPath = fs.realpathSync(scriptPath); } catch { return null; }
    const cli = path.resolve(path.dirname(scriptPath), '..');
    const script = path.join(cli, 'bin', 'codebuddy');
    try { if (!fs.statSync(script).isFile()) return null; } catch { return null; }
    if (process.platform === 'darwin') {
        const contents = path.resolve(cli, '../../..');
        if (path.basename(contents) !== 'Contents' || !path.basename(path.dirname(contents)).endsWith('.app')) return null;
        const command = path.join(contents, 'MacOS', 'Electron');
        try { if (fs.statSync(command).isFile()) return { command, app: path.dirname(contents), script }; } catch { /* 显式非桌面路径不启动其他程序。 */ }
    } else if (process.platform === 'win32') {
        for (const exe of ['WorkBuddy.exe', 'WorkBuddyAI.exe']) {
            const command = path.resolve(cli, '../../..', exe);
            try { if (fs.statSync(command).isFile()) return { command, app: command, script }; } catch { /* 显式非桌面路径不启动其他程序。 */ }
        }
    }
    return null;
}

async function openInstalledHost(runtime: { command: string; app: string }, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw cancelled();
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    // 只正常打开已安装宿主；不关闭、重启或终止宿主已有任务。
    const proc = process.platform === 'darwin'
        ? spawn('/usr/bin/open', ['-g', runtime.app], { env, stdio: 'ignore' })
        : spawn(runtime.app, [], { env, detached: true, stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => {
        proc.once('error', () => reject(new Error('无法启动已安装的 WorkBuddy，请正常打开后重试')));
        proc.once('spawn', () => { proc.unref(); resolve(); });
    });
}

async function accountBroker(configDir: string, runtime: ReturnType<typeof installedRuntime>, signal: AbortSignal | undefined,
    disconnected: (error: Error) => void): Promise<WorkbuddyBroker> {
    try { return await connectWorkbuddyBroker(configDir, signal, disconnected); }
    catch (error) {
        if (signal?.aborted) throw cancelled();
        const code = (error as { code?: string }).code ?? '';
        if (code !== 'E_REQUEST_PIPE_UNAVAILABLE') {
            if (!runtime || !['E_DISCOVERY_MISSING', 'E_SOCKET_UNAVAILABLE'].includes(code)) throw error;
            await openInstalledHost(runtime, signal);
        }
    }
    const deadline = Date.now() + 30_000;
    while (true) {
        if (signal?.aborted) throw cancelled();
        try { return await connectWorkbuddyBroker(configDir, signal, disconnected); }
        catch (error) {
            if (!['E_DISCOVERY_MISSING', 'E_SOCKET_UNAVAILABLE', 'E_REQUEST_PIPE_UNAVAILABLE'].includes((error as { code?: string }).code ?? '')) throw error;
            if (Date.now() >= deadline) throw new Error('WorkBuddy 本地账号代理未就绪，请确认已正常启动并登录；未重发任何消息');
        }
        await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(cancelled()); };
            const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 200);
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
        });
    }
}

/** 无连接扩展时使用宿主 WBIPC 委托账号请求；账号凭据始终由宿主保管。 */
export async function startWorkbuddyNative(configDir: string, scriptPath: string, cwd: string, command: string,
    args: string[], signal?: AbortSignal): Promise<{ endpoint: string; dispose(): Promise<void> }> {
    if (signal?.aborted) throw cancelled();
    let proc: ReturnType<typeof spawn> | undefined;
    let broker: WorkbuddyBroker | undefined;
    let exit: Promise<void> | undefined;
    let exited = false;
    let connectionError: Error | undefined;
    let rejectEndpoint: ((error: Error) => void) | undefined;
    let disposing: Promise<void> | undefined;
    const sockets = new Set<Socket>();
    const active = new Set<AbortController>();
    const nonce = randomBytes(32).toString('hex');
    const nonceBytes = Buffer.from(`Bearer ${nonce}`);
    const server = createServer(async (req, res) => {
        const controller = new AbortController();
        active.add(controller);
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', abort);
        try {
            const auth = Buffer.from(typeof req.headers.authorization === 'string' ? req.headers.authorization : '');
            if (req.headers.origin || auth.length !== nonceBytes.length || !timingSafeEqual(auth, nonceBytes)) {
                res.writeHead(401); res.end(); return;
            }
            if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? '') || !req.url?.startsWith('/')
                || req.url.startsWith('//') || /[\\\s#]/.test(req.url)) { res.writeHead(400); res.end(); return; }
            const url = new URL(req.url, 'http://127.0.0.1');
            if (!/^\/[A-Za-z0-9_./-]*$/.test(url.pathname) || /(?:^|\/)\.\.(?:\/|$)/.test(req.url.split('?')[0])) {
                res.writeHead(400); res.end(); return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req) {
                size += chunk.length;
                if (size > 655_360) { res.writeHead(413); res.end('WorkBuddy 本地账号代理请求过大，请减少本轮上下文'); return; }
                chunks.push(chunk);
            }
            if (controller.signal.aborted) return;
            const headers: Record<string, string> = {};
            for (const key of ['content-type', 'accept']) if (typeof req.headers[key] === 'string') headers[key] = req.headers[key] as string;
            const result = await broker!.requestFetch({ method: req.method!, path: url.pathname, headers,
                query: Object.fromEntries(url.searchParams), ...(size ? { body_b64: Buffer.concat(chunks).toString('base64') } : {}) }, controller.signal);
            if (controller.signal.aborted) return;
            if (!Number.isInteger(result?.status) || result.status < 200 || result.status > 599
                || typeof result.body_b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.body_b64)) throw new Error('Invalid broker response');
            const body = Buffer.from(result.body_b64, 'base64');
            if (body.length > 655_360 || (result.status >= 300 && result.status < 400)) throw new Error('Invalid broker response');
            const responseHeaders: Record<string, string> = {};
            for (const key of ['content-type', 'etag', 'last-modified', 'retry-after', 'x-request-id']) {
                const value = result.headers?.[key];
                if (typeof value === 'string' && !/[\r\n]/.test(value)) responseHeaders[key] = value;
            }
            res.writeHead(result.status, responseHeaders); res.end(body);
        } catch {
            // 本地委托明确失败用非重试状态，避免这条错误路径触发 CLI 自动重试。
            if (!res.headersSent) res.writeHead(422, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { type: 'workbuddy_local_transport', code: 'WORKBUDDY_LOCAL_REQUEST_FAILED',
                message: 'WorkBuddy 本地账号代理请求失败或超过宿主限制，请检查宿主后手动重试' } }));
        } finally {
            active.delete(controller); res.removeListener('close', abort);
        }
    });
    server.requestTimeout = 60_000;
    server.headersTimeout = 10_000;
    server.maxConnections = 16;
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });

    const dispose = (): Promise<void> => {
        if (disposing) return disposing;
        disposing = (async () => {
            for (const controller of active) controller.abort();
            broker?.dispose();
            for (const socket of sockets) socket.destroy();
            if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
            if (proc && !exited) {
                proc.kill('SIGTERM');
                const wait = (ms: number) => new Promise<boolean>(resolve => {
                    const timer = setTimeout(() => resolve(false), ms);
                    exit!.then(() => { clearTimeout(timer); resolve(true); });
                });
                if (!await wait(5000)) { proc.kill('SIGKILL'); if (!await wait(5000)) throw new Error('WorkBuddy own worker cleanup could not be confirmed'); }
            }
            nonceBytes.fill(0);
        })();
        void disposing.catch(() => { disposing = undefined; });
        return disposing;
    };
    // 获取资源期间不能提前完成 dispose；否则 await 后到达的 broker 会逃过清理。
    const abort = () => { rejectEndpoint?.(cancelled()); if (proc && !exited) proc.kill('SIGTERM'); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        const runtime = installedRuntime(scriptPath);
        broker = await accountBroker(configDir, runtime, signal, error => {
            connectionError = error; rejectEndpoint?.(error);
            // 只终止本插件创建的子进程，令当前请求失败；下一条用户消息才尝试重连。
            if (proc && !exited) proc.kill('SIGTERM');
        });
        if (signal?.aborted) throw cancelled();
        if (connectionError) throw connectionError;
        const productPath = path.join(path.dirname(fs.realpathSync(scriptPath)), '..', 'product.json');
        const modelConfig = await loadWorkbuddyModelConfig(broker, JSON.parse(fs.readFileSync(productPath, 'utf8')), signal);
        if (signal?.aborted) throw cancelled();
        if (connectionError) throw connectionError;
        const cache = path.join(configDir, 'workbuddian'); ownedDirectory(cache, true);
        const workerDir = path.join(cache, createHash('sha256').update(fs.realpathSync(cwd)).digest('hex')); ownedDirectory(workerDir, true);
        await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        const env = { ...process.env };
        for (const key of Object.keys(env)) if (/^(?:CODEBUDDY_|WORKBUDDY_|ACC_PRODUCT_CONFIG|ACC_USER_|ANTHROPIC_|OPENAI_)/.test(key)) delete env[key];
        Object.assign(env, {
            ELECTRON_RUN_AS_NODE: '1', CODEBUDDY_FORCE_HEADLESS_BUNDLE: '1',
            CODEBUDDY_CONFIG_DIR: workerDir, WORKBUDDY_CONFIG_DIR: workerDir,
            CODEBUDDY_AUTH_TOKEN: nonce, CODEBUDDY_BASE_URL: `${origin}/v2`, CODEBUDDY_INTERNET_ENVIRONMENT: 'external',
            CODEBUDDY_CREDENTIALS_IN_MEMORY: '1', CODEBUDDY_DISABLE_LOCAL_STORAGE: '1',
            CODEBUDDY_DISABLE_PRODUCT_CACHE: '1', CODEBUDDY_DISABLE_CUSTOM_MODELS_FILE: '1',
            CODEBUDDY_API_KEY_DISABLED: '1', CODEBUDDY_API_KEY_HELPER_DISABLED: '1',
            CODEBUDDY_MAX_RETRIES: '0', CODEBUDDY_RETRY_WATCHDOG: '0',
            CODEBUDDY_GATEWAY_AUTH: 'password', CODEBUDDY_GATEWAY_PASSWORD: randomBytes(32).toString('hex'),
            CODEBUDDY_GATEWAY_DISABLE_API_DOCS: '1', SERVER__PORT: '0', SERVER__HOST: '127.0.0.1',
            DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1',
            ACC_PRODUCT_CONFIG_V3: JSON.stringify({ ...modelConfig, endpoint: origin, networkEnvironment: 'external',
                authentication: { type: 'custom-token', attributes: { tokenType: 'bearerToken', token: nonce } } }),
        });
        // 仅恢复已安装的目录型 skills，不读取宿主账号、会话或 settings。
        env.CODEBUDDY_SESSION_SKILL_DIRS = [path.join(configDir, 'skills'), path.join(configDir, 'connectors', 'skills')]
            .filter(dir => { try { return fs.lstatSync(dir).isDirectory(); } catch { return false; } }).join(path.delimiter);
        if (signal?.aborted) throw cancelled();
        if (connectionError) throw connectionError;
        const endpoint = new Promise<string>((resolve, reject) => {
            rejectEndpoint = reject;
            const timer = setTimeout(() => reject(new Error('WorkBuddy 内置 CLI 启动超时；未发送用户消息')), 30_000);
            let buffer = '', announced = false;
            // .cmd/.exe 的旧 args 没有 Node 入口；桌面运行时始终显式传安装包内的 JS。
            const workerArgs = workbuddyNativeArgs(scriptPath, args, runtime?.script);
            proc = spawn(runtime?.command ?? command, [...workerArgs, '--port', '0', '--host', '127.0.0.1', '--setting-sources', 'none'],
                { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
            exit = new Promise<void>(done => proc!.once('close', () => { exited = true; done(); }));
            proc.once('error', () => reject(new Error('WorkBuddy 内置 CLI 无法启动，请检查安装完整性')));
            proc.once('close', () => reject(new Error('WorkBuddy 内置 CLI 在就绪前退出')));
            proc.stdout!.on('data', (chunk: Buffer) => {
                if (announced) return;
                buffer += chunk.toString('utf8');
                if (buffer.length > 65_536) { reject(new Error('WorkBuddy 启动公告过大')); return; }
                let newline: number;
                while ((newline = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, newline).replace(/\x1b\[[0-9;]*m/g, ''); buffer = buffer.slice(newline + 1);
                    const match = /^\s*Endpoint\s+(http:\/\/127\.0\.0\.1:(\d+))\/?\s*$/.exec(line);
                    if (match && Number(match[2]) > 0 && Number(match[2]) <= 65535) {
                        announced = true; buffer = ''; clearTimeout(timer); resolve(match[1]); return;
                    }
                }
            });
            // 启动日志可能包含本地密码，绝不写入插件日志或错误内容。
            proc.stderr!.on('data', () => {});
            const clear = () => clearTimeout(timer);
            proc.once('close', clear); proc.once('error', clear);
            signal?.addEventListener('abort', clear, { once: true });
            void exit.then(() => signal?.removeEventListener('abort', clear));
        });
        const result = await endpoint;
        if (signal?.aborted) throw cancelled();
        if (connectionError) throw connectionError;
        return { endpoint: result, dispose };
    } catch (error) {
        try { await dispose(); }
        catch { throw Object.assign(new Error('WorkBuddy own worker cleanup could not be confirmed'), { workbuddyCleanup: dispose }); }
        throw error;
    } finally {
        rejectEndpoint = undefined;
        signal?.removeEventListener('abort', abort);
    }
}
