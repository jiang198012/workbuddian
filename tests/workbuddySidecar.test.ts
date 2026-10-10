import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { createHash } from 'crypto';
import { startWorkbuddySidecar } from '../src/providers/codebuddy/workbuddySidecar';
import { warmupWorkbuddy } from '../src/providers/codebuddy/workbuddyWarmup';
import { connectWorkbuddyBroker } from '../src/providers/codebuddy/workbuddyBroker';
jest.mock('../src/providers/codebuddy/workbuddyWarmup', () => ({
    ...jest.requireActual('../src/providers/codebuddy/workbuddyWarmup'), warmupWorkbuddy: jest.fn(),
}));
jest.mock('../src/providers/codebuddy/workbuddyBroker', () => ({
    ...jest.requireActual('../src/providers/codebuddy/workbuddyBroker'), connectWorkbuddyBroker: jest.fn(),
}));

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
    let modelBroker: { requestFetch: jest.Mock; dispose: jest.Mock };
    const installedModels = [{ id: 'old-model', name: 'Old' }, { id: 'helper-model', name: 'Helper' }];
    const installedAgents = [
        { name: 'cli', tags: ['cli', 'default'], models: ['old-model'], tools: ['Read'], instructions: 'installed test only' },
        { name: 'helper-agent', tags: ['cli'], models: ['helper-model'] },
    ];
    const originalConfig = process.env.WORKBUDDY_CONFIG_DIR;
    const originalRuntime = process.env.XDG_RUNTIME_DIR;
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
        fs.writeFileSync(path.join(root, 'cli', 'product.json'), JSON.stringify({ productName: 'WorkBuddy', dataFolderName: '.workbuddy',
            models: installedModels, agents: installedAgents }));
        fs.writeFileSync(path.join(root, 'cli', 'dist', 'codebuddy-lite-wb.mjs'), 'CODEBUDDY_SIDECAR_CREDENTIAL_BOOTSTRAP_SOCKET');
        process.env.WORKBUDDY_CONFIG_DIR = configDir;
        process.env.XDG_RUNTIME_DIR = root;
        jest.spyOn(require('os'), 'tmpdir').mockReturnValue(root);
        runtimeDir = path.join(root, process.platform === 'linux' ? 'workbuddy' : `wb-${hash(String(process.getuid!()), 6)}`, hash(configDir, 12));
        socketPath = path.join(runtimeDir, 'sidecar-1234abcd.sock');
        requests = [];
        sockets = new Set();
        (warmupWorkbuddy as jest.Mock).mockReset().mockRejectedValue(new Error('请安装连接扩展并重启 WorkBuddy'));
        modelBroker = { requestFetch: jest.fn(async () => ({ status: 200, headers: { 'content-type': 'application/json' },
            body_b64: Buffer.from(JSON.stringify({ code: 0, data: {
                models: [{ id: 'glm-5.3', name: 'GLM-5.3', vendor: 'glm', maxInputTokens: 200000, maxOutputTokens: 16384,
                    supportsImages: true, supportsToolCall: true }], agents: [{ name: 'cli', models: ['glm-5.3'] }],
            } })).toString('base64') })), dispose: jest.fn() };
        (connectWorkbuddyBroker as jest.Mock).mockReset().mockImplementation(async () => {
            if (!fs.existsSync(path.join(runtimeDir, 'sidecar.pid'))) {
                throw Object.assign(new Error('fixture account missing'), { code: 'E_DISCOVERY_MISSING' });
            }
            return modelBroker;
        });
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
        if (originalRuntime === undefined) delete process.env.XDG_RUNTIME_DIR;
        else process.env.XDG_RUNTIME_DIR = originalRuntime;
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

    it('sidecar 初始化向 V3 注入账号新模型目录并保留安装包辅助定义', async () => {
        await listen();
        worker = await startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve']);
        expect(requests[0].params.env.ACC_PRODUCT_CONFIG_V3).toEqual(expect.any(String));
        const product = JSON.parse(requests[0].params.env.ACC_PRODUCT_CONFIG_V3);
        expect(product.models).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'glm-5.3', name: 'GLM-5.3' }), installedModels[1],
        ]));
        expect(product.agents.find((agent: { name: string }) => agent.name === 'cli')).toEqual({
            ...installedAgents[0], models: ['glm-5.3'],
        });
        expect(product.agents.find((agent: { name: string }) => agent.name === 'helper-agent')).toEqual(installedAgents[1]);
        expect(connectWorkbuddyBroker).toHaveBeenCalledWith(configDir, undefined);
        expect(modelBroker.requestFetch).toHaveBeenCalledTimes(1);
        expect(modelBroker.requestFetch).toHaveBeenCalledWith(expect.objectContaining({
            method: 'GET', path: '/console/enterprises/personal/models',
        }), undefined);
        expect(modelBroker.dispose).toHaveBeenCalledTimes(1);
    });

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
            CODEBUDDY_DISABLE_PRODUCT_CACHE: '1',
            CODEBUDDY_API_KEY_HELPER_DISABLED: '1', CODEBUDDY_API_KEY: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '',
            CODEBUDDY_GATEWAY_AUTH: 'password', CODEBUDDY_GATEWAY_DISABLE_API_DOCS: '1',
        });
        expect(params.env.CODEBUDDY_GATEWAY_PASSWORD).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(params)).not.toContain('never-copy-this-test-token');
        await worker!.dispose();
        await worker!.dispose();
        expect(requests.slice(1)).toEqual([{ id: expect.any(Number), jsonrpc: '2.0', method: 'session.kill', params: { sessionId: params.sessionId, expectedRuntimeId: 'owned-runtime' } }]);
    });

    it.each([
        { productName: 'CodeBuddy' },
        { productName: 'WorkBuddy AI beta' },
        { productName: 'workbuddy' },
        { authentication: { id: 'workbuddy-desktop-ai-other' } },
    ])('does not route unrelated or prefix-only identities through the WorkBuddy account %j', async (product) => {
        fs.writeFileSync(path.join(root, 'cli', 'product.json'), JSON.stringify({ models: installedModels, agents: installedAgents, ...product }));
        await expect(startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve'])).resolves.toBeNull();
        expect(requests).toHaveLength(0);
    });

    it.each([
        { productName: 'WorkBuddy AI' },
        { authentication: { id: 'workbuddy-desktop' } },
        { authentication: { id: 'workbuddy-desktop-ai' } },
    ])('creates a real sidecar session for an exact known product identity %j', async (product) => {
        fs.writeFileSync(path.join(root, 'cli', 'product.json'), JSON.stringify({ models: installedModels, agents: installedAgents, ...product }));
        await listen();
        worker = await startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve']);
        expect(worker?.endpoint).toBe('http://127.0.0.1:34567');
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ method: 'session.create', params: { cwd } });
    });

    it('leaves an older WorkBuddy bundle without credential bootstrap on the existing stdio path', async () => {
        fs.writeFileSync(path.join(root, 'cli', 'dist', 'codebuddy-lite-wb.mjs'), 'older bundle without bootstrap');
        await expect(startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve'])).resolves.toBeNull();
        expect(requests).toHaveLength(0);
    });

    it('requires a trusted account route and an explicit existing absolute cwd', async () => {
        await expect(startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve']))
            .rejects.toMatchObject({ code: 'E_DISCOVERY_MISSING' });
        await listen();
        await expect(startWorkbuddySidecar(scriptPath, 'relative-vault', '/test/node', [scriptPath, '--serve'])).rejects.toThrow(/cwd|directory|目录/);
        await expect(startWorkbuddySidecar(scriptPath, path.join(root, 'missing'), '/test/node', [scriptPath, '--serve'])).rejects.toThrow(/cwd|directory|目录/);
        expect(requests).toHaveLength(0);
    });

    it('initializes the cold host before creating a Vault worker and revalidates its runtime', async () => {
        (warmupWorkbuddy as jest.Mock).mockImplementation(async () => { await listen(); });
        worker = await startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve']);
        expect(worker?.endpoint).toBe('http://127.0.0.1:34567');
        expect(warmupWorkbuddy).toHaveBeenCalledWith(configDir, undefined);
        expect(requests.map(r => r.method)).toEqual(['session.create']);
    });

    it('does not submit a worker if warmup leaves neither a sidecar nor a trusted native broker', async () => {
        (warmupWorkbuddy as jest.Mock).mockResolvedValue(undefined);
        await expect(startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve']))
            .rejects.toMatchObject({ code: 'E_DISCOVERY_MISSING' });
        expect(requests).toHaveLength(0);
    });

    it('never submits a worker after cancellation during cold initialization', async () => {
        const controller = new AbortController();
        (warmupWorkbuddy as jest.Mock).mockImplementation(async () => { await listen(); controller.abort(); });
        await expect(startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve'], controller.signal)).rejects.toThrow(/cancel|取消/);
        expect(requests).toHaveLength(0);
    });

    it('does not misreport invalid sidecar metadata as a stopped or logged-out host', async () => {
        await listen();
        fs.writeFileSync(path.join(runtimeDir, 'sidecar.pid'), JSON.stringify({ pid: process.pid, version: 7, controlPipeUuid: '1234abcd' }));
        await expect(startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve']))
            .rejects.toThrow('本地任务服务校验失败');
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

    it('rechecks a failed cleanup but releases it only after its own PID is confirmed gone', async () => {
        await listen();
        worker = await startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve']);
        const probe = jest.spyOn(process, 'kill').mockReturnValue(true);
        await expect(worker!.dispose()).rejects.toThrow('cleanup could not be confirmed');
        probe.mockImplementation(() => { throw Object.assign(new Error('Not permitted'), { code: 'EPERM' }); });
        await expect(worker!.dispose()).rejects.toThrow();
        probe.mockImplementation(() => { throw Object.assign(new Error('Gone'), { code: 'ESRCH' }); });
        await expect(worker!.dispose()).resolves.toBeUndefined();
        expect(requests.map(r => r.method)).toEqual(['session.create', 'session.kill']);
    });

    it('retains the original cleanup callback when startup fails before returning its runtime', async () => {
        await listen((socket, request) => reply(socket, request, { ...created(request), acpEndpoint: 'https://invalid.example/api/v1/acp' }));
        const probe = jest.spyOn(process, 'kill').mockReturnValue(true);
        let clock = 0;
        jest.spyOn(Date, 'now').mockImplementation(() => clock += 4_000);
        const failure = await startWorkbuddySidecar(scriptPath, cwd, '/test/node', [scriptPath, '--serve']).catch(error => error);
        expect(failure.message).toContain('cleanup could not be confirmed');
        probe.mockImplementation(() => { throw Object.assign(new Error('Gone'), { code: 'ESRCH' }); });
        await expect(failure.workbuddyCleanup()).resolves.toBeUndefined();
        expect(requests.map(r => r.method)).toEqual(['session.create', 'session.kill']);
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
