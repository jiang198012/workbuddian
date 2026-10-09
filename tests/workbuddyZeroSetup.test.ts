import * as fs from 'fs';
import * as path from 'path';
import { startWorkbuddySidecar } from '../src/providers/codebuddy/workbuddySidecar';
import { WorkbuddyHostConnection } from '../src/providers/codebuddy/workbuddyHost';
import { createWorkbuddyBrokerServer } from './helpers/workbuddyBrokerServer';

describe('WorkBuddy first use without a connection extension', () => {
    let root: string;
    let originalConfig: string | undefined;
    let originalRuntime: string | undefined;
    let broker: Awaited<ReturnType<typeof createWorkbuddyBrokerServer>>;
    let worker: Awaited<ReturnType<typeof startWorkbuddySidecar>>;
    let host: WorkbuddyHostConnection | undefined;

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
        await broker?.close();
        host = undefined; worker = null;
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
        fs.writeFileSync(path.join(cliRoot, 'product.json'), JSON.stringify({ productName: 'WorkBuddy', dataFolderName: '.workbuddy' }));
        fs.writeFileSync(path.join(cliRoot, 'dist/codebuddy-headless.js'), 'CODEBUDDY_SIDECAR_CREDENTIAL_BOOTSTRAP_SOCKET');
        return { scriptPath, cwd };
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

    it('completes the first ACP prompt through the logged-in host without sidecar or connector setup', async () => {
        broker = await createWorkbuddyBrokerServer(root, () => ({ status: 200,
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
            .toEqual({ stopReason: 'end_turn', reply: 'ZERO_SETUP_READY' });
        expect(broker.requests).toHaveLength(1);
        expect(fs.existsSync(path.join(broker.configDir, 'extensions'))).toBe(false);
    });

    it('returns a non-retryable model error when host delegation fails', async () => {
        broker = await createWorkbuddyBrokerServer(root, () => { throw new Error('remote fixture failure'); });
        process.env.WORKBUDDY_CONFIG_DIR = broker.configDir;
        const { scriptPath, cwd } = cliFixture();
        worker = await startWorkbuddySidecar(scriptPath, cwd, process.execPath, [scriptPath, '--serve']);
        const rpc = await rpcConnection();
        expect(await rpc('session/prompt', { sessionId: 'fixture-owned', prompt: [] }))
            .toEqual({ stopReason: 'refusal', upstreamStatus: 422 });
        expect(broker.requests).toHaveLength(1);
    });

    it('waits for the logged-in account pipe to become visible before sending the first prompt', async () => {
        broker = await createWorkbuddyBrokerServer(root, () => ({ status: 200,
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
            .toEqual({ stopReason: 'end_turn', reply: 'ACCOUNT_RESTORED' });
        expect(broker.requests).toHaveLength(1);
    });

    it('cancels cold authentication without creating a worker or installing an extension', async () => {
        broker = await createWorkbuddyBrokerServer(root);
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
        broker = await createWorkbuddyBrokerServer(root);
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
        broker = await createWorkbuddyBrokerServer(root);
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
        broker = await createWorkbuddyBrokerServer(root);
        broker.options.invalidServerProof = true;
        process.env.WORKBUDDY_CONFIG_DIR = broker.configDir;
        const { scriptPath, cwd } = cliFixture();
        await expect(startWorkbuddySidecar(scriptPath, cwd, process.execPath, [scriptPath, '--serve']))
            .rejects.toMatchObject({ code: 'E_SERVER_PROOF_INVALID' });
        expect(broker.requests).toHaveLength(0);
        expect(fs.existsSync(path.join(broker.configDir, 'workbuddian'))).toBe(false);
    });
});
