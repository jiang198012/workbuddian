import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { createHash } from 'crypto';
import { startWorkbuddySidecar } from '../src/providers/codebuddy/workbuddySidecar';

type Rpc = { id: number; method: string; params: Record<string, any> };

describe('WorkBuddy owned sidecar worker', () => {
    let root: string;
    let scriptPath: string;
    let cwd: string;
    let configDir: string;
    let runtimeDir: string;
    let socketPath: string;
    let server: net.Server | undefined;
    let worker: Awaited<ReturnType<typeof startWorkbuddySidecar>>;
    let requests: Rpc[];
    let sockets: Set<net.Socket>;
    const originalConfig = process.env.WORKBUDDY_CONFIG_DIR;
    const hash = (value: string, length: number) => createHash('sha1').update(value).digest('hex').slice(0, length);
    const reply = (socket: net.Socket, request: Rpc, result: unknown) => socket.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
    const created = (request: Rpc) => ({ sessionId: request.params.sessionId, runtimeId: 'owned-runtime', pid: 2147483000, acpEndpoint: 'http://127.0.0.1:34567/api/v1/acp' });

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync('/tmp/wbs-'));
        configDir = path.join(root, 'config');
        cwd = path.join(root, 'vault');
        scriptPath = path.join(root, 'cli', 'bin', 'codebuddy');
        fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
        fs.mkdirSync(path.join(root, 'cli', 'dist'));
        fs.mkdirSync(cwd);
        fs.writeFileSync(scriptPath, '');
        fs.writeFileSync(path.join(root, 'cli', 'product.json'), JSON.stringify({ productName: 'WorkBuddy', dataFolderName: '.workbuddy' }));
        fs.writeFileSync(path.join(root, 'cli', 'dist', 'codebuddy-lite-wb.mjs'), 'CODEBUDDY_SIDECAR_CREDENTIAL_BOOTSTRAP_SOCKET');
        process.env.WORKBUDDY_CONFIG_DIR = configDir;
        jest.spyOn(require('os'), 'tmpdir').mockReturnValue(root);
        runtimeDir = path.join(root, `wb-${hash(String(process.getuid!()), 6)}`, hash(configDir, 12));
        socketPath = path.join(runtimeDir, 'sidecar-1234abcd.sock');
        requests = [];
        sockets = new Set();
    });

    afterEach(async () => {
        jest.useRealTimers();
        await worker?.dispose().catch(() => {});
        worker = null;
        for (const socket of sockets) socket.destroy();
        if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
        server = undefined;
        jest.restoreAllMocks();
        if (originalConfig === undefined) delete process.env.WORKBUDDY_CONFIG_DIR;
        else process.env.WORKBUDDY_CONFIG_DIR = originalConfig;
        fs.rmSync(root, { recursive: true, force: true });
    });

    async function listen(onCreate = (socket: net.Socket, request: Rpc) => { reply(socket, request, created(request)); }) {
        fs.mkdirSync(runtimeDir, { recursive: true });
        fs.writeFileSync(path.join(runtimeDir, 'sidecar.pid'), JSON.stringify({ pid: process.pid, version: 6, controlPipeUuid: '1234abcd', token: 'never-copy-this-test-token' }));
        server = net.createServer((socket) => {
            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket));
            socket.setEncoding('utf8');
            let buffer = '';
            socket.on('data', (chunk) => {
                buffer += chunk;
                let newline: number;
                while ((newline = buffer.indexOf('\n')) >= 0) {
                    const request = JSON.parse(buffer.slice(0, newline)) as Rpc;
                    buffer = buffer.slice(newline + 1);
                    requests.push(request);
                    if (request.method === 'session.create') onCreate(socket, request);
                    else if (request.method === 'session.kill') reply(socket, request, { ok: true });
                }
            });
        });
        await new Promise<void>((resolve) => server!.listen(socketPath, resolve));
    }

    it('creates a separate cwd worker with the installed product and kills only its returned runtime', async () => {
        await listen();
        worker = await startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve', '--agents', '{}']);
        expect(worker?.endpoint).toBe('http://127.0.0.1:34567');
        const params = requests[0].params;
        expect(requests[0].method).toBe('session.create');
        expect(params.sessionId).toMatch(/^workbuddian-[0-9a-f-]{36}$/);
        expect(params).toMatchObject({ command: '/test/node', args: [scriptPath, '--serve', '--agents', '{}'], cwd, port: 0 });
        expect(params.args).not.toContain('--session-id');
        expect(params.args).not.toContain('--no-session-persistence');
        expect(params.env).toMatchObject({
            ELECTRON_RUN_AS_NODE: '1', CODEBUDDY_FORCE_LITE_WB_BUNDLE: '1',
            CODEBUDDY_CONFIG_DIR: configDir, WORKBUDDY_CONFIG_DIR: configDir,
            ACC_PRODUCT_CONFIG_PATH: path.join(root, 'cli', 'product.json'),
            CODEBUDDY_API_KEY_HELPER_DISABLED: '1', CODEBUDDY_API_KEY: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '',
            CODEBUDDY_GATEWAY_AUTH: 'password', CODEBUDDY_GATEWAY_DISABLE_API_DOCS: '1',
        });
        expect(params.env.CODEBUDDY_GATEWAY_PASSWORD).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(params)).not.toContain('never-copy-this-test-token');
        await worker!.dispose();
        await worker!.dispose();
        expect(requests.slice(1)).toEqual([{ id: expect.any(Number), jsonrpc: '2.0', method: 'session.kill', params: { sessionId: params.sessionId, expectedRuntimeId: 'owned-runtime' } }]);
    });

    it('does not route other products through the WorkBuddy account', async () => {
        fs.writeFileSync(path.join(root, 'cli', 'product.json'), JSON.stringify({ productName: 'CodeBuddy' }));
        await expect(startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve'])).resolves.toBeNull();
        expect(requests).toHaveLength(0);
    });

    it('leaves an older WorkBuddy bundle without credential bootstrap on the existing stdio path', async () => {
        fs.writeFileSync(path.join(root, 'cli', 'dist', 'codebuddy-lite-wb.mjs'), 'older bundle without bootstrap');
        await expect(startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve'])).resolves.toBeNull();
        expect(requests).toHaveLength(0);
    });

    it('requires an existing runtime and an explicit existing absolute cwd', async () => {
        await expect(startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve'])).rejects.toThrow(/running|启动|运行/);
        await listen();
        await expect(startWorkbuddySidecar(scriptPath, 'relative-vault', '/test/node', [scriptPath, '--serve'])).rejects.toThrow(/cwd|directory|目录/);
        await expect(startWorkbuddySidecar(scriptPath, path.join(root, 'missing'), '/test/node', [scriptPath, '--serve'])).rejects.toThrow(/cwd|directory|目录/);
        expect(requests).toHaveLength(0);
    });

    it('ignores foreign broadcasts and unknown responses', async () => {
        await listen((socket, request) => {
            socket.write(JSON.stringify({ jsonrpc: '2.0', method: 'session.exited', params: { sessionId: 'someone-else' } }) + '\n');
            socket.write(JSON.stringify({ jsonrpc: '2.0', id: 999, result: created(request) }) + '\n');
            reply(socket, request, created(request));
        });
        worker = await startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve']);
        expect(worker?.endpoint).toBe('http://127.0.0.1:34567');
        expect(requests).toHaveLength(1);
    });

    it('never uses an unexpected returned session identity for cleanup', async () => {
        await listen((socket, request) => reply(socket, request, { ...created(request), sessionId: 'someone-else', runtimeId: 'foreign-runtime' }));
        await expect(startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve'])).rejects.toThrow(/identity|身份/);
        expect(requests[1]).toMatchObject({ method: 'session.kill', params: { sessionId: requests[0].params.sessionId } });
        expect(JSON.stringify(requests)).not.toContain('someone-else');
        expect(JSON.stringify(requests)).not.toContain('foreign-runtime');
    });

    it('cleans its submitted worker when aborted during creation', async () => {
        let observed!: () => void;
        const submitted = new Promise<void>((resolve) => { observed = resolve; });
        await listen(() => observed());
        const controller = new AbortController();
        const starting = startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve'], controller.signal);
        const failure = expect(starting).rejects.toThrow(/cancel|abort|取消/);
        await submitted;
        controller.abort();
        await failure;
        expect(requests[1]).toMatchObject({ method: 'session.kill', params: { sessionId: requests[0].params.sessionId } });
    });

    it('reconnects only to clean its own submitted worker after control disconnect', async () => {
        await listen((socket) => socket.destroy());
        await expect(startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve'])).rejects.toThrow(/closed|connection|连接/);
        expect(requests.map((r) => r.method)).toEqual(['session.create', 'session.kill']);
        expect(requests[1].params.sessionId).toBe(requests[0].params.sessionId);
    });

    it('cleans its submitted worker after the creation deadline', async () => {
        let observed!: () => void;
        const submitted = new Promise<void>((resolve) => { observed = resolve; });
        await listen(() => observed());
        jest.useFakeTimers();
        const starting = startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve']);
        const failure = expect(starting).rejects.toThrow('timed out');
        await submitted;
        jest.advanceTimersByTime(195_001);
        await failure;
        expect(requests.map((r) => r.method)).toEqual(['session.create', 'session.kill']);
        expect(requests[1].params.sessionId).toBe(requests[0].params.sessionId);
    });

    it('does not chase another sidecar instance when its original control socket disconnects', async () => {
        await listen((socket) => {
            fs.writeFileSync(path.join(runtimeDir, 'sidecar.pid'), JSON.stringify({ pid: process.pid, version: 6, controlPipeUuid: 'abcd1234' }));
            socket.destroy();
        });
        await expect(startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve'])).rejects.toThrow('cleanup could not be confirmed');
        expect(requests.map((r) => r.method)).toEqual(['session.create']);
    });

    it('rejects a remote endpoint and cleans only the owned runtime', async () => {
        await listen((socket, request) => reply(socket, request, { ...created(request), acpEndpoint: 'https://example.com/api/v1/acp' }));
        await expect(startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve'])).rejects.toThrow('endpoint');
        expect(requests[1]).toMatchObject({ method: 'session.kill', params: { sessionId: requests[0].params.sessionId, expectedRuntimeId: 'owned-runtime' } });
    });

    it('does not claim cleanup succeeded while the owned PID is still alive', async () => {
        await listen();
        worker = await startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve']);
        const probe = jest.spyOn(process, 'kill').mockReturnValue(true);
        await expect(worker!.dispose()).rejects.toThrow('cleanup could not be confirmed');
        expect(probe.mock.calls.length).toBeGreaterThan(1);
        expect(probe.mock.calls.every(([pid, signal]) => pid === 2147483000 && signal === 0)).toBe(true);
        expect(requests.map((r) => r.method)).toEqual(['session.create', 'session.kill']);
    });

    it('completes cleanup after host restart only when its known worker PID is confirmed gone', async () => {
        await listen();
        worker = await startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve']);
        fs.writeFileSync(path.join(runtimeDir, 'sidecar.pid'), JSON.stringify({ pid: process.pid, version: 6, controlPipeUuid: 'abcd1234' }));
        for (const socket of sockets) socket.destroy();
        const probe = jest.spyOn(process, 'kill').mockImplementation(() => {
            throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
        });
        await expect(worker!.dispose()).resolves.toBeUndefined();
        expect(probe).toHaveBeenCalledWith(2147483000, 0);
        expect(requests.map((r) => r.method)).toEqual(['session.create']);
    });

    it.each(['alive', 'unverifiable'])('keeps the cleanup failure after host restart when its known worker is %s', async (state) => {
        await listen();
        worker = await startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve']);
        fs.writeFileSync(path.join(runtimeDir, 'sidecar.pid'), JSON.stringify({ pid: process.pid, version: 6, controlPipeUuid: 'abcd1234' }));
        for (const socket of sockets) socket.destroy();
        jest.spyOn(process, 'kill').mockImplementation(() => {
            if (state === 'unverifiable') throw Object.assign(new Error('Not permitted'), { code: 'EPERM' });
            return true;
        });
        await expect(worker!.dispose()).rejects.toThrow();
        expect(requests.map((r) => r.method)).toEqual(['session.create']);
    });

    it('derives the Windows named pipe from the user runtime PID metadata, without using its token', async () => {
        const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        const getuid = Object.getOwnPropertyDescriptor(process, 'getuid')!;
        runtimeDir = path.join(root, 'wb', hash(configDir, 12));
        socketPath = path.join(runtimeDir, 'sidecar-1234abcd.sock');
        await listen();
        const nativeConnect = require('net').createConnection;
        const connect = jest.spyOn(require('net'), 'createConnection').mockImplementation(() => nativeConnect(socketPath));
        Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
        Object.defineProperty(process, 'getuid', { ...getuid, value: undefined });
        try {
            worker = await startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve']);
            expect(connect.mock.calls[0][0]).toBe(`\\\\.\\pipe\\workbuddy-${hash(configDir, 12)}-sidecar-control-1234abcd`);
            await worker!.dispose();
        } finally {
            Object.defineProperty(process, 'platform', platform);
            Object.defineProperty(process, 'getuid', getuid);
        }
    });
});
