import { request, type ClientRequest } from 'http';
import { StringDecoder } from 'string_decoder';

const MAX_FRAME_LENGTH = 4 * 1024 * 1024;

function parseJson(text: string): unknown {
    try { return JSON.parse(text); }
    catch { throw new Error('WorkBuddy returned invalid JSON'); }
}

/** 只管理本客户端的 HTTP/SSE 连接；不启动进程、不创建会话、不重放 RPC。 */
export class WorkbuddyHostConnection {
    private readonly requests = new Set<ClientRequest>();
    private connectionId = '';
    private sessionToken = '';
    private closed = false;
    private disposal: Promise<void> | null = null;

    private constructor(
        private readonly endpoint: URL,
        private readonly onMessage: (message: Record<string, unknown>) => void,
        private readonly onDisconnect: (error: Error) => void,
    ) {}

    static async connect(
        endpoint: string,
        onMessage: (message: Record<string, unknown>) => void,
        onDisconnect: (error: Error) => void,
    ): Promise<WorkbuddyHostConnection> {
        let url: URL;
        try { url = new URL(endpoint); }
        catch { throw new Error('Invalid WorkBuddy loopback endpoint'); }
        if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
            || url.username || url.password || url.pathname !== '/' || /[?\#@]/.test(endpoint)) {
            throw new Error('WorkBuddy endpoint must be an HTTP loopback root URL');
        }
        const connection = new WorkbuddyHostConnection(url, onMessage, onDisconnect);
        try {
            const result = await connection.request('POST', '/api/v1/acp/connect') as {
                connectionId?: unknown; sessionToken?: unknown;
            } | null;
            if (!result || typeof result.connectionId !== 'string' || !result.connectionId
                || typeof result.sessionToken !== 'string' || !result.sessionToken
                || /[\r\n]/.test(result.connectionId + result.sessionToken)) {
                throw new Error('WorkBuddy returned invalid connection credentials');
            }
            connection.connectionId = result.connectionId;
            connection.sessionToken = result.sessionToken;
            await connection.request('GET', '/api/v1/acp', undefined, true);
            return connection;
        } catch (error) {
            await connection.dispose().catch(() => {});
            throw error;
        }
    }

    async send(message: Record<string, unknown>): Promise<void> {
        if (this.closed) throw new Error('WorkBuddy host connection is closed');
        try {
            await this.request('POST', '/api/v1/acp', JSON.stringify(message));
        } catch (error) {
            this.disconnect(error as Error);
            throw error;
        }
    }

    dispose(): Promise<void> {
        if (this.disposal) return this.disposal;
        this.closed = true;
        for (const req of this.requests) req.destroy(new Error('WorkBuddy host connection disposed'));
        this.disposal = (async () => {
            try {
                if (this.connectionId) await this.request('DELETE', '/api/v1/acp');
            } finally {
                this.connectionId = '';
                this.sessionToken = '';
            }
        })();
        return this.disposal;
    }

    private disconnect(error: Error): void {
        if (this.closed) return;
        this.closed = true;
        for (const req of this.requests) req.destroy(error);
        this.onDisconnect(error);
    }

    private receive(text: string): void {
        const message = parseJson(text);
        if (!message || typeof message !== 'object' || Array.isArray(message)
            || (message as Record<string, unknown>).jsonrpc !== '2.0') {
            throw new Error('WorkBuddy returned an invalid JSON-RPC message');
        }
        this.onMessage(message as Record<string, unknown>);
    }

    private request(method: string, pathname: string, body?: string, subscription = false): Promise<unknown> {
        return new Promise((resolve, reject) => {
            let settled = false;
            let subscribed = false;
            const headers: Record<string, string> = {
                'X-CodeBuddy-Request': '1',
                Accept: subscription ? 'text/event-stream' : 'application/json, text/event-stream',
            };
            if (pathname.endsWith('/connect')) headers.Accept = 'application/json';
            if (this.connectionId) {
                headers['acp-connection-id'] = this.connectionId;
                headers['acp-session-token'] = this.sessionToken;
            }
            if (body !== undefined) headers['Content-Type'] = 'application/json';
            const req = request(new URL(pathname, this.endpoint), {
                method, headers,
                // localhost 必须固定连回环，不能受本机 DNS/hosts 改写影响。
                ...(this.endpoint.hostname === 'localhost' ? { hostname: '127.0.0.1' } : {}),
            });
            this.requests.add(req);
            const fail = (error: Error) => {
                if (!settled) { settled = true; reject(error); }
                if (subscribed) this.disconnect(error);
                req.destroy();
            };
            req.on('error', fail);
            req.on('close', () => this.requests.delete(req));
            req.setTimeout(10_000, () => fail(new Error('WorkBuddy HTTP request timed out')));
            req.on('response', (res) => {
                const status = res.statusCode ?? 0;
                if (status < 200 || status >= 300) {
                    res.resume();
                    fail(new Error(`WorkBuddy HTTP ${status}`));
                    return;
                }
                const sse = /^text\/event-stream(?:;|$)/i.test(res.headers['content-type'] ?? '');
                if (subscription && !sse) {
                    res.resume();
                    fail(new Error('WorkBuddy subscription is not an event stream'));
                    return;
                }
                if (sse) req.setTimeout(0);
                const decoder = new StringDecoder('utf8');
                let buffer = '';
                let data: string[] = [];
                let frameLength = 0;
                let trailingCr = false;
                const consume = (text: string) => {
                    if (sse && text) {
                        if (trailingCr && text[0] === '\n') text = text.slice(1);
                        trailingCr = false;
                    }
                    buffer += text;
                    if (buffer.length + frameLength > MAX_FRAME_LENGTH) throw new Error('WorkBuddy response is too large');
                    if (!sse) return;
                    let newline: RegExpExecArray | null;
                    while ((newline = /\r\n|\r|\n/.exec(buffer))) {
                        trailingCr = newline[0] === '\r' && newline.index === buffer.length - 1;
                        const line = buffer.slice(0, newline.index);
                        buffer = buffer.slice(newline.index + newline[0].length);
                        if (!line) {
                            if (data.length) this.receive(data.join('\n'));
                            data = [];
                            frameLength = 0;
                        } else if (line === 'data' || line.startsWith('data:')) {
                            const value = line.slice(5).replace(/^ /, '');
                            data.push(value);
                            frameLength += value.length;
                        }
                    }
                };
                res.on('data', (chunk: Buffer) => {
                    try { consume(decoder.write(chunk)); }
                    catch (error) { fail(error as Error); }
                });
                res.on('aborted', () => fail(new Error('WorkBuddy HTTP response was interrupted')));
                res.on('error', () => fail(new Error('WorkBuddy HTTP response failed')));
                res.on('end', () => {
                    if (subscription) { fail(new Error('WorkBuddy event stream closed')); return; }
                    if (settled) return;
                    try {
                        consume(decoder.end());
                        let result: unknown;
                        if (sse) {
                            if (buffer.trim() || data.length) throw new Error('WorkBuddy returned an incomplete SSE frame');
                        } else if (body !== undefined && status !== 202 && status !== 204) {
                            this.receive(buffer);
                        } else if (pathname.endsWith('/connect')) {
                            result = parseJson(buffer);
                        }
                        settled = true;
                        resolve(result);
                    } catch (error) { fail(error as Error); }
                });
                if (subscription) {
                    subscribed = true;
                    settled = true;
                    resolve(undefined);
                }
            });
            req.end(body);
        });
    }
}
