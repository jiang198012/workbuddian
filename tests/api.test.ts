import { CodebuddyProvider, isWindowsWrapper, isBareFallback, needsWindowsShell, type StreamChunk } from '../src/providers/codebuddy';
import { AcpClient, AcpStartError } from '../src/providers/codebuddy/acp/client';
import { resolveCodebuddyPath, findNodeExecutable } from '../src/utils/cliPath';
import { t } from '../src/i18n';
import { makeFakeClient, deferred, flush, consume } from './helpers/fakeAcpClient';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('../src/providers/codebuddy/acp/client', () => {
    const actual = jest.requireActual('../src/providers/codebuddy/acp/client');
    return { ...actual, AcpClient: jest.fn() };
});
const MockAcpClient = AcpClient as jest.MockedClass<typeof AcpClient>;

jest.mock('fs', () => {
    const actualFs = jest.requireActual('fs');
    return { ...actualFs, existsSync: jest.fn(actualFs.existsSync) };
});

beforeEach(() => { MockAcpClient.mockReset(); });

// ---------- provider v2 生成器契约 ----------

describe('CodebuddyProvider v2 sendMessage', () => {
    it('should create instance', () => {
        makeFakeClient(MockAcpClient);
        expect(new CodebuddyProvider()).toBeDefined();
    });

    it('streams chunks and ends with a done chunk carrying usage', async () => {
        const { fake, events } = makeFakeClient(MockAcpClient);
        fake.request.mockImplementation(async (method: string) => {
            if (method === 'session/prompt') {
                events().onSessionUpdate('acp-1', { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } });
                events().onSessionUpdate('acp-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } });
                events().onSessionUpdate('acp-1', { sessionUpdate: 'usage_update', used: 42, size: 168000 });
                return { stopReason: 'end_turn' };
            }
            if (method === 'session/new') return { sessionId: 'acp-1' };
            if (method === 'session/load') throw new Error('not found');
            return {};
        });
        const api = new CodebuddyProvider();
        const chunks = await consume(api.sendMessage('s1', 'hello', '/v'));
        expect(chunks).toEqual([
            { type: 'thinking', content: 'hmm' },
            { type: 'text', content: 'world' },
            { type: 'done', content: '', usage: { inputTokens: 42 } },
        ]);
        // 懒加载链：先试 load 旧 uuid，失败后 session/new
        expect(fake.request).toHaveBeenCalledWith('session/load', expect.objectContaining({ sessionId: 's1' }));
        expect(fake.request).toHaveBeenCalledWith('session/new', expect.objectContaining({ cwd: '/v', mcpServers: [] }));
    });

    it('cancel(sessionId) sends session/cancel and ends generator silently without killing the process', async () => {
        const { fake } = makeFakeClient(MockAcpClient);
        const promptGate = deferred<{ stopReason: string }>();
        fake.request.mockImplementation(async (method: string) => {
            if (method === 'session/prompt') return promptGate.promise;
            if (method === 'session/new') return { sessionId: 'acp-1' };
            if (method === 'session/load') throw new Error('not found');
            return {};
        });
        const api = new CodebuddyProvider();
        const gen = api.sendMessage('s1', 'hello', '/v');
        const firstPromise = gen.next();
        await flush();
        api.cancel('s1');
        expect(fake.notify).toHaveBeenCalledWith('session/cancel', { sessionId: 'acp-1' });
        promptGate.resolve({ stopReason: 'cancelled' });
        const first = await firstPromise;
        expect(first.done).toBe(true); // cancelled → 静默结束，无 done chunk（对齐 v1）
        expect(fake.dispose).not.toHaveBeenCalled(); // 进程保活
    });

    it('cancel() without args cancels every in-flight session', async () => {
        const { fake } = makeFakeClient(MockAcpClient);
        const gates = new Map<string, ReturnType<typeof deferred<{ stopReason: string }>>>();
        let newCount = 0;
        fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
            if (method === 'session/prompt') {
                const d = deferred<{ stopReason: string }>();
                gates.set(String(params.sessionId), d);
                return d.promise;
            }
            if (method === 'session/new') return { sessionId: `acp-${++newCount}` };
            if (method === 'session/load') throw new Error('not found');
            return {};
        });
        const api = new CodebuddyProvider();
        const gen1 = api.sendMessage('s1', 'a', '/v');
        const gen2 = api.sendMessage('s2', 'b', '/v');
        const p1 = gen1.next();
        const p2 = gen2.next();
        await flush();
        api.cancel();
        expect(fake.notify).toHaveBeenCalledWith('session/cancel', { sessionId: 'acp-1' });
        expect(fake.notify).toHaveBeenCalledWith('session/cancel', { sessionId: 'acp-2' });
        gates.get('acp-1')!.resolve({ stopReason: 'cancelled' });
        gates.get('acp-2')!.resolve({ stopReason: 'cancelled' });
        expect((await p1).done).toBe(true);
        expect((await p2).done).toBe(true);
    });

    it('targeted cancel does not affect another in-flight session (双面板)', async () => {
        const { fake, events } = makeFakeClient(MockAcpClient);
        const gates = new Map<string, ReturnType<typeof deferred<{ stopReason: string }>>>();
        let newCount = 0;
        fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
            if (method === 'session/prompt') {
                const d = deferred<{ stopReason: string }>();
                gates.set(String(params.sessionId), d);
                return d.promise;
            }
            if (method === 'session/new') return { sessionId: `acp-${++newCount}` };
            if (method === 'session/load') throw new Error('not found');
            return {};
        });
        const api = new CodebuddyProvider();
        const chunks1: StreamChunk[] = [];
        const chunks2: StreamChunk[] = [];
        const c1 = (async () => { for await (const c of api.sendMessage('s1', 'a', '/v')) chunks1.push(c); })();
        const c2 = (async () => { for await (const c of api.sendMessage('s2', 'b', '/v')) chunks2.push(c); })();
        await flush();
        api.cancel('s1');
        expect(fake.notify).toHaveBeenCalledWith('session/cancel', { sessionId: 'acp-1' });
        expect(fake.notify).not.toHaveBeenCalledWith('session/cancel', { sessionId: 'acp-2' });
        gates.get('acp-1')!.resolve({ stopReason: 'cancelled' });
        // s2 继续正常流式
        events().onSessionUpdate('acp-2', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'still going' } });
        gates.get('acp-2')!.resolve({ stopReason: 'end_turn' });
        await Promise.all([c1, c2]);
        expect(chunks1).toEqual([]);
        expect(chunks2.map((c) => c.type)).toEqual(['text', 'done']);
        expect(chunks2[0].content).toBe('still going');
    });

    it('times out a turn with session/cancel + turnTimeout error, process stays alive', async () => {
        const { fake } = makeFakeClient(MockAcpClient);
        fake.request.mockImplementation(async (method: string) => {
            if (method === 'session/prompt') return new Promise(() => { /* 永不落账 */ });
            if (method === 'session/new') return { sessionId: 'acp-1' };
            if (method === 'session/load') throw new Error('not found');
            return {};
        });
        const api = new CodebuddyProvider();
        api.setTimeout(50);
        await expect(consume(api.sendMessage('s1', 'slow', '/v'))).rejects.toThrow(t('provider.turnTimeout'));
        expect(fake.notify).toHaveBeenCalledWith('session/cancel', { sessionId: 'acp-1' });
        expect(fake.dispose).not.toHaveBeenCalled();
    });

    it('surfaces preflight failure as thrown localized error', async () => {
        const { fake } = makeFakeClient(MockAcpClient);
        fake.ensureStarted.mockRejectedValue(new AcpStartError('acp-unsupported', 'unrecognized option'));
        const api = new CodebuddyProvider();
        await expect(consume(api.sendMessage('s1', 'x', '/v'))).rejects.toThrow(t('provider.acpUnsupported'));
    });

    it('surfaces cli-not-found tier with v1 wording', async () => {
        const { fake } = makeFakeClient(MockAcpClient);
        fake.ensureStarted.mockRejectedValue(new AcpStartError('cli-not-found', 'ENOENT'));
        const api = new CodebuddyProvider();
        await expect(consume(api.sendMessage('s1', 'x', '/v'))).rejects.toThrow(t('provider.cliNotFound'));
    });

    it('fails in-flight turn on process death and recovers via session/load on next send', async () => {
        const { fake, events } = makeFakeClient(MockAcpClient);
        const promptGate = deferred<{ stopReason: string }>();
        let loadShouldFail = true;
        fake.request.mockImplementation(async (method: string) => {
            if (method === 'session/prompt') return promptGate.promise;
            if (method === 'session/new') return { sessionId: 'acp-1' };
            if (method === 'session/load') {
                if (loadShouldFail) throw new Error('not found');
                return {};
            }
            return {};
        });
        const api = new CodebuddyProvider();
        const dying = consume(api.sendMessage('s1', 'x', '/v'));
        await flush();
        const assertion = expect(dying).rejects.toThrow(t('provider.processDied'));
        events().onExit(1, null);
        promptGate.reject(new Error('acp process exited')); // client 死亡时 pending 请求一并拒绝
        await assertion;

        // 第二轮：进程已重启（ensureStarted 再 resolve），受影响会话 session/load 恢复
        loadShouldFail = false;
        fake.request.mockImplementation(async (method: string) => {
            if (method === 'session/prompt') {
                events().onSessionUpdate('acp-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'back' } });
                return { stopReason: 'end_turn' };
            }
            if (method === 'session/load') return {};
            return {};
        });
        const chunks = await consume(api.sendMessage('s1', 'again', '/v'));
        expect(fake.request).toHaveBeenCalledWith('session/load', expect.objectContaining({ sessionId: 'acp-1' }));
        expect(chunks.map((c) => c.type)).toEqual(['text', 'done']);
    });

    it('rejects a second send on the same session while busy', async () => {
        const { fake } = makeFakeClient(MockAcpClient);
        const promptGate = deferred<{ stopReason: string }>();
        fake.request.mockImplementation(async (method: string) => {
            if (method === 'session/prompt') return promptGate.promise;
            if (method === 'session/new') return { sessionId: 'acp-1' };
            if (method === 'session/load') throw new Error('not found');
            return {};
        });
        const api = new CodebuddyProvider();
        const first = api.sendMessage('s1', 'a', '/v');
        const firstNext = first.next();
        await flush();
        await expect(consume(api.sendMessage('s1', 'b', '/v'))).rejects.toThrow(t('provider.busy'));
        promptGate.resolve({ stopReason: 'cancelled' });
        await firstNext;
    });

    it('ignores addDirs and permissionModeOverride (退役参数保留签名)', async () => {
        const { fake } = makeFakeClient(MockAcpClient);
        const api = new CodebuddyProvider();
        const chunks = await consume(api.sendMessage('s1', 'x', '/v', ['/etc', '/tmp'], 'acceptEdits'));
        expect(chunks.map((c) => c.type)).toEqual(['done']);
        const promptCall = fake.request.mock.calls.find((c) => c[0] === 'session/prompt');
        expect(JSON.stringify(promptCall)).not.toContain('add-dir');
        expect(JSON.stringify(promptCall)).not.toContain('/etc');
    });

    it('generateId returns v4 uuid shape', () => {
        makeFakeClient(MockAcpClient);
        const api = new CodebuddyProvider();
        expect(api.generateId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
});

// ---------- cliPath 纯函数（原样保留） ----------

describe('path helpers', () => {
    describe('isWindowsWrapper', () => {
        it('returns true for windows executables', () => {
            expect(isWindowsWrapper('a.cmd')).toBe(true);
            expect(isWindowsWrapper('a.exe')).toBe(true);
            expect(isWindowsWrapper('a.bat')).toBe(true);
        });

        it('returns false otherwise', () => {
            expect(isWindowsWrapper('a')).toBe(false);
            expect(isWindowsWrapper('a.js')).toBe(false);
        });
    });

    describe('isBareFallback', () => {
        it('returns true for bare command and relative paths', () => {
            expect(isBareFallback('codebuddy')).toBe(true);
            expect(isBareFallback('relative/path')).toBe(true);
        });

        it('returns false for absolute paths', () => {
            expect(isBareFallback('/usr/bin/codebuddy')).toBe(false);
            // 'C:\\...' 仅在 Windows 路径语义下算绝对路径；POSIX 下会被 path.isAbsolute 视为相对路径
            const winStyleIsAbsolute = process.platform === 'win32';
            expect(isBareFallback('C:\\codebuddy.exe')).toBe(!winStyleIsAbsolute);
        });
    });

    describe('needsWindowsShell', () => {
        const originalPlatform = process.platform;
        afterEach(() => {
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        });

        it('returns true on win32 for batch files', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            expect(needsWindowsShell('a.cmd')).toBe(true);
            expect(needsWindowsShell('a.bat')).toBe(true);
            expect(needsWindowsShell('a.exe')).toBe(false);
        });

        it('returns false on non-windows platforms', () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            expect(needsWindowsShell('a.cmd')).toBe(false);
        });
    });
});

describe('resolveCodebuddyPath', () => {
    const originalAppData = process.env.APPDATA;
    const originalPlatform = process.platform;
    let tempDir: string;

    beforeEach(() => {
        // 该用例铺设的是 Windows 分支候选（APPDATA/npm/codebuddy.cmd），
        // 强制走 win32 解析分支，避免在 macOS/Linux 上命中本机真实 codebuddy 安装路径
        Object.defineProperty(process, 'platform', { value: 'win32' });
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-test-'));
        const npmDir = path.join(tempDir, 'npm');
        fs.mkdirSync(npmDir);
        fs.writeFileSync(path.join(npmDir, 'codebuddy.cmd'), '');
        process.env.APPDATA = tempDir;
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        process.env.APPDATA = originalAppData;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('resolves codebuddy from known candidate paths', () => {
        const result = resolveCodebuddyPath('');
        expect(result).toBe(path.join(tempDir, 'npm', 'codebuddy.cmd'));
    });
});

describe('resolveCodebuddyPath on macOS', () => {
    const originalHome = process.env.HOME;
    const originalPlatform = process.platform;
    const realExistsSync = jest.requireActual('fs').existsSync;
    let tempDir: string;

    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-mac-test-'));
        process.env.HOME = tempDir;
        (fs.existsSync as jest.Mock).mockImplementation((p: fs.PathLike) => {
            const target = p.toString();
            if (!target.startsWith(tempDir)) return false;
            return realExistsSync(target);
        });
    });

    afterEach(() => {
        (fs.existsSync as jest.Mock).mockImplementation(realExistsSync);
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        process.env.HOME = originalHome;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('resolves codebuddy from a per-user WorkBuddy.app bundle under $HOME/Applications', () => {
        const appDir = path.join(tempDir, 'Applications', 'WorkBuddy.app', 'Contents', 'Resources', 'app.asar.unpacked', 'cli', 'bin');
        fs.mkdirSync(appDir, { recursive: true });
        fs.writeFileSync(path.join(appDir, 'codebuddy'), '');

        const result = resolveCodebuddyPath('');
        expect(result).toBe(path.join(appDir, 'codebuddy'));
    });

    it('falls back to ~/.local/bin/codebuddy when no WorkBuddy.app bundle exists', () => {
        const binDir = path.join(tempDir, '.local', 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(path.join(binDir, 'codebuddy'), '');

        const result = resolveCodebuddyPath('');
        expect(result).toBe(path.join(binDir, 'codebuddy'));
    });
});

describe('findNodeExecutable on macOS', () => {
    const originalHome = process.env.HOME;
    const originalPlatform = process.platform;
    let tempDir: string;

    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-node-test-'));
        process.env.HOME = tempDir;
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        process.env.HOME = originalHome;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('finds node directly under ~/bin (not nested under a codebuddy subfolder)', () => {
        const binDir = path.join(tempDir, 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(path.join(binDir, 'node'), '');

        const result = findNodeExecutable();
        expect(result).toBe(path.join(binDir, 'node'));
    });
});

describe('CodebuddyProvider forkSession', () => {
    it('loads the session then returns the forked acpSessionId', async () => {
        const { fake, events } = makeFakeClient(MockAcpClient);
        fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
            if (method === 'session/prompt') {
                const text = (params.prompt as Array<{ text: string }>)[0].text;
                if (text.startsWith('/branch ')) {
                    events().onSessionUpdate('acp-1', {
                        sessionUpdate: 'session_info_update',
                        _meta: { 'codebuddy.ai/sessionReset': true, 'codebuddy.ai/newSessionId': 'acp-forked-9' },
                    });
                }
                return { stopReason: 'end_turn' };
            }
            if (method === 'session/new') return { sessionId: 'acp-1' };
            if (method === 'session/load') throw new Error('not found');
            return {};
        });
        const api = new CodebuddyProvider();
        await expect(api.forkSession('s1', '分叉 - x', '/v')).resolves.toBe('acp-forked-9');
        expect(fake.request).toHaveBeenCalledWith('session/new', expect.objectContaining({ cwd: '/v' }));
        const branchCall = fake.request.mock.calls.find((c) => c[0] === 'session/prompt'
            && String((c[1].prompt as Array<{ text: string }>)[0].text).startsWith('/branch '));
        expect(branchCall).toBeDefined();
    });
});
