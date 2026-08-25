import { HermesProvider } from '../src/providers/hermes';

// mock 两个内部 provider 与 CLI 探测
jest.mock('../src/providers/hermes/acpProvider', () => ({
    HermesAcpProvider: jest.fn().mockImplementation(() => ({ kind: 'acp', ...contractStub() })),
}));
jest.mock('../src/providers/hermes/httpProvider', () => ({
    HermesHttpProvider: jest.fn().mockImplementation(() => ({ kind: 'http', ...contractStub() })),
}));
jest.mock('child_process', () => ({ execFile: jest.fn() }));
import { execFile } from 'child_process';
const execFileMock = execFile as unknown as jest.Mock;

function contractStub() {
    return {
        setGateway: jest.fn(), setModel: jest.fn(), setTimeout: jest.fn(), setCliPath: jest.fn(),
        setPermissionMode: jest.fn(), setThoughtLevel: jest.fn(), setMcpServersJson: jest.fn(),
        setCustomAgentsJson: jest.fn(), setConversationLookup: jest.fn(), setAvailableModels: jest.fn(),
        onPermissionRequest: jest.fn(), onUsage: jest.fn(), onConfigUpdate: jest.fn(),
        respondPermission: jest.fn(), rejectPendingPermissions: jest.fn(),
        cancel: jest.fn(), dispose: jest.fn(), getAvailableModels: jest.fn(() => []),
        getScriptPath: jest.fn(() => ''), generateId: jest.fn(() => 'id'),
        forkSession: jest.fn(async () => 'forked'), testConnection: jest.fn(async () => ({ ok: true })),
    };
}

describe('HermesProvider 路由器', () => {
    beforeEach(() => execFileMock.mockReset());
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
    it('空 gateway = 本机自动发现，会探测 CLI', async () => {
        execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: Function) => cb(null, 'ok', ''));
        const p = new HermesProvider();
        await p.init();
        expect(execFileMock).toHaveBeenCalled();
        expect(p.mode).toBe('acp');
    });
});
