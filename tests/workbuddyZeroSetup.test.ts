import * as fs from 'fs';
import * as path from 'path';
import { startWorkbuddySidecar } from '../src/providers/codebuddy/workbuddySidecar';
import { WorkbuddyHostConnection } from '../src/providers/codebuddy/workbuddyHost';
import { createWorkbuddyBrokerServer } from './helpers/workbuddyBrokerServer';
import { installWorkbuddyWarmup } from '../src/providers/codebuddy/workbuddyWarmup';

describe('WorkBuddy first use without a connection extension', () => {
    let root: string;
    let originalConfig: string | undefined;
    let originalRuntime: string | undefined;
    let broker: Awaited<ReturnType<typeof createWorkbuddyBrokerServer>>;
    let worker: Awaited<ReturnType<typeof startWorkbuddySidecar>>;
    let host: WorkbuddyHostConnection | undefined;
    let extension: { dispose(): Promise<void> } | undefined;

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync('/tmp/wbz-'));
        originalConfig = process.env.WORKBUDDY_CONFIG_DIR;
        originalRuntime = process.env.XDG_RUNTIME_DIR;
        process.env.XDG_RUNTIME_DIR = root;
        jest.spyOn(require('os'), 'tmpdir').mockReturnValue(root);
    });

    afterEach(async () => {
        await host?.dispose().catch(() => {});
        await worker?.dispose();
        await extension?.dispose();
        await broker?.close();
        host = undefined; worker = null; extension = undefined;
        jest.restoreAllMocks();
        if (originalConfig === undefined) delete process.env.WORKBUDDY_CONFIG_DIR;
        else process.env.WORKBUDDY_CONFIG_DIR = originalConfig;
        if (originalRuntime === undefined) delete process.env.XDG_RUNTIME_DIR;
        else process.env.XDG_RUNTIME_DIR = originalRuntime;
        fs.rmSync(root, { recursive: true, force: true });
    });

    function cliFixture() {
        const cliRoot = path.join(root, 'cli');
        const scriptPath = path.join(cliRoot, 'bin', 'codebuddy');
        const cwd = path.join(root, 'vault');
        fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
        fs.mkdirSync(path.join(cliRoot, 'dist'));
        fs.mkdirSync(cwd);
        fs.copyFileSync(path.join(__dirname, 'helpers/workbuddy-native-cli.cjs'), scriptPath);
        fs.writeFileSync(path.join(cliRoot, 'product.json'), JSON.stringify({ productName: 'WorkBuddy', dataFolderName: '.workbuddy',
            agents: [
                { name: 'cli', tags: ['cli', 'default'], models: ['old-model'], tools: ['Read'], instructions: 'installed test only' },
                { name: 'helper-agent', tags: ['cli'], models: ['helper-model'] },
            ], models: [{ id: 'old-model', name: 'Old' }, { id: 'helper-model', name: 'Helper' }],
        }));
        fs.writeFileSync(path.join(cliRoot, 'dist/codebuddy-headless.js'), 'CODEBUDDY_SIDECAR_CREDENTIAL_BOOTSTRAP_SOCKET');
        return { scriptPath, cwd };
    }

    function accountFixture(onFetch: NonNullable<Parameters<typeof createWorkbuddyBrokerServer>[1]>
        = () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body_b64: 'b2s=' })) {
        return createWorkbuddyBrokerServer(root, (params, signal) => {
            if (params.method === 'GET' && params.path === '/console/enterprises/personal/models') {
                return { status: 200, headers: { 'content-type': 'application/json' },
                    body_b64: Buffer.from(JSON.stringify({ code: 0, data: {
                        models: [{ id: 'glm-5.3', name: 'GLM-5.3', vendor: 'glm', maxInputTokens: 200000, maxOutputTokens: 16384,
                            supportsImages: true, supportsToolCall: true }], agents: [{ name: 'cli', models: ['glm-5.3'] }],
                    } })).toString('base64') };
            }
            return onFetch(params, signal);
        });
    }

    async function activateConnector(invoke: () => Promise<unknown>) {
        const dir = installWorkbuddyWarmup(broker.configDir);
        const exports: any = {};
        new Function('require', 'exports', '__dirname', fs.readFileSync(path.join(dir, 'index.cjs'), 'utf8'))(require, exports, dir);
        extension = await exports.activate({ invoke });
    }

    async function rpcConnection() {
        const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
        host = await WorkbuddyHostConnection.connect(worker!.endpoint, message => {
            pending.get(message.id as number)?.resolve(message.result); pending.delete(message.id as number);
        }, error => { for (const entry of pending.values()) entry.reject(error); pending.clear(); });
        let id = 0;
        return async (method: string, params: Record<string, unknown>) => {
            const current = ++id;
            const result = new Promise<any>((resolve, reject) => pending.set(current, { resolve, reject }));
            await host!.send({ jsonrpc: '2.0', id: current, method, params });
            return result;
        };
    }

    it('native V3 目录在首次 ACP 会话提供账号新模型并把该 ID 用于 prompt', async () => {
        broker = await accountFixture(() => ({ status: 200, headers: { 'content-type': 'application/json' },
            body_b64: Buffer.from('{"text":"MODEL_ID_OBSERVED"}').toString('base64') }));
        process.env.WORKBUDDY_CONFIG_DIR = broker.configDir;
        const { scriptPath, cwd } = cliFixture();
        worker = await startWorkbuddySidecar(scriptPath, cwd, process.execPath, [scriptPath, '--serve']);
        const rpc = await rpcConnection();
        const session = await rpc('session/new', { cwd, mcpServers: [] });
        expect(session.models.availableModels).toEqual([{ modelId: 'glm-5.3', name: 'GLM-5.3' }]);
        expect(session.models.currentModelId).toBe('glm-5.3');
        await rpc('session/set_config_option', { sessionId: session.sessionId, configId: 'model', value: 'glm-5.3' });
        expect(await rpc('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'fixture only' }] }))
            .toEqual({ stopReason: 'end_turn', reply: 'MODEL_ID_OBSERVED', modelId: 'glm-5.3' });
        expect(broker.requests.map(request => `${request.method} ${request.path}`)).toEqual([
            'GET /console/enterprises/personal/models', 'POST /v2/chat/completions',
        ]);
        expect(JSON.parse(Buffer.from(broker.requests[1].body_b64!, 'base64').toString('utf8')).model).toBe('glm-5.3');
    });

    it('completes the first ACP prompt through the logged-in host without sidecar or connector setup', async () => {
        broker = await accountFixture(() => ({ status: 200,
            headers: { 'content-type': 'application/json' }, body_b64: Buffer.from('{"text":"ZERO_SETUP_READY"}').toString('base64') }));
        process.env.WORKBUDDY_CONFIG_DIR = broker.configDir;
        const { scriptPath, cwd } = cliFixture();
        expect(fs.existsSync(path.join(broker.configDir, 'extensions'))).toBe(false);
        worker = await startWorkbuddySidecar(scriptPath, cwd, process.execPath, [scriptPath, '--serve']);
        expect(worker?.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        const rpc = await rpcConnection();
        expect(await rpc('initialize', { protocolVersion: 1 })).toMatchObject({ protocolVersion: 1 });
        const session = await rpc('session/new', { cwd, mcpServers: [] });
        expect(await rpc('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'ZERO_SETUP_READY' }] }))
            .toEqual({ stopReason: 'end_turn', reply: 'ZERO_SETUP_READY', modelId: 'glm-5.3' });
        expect(broker.requests.map(request => `${request.method} ${request.path}`)).toEqual([
            'GET /console/enterprises/personal/models', 'POST /v2/chat/completions',
        ]);
        expect(fs.existsSync(path.join(broker.configDir, 'extensions'))).toBe(false);
    });

    it('returns a non-retryable model error when host delegation fails', async () => {
        broker = await accountFixture(() => { throw new Error('remote fixture failure'); });
        process.env.WORKBUDDY_CONFIG_DIR = broker.configDir;
        const { scriptPath, cwd } = cliFixture();
        worker = await startWorkbuddySidecar(scriptPath, cwd, process.execPath, [scriptPath, '--serve']);
        const rpc = await rpcConnection();
        expect(await rpc('session/prompt', { sessionId: 'fixture-owned', prompt: [] }))
            .toEqual({ stopReason: 'refusal', upstreamStatus: 422 });
        expect(broker.requests.map(request => `${request.method} ${request.path}`)).toEqual([
            'GET /console/enterprises/personal/models', 'POST /v2/chat/completions',
        ]);
    });

    it('waits for the logged-in account pipe to become visible before sending the first prompt', async () => {
        broker = await accountFixture(() => ({ status: 200,
            headers: { 'content-type': 'application/json' }, body_b64: Buffer.from('{"text":"ACCOUNT_RESTORED"}').toString('base64') }));
        broker.options.requestPipeUnavailable = true;
        process.env.WORKBUDDY_CONFIG_DIR = broker.configDir;
        const { scriptPath, cwd } = cliFixture();
        const starting = startWorkbuddySidecar(scriptPath, cwd, process.execPath, [scriptPath, '--serve'])
            .then(value => { worker = value; return { ready: true }; }, error => ({ ready: false, code: error.code }));
        for (let attempts = 0; !broker.frames.some(frame => frame.type === 'session_prove') && attempts < 100; attempts++) {
            await new Promise(resolve => setImmediate(resolve));
        }
        expect(broker.frames.some(frame => frame.type === 'session_prove')).toBe(true);
        expect(broker.requests).toHaveLength(0);
        broker.options.requestPipeUnavailable = false;
        expect(await starting).toEqual({ ready: true });
        const rpc = await rpcConnection();
        expect(await rpc('session/prompt', { sessionId: 'fixture-owned', prompt: [] }))
            .toEqual({ stopReason: 'end_turn', reply: 'ACCOUNT_RESTORED', modelId: 'glm-5.3' });
        expect(broker.requests.map(request => `${request.method} ${request.path}`)).toEqual([
            'GET /console/enterprises/personal/models', 'POST /v2/chat/completions',
        ]);
    });

    it('uses the original account when an installed optional connector cannot initialize the host', async () => {
        broker = await accountFixture(() => ({ status: 200,
            headers: { 'content-type': 'application/json' }, body_b64: Buffer.from('{"text":"CONNECTOR_FALLBACK_READY"}').toString('base64') }));
        process.env.WORKBUDDY_CONFIG_DIR = broker.configDir;
        const { scriptPath, cwd } = cliFixture();
        await activateConnector(async () => { throw new Error('Unsupported fixture host API'); });
        worker = await startWorkbuddySidecar(scriptPath, cwd, process.execPath, [scriptPath, '--serve']);
        const rpc = await rpcConnection();
        expect(await rpc('session/prompt', { sessionId: 'fixture-owned', prompt: [] }))
            .toEqual({ stopReason: 'end_turn', reply: 'CONNECTOR_FALLBACK_READY', modelId: 'glm-5.3' });
        expect(broker.requests.map(request => `${request.method} ${request.path}`)).toEqual([
            'GET /console/enterprises/personal/models', 'POST /v2/chat/completions',
        ]);
    });

    it('uses the original account when optional warmup succeeds without creating a sidecar', async () => {
        broker = await accountFixture(() => ({ status: 200,
            headers: { 'content-type': 'application/json' }, body_b64: Buffer.from('{"text":"NO_SIDECAR_READY"}').toString('base64') }));
        process.env.WORKBUDDY_CONFIG_DIR = broker.configDir;
        const { scriptPath, cwd } = cliFixture();
        await activateConnector(async (): Promise<unknown[]> => []);
        worker = await startWorkbuddySidecar(scriptPath, cwd, process.execPath, [scriptPath, '--serve']);
        const rpc = await rpcConnection();
        expect(await rpc('session/prompt', { sessionId: 'fixture-owned', prompt: [] }))
            .toEqual({ stopReason: 'end_turn', reply: 'NO_SIDECAR_READY', modelId: 'glm-5.3' });
        expect(broker.requests.map(request => `${request.method} ${request.path}`)).toEqual([
            'GET /console/enterprises/personal/models', 'POST /v2/chat/completions',
        ]);
    });

    it('ignores incompatible optional metadata but independently rejects an invalid native host proof', async () => {
        broker = await accountFixture();
        broker.options.invalidServerProof = true;
        process.env.WORKBUDDY_CONFIG_DIR = broker.configDir;
        const { scriptPath, cwd } = cliFixture();
        const dir = installWorkbuddyWarmup(broker.configDir);
        fs.writeFileSync(path.join(dir, 'endpoint.json'), JSON.stringify({ version: 2 }));
        await expect(startWorkbuddySidecar(scriptPath, cwd, process.execPath, [scriptPath, '--serve']))
            .rejects.toMatchObject({ code: 'E_SERVER_PROOF_INVALID' });
        expect(broker.requests).toHaveLength(0);
        expect(fs.existsSync(path.join(broker.configDir, 'workbuddian'))).toBe(false);
    });

    it('does not fall back to the account broker when cancelled during optional warmup', async () => {
        broker = await accountFixture();
        process.env.WORKBUDDY_CONFIG_DIR = broker.configDir;
        const { scriptPath, cwd } = cliFixture();
        const controller = new AbortController();
        await activateConnector(async () => { controller.abort(); throw new Error('Cancelled fixture'); });
        await expect(startWorkbuddySidecar(scriptPath, cwd, process.execPath, [scriptPath, '--serve'], controller.signal))
            .rejects.toThrow(/cancel|取消/);
        expect(broker.frames).toHaveLength(0);
        expect(broker.requests).toHaveLength(0);
        expect(fs.existsSync(path.join(broker.configDir, 'workbuddian'))).toBe(false);
    });

    it.each(['existing', 'after warmup'])('refuses invalid sidecar identity %s even with an available native account', async (timing) => {
        broker = await accountFixture();
        process.env.WORKBUDDY_CONFIG_DIR = broker.configDir;
        const { scriptPath, cwd } = cliFixture();
        const invalidIdentity = () => fs.writeFileSync(path.join(path.dirname(path.dirname(broker.endpoint)), 'sidecar.pid'),
            JSON.stringify({ pid: process.pid, version: 7, controlPipeUuid: '1234abcd' }));
        if (timing === 'existing') invalidIdentity();
        else {
            await activateConnector(async (): Promise<unknown[]> => { invalidIdentity(); return []; });
        }
        await expect(startWorkbuddySidecar(scriptPath, cwd, process.execPath, [scriptPath, '--serve']))
            .rejects.toThrow(/校验失败|仍未就绪/);
        expect(broker.frames).toHaveLength(0);
        expect(broker.requests).toHaveLength(0);
        expect(fs.existsSync(path.join(broker.configDir, 'workbuddian'))).toBe(false);
    });

    it('cancels cold authentication without creating a worker or installing an extension', async () => {
        broker = await accountFixture();
        broker.options.silentHandshake = true;
        process.env.WORKBUDDY_CONFIG_DIR = broker.configDir;
        const { scriptPath, cwd } = cliFixture();
        const controller = new AbortController();
        const starting = startWorkbuddySidecar(scriptPath, cwd, process.execPath, [scriptPath, '--serve'], controller.signal);
        const rejected = expect(starting).rejects.toThrow(/cancel|取消|E_CANCELLED/);
        for (let attempts = 0; !broker.frames.length && attempts < 100; attempts++) await new Promise(resolve => setImmediate(resolve));
        controller.abort();
        await rejected;
        expect(broker.requests).toHaveLength(0);
        expect(fs.existsSync(path.join(broker.configDir, 'workbuddian'))).toBe(false);
        expect(fs.existsSync(path.join(broker.configDir, 'extensions'))).toBe(false);
    });

    it('cancels waiting for the account pipe without sending a model request', async () => {
        broker = await accountFixture();
        broker.options.requestPipeUnavailable = true;
        process.env.WORKBUDDY_CONFIG_DIR = broker.configDir;
        const { scriptPath, cwd } = cliFixture();
        const controller = new AbortController();
        const starting = startWorkbuddySidecar(scriptPath, cwd, process.execPath, [scriptPath, '--serve'], controller.signal)
            .then(value => { worker = value; return ''; }, error => error.message as string);
        for (let attempts = 0; !broker.frames.some(frame => frame.type === 'session_prove') && attempts < 100; attempts++) {
            await new Promise(resolve => setImmediate(resolve));
        }
        expect(broker.frames.some(frame => frame.type === 'session_prove')).toBe(true);
        controller.abort();
        expect(await starting).toMatch(/cancel|取消/);
        expect(broker.requests).toHaveLength(0);
        expect(fs.existsSync(path.join(broker.configDir, 'workbuddian'))).toBe(false);
    });

    it('ends account restoration waiting at the deadline without creating a worker', async () => {
        broker = await accountFixture();
        broker.options.requestPipeUnavailable = true;
        process.env.WORKBUDDY_CONFIG_DIR = broker.configDir;
        const { scriptPath, cwd } = cliFixture();
        jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(31_000);
        await expect(startWorkbuddySidecar(scriptPath, cwd, process.execPath, [scriptPath, '--serve']))
            .rejects.toThrow('未重发任何消息');
        expect(broker.requests).toHaveLength(0);
        expect(fs.existsSync(path.join(broker.configDir, 'workbuddian'))).toBe(false);
    });

    it('does not retry an invalid host authentication proof as account restoration', async () => {
        broker = await accountFixture();
        broker.options.invalidServerProof = true;
        process.env.WORKBUDDY_CONFIG_DIR = broker.configDir;
        const { scriptPath, cwd } = cliFixture();
        await expect(startWorkbuddySidecar(scriptPath, cwd, process.execPath, [scriptPath, '--serve']))
            .rejects.toMatchObject({ code: 'E_SERVER_PROOF_INVALID' });
        expect(broker.requests).toHaveLength(0);
        expect(fs.existsSync(path.join(broker.configDir, 'workbuddian'))).toBe(false);
    });
});
