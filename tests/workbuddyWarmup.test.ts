import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { installWorkbuddyWarmup, warmupWorkbuddy } from '../src/providers/codebuddy/workbuddyWarmup';

describe('WorkBuddy authenticated sidecar warmup extension', () => {
    let configDir: string;
    let extension: { dispose(): Promise<void> } | undefined;
    let invoked: string[];
    let initialize: () => Promise<any>;

    beforeEach(() => {
        configDir = fs.realpathSync(fs.mkdtempSync('/tmp/wbw-'));
        invoked = []; initialize = async () => [];
    });
    afterEach(async () => {
        jest.useRealTimers();
        await extension?.dispose(); extension = undefined;
        fs.rmSync(configDir, { recursive: true, force: true });
    });

    async function activate() {
        const dir = installWorkbuddyWarmup(configDir);
        const exports: any = {};
        new Function('require', 'exports', '__dirname', fs.readFileSync(path.join(dir, 'index.cjs'), 'utf8'))(require, exports, dir);
        extension = await exports.activate({ invoke: async (method: string, ...args: any[]) => {
            invoked.push(method);
            expect(args).toEqual([]);
            return initialize();
        } });
        return dir;
    }

    it('awaits host initialization and coalesces concurrent requests without creating a task or exposing session data', async () => {
        let ready!: () => void;
        initialize = () => new Promise(resolve => { ready = () => resolve([{ sessionId: 'foreign-private-id' }]); });
        const dir = await activate();
        const first = warmupWorkbuddy(configDir), second = warmupWorkbuddy(configDir);
        let completed = false;
        void first.then(() => { completed = true; });
        while (!ready) await new Promise(resolve => setTimeout(resolve, 5));
        expect(completed).toBe(false);
        ready(); await Promise.all([first, second]);
        expect(invoked).toEqual(['listSidecarSessions']);
        const distribution = JSON.parse(fs.readFileSync(path.join(dir, 'distribution.json'), 'utf8'));
        expect(distribution.kind).toBe('platform');
        expect(distribution.grantedPermissions).toEqual([]);
    });

    it('fails on host errors and allows a later independent initialization without replaying a prompt', async () => {
        await activate();
        initialize = async () => { throw new Error('host unavailable'); };
        await expect(warmupWorkbuddy(configDir)).rejects.toThrow(/初始化失败/);
        initialize = async () => [];
        await warmupWorkbuddy(configDir);
        expect(invoked).toEqual(['listSidecarSessions', 'listSidecarSessions']);
    });

    it('bounds a silent host call and permits a subsequent retry', async () => {
        const nativeTimeout = global.setTimeout;
        jest.spyOn(global, 'setTimeout').mockImplementation(((handler: any, delay: number, ...args: any[]) =>
            nativeTimeout(handler, delay === 90_000 ? 10 : delay === 95_000 ? 200 : delay, ...args)) as typeof setTimeout);
        await activate();
        initialize = () => new Promise(() => {});
        await expect(warmupWorkbuddy(configDir)).rejects.toThrow(/初始化失败/);
        initialize = async () => [];
        await warmupWorkbuddy(configDir);
        expect(invoked).toHaveLength(2);
        jest.restoreAllMocks();
    });

    it('rejects wrong nonce and arbitrary RPC names without invoking the host', async () => {
        const dir = await activate();
        const { endpoint, token } = JSON.parse(fs.readFileSync(path.join(dir, 'endpoint.json'), 'utf8'));
        for (const request of [null, { method: 'warmup', token: 'wrong' }, { method: 'warmup', token: 'é'.repeat(64) }, { method: 'session.kill', token }]) {
            const reply = await new Promise<string>((resolve, reject) => {
                const socket = net.createConnection(endpoint);
                socket.setEncoding('utf8'); let response = '';
                socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'));
                socket.on('data', chunk => { response += chunk; });
                socket.on('end', () => resolve(response)); socket.on('error', reject);
            });
            expect(JSON.parse(reply)).toMatchObject({ ready: false });
        }
        expect(invoked).toHaveLength(0);
    });

    it('cancels a waiter and still finishes the shared initialization safely', async () => {
        let ready!: () => void;
        initialize = () => new Promise(resolve => { ready = () => resolve([]); });
        await activate();
        const controller = new AbortController();
        const waiting = warmupWorkbuddy(configDir, controller.signal);
        const failure = expect(waiting).rejects.toThrow(/cancel|取消/);
        while (!ready) await new Promise(resolve => setTimeout(resolve, 5));
        controller.abort(); await failure;
        ready(); initialize = async () => [];
        await warmupWorkbuddy(configDir);
    });

    it('refuses a foreign extension and symlink instead of overwriting it', () => {
        const root = path.join(configDir, 'extensions'), dir = path.join(root, 'workbuddian-warmup');
        fs.mkdirSync(root); fs.symlinkSync(configDir, dir);
        expect(() => installWorkbuddyWarmup(configDir)).toThrow(/可信/);
        fs.unlinkSync(dir); fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'extension.json'), JSON.stringify({ id: 'someone-else' }));
        expect(() => installWorkbuddyWarmup(configDir)).toThrow(/已有/);
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'extension.json'), 'utf8')).id).toBe('someone-else');
    });

    it('distinguishes installed files from an activated host extension', async () => {
        installWorkbuddyWarmup(configDir);
        await expect(warmupWorkbuddy(configDir)).rejects.toThrow(/重启 WorkBuddy/);
        expect(invoked).toHaveLength(0);
    });
});
