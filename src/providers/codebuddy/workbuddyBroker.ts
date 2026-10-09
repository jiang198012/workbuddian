import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export interface BrokerFetchParams {
    method: string;
    path: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body_b64?: string;
}
export interface BrokerFetchResult { status: number; headers: Record<string, string>; body_b64: string }
export interface WorkbuddyBroker {
    requestFetch(params: BrokerFetchParams, signal?: AbortSignal): Promise<BrokerFetchResult>;
    dispose(): void;
}
const MAX_FRAME = 1024 * 1024;
type BrokerError = Error & { code: string };
const failure = (code: string): BrokerError => Object.assign(new Error(`WorkBuddy 本地代理错误（${code}）`), { code });
const remoteCodes = new Set(['E_TICKET_INVALID', 'E_REVOKED', 'E_ENDPOINT_UNTRUSTED', 'E_PROTOCOL_MISMATCH',
    'E_PIPE_UNKNOWN', 'E_METHOD_UNKNOWN', 'E_METHOD_KIND_MISMATCH', 'E_NOT_DECLARED', 'E_CONSENT_REQUIRED',
    'E_NOT_CONNECTED', 'E_POLICY_DENIED', 'E_UPSTREAM', 'E_BUSY', 'E_CHANNEL_UNKNOWN', 'E_BAD_REQUEST',
    'E_CANCELLED', 'E_PAYLOAD_TOO_LARGE', 'E_TIMEOUT', 'E_INTERNAL']);
const hash = (value: string, length: number) => createHash('sha1').update(value).digest('hex').slice(0, length);

function owned(target: string, kind: 'file' | 'directory' | 'socket', mode?: number): fs.Stats {
    const stat = fs.lstatSync(target), unix = process.platform !== 'win32';
    if (stat.isSymbolicLink() || !(kind === 'file' ? stat.isFile() : kind === 'socket' ? stat.isSocket() : stat.isDirectory())
        || (unix && ((process.getuid && stat.uid !== process.getuid()) || (mode !== undefined && (stat.mode & 0o777) !== mode)))) {
        throw failure('E_ENDPOINT_UNTRUSTED');
    }
    return stat;
}

function runtimeDirectory(configDir: string): string {
    const key = hash(configDir, 12), uid = process.getuid?.();
    const writable = (dir: string) => { try { if (!fs.statSync(dir).isDirectory()) return false; fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; } };
    if (process.platform === 'linux') {
        const xdg = process.env.XDG_RUNTIME_DIR?.trim();
        if (xdg && writable(xdg)) return path.join(xdg, 'workbuddy', key);
        if (uid !== undefined && writable(`/run/user/${uid}`)) return path.join(`/run/user/${uid}`, 'workbuddy', key);
    }
    return path.join(os.tmpdir().trim(), uid === undefined ? 'wb' : `wb-${hash(String(uid), 6)}`, key);
}

function discover(configDir: string): { endpoint: string; ticket: Buffer } {
    let fd: number | undefined, raw: Buffer | undefined, metadata: Record<string, unknown> | undefined;
    try {
        if (!path.isAbsolute(configDir)) throw failure('E_ENDPOINT_UNTRUSTED');
        owned(configDir, 'directory');
        const dir = path.join(configDir, 'wbipc'); owned(dir, 'directory', 0o700);
        const file = path.join(dir, 'endpoint.json'), before = owned(file, 'file', 0o600);
        if (before.size < 1 || before.size > 4096) throw failure('E_ENDPOINT_UNTRUSTED');
        fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
        const after = fs.fstatSync(fd);
        if (!after.isFile() || after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size
            || (process.platform !== 'win32' && ((process.getuid && after.uid !== process.getuid()) || (after.mode & 0o777) !== 0o600))) {
            throw failure('E_ENDPOINT_UNTRUSTED');
        }
        raw = fs.readFileSync(fd);
        let parsed: unknown;
        try { parsed = JSON.parse(raw.toString('utf8')); } catch { throw failure('E_ENDPOINT_UNTRUSTED'); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw failure('E_ENDPOINT_UNTRUSTED');
        metadata = parsed as Record<string, unknown>;
        const endpoint = metadata.endpoint, ticket = metadata.ticket;
        if (typeof endpoint !== 'string' || typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw failure('E_ENDPOINT_UNTRUSTED');
        if (process.platform === 'win32') {
            if (!/^\\\\\.\\pipe\\wbipc-[a-f0-9]+$/.test(endpoint)) throw failure('E_ENDPOINT_UNTRUSTED');
        } else {
            const runtime = runtimeDirectory(configDir), socketDir = path.join(runtime, 'wbipc');
            owned(runtime, 'directory', 0o700); owned(socketDir, 'directory', 0o700);
            if (!path.isAbsolute(endpoint) || !/^b-[a-f0-9]+\.sock$/.test(path.basename(endpoint))
                || fs.realpathSync(path.dirname(endpoint)) !== fs.realpathSync(socketDir)) throw failure('E_ENDPOINT_UNTRUSTED');
            owned(endpoint, 'socket', 0o600);
        }
        return { endpoint, ticket: Buffer.from(ticket) };
    } catch (error) {
        if ((error as BrokerError).code === 'E_ENDPOINT_UNTRUSTED') throw error;
        if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) throw failure('E_DISCOVERY_MISSING');
        throw failure('E_DISCOVERY_FAILED');
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
        raw?.fill(0); if (metadata) metadata.ticket = '';
    }
}

function proof(ticket: Buffer, side: 'server' | 'client', endpoint: string, clientNonce: string, serverNonce: string): string {
    const chunks: Buffer[] = [];
    for (const value of [side === 'server' ? 'wbipc-s' : 'wbipc-c', '1', endpoint, clientNonce, serverNonce]) {
        const bytes = Buffer.from(value), length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
        chunks.push(length, bytes);
    }
    return createHmac('sha256', ticket).update(Buffer.concat(chunks)).digest('base64url');
}

class BrokerConnection implements WorkbuddyBroker {
    private readonly socket: net.Socket;
    private readonly pending = new Map<number, {
        resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>;
        signal?: AbortSignal; abort(): void; sent: boolean;
    }>();
    private readonly handshakeFrames: Record<string, unknown>[] = [];
    private waiter?: { resolve(frame: Record<string, unknown>): void; reject(error: Error): void };
    private buffer = Buffer.alloc(0);
    private closed?: Error;
    private rpcReady = false;
    private available = false;
    private maxInflight = 8;
    private id = 0;
    constructor(endpoint: string, private readonly onDisconnect?: (error: Error) => void) {
        this.socket = net.createConnection(endpoint);
        this.socket.on('error', error => this.close(failure(!this.available
            && ['ECONNREFUSED', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'E_SOCKET_UNAVAILABLE' : 'E_DISCONNECTED')));
        this.socket.on('close', () => this.close(failure('E_DISCONNECTED')));
        this.socket.on('data', chunk => {
            try {
                let start = 0;
                while (!this.closed && start < chunk.length) {
                    const end = chunk.indexOf(10, start), part = chunk.subarray(start, end < 0 ? chunk.length : end);
                    if (this.buffer.length + part.length > MAX_FRAME) throw failure('E_PAYLOAD_TOO_LARGE');
                    this.buffer = Buffer.concat([this.buffer, part]);
                    if (end < 0) break;
                    const line = this.buffer; this.buffer = Buffer.alloc(0);
                    if (line.length) this.receive(JSON.parse(line.toString('utf8')));
                    start = end + 1;
                }
            } catch (error) { this.close(failure((error as BrokerError).code === 'E_PAYLOAD_TOO_LARGE' ? 'E_PAYLOAD_TOO_LARGE' : 'E_PROTOCOL_ERROR')); }
        });
    }
    private settle(id: number, error?: Error, result?: unknown): void {
        const entry = this.pending.get(id); if (!entry) return;
        this.pending.delete(id); clearTimeout(entry.timer); entry.signal?.removeEventListener('abort', entry.abort);
        if (error) entry.reject(error); else entry.resolve(result);
    }
    private close(error: Error, notify = true): void {
        if (this.closed) return;
        this.closed = error; this.waiter?.reject(error); this.waiter = undefined;
        for (const id of this.pending.keys()) this.settle(id, error);
        this.handshakeFrames.length = 0; this.buffer.fill(0); this.buffer = Buffer.alloc(0); this.socket.destroy();
        if (notify && this.available) { try { this.onDisconnect?.(error); } catch {} }
    }
    dispose(): void { this.close(failure('E_CLOSED'), false); }
    private send(frame: Record<string, unknown>): void {
        if (this.closed) throw this.closed;
        const text = JSON.stringify(frame);
        if (Buffer.byteLength(text) > MAX_FRAME) throw failure('E_PAYLOAD_TOO_LARGE');
        this.socket.write(text + '\n');
    }
    private receive(frame: Record<string, unknown>): void {
        if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw failure('E_PROTOCOL_ERROR');
        if (frame.type === 'pipe_revoked') { this.close(failure('E_REVOKED')); return; }
        if (!this.rpcReady) {
            if (frame.type === 'session_hello_error') throw failure('E_PROTOCOL_ERROR');
            if (this.waiter) { this.waiter.resolve(frame); this.waiter = undefined; }
            else { if (this.handshakeFrames.length >= 4) throw failure('E_PROTOCOL_ERROR'); this.handshakeFrames.push(frame); }
            return;
        }
        if (frame.jsonrpc !== '2.0' || !Number.isSafeInteger(frame.id)) throw failure('E_PROTOCOL_ERROR');
        const id = frame.id as number; if (!this.pending.has(id)) return;
        if (frame.error) {
            const code = (frame.error as { code?: unknown }).code;
            this.settle(id, failure(typeof code === 'string' && remoteCodes.has(code) ? code : 'E_REMOTE_ERROR'));
        } else if (Object.prototype.hasOwnProperty.call(frame, 'result')) this.settle(id, undefined, frame.result);
        else throw failure('E_PROTOCOL_ERROR');
    }
    private nextHandshake(): Promise<Record<string, unknown>> {
        if (this.closed) return Promise.reject(this.closed);
        if (this.handshakeFrames.length) return Promise.resolve(this.handshakeFrames.shift()!);
        return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
    }
    private rpc(method: string, params: unknown, mode?: string, signal?: AbortSignal): Promise<unknown> {
        if (this.closed) return Promise.reject(this.closed);
        if (signal?.aborted) return Promise.reject(failure('E_CANCELLED'));
        if (this.pending.size >= this.maxInflight) return Promise.reject(failure('E_BUSY'));
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            const cancel = (code: string) => {
                const entry = this.pending.get(id); if (!entry) return;
                if (entry.sent) {
                    try { this.send({ jsonrpc: '2.0', method: '$/cancel', params: { id } }); }
                    catch { this.close(failure('E_DISCONNECTED')); return; }
                }
                this.settle(id, failure(code));
            };
            const entry = { resolve, reject, signal, sent: false, abort: () => cancel('E_CANCELLED'),
                timer: setTimeout(() => cancel('E_TIMEOUT'), 55_000) };
            this.pending.set(id, entry); signal?.addEventListener('abort', entry.abort, { once: true });
            if (signal?.aborted) { entry.abort(); return; }
            try { this.send({ jsonrpc: '2.0', id, method, params, ...(mode ? { mode } : {}) }); entry.sent = true; }
            catch (error) { this.settle(id, failure((error as BrokerError).code === 'E_PAYLOAD_TOO_LARGE' ? 'E_PAYLOAD_TOO_LARGE' : 'E_INVALID_PARAMS')); }
        });
    }
    async initialize(endpoint: string, ticket: Buffer, signal?: AbortSignal): Promise<void> {
        const abort = () => this.close(failure('E_CANCELLED'), false);
        const deadline = setTimeout(() => this.close(failure('E_HANDSHAKE_TIMEOUT'), false), 5000);
        signal?.addEventListener('abort', abort, { once: true });
        try {
            if (signal?.aborted) { abort(); throw failure('E_CANCELLED'); }
            const clientNonce = randomBytes(16).toString('base64url');
            this.send({ type: 'session_hello', protocol_min: 1, protocol_max: 1, client_nonce: clientNonce,
                ticket_id: createHash('sha256').update(ticket).digest('hex').slice(0, 16),
                client: { kind: 'workbuddian', id: 'workbuddian', version: '1' } });
            const challenge = await this.nextHandshake();
            if (challenge.type !== 'session_challenge' || challenge.protocol !== 1
                || typeof challenge.server_nonce !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(challenge.server_nonce)
                || typeof challenge.server_proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge.server_proof)) throw failure('E_PROTOCOL_ERROR');
            const expected = Buffer.from(proof(ticket, 'server', endpoint, clientNonce, challenge.server_nonce)), actual = Buffer.from(challenge.server_proof);
            const verified = expected.length === actual.length && timingSafeEqual(expected, actual);
            expected.fill(0); actual.fill(0); challenge.server_proof = '';
            if (!verified) throw failure('E_SERVER_PROOF_INVALID');
            this.send({ type: 'session_prove', client_proof: proof(ticket, 'client', endpoint, clientNonce, challenge.server_nonce) });
            const ack = await this.nextHandshake(); ticket.fill(0);
            if (ack.type !== 'session_hello_ack' || ack.protocol !== 1 || !Array.isArray(ack.pipes) || !ack.pipes.includes('wb.request')) throw failure('E_REQUEST_PIPE_UNAVAILABLE');
            if (this.handshakeFrames.length || !Number.isSafeInteger(ack.max_inflight) || (ack.max_inflight as number) < 1) throw failure('E_PROTOCOL_ERROR');
            this.maxInflight = Math.min(8, ack.max_inflight as number);
            this.rpcReady = true;
            const pipe = await this.rpc('broker/GetPipe', { pipe: 'wb.request' }) as { channel?: string; methods?: unknown };
            if (pipe?.channel !== 'c:wb.request' || !Array.isArray(pipe.methods) || !pipe.methods.includes('http.fetch')) throw failure('E_REQUEST_PIPE_UNAVAILABLE');
            if (this.closed) throw this.closed;
            this.available = true;
        } finally { clearTimeout(deadline); signal?.removeEventListener('abort', abort); }
    }
    async requestFetch(params: BrokerFetchParams, signal?: AbortSignal): Promise<BrokerFetchResult> {
        if (!params || typeof params !== 'object' || Array.isArray(params)) throw failure('E_INVALID_PARAMS');
        const result = await this.rpc('c:wb.request/http.fetch', params, 'call', signal) as BrokerFetchResult;
        if (!result || !Number.isInteger(result.status) || result.status < 100 || result.status > 599
            || !result.headers || typeof result.headers !== 'object' || Array.isArray(result.headers)
            || Object.values(result.headers).some(value => typeof value !== 'string')
            || typeof result.body_b64 !== 'string' || result.body_b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.body_b64)) {
            this.close(failure('E_PROTOCOL_ERROR')); throw failure('E_PROTOCOL_ERROR');
        }
        return { status: result.status, headers: { ...result.headers }, body_b64: result.body_b64 };
    }
}

export async function connectWorkbuddyBroker(configDir: string, signal?: AbortSignal, onDisconnect?: (error: Error) => void): Promise<WorkbuddyBroker> {
    if (signal?.aborted) throw failure('E_CANCELLED');
    const { endpoint, ticket } = discover(configDir);
    let connection: BrokerConnection | undefined;
    try {
        connection = new BrokerConnection(endpoint, onDisconnect);
        await connection.initialize(endpoint, ticket, signal);
        const ready = connection;
        return { requestFetch: (params, requestSignal) => ready.requestFetch(params, requestSignal), dispose: () => ready.dispose() };
    }
    catch (error) {
        connection?.dispose();
        const code = (error as BrokerError).code;
        throw failure(remoteCodes.has(code) || ['E_SOCKET_UNAVAILABLE', 'E_DISCONNECTED', 'E_SERVER_PROOF_INVALID',
            'E_REQUEST_PIPE_UNAVAILABLE', 'E_PROTOCOL_ERROR', 'E_HANDSHAKE_TIMEOUT', 'E_INVALID_PARAMS'].includes(code) ? code : 'E_CONNECT_FAILED');
    }
    finally { ticket.fill(0); }
}
