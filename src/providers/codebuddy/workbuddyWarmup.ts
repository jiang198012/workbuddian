import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as os from 'os';
import { createHash, randomUUID } from 'crypto';

const ID = 'workbuddian-warmup';
export const workbuddyConfigDirectory = (dataFolder = '.workbuddy') =>
    process.env.WORKBUDDY_CONFIG_DIR?.trim() || process.env.CODEBUDDY_CONFIG_DIR?.trim() || path.join(os.homedir(), dataFolder);
const extensionDirectory = (configDir: string) => path.join(configDir, 'extensions', ID);
const endpointFor = (dir: string) => process.platform === 'win32'
    ? `\\\\.\\pipe\\workbuddian-warmup-${createHash('sha256').update(dir).digest('hex').slice(0, 16)}`
    : path.join(dir, 'warmup.sock');

function owned(file: string, kind: 'file' | 'directory' | 'socket'): void {
    const stat = fs.lstatSync(file);
    if ((process.getuid && stat.uid !== process.getuid())
        || !(kind === 'file' ? stat.isFile() : kind === 'directory' ? stat.isDirectory() : stat.isSocket())) {
        throw new Error('WorkBuddy 连接扩展路径不可信');
    }
}

// 原生 CJS 随三文件插件分发；仅在用户明确授权安装后交由 WorkBuddy 正常扩展加载器执行。
const serviceSource = String.raw`
const fs = require('fs'), path = require('path'), net = require('net'), crypto = require('crypto');
exports.activate = async function(wb) {
    const dir = __dirname, meta = path.join(dir, 'endpoint.json');
    const endpoint = process.platform === 'win32'
        ? '\\\\.\\pipe\\workbuddian-warmup-' + crypto.createHash('sha256').update(dir).digest('hex').slice(0, 16)
        : path.join(dir, 'warmup.sock');
    const token = crypto.randomBytes(32).toString('hex');
    let closed = false, pending;
    const sockets = new Set();
    function warmup() {
        if (pending) return pending;
        let timer;
        const invoke = Promise.resolve().then(async () => {
            if (closed) throw new Error('WorkBuddy 连接扩展已关闭');
            // 宿主扩展的既有固定入口会 ensureStarted；不创建任务，不转发返回的会话信息。
            const result = await wb.invoke('listSidecarSessions');
            if (!Array.isArray(result)) throw new Error('Unsupported WorkBuddy sidecar API');
        });
        pending = Promise.race([invoke, new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('WorkBuddy host warmup timed out')), 90000);
        })]).finally(() => { clearTimeout(timer); pending = undefined; });
        return pending;
    }
    // 不接收 prompt、Vault 路径、任意 RPC 或权限参数；认证 nonce 只用于本机的这一服务实例。
    const server = net.createServer(socket => {
        if (closed || sockets.size >= 16) { socket.destroy(); return; }
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {});
        socket.setEncoding('utf8');
        socket.setTimeout(100000, () => socket.destroy());
        let buffer = '', handled = false;
        socket.on('data', chunk => {
            if (handled) return;
            buffer += chunk;
            if (buffer.length > 1024) { handled = true; socket.destroy(); return; }
            if (!buffer.includes('\n')) return;
            handled = true;
            let request;
            try { request = JSON.parse(buffer.trim()); } catch { socket.destroy(); return; }
            if (!request || typeof request !== 'object' || Array.isArray(request)
                || request.method !== 'warmup' || typeof request.token !== 'string'
                || !/^[a-f0-9]{64}$/.test(request.token)
                || !crypto.timingSafeEqual(Buffer.from(request.token), Buffer.from(token))) {
                socket.end(JSON.stringify({ready:false, error:'WorkBuddy 连接扩展认证失败'}) + '\n'); return;
            }
            warmup().then(
                () => { if (!socket.destroyed) socket.end(JSON.stringify({ready:true, version:1}) + '\n'); },
                () => { if (!socket.destroyed) socket.end(JSON.stringify({ready:false, error:'WorkBuddy 初始化失败，请检查宿主登录或稍后重试'}) + '\n'); }
            );
        });
    });
    // 只回收上次已退出的本扩展实例；不能抢占还活着的服务。
    if (fs.existsSync(meta)) {
        const stat = fs.lstatSync(meta);
        if (!stat.isFile() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Untrusted warmup metadata');
        const previous = JSON.parse(fs.readFileSync(meta, 'utf8'));
        if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0) throw new Error('Invalid warmup metadata');
        try { process.kill(previous.pid, 0); throw new Error('Warmup service already active'); }
        catch(error) { if (error.code !== 'ESRCH') throw error; }
        fs.unlinkSync(meta);
    }
    if (process.platform !== 'win32' && fs.existsSync(endpoint)) {
        const stat = fs.lstatSync(endpoint);
        if (!stat.isSocket() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Untrusted warmup socket');
        fs.unlinkSync(endpoint);
    }
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve); });
    if (process.platform !== 'win32') fs.chmodSync(endpoint, 0o600);
    fs.writeFileSync(meta, JSON.stringify({pid:process.pid, endpoint, token, version:1}), {mode:0o600, flag:'wx'});
    return { async dispose() {
        closed = true;
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
        if (pending) await pending.catch(() => {});
        if (fs.existsSync(meta) && JSON.parse(fs.readFileSync(meta, 'utf8')).token === token) fs.unlinkSync(meta);
    } };
};
`;

/** 只能由明确的安装/授权操作调用；绝不在普通聊天或插件加载时自动授予权限。 */
export function installWorkbuddyWarmup(configDir: string): string {
    owned(configDir, 'directory');
    const root = path.join(configDir, 'extensions');
    if (!fs.existsSync(root)) fs.mkdirSync(root, { mode: 0o700 });
    owned(root, 'directory');
    const dir = extensionDirectory(configDir);
    if (fs.existsSync(dir)) {
        owned(dir, 'directory');
        const file = path.join(dir, 'extension.json');
        owned(file, 'file');
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (manifest.id !== ID || manifest.managedBy !== 'workbuddian') throw new Error('已有扩展不属于 Workbuddian，拒绝覆盖');
    } else fs.mkdirSync(dir, { mode: 0o700 });
    const files: Record<string, string> = {
        'extension.json': JSON.stringify({ id: ID, name: 'Workbuddian 本地连接', version: '1.0.0', managedBy: 'workbuddian',
            service: { entry: './index.cjs', process: 'fork', activationEvents: ['onStartup'] } }),
        'distribution.json': JSON.stringify({ extensionId: ID, version: '1.0.0', kind: 'platform', grantedPermissions: [], resident: true,
            processPolicy: { server: 'fork', renderer: null }, rollout: { strategy: 'full', percentage: 100 }, status: 'active' }),
        'index.cjs': serviceSource,
    };
    for (const name of Object.keys(files)) {
        const file = path.join(dir, name);
        if (fs.existsSync(file)) owned(file, 'file');
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temporary, files[name], { mode: 0o600, flag: 'wx' });
            fs.renameSync(temporary, file);
        } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    return dir;
}

export async function warmupWorkbuddy(configDir: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('WorkBuddy 初始化取消');
    const dir = extensionDirectory(configDir);
    let metadata: { pid: number; endpoint: string; token: string; version: number };
    try {
        owned(configDir, 'directory'); owned(path.dirname(dir), 'directory'); owned(dir, 'directory');
        const file = path.join(dir, 'endpoint.json');
        owned(file, 'file');
        metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (metadata.version !== 1 || metadata.endpoint !== endpointFor(dir)
            || !Number.isSafeInteger(metadata.pid) || metadata.pid <= 0 || !/^[a-f0-9]{64}$/.test(metadata.token)) throw new Error('Invalid warmup metadata');
        process.kill(metadata.pid, 0);
        if (process.platform !== 'win32') owned(metadata.endpoint, 'socket');
    } catch (error) {
        if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) {
            throw new Error('WorkBuddy 本地任务服务尚未初始化。请运行“安装 WorkBuddy 本地连接扩展”命令并授权，安装后重启 WorkBuddy；也可先在 WorkBuddy 初始化任务后重试。无需重新登录。');
        }
        throw new Error('WorkBuddy 连接扩展校验失败，未扩大权限或切换账号');
    }
    await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection(metadata.endpoint);
        let buffer = '', settled = false;
        const finish = (error?: Error) => {
            if (settled) return;
            settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); socket.destroy();
            if (error) reject(error); else resolve();
        };
        const abort = () => finish(new Error('WorkBuddy 初始化取消'));
        const timer = setTimeout(() => finish(new Error('WorkBuddy 初始化超时，未重发任何用户消息，请检查宿主后重试')), 95_000);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        socket.setEncoding('utf8');
        socket.on('connect', () => socket.write(JSON.stringify({ method: 'warmup', token: metadata.token }) + '\n'));
        socket.on('error', () => finish(new Error('WorkBuddy 连接扩展连接失败，请确认宿主已启动')));
        socket.on('close', () => finish(new Error('WorkBuddy 连接扩展已断开，请重试')));
        socket.on('data', chunk => {
            buffer += chunk;
            if (buffer.length > 1024) { finish(new Error('Invalid WorkBuddy warmup response')); return; }
            if (!buffer.includes('\n')) return;
            try {
                const result = JSON.parse(buffer.trim());
                finish(result.ready === true && result.version === 1 ? undefined : new Error('WorkBuddy 初始化失败，请检查宿主登录或稍后重试'));
            } catch { finish(new Error('Invalid WorkBuddy warmup response')); }
        });
    });
}
