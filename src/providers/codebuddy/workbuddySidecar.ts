import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { createHash, randomBytes, randomUUID } from 'crypto';

const hash = (value: string, length: number) => createHash('sha1').update(value).digest('hex').slice(0, length);

function runtimeDirectory(configDir: string): string {
    const token = hash(configDir, 12);
    const uid = process.getuid?.();
    if (process.platform === 'linux') {
        for (const dir of [process.env.XDG_RUNTIME_DIR?.trim(), uid === undefined ? undefined : `/run/user/${uid}`]) {
            if (!dir) continue;
            try {
                if (!fs.statSync(dir).isDirectory()) continue;
                fs.accessSync(dir, fs.constants.W_OK);
                return path.join(dir, 'workbuddy', token);
            } catch { /* 官方规则：无可用 XDG/run-user 时落回临时目录。 */ }
        }
    }
    return path.join(os.tmpdir().trim(), uid === undefined ? 'wb' : `wb-${hash(String(uid), 6)}`, token);
}

function requireOwned(file: string, kind: 'directory' | 'file' | 'socket'): fs.Stats {
    const stat = fs.lstatSync(file);
    const correctType = kind === 'directory' ? stat.isDirectory() : kind === 'file' ? stat.isFile() : stat.isSocket();
    if (!correctType || (process.getuid && stat.uid !== process.getuid())) throw new Error('Untrusted WorkBuddy runtime');
    return stat;
}

/** WorkBuddy 5.6.2 sidecar v6；仅连接已运行的宿主，绝不启动、重启或关闭宿主。 */
export async function startWorkbuddySidecar(
    scriptPath: string, cwd: string, command: string, args: string[], signal?: AbortSignal,
): Promise<{ endpoint: string; dispose(): Promise<void> } | null> {
    let productPath: string;
    let product: { productName?: string; dataFolderName?: string };
    try {
        productPath = path.join(path.dirname(fs.realpathSync(scriptPath)), '..', 'product.json');
        product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
    } catch { return null; }
    if (product?.productName !== 'WorkBuddy') return null;
    const bootstrapMarker = Buffer.from('CODEBUDDY_SIDECAR_CREDENTIAL_BOOTSTRAP_SOCKET');
    const requiresHost = ['codebuddy-lite-wb.mjs', 'codebuddy-headless.js'].some((bundle) => {
        try { return fs.readFileSync(path.join(path.dirname(productPath), 'dist', bundle)).includes(bootstrapMarker); }
        catch { return false; }
    });
    // 旧内置 CLI 保留已有 stdio；新凭据机制不能在宿主不可用时静默退回外部 spawn。
    if (!requiresHost) return null;
    try {
        if (!path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error();
    } catch { throw new Error('WorkBuddy worker requires an existing absolute cwd directory'); }
    if (signal?.aborted) throw new Error('WorkBuddy worker creation cancelled');
    const dataFolder = product.dataFolderName || '.workbuddy';
    const configDir = process.env.WORKBUDDY_CONFIG_DIR?.trim() || process.env.CODEBUDDY_CONFIG_DIR?.trim() || path.join(os.homedir(), dataFolder);
    const runtimeDir = runtimeDirectory(configDir);
    const pidFile = path.join(runtimeDir, 'sidecar.pid');
    // PID 元数据含宿主 token；只取实例身份字段，绝不复制、输出或发送该 token。
    const readIdentity = () => {
        requireOwned(runtimeDir, 'directory');
        requireOwned(pidFile, 'file');
        const { pid, version, controlPipeUuid } = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
        if (!Number.isSafeInteger(pid) || pid <= 0 || version !== 6 || !/^[a-f0-9]{8}$/.test(controlPipeUuid ?? '')) throw new Error();
        return { pid: pid as number, controlPipeUuid: controlPipeUuid as string };
    };
    let identity: ReturnType<typeof readIdentity>;
    let socketPath: string;
    let socketIdentity: fs.Stats | undefined;
    try {
        identity = readIdentity();
        socketPath = process.platform === 'win32'
            ? `\\\\.\\pipe\\workbuddy-${hash(configDir, 12)}-sidecar-control-${identity.controlPipeUuid}`
            : path.join(runtimeDir, `sidecar-${identity.controlPipeUuid}.sock`);
        if (process.platform !== 'win32') socketIdentity = requireOwned(socketPath, 'socket');
    } catch { throw new Error('WorkBuddy sidecar v6 is not running. 请启动并登录 WorkBuddy 5.6.2 后重试。'); }

    const ownedId = `workbuddian-${randomUUID()}`;
    let runtimeId: string | undefined;
    let pid: number | undefined;
    let socket: net.Socket | undefined;
    let serial = 0;
    let submitted = false;
    let disposing: Promise<void> | undefined;
    const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
    const rejectPending = (error: Error) => {
        for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
        pending.clear();
    };
    const open = async () => {
        // 清理时只能重连原实例，不能追随新宿主或按最新会话猜测。
        const current = readIdentity();
        if (current.pid !== identity.pid || current.controlPipeUuid !== identity.controlPipeUuid) throw new Error('WorkBuddy sidecar instance changed');
        if (socketIdentity) {
            const stat = requireOwned(socketPath, 'socket');
            if (stat.ino !== socketIdentity.ino || stat.dev !== socketIdentity.dev) throw new Error('WorkBuddy sidecar socket changed');
        }
        const client = net.createConnection(socketPath);
        socket = client;
        client.setEncoding('utf8');
        let buffer = '';
        client.on('data', (chunk) => {
            if (socket !== client) return;
            buffer += chunk;
            try {
                if (buffer.length > 1024 * 1024) throw new Error();
                let newline: number;
                while ((newline = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, newline);
                    buffer = buffer.slice(newline + 1);
                    if (!line.trim()) continue;
                    const message = JSON.parse(line);
                    // 侧车广播属于所有客户端；只处理本连接待决 RPC 的响应。
                    if (!message || message.method || message.jsonrpc !== '2.0') continue;
                    const entry = pending.get(message.id);
                    if (!entry) continue;
                    pending.delete(message.id);
                    clearTimeout(entry.timer);
                    if (message.error) entry.reject(new Error('WorkBuddy sidecar request failed'));
                    else entry.resolve(message.result);
                }
            } catch {
                rejectPending(new Error('Invalid WorkBuddy sidecar response'));
                client.destroy();
            }
        });
        client.on('error', () => {
            if (socket === client) rejectPending(new Error('WorkBuddy sidecar connection failed'));
        });
        client.on('close', () => {
            if (socket === client) rejectPending(new Error('WorkBuddy sidecar connection closed'));
        });
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { client.destroy(); reject(new Error('WorkBuddy sidecar connection timed out')); }, 5_000);
            client.once('connect', () => { clearTimeout(timer); resolve(); });
            client.once('error', () => { clearTimeout(timer); reject(new Error('WorkBuddy sidecar connection failed')); });
            client.once('close', () => { clearTimeout(timer); reject(new Error('WorkBuddy sidecar connection closed')); });
        });
    };
    const rpc = (method: string, params: Record<string, unknown>, timeout: number): Promise<any> => new Promise((resolve, reject) => {
        if (!socket || socket.destroyed) { reject(new Error('WorkBuddy sidecar connection closed')); return; }
        const id = ++serial;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`WorkBuddy ${method} timed out`)); }, timeout);
        pending.set(id, { resolve, reject, timer });
        socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', (error) => {
            if (error) { clearTimeout(timer); pending.delete(id); reject(new Error('WorkBuddy sidecar connection failed')); }
        });
    });
    const dispose = (): Promise<void> => {
        if (disposing) return disposing;
        signal?.removeEventListener('abort', abort);
        rejectPending(new Error('WorkBuddy worker creation cancelled'));
        disposing = (async () => {
            try {
                if (!submitted) return;
                if (!socket || socket.destroyed) await open();
                await rpc('session.kill', { sessionId: ownedId, ...(runtimeId ? { expectedRuntimeId: runtimeId } : {}) }, 5_000);
                // kill RPC 先确认接收、后异步退出；只探测自己的 PID，绝不发终止信号。
                const deadline = Date.now() + 3_000;
                while (pid) {
                    try { process.kill(pid, 0); }
                    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') break; throw new Error('WorkBuddy worker cleanup could not be confirmed'); }
                    if (Date.now() >= deadline) throw new Error('WorkBuddy worker cleanup could not be confirmed');
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
            } catch (error) {
                // 宿主已退出/换代时 kill RPC 可能失败；只有自有 PID 明确消失才能解除清理屏障。
                if (pid) {
                    try { process.kill(pid, 0); }
                    catch (probeError) {
                        if ((probeError as NodeJS.ErrnoException).code === 'ESRCH') return;
                    }
                }
                throw error;
            } finally {
                socket?.destroy();
                rejectPending(new Error('WorkBuddy worker disposed'));
            }
        })();
        return disposing;
    };
    const abort = () => { void dispose().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        await open();
        if (signal?.aborted || disposing) throw new Error('WorkBuddy worker creation cancelled');
        submitted = true;
        const result = await rpc('session.create', {
            sessionId: ownedId, command, args, cwd, port: 0,
            env: {
                ELECTRON_RUN_AS_NODE: '1', CODEBUDDY_FORCE_LITE_WB_BUNDLE: '1',
                CODEBUDDY_CONFIG_DIR: configDir, WORKBUDDY_CONFIG_DIR: configDir, WORKBUDDY_DATA_FOLDER_NAME: dataFolder,
                ACC_PRODUCT_CONFIG_PATH: productPath,
                CODEBUDDY_API_KEY_HELPER_DISABLED: '1', CODEBUDDY_API_KEY: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '',
                CODEBUDDY_GATEWAY_AUTH: 'password', CODEBUDDY_GATEWAY_PASSWORD: randomBytes(32).toString('hex'),
                CODEBUDDY_GATEWAY_DISABLE_API_DOCS: '1', DISABLE_AUTOUPDATER: '1',
            },
        }, 195_000);
        if (result?.sessionId !== ownedId || typeof result.runtimeId !== 'string' || !result.runtimeId
            || !Number.isSafeInteger(result.pid) || result.pid <= 0) throw new Error('Unexpected WorkBuddy worker identity');
        runtimeId = result.runtimeId;
        pid = result.pid;
        const endpoint = new URL(result.acpEndpoint);
        if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port
            || endpoint.pathname !== '/api/v1/acp' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
            throw new Error('Invalid WorkBuddy worker endpoint');
        }
        if (signal?.aborted || disposing) throw new Error('WorkBuddy worker creation cancelled');
        return { endpoint: endpoint.origin, dispose };
    } catch (error) {
        try { await dispose(); }
        catch { throw new Error(`${error instanceof Error ? error.message : 'WorkBuddy creation failed'}; own worker cleanup could not be confirmed`); }
        throw error;
    }
}
