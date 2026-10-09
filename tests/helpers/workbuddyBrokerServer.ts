import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { createHash, createHmac, randomBytes } from 'crypto';
import type { BrokerFetchParams, BrokerFetchResult } from '../../src/providers/codebuddy/workbuddyBroker';

export interface WorkbuddyBrokerTestServer {
    configDir: string;
    endpoint: string;
    metadataPath: string;
    requests: BrokerFetchParams[];
    frames: Record<string, any>[];
    readonly socket: net.Socket | undefined;
    options: { invalidServerProof?: boolean; silentHandshake?: boolean; silentGetPipe?: boolean; proofEndpoint?: string };
    send(frame: unknown): void;
    disconnect(): void;
    close(): Promise<void>;
}

/** 只生成隔离目录内的测试票据；协议夹具不读取真实账号。 */
export async function createWorkbuddyBrokerServer(
    root: string,
    onFetch: (params: BrokerFetchParams, signal: AbortSignal) => BrokerFetchResult | Promise<BrokerFetchResult>
        = () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body_b64: 'b2s=' }),
): Promise<WorkbuddyBrokerTestServer> {
    const configDir = path.join(root, 'cfg'); fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const hash = (value: string, count: number) => createHash('sha1').update(value).digest('hex').slice(0, count);
    const uid = process.getuid?.();
    const writable = (dir: string) => { try { if (!fs.statSync(dir).isDirectory()) return false; fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; } };
    const xdg = process.env.XDG_RUNTIME_DIR?.trim();
    const base = process.platform === 'linux' && xdg && writable(xdg) ? path.join(xdg, 'workbuddy')
        : process.platform === 'linux' && uid !== undefined && writable(`/run/user/${uid}`) ? path.join(`/run/user/${uid}`, 'workbuddy')
            : path.join(os.tmpdir().trim(), uid === undefined ? 'wb' : `wb-${hash(String(uid), 6)}`);
    const socketDir = path.join(base, hash(configDir, 12), 'wbipc'); fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    const endpoint = path.join(socketDir, 'b-0123456789abcdef.sock');
    const metadataDir = path.join(configDir, 'wbipc'); fs.mkdirSync(metadataDir, { mode: 0o700 });
    const metadataPath = path.join(metadataDir, 'endpoint.json');
    const ticket = randomBytes(32).toString('base64url');
    const frames: Record<string, any>[] = [], requests: BrokerFetchParams[] = [], sockets = new Set<net.Socket>();
    const options: WorkbuddyBrokerTestServer['options'] = {};
    let current: net.Socket | undefined;
    const send = (socket: net.Socket, frame: unknown) => { if (!socket.destroyed) socket.write(JSON.stringify(frame) + '\n'); };
    const proof = (side: 'server' | 'client', client: string, nonce: string) => {
        const bytes = [side === 'server' ? 'wbipc-s' : 'wbipc-c', '1', options.proofEndpoint ?? endpoint, client, nonce].flatMap(value => {
            const data = Buffer.from(value), size = Buffer.alloc(4); size.writeUInt32BE(data.length); return [size, data];
        });
        return createHmac('sha256', Buffer.from(ticket)).update(Buffer.concat(bytes)).digest('base64url');
    };
    const server = net.createServer(socket => {
        current = socket; sockets.add(socket);
        const pending = new Map<number, AbortController>();
        const nonce = randomBytes(16).toString('base64url'); let client = '', ready = false, buffer = '';
        socket.on('error', () => {});
        socket.on('close', () => { sockets.delete(socket); for (const controller of pending.values()) controller.abort(); pending.clear(); });
        socket.setEncoding('utf8');
        socket.on('data', chunk => {
            buffer += chunk;
            let newline: number;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                let frame: Record<string, any>;
                try { frame = JSON.parse(buffer.slice(0, newline)); } catch { socket.destroy(); return; }
                buffer = buffer.slice(newline + 1); frames.push(frame);
                if (frame.type === 'session_hello') {
                    if (options.silentHandshake) continue;
                    client = frame.client_nonce;
                    if (frame.ticket_id !== createHash('sha256').update(ticket).digest('hex').slice(0, 16)) { socket.destroy(); return; }
                    send(socket, { type: 'session_challenge', protocol: 1, server_nonce: nonce,
                        server_proof: options.invalidServerProof ? 'x'.repeat(43) : proof('server', client, nonce) });
                } else if (frame.type === 'session_prove') {
                    if (frame.client_proof !== proof('client', client, nonce)) { send(socket, { type: 'session_hello_error', code: 'auth_failed' }); return; }
                    ready = true;
                    send(socket, { type: 'session_hello_ack', protocol: 1, connection_epoch: 'ce-fixture', max_inflight: 8, pipes: ['wb.request'] });
                } else if (!ready) { socket.destroy(); return; }
                else if (frame.method === 'broker/GetPipe') {
                    if (!options.silentGetPipe) send(socket, { jsonrpc: '2.0', id: frame.id,
                        result: { channel: 'c:wb.request', methods: ['http.fetch'] } });
                } else if (frame.method === '$/cancel') pending.get(frame.params?.id)?.abort();
                else if (frame.method === 'c:wb.request/http.fetch' && frame.mode === 'call') {
                    const controller = new AbortController(); pending.set(frame.id, controller); requests.push(frame.params);
                    Promise.resolve().then(() => onFetch(frame.params, controller.signal)).then(
                        result => send(socket, { jsonrpc: '2.0', id: frame.id, result }),
                        () => send(socket, { jsonrpc: '2.0', id: frame.id, error: { code: 'E_UPSTREAM', message: 'fixture failure' } }),
                    ).finally(() => pending.delete(frame.id));
                } else { socket.destroy(); return; }
            }
        });
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve); });
    fs.chmodSync(endpoint, 0o600); fs.writeFileSync(metadataPath, JSON.stringify({ endpoint, ticket }), { mode: 0o600 });
    return { configDir, endpoint, metadataPath, requests, frames, options,
        get socket() { return current; },
        send(frame) { if (!current) throw new Error('Fixture client not connected'); send(current, frame); },
        disconnect() { current?.destroy(); },
        async close() { for (const socket of sockets) socket.destroy(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); },
    };
}
