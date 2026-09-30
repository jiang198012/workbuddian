import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { AddressInfo, Socket } from 'net';
import { WorkbuddyHostConnection } from '../src/providers/codebuddy/workbuddyHost';

type RecordedRequest = { method: string; url: string; headers: IncomingMessage['headers']; body: string };

async function startHost() {
    const requests: RecordedRequest[] = [];
    const sockets = new Set<Socket>();
    let events: ServerResponse;
    let reply = (_req: RecordedRequest, res: ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } }));
    };
    const server = createServer((req, res) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            const recorded = { method: req.method!, url: req.url!, headers: req.headers, body };
            requests.push(recorded);
            if (req.url === '/api/v1/acp/connect') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ connectionId: 'owned-connection', sessionToken: 'synthetic-token' }));
            } else if (req.method === 'GET') {
                events = res;
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                res.flushHeaders();
            } else if (req.method === 'DELETE') {
                res.writeHead(204);
                res.end();
            } else {
                reply(recorded, res);
            }
        });
    });
    server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        requests,
        get events() { return events; },
        setReply(fn: typeof reply) { reply = fn; },
        async close() {
            for (const socket of sockets) socket.destroy();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        },
    };
}

describe('WorkBuddy host HTTP/SSE connection', () => {
    let host: Awaited<ReturnType<typeof startHost>>;
    let connection: WorkbuddyHostConnection | undefined;
    beforeEach(async () => { host = await startHost(); });
    afterEach(async () => {
        await connection?.dispose();
        connection = undefined;
        await host.close();
    });

    it('subscribes before the caller initializes, using only its issued connection credentials', async () => {
        const messages: unknown[] = [];
        const disconnected = jest.fn();
        connection = await WorkbuddyHostConnection.connect(host.endpoint, (message) => messages.push(message), disconnected);
        expect(host.requests.map((r) => [r.method, r.url])).toEqual([
            ['POST', '/api/v1/acp/connect'], ['GET', '/api/v1/acp'],
        ]);
        expect(host.requests[0].headers['x-codebuddy-request']).toBe('1');
        expect(host.requests[1].headers['acp-connection-id']).toBe('owned-connection');
        expect(host.requests[1].headers['acp-session-token']).toBe('synthetic-token');
        await connection.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } });
        expect(messages).toEqual([{ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } }]);
        const sent = host.requests[2];
        expect(sent.headers).toMatchObject({
            'x-codebuddy-request': '1', 'content-type': 'application/json',
            'acp-connection-id': 'owned-connection', 'acp-session-token': 'synthetic-token',
        });
        expect(JSON.parse(sent.body).method).toBe('initialize');
        expect(disconnected).not.toHaveBeenCalled();
    });

    it('decodes GET SSE frames across UTF-8 bytes, CRLF and multiple data lines', async () => {
        let receive!: (message: unknown) => void;
        const message = new Promise<unknown>((resolve) => { receive = resolve; });
        connection = await WorkbuddyHostConnection.connect(host.endpoint, receive, () => {});
        const frame = Buffer.from(': heartbeat\r\nevent: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "method":"session/update","params":{"text":"你好"}}\r\n\r\n');
        const split = frame.indexOf(Buffer.from('你')) + 1;
        host.events.write(frame.subarray(0, split));
        await new Promise((resolve) => setTimeout(resolve, 5));
        host.events.write(frame.subarray(split));
        await expect(message).resolves.toEqual({ jsonrpc: '2.0', method: 'session/update', params: { text: '你好' } });
    });

    it('delivers POST SSE responses and accepts notification acknowledgements without inventing RPC replies', async () => {
        const messages: unknown[] = [];
        connection = await WorkbuddyHostConnection.connect(host.endpoint, (message) => messages.push(message), () => {});
        host.setReply((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.end('data: {"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}\n\n');
        });
        await connection.send({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: {} });
        host.setReply((_req, res) => { res.writeHead(202); res.end(); });
        await connection.send({ jsonrpc: '2.0', method: 'session/cancel', params: {} });
        expect(messages).toEqual([{ jsonrpc: '2.0', id: 3, result: { stopReason: 'end_turn' } }]);
    });

    it('accepts SSE frames delimited by lone CR characters', async () => {
        const messages: unknown[] = [];
        connection = await WorkbuddyHostConnection.connect(host.endpoint, (message) => messages.push(message), () => {});
        host.setReply((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.end('data: {"jsonrpc":"2.0","id":2,"result":{}}\r\r');
        });
        await connection.send({ jsonrpc: '2.0', id: 2, method: 'initialize' });
        expect(messages).toEqual([{ jsonrpc: '2.0', id: 2, result: {} }]);
    });

    it.each([302, 500])('rejects HTTP %s without leaking response bodies or following redirects', async (status) => {
        connection = await WorkbuddyHostConnection.connect(host.endpoint, () => {}, () => {});
        host.setReply((_req, res) => {
            res.writeHead(status, { Location: '/unexpected' });
            res.end('synthetic-sensitive-response');
        });
        const failure = await connection.send({ jsonrpc: '2.0', id: 4, method: 'initialize' }).catch((error: Error) => error);
        expect(failure).toBeInstanceOf(Error);
        expect(String(failure)).toContain(String(status));
        expect(String(failure)).not.toContain('synthetic-sensitive-response');
        expect(host.requests.some((r) => r.url === '/unexpected')).toBe(false);
    });

    it('rejects malformed POST JSON and reports the disconnect without exposing the body', async () => {
        const disconnected = jest.fn();
        connection = await WorkbuddyHostConnection.connect(host.endpoint, () => {}, disconnected);
        host.setReply((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{synthetic-sensitive-response');
        });
        await expect(connection.send({ jsonrpc: '2.0', id: 4, method: 'initialize' }))
            .rejects.toThrow('invalid JSON');
        expect(disconnected).toHaveBeenCalledTimes(1);
        expect(disconnected.mock.calls[0][0].message).not.toContain('synthetic-sensitive-response');
    });

    it('reports an ended subscription once and refuses subsequent sends', async () => {
        let disconnect!: (error: Error) => void;
        const disconnected = new Promise<Error>((resolve) => { disconnect = resolve; });
        connection = await WorkbuddyHostConnection.connect(host.endpoint, () => {}, disconnect);
        host.events.end();
        await expect(disconnected).resolves.toBeInstanceOf(Error);
        await expect(connection.send({ jsonrpc: '2.0', id: 5, method: 'initialize' })).rejects.toThrow();
    });

    it('disconnects only its owned connection and makes disposal idempotent', async () => {
        const disconnected = jest.fn();
        connection = await WorkbuddyHostConnection.connect(host.endpoint, () => {}, disconnected);
        await connection.dispose();
        await connection.dispose();
        const deletes = host.requests.filter((r) => r.method === 'DELETE');
        expect(deletes).toHaveLength(1);
        expect(deletes[0].url).toBe('/api/v1/acp');
        expect(deletes[0].headers['acp-connection-id']).toBe('owned-connection');
        expect(deletes[0].headers['acp-session-token']).toBe('synthetic-token');
        expect(disconnected).not.toHaveBeenCalled();
        expect(host.requests.every((r) => r.url.startsWith('/api/v1/acp'))).toBe(true);
    });

    it.each([
        'https://127.0.0.1:1234', 'http://example.com', 'http://127.0.0.1:1234/task',
        'http://user:pass@127.0.0.1:1234', 'http://127.0.0.1:1234/?x=1', 'http://127.0.0.1:1234/#task',
        'http://127.0.0.1:1234/?', 'http://127.0.0.1:1234/#', 'http://@127.0.0.1:1234',
    ])('rejects a non-loopback or non-root endpoint before connecting: %s', async (endpoint) => {
        await expect(WorkbuddyHostConnection.connect(endpoint, () => {}, () => {})).rejects.toThrow(/endpoint|loopback/);
        expect(host.requests).toHaveLength(0);
    });
});
