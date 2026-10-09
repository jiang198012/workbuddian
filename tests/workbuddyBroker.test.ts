import * as fs from 'fs';
import * as path from 'path';
import { connectWorkbuddyBroker, type WorkbuddyBroker, type BrokerFetchResult } from '../src/providers/codebuddy/workbuddyBroker';
import { createWorkbuddyBrokerServer, type WorkbuddyBrokerTestServer } from './helpers/workbuddyBrokerServer';

describe('WorkBuddy native account broker', () => {
    let root: string;
    let fixture: WorkbuddyBrokerTestServer | undefined;
    let connection: WorkbuddyBroker | undefined;
    let previousXdg: string | undefined;
    const ok: BrokerFetchResult = { status: 200, headers: { 'content-type': 'text/plain' }, body_b64: 'b2s=' };
    const waitFor = async (predicate: () => boolean) => {
        for (let index = 0; index < 200; index++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
        throw new Error('Fixture did not receive the expected frame');
    };
    const open = async (onFetch?: Parameters<typeof createWorkbuddyBrokerServer>[1], onDisconnect?: (error: Error) => void) => {
        fixture = await createWorkbuddyBrokerServer(root, onFetch);
        connection = await connectWorkbuddyBroker(fixture.configDir, undefined, onDisconnect);
        return connection;
    };
    const shortenTimeouts = () => {
        const original = global.setTimeout;
        jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any, delay: number, ...args: any[]) =>
            original(fn, delay === 5000 || delay === 55_000 ? 20 : delay, ...args)) as typeof setTimeout);
    };

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync('/tmp/wbbr-'));
        jest.spyOn(require('os'), 'tmpdir').mockReturnValue(root);
        previousXdg = process.env.XDG_RUNTIME_DIR;
        const xdg = path.join(root, 'x'); fs.mkdirSync(xdg, { mode: 0o700 }); process.env.XDG_RUNTIME_DIR = xdg;
    });
    afterEach(async () => {
        connection?.dispose(); connection = undefined;
        await fixture?.close(); fixture = undefined;
        jest.restoreAllMocks();
        if (previousXdg === undefined) delete process.env.XDG_RUNTIME_DIR; else process.env.XDG_RUNTIME_DIR = previousXdg;
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('authenticates a real native host and returns its HTTP result over the fixed pipe', async () => {
        const broker = await open();
        await expect(broker.requestFetch({ method: 'GET', path: '/fixture' })).resolves.toEqual(ok);
        expect(fixture!.frames[0].client.kind).toBe('workbuddian');
        expect(fixture!.frames.filter(frame => frame.method).map(frame => [frame.method, frame.params, frame.mode])).toEqual([
            ['broker/GetPipe', { pipe: 'wb.request' }, undefined],
            ['c:wb.request/http.fetch', { method: 'GET', path: '/fixture' }, 'call'],
        ]);
    });

    it('rejects a forged server proof before exposing a request channel', async () => {
        fixture = await createWorkbuddyBrokerServer(root); fixture.options.invalidServerProof = true;
        await expect(connectWorkbuddyBroker(fixture.configDir)).rejects.toMatchObject({ code: 'E_SERVER_PROOF_INVALID' });
        expect(fixture.frames.some(frame => frame.type === 'session_prove')).toBe(false);
        expect(fixture.requests).toHaveLength(0);
    });

    it.each(['permissions', 'symlink', 'outside-runtime', 'socket-directory', 'invalid-json', 'socket-permissions'])('fails closed on untrusted %s metadata', async kind => {
        fixture = await createWorkbuddyBrokerServer(root);
        if (kind === 'permissions') fs.chmodSync(fixture.metadataPath, 0o644);
        if (kind === 'symlink') { const target = path.join(root, 'other.json'); fs.renameSync(fixture.metadataPath, target); fs.symlinkSync(target, fixture.metadataPath); }
        if (kind === 'outside-runtime') { const meta = JSON.parse(fs.readFileSync(fixture.metadataPath, 'utf8')); meta.endpoint = path.join(root, 'b-abcd.sock'); fs.writeFileSync(fixture.metadataPath, JSON.stringify(meta)); }
        if (kind === 'socket-directory') fs.chmodSync(path.dirname(fixture.endpoint), 0o755);
        if (kind === 'invalid-json') fs.writeFileSync(fixture.metadataPath, '{invalid fixture');
        if (kind === 'socket-permissions') fs.chmodSync(fixture.endpoint, 0o644);
        await expect(connectWorkbuddyBroker(fixture.configDir)).rejects.toMatchObject({ code: 'E_ENDPOINT_UNTRUSTED' });
        expect(fixture.frames).toHaveLength(0);
    });

    it('rejects a metadata inode change between lstat and open', async () => {
        fixture = await createWorkbuddyBrokerServer(root);
        const original = fs.fstatSync;
        jest.spyOn(require('fs'), 'fstatSync').mockImplementation((fd: number) => { const stat = original(fd); stat.ino += 1; return stat; });
        await expect(connectWorkbuddyBroker(fixture.configDir)).rejects.toMatchObject({ code: 'E_ENDPOINT_UNTRUSTED' });
        expect(fixture.frames).toHaveLength(0);
    });

    it('rejects a metadata file owned by another user', async () => {
        fixture = await createWorkbuddyBrokerServer(root);
        const original = fs.lstatSync;
        jest.spyOn(require('fs'), 'lstatSync').mockImplementation((file: fs.PathLike) => { const stat = original(file); if (file === fixture!.metadataPath) stat.uid += 1; return stat; });
        await expect(connectWorkbuddyBroker(fixture.configDir)).rejects.toMatchObject({ code: 'E_ENDPOINT_UNTRUSTED' });
        expect(fixture.frames).toHaveLength(0);
    });

    it('classifies missing discovery separately from unsafe metadata', async () => {
        const config = path.join(root, 'missing'); fs.mkdirSync(config, { mode: 0o700 });
        await expect(connectWorkbuddyBroker(config)).rejects.toMatchObject({ code: 'E_DISCOVERY_MISSING' });
    });

    it('reports an initially unavailable socket without notifying disconnect', async () => {
        fixture = await createWorkbuddyBrokerServer(root);
        const nativeConnect = require('net').createConnection;
        let stopping: Promise<void> | undefined;
        jest.spyOn(require('net'), 'createConnection').mockImplementation((...args: any[]) => {
            stopping = fixture!.close(); return nativeConnect(...args);
        });
        const notified: Error[] = [];
        await expect(connectWorkbuddyBroker(fixture.configDir, undefined, error => notified.push(error)))
            .rejects.toMatchObject({ code: 'E_SOCKET_UNAVAILABLE' });
        await stopping; expect(notified).toHaveLength(0);
    });

    it('rejects nonnative Windows network pipe addresses', async () => {
        fixture = await createWorkbuddyBrokerServer(root);
        const meta = JSON.parse(fs.readFileSync(fixture.metadataPath, 'utf8')); meta.endpoint = '\\\\server\\pipe\\wbipc-abcd';
        fs.writeFileSync(fixture.metadataPath, JSON.stringify(meta));
        const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
        try { await expect(connectWorkbuddyBroker(fixture.configDir)).rejects.toMatchObject({ code: 'E_ENDPOINT_UNTRUSTED' }); }
        finally { Object.defineProperty(process, 'platform', platform); }
        expect(fixture.frames).toHaveLength(0);
    });

    it('authenticates a native Windows pipe without imposing Unix permission bits', async () => {
        fixture = await createWorkbuddyBrokerServer(root);
        const nativeEndpoint = '\\\\.\\pipe\\wbipc-0123456789abcdef';
        const meta = JSON.parse(fs.readFileSync(fixture.metadataPath, 'utf8')); meta.endpoint = nativeEndpoint;
        fs.writeFileSync(fixture.metadataPath, JSON.stringify(meta)); fs.chmodSync(fixture.metadataPath, 0o644);
        fs.chmodSync(path.dirname(fixture.metadataPath), 0o755); fixture.options.proofEndpoint = nativeEndpoint;
        const nativeConnect = require('net').createConnection;
        jest.spyOn(require('net'), 'createConnection').mockImplementation((endpoint: unknown) => {
            expect(endpoint).toBe(nativeEndpoint); return nativeConnect(fixture!.endpoint);
        });
        const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
        try {
            connection = await connectWorkbuddyBroker(fixture.configDir);
            await expect(connection.requestFetch({ method: 'GET', path: '/windows' })).resolves.toEqual(ok);
        } finally { Object.defineProperty(process, 'platform', platform); }
    });

    it('uses the official Linux XDG runtime directory while keeping metadata isolated', async () => {
        const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
        try {
            const broker = await open();
            expect(fixture!.endpoint.startsWith(path.join(root, 'x', 'workbuddy') + path.sep)).toBe(true);
            await expect(broker.requestFetch({ method: 'GET', path: '/linux' })).resolves.toEqual(ok);
        } finally { Object.defineProperty(process, 'platform', platform); }
    });

    it('cancels before connecting without opening a host channel', async () => {
        fixture = await createWorkbuddyBrokerServer(root);
        const controller = new AbortController(); controller.abort();
        await expect(connectWorkbuddyBroker(fixture.configDir, controller.signal)).rejects.toMatchObject({ code: 'E_CANCELLED' });
        expect(fixture.frames).toHaveLength(0);
    });

    it('cancels an unfinished handshake without notifying disconnect', async () => {
        fixture = await createWorkbuddyBrokerServer(root); fixture.options.silentHandshake = true;
        const controller = new AbortController(), notified: Error[] = [];
        const pending = expect(connectWorkbuddyBroker(fixture.configDir, controller.signal, error => notified.push(error)))
            .rejects.toMatchObject({ code: 'E_CANCELLED' });
        await waitFor(() => fixture!.frames.length === 1); controller.abort(); await pending;
        expect(notified).toHaveLength(0); expect(fixture.requests).toHaveLength(0);
    });

    it('cancels a request before sending without changing host state', async () => {
        const broker = await open(), controller = new AbortController(); controller.abort();
        await expect(broker.requestFetch({ method: 'GET', path: '/cancel' }, controller.signal)).rejects.toMatchObject({ code: 'E_CANCELLED' });
        expect(fixture!.requests).toHaveLength(0);
    });

    it('cancels an in-flight request with a JSON-RPC cancellation notification and no replay', async () => {
        const broker = await open(() => new Promise(() => {})), controller = new AbortController();
        const result = expect(broker.requestFetch({ method: 'GET', path: '/cancel' }, controller.signal)).rejects.toMatchObject({ code: 'E_CANCELLED' });
        await waitFor(() => fixture!.requests.length === 1); controller.abort(); await result;
        await waitFor(() => fixture!.frames.some(frame => frame.method === '$/cancel'));
        const cancel = fixture!.frames.find(frame => frame.method === '$/cancel');
        expect(cancel).toEqual({ jsonrpc: '2.0', method: '$/cancel', params: { id: fixture!.frames.find(frame => frame.method === 'c:wb.request/http.fetch').id } });
        expect(fixture!.requests).toHaveLength(1);
    });

    it('matches concurrent responses by id even when host replies in reverse order', async () => {
        const finish: ((result: BrokerFetchResult) => void)[] = [];
        const broker = await open(() => new Promise(resolve => finish.push(resolve)));
        const first = broker.requestFetch({ method: 'GET', path: '/first' }), second = broker.requestFetch({ method: 'GET', path: '/second' });
        await waitFor(() => finish.length === 2);
        finish[1]({ ...ok, status: 202 }); finish[0]({ ...ok, status: 201 });
        await expect(first).resolves.toMatchObject({ status: 201 }); await expect(second).resolves.toMatchObject({ status: 202 });
    });

    it('limits in-flight requests to eight without sending a ninth operation', async () => {
        const broker = await open(() => new Promise(() => {}));
        const pending = Array.from({ length: 8 }, (_, index) => broker.requestFetch({ method: 'GET', path: `/${index}` }).catch(error => error.code));
        await expect(broker.requestFetch({ method: 'GET', path: '/ninth' })).rejects.toMatchObject({ code: 'E_BUSY' });
        await waitFor(() => fixture!.requests.length === 8); broker.dispose();
        expect(await Promise.all(pending)).toEqual(Array(8).fill('E_CLOSED')); expect(fixture!.requests).toHaveLength(8);
    });

    it.each(['handshake', 'GetPipe'])('bounds a silent %s under the connect deadline', async stage => {
        shortenTimeouts(); fixture = await createWorkbuddyBrokerServer(root);
        if (stage === 'handshake') fixture.options.silentHandshake = true; else fixture.options.silentGetPipe = true;
        await expect(connectWorkbuddyBroker(fixture.configDir)).rejects.toMatchObject({ code: 'E_HANDSHAKE_TIMEOUT' });
        expect(fixture.requests).toHaveLength(0);
    });

    it('times out a silent request and cancels it without replay', async () => {
        shortenTimeouts(); const broker = await open(() => new Promise(() => {}));
        await expect(broker.requestFetch({ method: 'GET', path: '/timeout' })).rejects.toMatchObject({ code: 'E_TIMEOUT' });
        await waitFor(() => fixture!.frames.some(frame => frame.method === '$/cancel')); expect(fixture!.requests).toHaveLength(1);
    });

    it('rejects all pending requests and reports unexpected disconnect once without reconnecting', async () => {
        const notified: Error[] = [], broker = await open(() => new Promise(() => {}), error => notified.push(error));
        const pending = [1, 2].map(index => broker.requestFetch({ method: 'GET', path: `/${index}` }).catch(error => error.code));
        await waitFor(() => fixture!.requests.length === 2); fixture!.disconnect();
        expect(await Promise.all(pending)).toEqual(['E_DISCONNECTED', 'E_DISCONNECTED']);
        expect(notified).toHaveLength(1); expect(fixture!.frames.filter(frame => frame.type === 'session_hello')).toHaveLength(1);
        await expect(broker.requestFetch({ method: 'GET', path: '/after' })).rejects.toMatchObject({ code: 'E_DISCONNECTED' });
    });

    it('actively disposes requests without notifying unexpected disconnect', async () => {
        const notified: Error[] = [], broker = await open(() => new Promise(() => {}), error => notified.push(error));
        const pending = broker.requestFetch({ method: 'GET', path: '/dispose' }).catch(error => error.code);
        broker.dispose(); expect(await pending).toBe('E_CLOSED'); expect(notified).toHaveLength(0);
    });

    it('closes revoked pipes before another account can receive a request', async () => {
        const broker = await open(() => new Promise(() => {}));
        const pending = broker.requestFetch({ method: 'GET', path: '/revoke' }).catch(error => error.code);
        await waitFor(() => fixture!.requests.length === 1); fixture!.send({ type: 'pipe_revoked', channel: 'c:wb.request', code: 'account_changed' });
        expect(await pending).toBe('E_REVOKED');
        await expect(broker.requestFetch({ method: 'GET', path: '/after' })).rejects.toMatchObject({ code: 'E_REVOKED' });
        expect(fixture!.requests).toHaveLength(1);
    });

    it.each(['malformed', 'oversized'])('rejects %s frames with a bounded safe error', async kind => {
        const broker = await open(() => new Promise(() => {}));
        const pending = broker.requestFetch({ method: 'GET', path: '/bad' }).catch(error => error);
        await waitFor(() => fixture!.requests.length === 1);
        fixture!.socket!.write(kind === 'malformed' ? '{private-raw-error\n' : 'x'.repeat(1024 * 1024 + 1));
        const error = await pending; expect(error.code).toBe(kind === 'malformed' ? 'E_PROTOCOL_ERROR' : 'E_PAYLOAD_TOO_LARGE');
        expect(error.message).not.toContain('private-raw-error');
    });

    it('accepts two individually bounded frames even when combined beyond the frame limit', async () => {
        const broker = await open(() => new Promise(() => {}));
        const first = broker.requestFetch({ method: 'GET', path: '/large1' }), second = broker.requestFetch({ method: 'GET', path: '/large2' });
        await waitFor(() => fixture!.requests.length === 2);
        const ids = fixture!.frames.filter(frame => frame.method === 'c:wb.request/http.fetch').map(frame => frame.id);
        const large = { ...ok, body_b64: Buffer.alloc(450_000).toString('base64') };
        fixture!.socket!.write(ids.map(id => JSON.stringify({ jsonrpc: '2.0', id, result: large }) + '\n').join(''));
        expect((await first).body_b64).toHaveLength(600_000); expect((await second).body_b64).toHaveLength(600_000);
    });

    it('preserves only a safe upstream error code and rejects malformed fetch results', async () => {
        const broker = await open(() => new Promise(() => {}));
        const first = broker.requestFetch({ method: 'GET', path: '/private' }).catch(error => error);
        await waitFor(() => fixture!.requests.length === 1);
        const id = fixture!.frames.find(frame => frame.method === 'c:wb.request/http.fetch').id;
        fixture!.send({ jsonrpc: '2.0', id, error: { code: 'E_UPSTREAM', message: 'private-account-credential', data: { credential: 'fake' } } });
        const error = await first; expect(error.code).toBe('E_UPSTREAM'); expect(error.message).not.toContain('private-account-credential'); expect(error.data).toBeUndefined();
        const second = broker.requestFetch({ method: 'GET', path: '/invalid' }).catch(error => error.code);
        await waitFor(() => fixture!.requests.length === 2);
        fixture!.send({ jsonrpc: '2.0', id: fixture!.frames.filter(frame => frame.method === 'c:wb.request/http.fetch')[1].id, result: { status: '200', headers: [], body_b64: 1 } });
        expect(await second).toBe('E_PROTOCOL_ERROR');
    });
});
