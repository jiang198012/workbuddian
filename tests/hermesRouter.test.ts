import { HermesProvider } from '../src/providers/hermes';
import { HermesAcpProvider } from '../src/providers/hermes/acpProvider';

// mock 两个内部 provider 与 CLI 探测
jest.mock('../src/providers/hermes/acpProvider', () => ({
    HermesAcpProvider: jest.fn().mockImplementation(() => ({ kind: 'acp', ...contractStub() })),
}));
jest.mock('../src/providers/hermes/httpProvider', () => ({
    HermesHttpProvider: jest.fn().mockImplementation(() => ({ kind: 'http', ...contractStub() })),
}));
jest.mock('child_process', () => ({ execFile: jest.fn(), spawn: jest.fn(() => ({ on: jest.fn(), unref: jest.fn() })) }));
jest.mock('../src/utils/cliPath', () => ({
    ...jest.requireActual('../src/utils/cliPath'),
    resolveHermesPath: jest.fn(() => '/fake/hermes'),
    needsWindowsShell: jest.fn(() => false),
}));
jest.mock('../src/shared/hermesDiscover', () => ({
    ...jest.requireActual('../src/shared/hermesDiscover'),
    hermesGatewayRunning: jest.fn(() => false),
}));
import { execFile, spawn } from 'child_process';
import { needsWindowsShell, resolveHermesPath } from '../src/utils/cliPath';
import { hermesGatewayRunning } from '../src/shared/hermesDiscover';
import { HermesHttpProvider } from '../src/providers/hermes/httpProvider';
import { AcpStartFailure } from '../src/providers/acp/provider';
const execFileMock = execFile as unknown as jest.Mock;
const spawnMock = spawn as unknown as jest.Mock;
const resolveHermesMock = resolveHermesPath as unknown as jest.Mock;
const windowsShellMock = needsWindowsShell as unknown as jest.Mock;
const gatewayRunningMock = hermesGatewayRunning as unknown as jest.Mock;
const lastInstance = (ctor: unknown) => {
    const results = (ctor as jest.Mock).mock.results;
    return results[results.length - 1].value;
};

function contractStub() {
    return {
        setGateway: jest.fn(), setModel: jest.fn(), setTimeout: jest.fn(), setCliPath: jest.fn(),
        setPermissionMode: jest.fn(), setThoughtLevel: jest.fn(), setMcpServersJson: jest.fn(),
        setCustomAgentsJson: jest.fn(), setConversationLookup: jest.fn(), setAvailableModels: jest.fn(),
        onPermissionRequest: jest.fn(), onUsage: jest.fn(), onConfigUpdate: jest.fn(),
        respondPermission: jest.fn(), rejectPendingPermissions: jest.fn(),
        cancel: jest.fn(), dispose: jest.fn(), getAvailableModels: jest.fn(() => []),
        refreshAvailableModels: jest.fn(async () => {}), refreshModels: jest.fn(async () => {}),
        getScriptPath: jest.fn(() => ''), generateId: jest.fn(() => 'id'),
        forkSession: jest.fn(async () => 'forked'), testConnection: jest.fn(async () => ({ ok: true })),
    };
}

describe('HermesProvider 路由器', () => {
    const realFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
    beforeEach(() => {
        execFileMock.mockReset();
        spawnMock.mockClear();
        resolveHermesMock.mockReturnValue('/fake/hermes');
        windowsShellMock.mockReturnValue(false);
        gatewayRunningMock.mockReset().mockReturnValue(false);
        // 默认 gateway 已在监听：把探测从测试里摘掉，只测路由决策
        (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({}));
    });
    afterEach(() => {
        (globalThis as unknown as { fetch?: unknown }).fetch = realFetch;
    });
    it('远程 gateway 地址 → http 模式，不探测 CLI', async () => {
        const p = new HermesProvider();
        p.setGateway('http://10.100.0.1:8642', 'key');
        await p.init();
        expect(p.mode).toBe('http');
        expect(execFileMock).not.toHaveBeenCalled();
    });
    it('本机 CLI --check 通过 → acp 模式', async () => {
        execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: Function) => cb(null, 'ok', ''));
        const p = new HermesProvider();
        p.setGateway('', '');
        await p.init();
        expect(p.mode).toBe('acp');
    });
    it('本机 CLI 自检失败 → http 降级', async () => {
        execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: Function) => cb(new Error('exit 1'), '', 'fail'));
        const p = new HermesProvider();
        p.setGateway('', '');
        await p.init();
        expect(p.mode).toBe('http');
    });
    it('ACP 启动失败 → 粘性降级 http 并触发 onModeChange', async () => {
        execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: Function) => cb(null, 'ok', ''));
        const p = new HermesProvider();
        p.setGateway('', '');
        await p.init();
        expect(p.mode).toBe('acp');
        const seen: string[] = [];
        p.onModeChange((m) => seen.push(m));
        p.demoteToHttp(new Error('spawn ENOENT'));
        expect(p.mode).toBe('http');
        expect(seen).toEqual(['http']);
        // 粘性：再次 init 探测成功也不再回到 acp
        await p.init();
        expect(p.mode).toBe('http');
        // 但用户改 CLI 路径 = 显式重试信号：解除粘性，init 可重回 acp
        p.setHermesCliPath('/fake/hermes');
        await p.init();
        expect(p.mode).toBe('acp');
    });
    it('init 探测未落定时不算轻量模式，落定为 ACP 后也不算（#15 顶条误报）', async () => {
        let finishCheck: Function = () => {};
        execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: Function) => { finishCheck = () => cb(null, 'ok', ''); });
        const p = new HermesProvider();
        p.setGateway('', '');
        expect(p.mode).toBe('http'); // 占位值
        expect(p.liteConfirmed).toBe(false); // 尚未探测
        const pending = p.init();
        await new Promise((r) => setImmediate(r));
        expect(p.liteConfirmed).toBe(false); // 探测进行中
        finishCheck();
        await pending;
        expect(p.mode).toBe('acp');
        expect(p.liteConfirmed).toBe(false);
    });
    it('探测落定为 HTTP 时确认轻量模式，并通知视图刷新（mode 值未变也通知）', async () => {
        execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: Function) => cb(new Error('exit 1'), '', 'fail'));
        const p = new HermesProvider();
        p.setGateway('', '');
        const seen: boolean[] = [];
        p.onModeChange(() => seen.push(p.liteConfirmed));
        await p.init();
        expect(p.mode).toBe('http');
        expect(p.liteConfirmed).toBe(true);
        expect(seen[seen.length - 1]).toBe(true);
    });
    it('空 gateway = 本机自动发现，会探测 CLI', async () => {
        execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: Function) => cb(null, 'ok', ''));
        const p = new HermesProvider();
        await p.init();
        expect(execFileMock).toHaveBeenCalled();
        expect(p.mode).toBe('acp');
    });
    it('refreshAvailableModels 在 ACP 模式刷新真实目录', async () => {
        execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: Function) => cb(null, 'ok', ''));
        const p = new HermesProvider();
        p.setGateway('http://127.0.0.1:8642', 'key');
        await p.init();
        await p.refreshAvailableModels('/vault');
        const instances = (HermesAcpProvider as unknown as jest.Mock).mock.results;
        const acp = instances[instances.length - 1].value;
        expect(acp.refreshAvailableModels).toHaveBeenCalledWith('/vault');
    });

    it('Windows .cmd 自检使用 shell 并放宽超时', async () => {
        resolveHermesMock.mockReturnValue('C:\\hermes\\bin\\hermes.cmd');
        windowsShellMock.mockReturnValue(true);
        execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: Function) => cb(null, 'Hermes ACP check OK', ''));
        const p = new HermesProvider();
        p.setGateway('http://127.0.0.1:8642', 'key');
        await p.init();
        expect(execFileMock).toHaveBeenCalledWith('C:\\hermes\\bin\\hermes.cmd', ['acp', '--check'],
            expect.objectContaining({ shell: true, timeout: 40_000 }), expect.any(Function));
        expect(p.mode).toBe('acp');
    });

    it('本机 gateway 未监听 → 先拉起 hermes gateway run 再探测', async () => {
        let probes = 0;
        (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => {
            probes += 1;
            if (probes === 1) throw new Error('ECONNREFUSED');
            return {};
        });
        execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: Function) => cb(null, 'ok', ''));
        const p = new HermesProvider();
        p.setGateway('http://127.0.0.1:8642', 'key');
        await p.init();
        expect(spawnMock).toHaveBeenCalledWith(expect.stringContaining('hermes'), ['gateway', 'run'],
            expect.objectContaining({ detached: true }));
        expect(p.mode).toBe('acp');
    });

    it('#15：gateway 进程在运行但 api_server 未开 → 不探测端口、不重复拉起', async () => {
        gatewayRunningMock.mockReturnValue(true);
        const fetchMock = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
        (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
        execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: Function) => cb(null, 'ok', ''));
        const p = new HermesProvider();
        p.setGateway('', '');
        await p.init();
        expect(spawnMock).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(p.mode).toBe('acp');
    });

    it('#15：拉起 gateway 后以进程存活判定就绪，不必等 api_server 端口（不白等 20s）', async () => {
        gatewayRunningMock.mockReturnValueOnce(false).mockReturnValue(true);
        (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
        execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: Function) => cb(null, 'ok', ''));
        const p = new HermesProvider();
        p.setGateway('', '');
        const started = Date.now();
        await p.init();
        expect(spawnMock).toHaveBeenCalledTimes(1);
        expect(Date.now() - started).toBeLessThan(3_000);
        expect(p.mode).toBe('acp');
    });

    describe('#15：ACP 启动失败后的降级', () => {
        async function acpRouter(httpUsable: boolean) {
            execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: Function) => cb(null, 'ok', ''));
            const p = new HermesProvider();
            p.setGateway('', '');
            await p.init();
            const acp = lastInstance(HermesAcpProvider);
            const http = lastInstance(HermesHttpProvider);
            let attempts = 0;
            acp.sendMessage = jest.fn(async function* () {
                attempts += 1;
                if (attempts === 1) throw new AcpStartFailure('gateway restarting');
                yield { type: 'done' };
            });
            http.sendMessage = jest.fn(async function* () { yield { type: 'done' }; });
            http.testConnection = jest.fn(async () => (httpUsable ? { ok: true } : { ok: false, error: 'Failed to fetch' }));
            return { p, acp, http };
        }
        const drain = async (gen: AsyncGenerator<unknown>) => { for await (const _ of gen) { /* consume */ } };
        const send = (p: HermesProvider) => drain(p.sendMessage('conv-1', 'hi', '/vault') as AsyncGenerator<unknown>);

        it('HTTP 轻量版不可用 → 不降级，重试时重新启动 ACP', async () => {
            const { p, acp, http } = await acpRouter(false);
            await expect(send(p)).rejects.toThrow('gateway restarting');
            expect(p.mode).toBe('acp');
            await send(p);
            expect(acp.sendMessage).toHaveBeenCalledTimes(2);
            expect(http.sendMessage).not.toHaveBeenCalled();
        });

        it('HTTP 轻量版可用 → 照旧降级 http', async () => {
            const { p, http } = await acpRouter(true);
            await expect(send(p)).rejects.toThrow('gateway restarting');
            expect(p.mode).toBe('http');
            await send(p);
            expect(http.sendMessage).toHaveBeenCalledTimes(1);
        });
    });
});
