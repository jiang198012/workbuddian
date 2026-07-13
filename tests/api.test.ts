import { spawn } from 'child_process';
import { CodebuddyProvider, parseStreamLine, parseMessageBlock, blockToChunk, parseStreamEvent, parseUsage, isWindowsWrapper, isBareFallback, needsWindowsShell, type StreamChunk } from '../src/providers/codebuddy';
import { resolveCodebuddyPath, findNodeExecutable } from '../src/utils/cliPath';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('child_process');
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

jest.mock('fs', () => {
    const actualFs = jest.requireActual('fs');
    return { ...actualFs, existsSync: jest.fn(actualFs.existsSync) };
});

function createFakeProc() {
    const handlers: Record<string, Function[]> = {};
    const proc = {
        stdout: {
            on: (event: string, cb: Function) => {
                handlers[`stdout:${event}`] = handlers[`stdout:${event}`] || [];
                handlers[`stdout:${event}`].push(cb);
            }
        },
        stderr: {
            on: (event: string, cb: Function) => {
                handlers[`stderr:${event}`] = handlers[`stderr:${event}`] || [];
                handlers[`stderr:${event}`].push(cb);
            }
        },
        on: (event: string, cb: Function) => {
            handlers[event] = handlers[event] || [];
            handlers[event].push(cb);
        }
    };
    const emit = (source: string, event: string, ...args: unknown[]) => {
        const key = source ? `${source}:${event}` : event;
        handlers[key]?.forEach(cb => cb(...args));
    };
    return { proc, emit };
}

describe('CodebuddyProvider', () => {
    let api: CodebuddyProvider;
    beforeEach(() => { api = new CodebuddyProvider(); });

    it('should create instance', () => { expect(api).toBeDefined(); });
    it('should accept custom timeout', () => { const a = new CodebuddyProvider(5000); expect(a).toBeDefined(); });
    it('should generate valid UUID', () => { expect(api.generateId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i); });

    describe('setCodebuddyPath', () => {
        it('should not throw', () => { api.setCodebuddyPath(''); });
    });

    describe('cancel', () => {
        it('should not throw', () => { api.cancel(); });
    });

    describe('sendMessage', () => {
        beforeEach(() => {
            mockedSpawn.mockClear();
        });

        it('streams text chunks from child process', async () => {
            const { proc, emit } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);

            const api = new CodebuddyProvider();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
            const gen = api.sendMessage('session-1', 'hello');

            const firstPromise = gen.next();
            emit('stdout', 'data', Buffer.from(JSON.stringify({ type: 'text', text: 'world' }) + '\n'));
            const first = await firstPromise;
            expect(first.done).toBe(false);
            expect(first.value).toEqual({ type: 'text', content: 'world' });

            const secondPromise = gen.next();
            emit('', 'close', 0, null);
            const second = await secondPromise;
            expect(second.done).toBe(true);
        });

        it('throws when stderr is non-empty and stdout is empty', async () => {
            const { proc, emit } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);

            const api = new CodebuddyProvider();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
            const gen = api.sendMessage('session-2', 'hello');

            const firstPromise = gen.next();
            emit('stderr', 'data', Buffer.from('command not found'));
            emit('', 'close', 1, null);
            await expect(firstPromise).rejects.toThrow('command not found');
        });

        it('cancel() kills the active process and ends the generator', async () => {
            const { proc, emit } = createFakeProc();
            (proc as any).kill = jest.fn();
            mockedSpawn.mockReturnValue(proc as any);

            const api = new CodebuddyProvider();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
            const gen = api.sendMessage('session-3', 'hello');

            const firstPromise = gen.next();
            emit('stdout', 'data', Buffer.from(JSON.stringify({ type: 'text', text: 'partial' }) + '\n'));
            await firstPromise;

            api.cancel();
            expect((proc as any).kill).toHaveBeenCalled();

            const nextPromise = gen.next();
            emit('', 'close', null, 'SIGTERM');
            const result = await nextPromise;
            expect(result.done).toBe(true);
        });

        it('passes --include-partial-messages so the CLI streams SSE deltas', async () => {
            const { proc, emit } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);

            const api = new CodebuddyProvider();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
            const gen = api.sendMessage('session-partial', 'hello');

            const firstPromise = gen.next();
            emit('', 'close', 0, null);
            await firstPromise;

            const [, cliArgs] = mockedSpawn.mock.calls[0];
            expect(cliArgs).toContain('--include-partial-messages');
        });

        it('passes --add-dir before --session-id so the variadic does not swallow the message', async () => {
            const { proc, emit } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);

            const api = new CodebuddyProvider();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
            const gen = api.sendMessage('session-adddir', 'my message', undefined, ['/Users/x/Desktop', '/tmp']);

            const firstPromise = gen.next();
            emit('', 'close', 0, null);
            await firstPromise;

            const [, cliArgs] = mockedSpawn.mock.calls[0];
            const addIdx = cliArgs.indexOf('--add-dir');
            const allowIdx = cliArgs.indexOf('--allowedTools');
            const sessIdx = cliArgs.indexOf('--session-id');
            expect(addIdx).toBeGreaterThanOrEqual(0);
            expect(cliArgs).toContain('/Users/x/Desktop');
            expect(cliArgs).toContain('/tmp');
            // 每个目录配一条限定的只读授权规则（不是全局 Read，避免越界读任意文件）
            expect(cliArgs).toContain('Read(/Users/x/Desktop/**)');
            expect(cliArgs).toContain('Read(/tmp/**)');
            expect(cliArgs).not.toContain('Read'); // 不应出现裸的全局 Read
            // 两个变长参数都必须在 --session-id 之前，且 message 仍是最后一个位置参数
            expect(addIdx).toBeLessThan(sessIdx);
            expect(allowIdx).toBeLessThan(sessIdx);
            expect(cliArgs[cliArgs.length - 1]).toBe('my message');
        });

        it('omits --add-dir when no extra directories are given', async () => {
            const { proc, emit } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);

            const api = new CodebuddyProvider();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
            const gen = api.sendMessage('session-nodir', 'hello');

            const firstPromise = gen.next();
            emit('', 'close', 0, null);
            await firstPromise;

            const [, cliArgs] = mockedSpawn.mock.calls[0];
            expect(cliArgs).not.toContain('--add-dir');
            expect(cliArgs[cliArgs.length - 1]).toBe('hello');
        });

        it('passes the configured model to the CLI as --model', async () => {
            const { proc, emit } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);

            const api = new CodebuddyProvider();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
            const gen = api.sendMessage('session-model', 'hello');

            const firstPromise = gen.next();
            emit('', 'close', 0, null);
            await firstPromise;

            const [, cliArgs] = mockedSpawn.mock.calls[0];
            expect(cliArgs).toContain('--model');
            expect(cliArgs).toContain('auto');
        });

        it('uses setModel() to override the model passed to the CLI', async () => {
            const { proc, emit } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);

            const api = new CodebuddyProvider();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
            api.setModel('glm-5.2');
            const gen = api.sendMessage('session-model-2', 'hello');

            const firstPromise = gen.next();
            emit('', 'close', 0, null);
            await firstPromise;

            const [, cliArgs] = mockedSpawn.mock.calls[0];
            expect(cliArgs).toContain('--model');
            expect(cliArgs).toContain('glm-5.2');
        });

        it('passes the default permission mode to the CLI as --permission-mode', async () => {
            const { proc, emit } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);

            const api = new CodebuddyProvider();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
            const gen = api.sendMessage('session-perm', 'hello');

            const firstPromise = gen.next();
            emit('', 'close', 0, null);
            await firstPromise;

            const [, cliArgs] = mockedSpawn.mock.calls[0];
            expect(cliArgs).toContain('--permission-mode');
            expect(cliArgs).toContain('default');
        });

        it('uses setPermissionMode() to override the permission mode passed to the CLI', async () => {
            const { proc, emit } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);

            const api = new CodebuddyProvider();
            api.setCodebuddyPath('C:\\fake\\codebuddy.exe');
            api.setPermissionMode('plan');
            const gen = api.sendMessage('session-perm-2', 'hello');

            const firstPromise = gen.next();
            emit('', 'close', 0, null);
            await firstPromise;

            const [, cliArgs] = mockedSpawn.mock.calls[0];
            expect(cliArgs).toContain('--permission-mode');
            expect(cliArgs).toContain('plan');
        });

        it('uses setNodePath() to override automatic Node.js discovery', async () => {
            const { proc, emit } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);

            // resolveCodebuddyPath('/fake/codebuddy') 只有在 fs.existsSync('/fake/codebuddy')
            // 为 true 时才会原样返回这个路径；否则会走真实候选路径搜索，在装了
            // WorkBuddy 的开发机上会意外解析到真实安装路径，让这条测试的通过与否
            // 取决于运行测试的机器上装没装 WorkBuddy——必须 mock existsSync 让它
            // 对这一个路径返回 true，才能让测试在任何机器上都确定性通过
            const realExistsSync = jest.requireActual('fs').existsSync;
            (fs.existsSync as jest.Mock).mockImplementation((p: fs.PathLike) => p === '/fake/codebuddy');

            const api = new CodebuddyProvider();
            api.setCodebuddyPath('/fake/codebuddy');
            api.setNodePath('/custom/node/path/node');
            const gen = api.sendMessage('session-node', 'hello');

            const firstPromise = gen.next();
            emit('', 'close', 0, null);
            await firstPromise;

            const [command] = mockedSpawn.mock.calls[0];
            expect(command).toBe('/custom/node/path/node');

            (fs.existsSync as jest.Mock).mockImplementation(realExistsSync);
        });
    });
});

describe('parseMessageBlock', () => {
    it('returns null for non-objects', () => {
        expect(parseMessageBlock(null)).toBeNull();
        expect(parseMessageBlock('text')).toBeNull();
    });

    it('returns null for unsupported types', () => {
        expect(parseMessageBlock({ type: 'image' })).toBeNull();
    });

    it('parses thinking block', () => {
        expect(parseMessageBlock({ type: 'thinking', thinking: 'reason' })).toEqual({
            type: 'thinking',
            thinking: 'reason',
            text: undefined,
            name: undefined,
            input: undefined
        });
    });

    it('parses text block', () => {
        expect(parseMessageBlock({ type: 'text', text: 'hi' })).toEqual({
            type: 'text', thinking: undefined, text: 'hi', name: undefined, input: undefined
        });
    });

    it('parses tool_call block', () => {
        expect(parseMessageBlock({ type: 'tool_call', name: 'read', input: { x: 1 } })).toEqual({
            type: 'tool_call',
            thinking: undefined,
            text: undefined,
            name: 'read',
            input: { x: 1 }
        });
    });
});

describe('blockToChunk', () => {
    it('converts thinking block', () => {
        expect(blockToChunk({ type: 'thinking', thinking: 't' })).toEqual({ type: 'thinking', content: 't' });
    });

    it('converts text block', () => {
        expect(blockToChunk({ type: 'text', text: 't' })).toEqual({ type: 'text', content: 't' });
    });

    it('converts tool_call block with string input', () => {
        expect(blockToChunk({ type: 'tool_call', name: 'n', input: 'arg' })).toEqual({
            type: 'tool', content: '', toolName: 'n', toolDetail: 'arg'
        });
    });

    it('converts tool_call block with object input', () => {
        expect(blockToChunk({ type: 'tool_call', name: 'n', input: { x: 1 } })).toEqual({
            type: 'tool', content: '', toolName: 'n', toolDetail: JSON.stringify({ x: 1 })
        });
    });
});

describe('parseStreamEvent', () => {
    it('returns null for non-objects', () => {
        expect(parseStreamEvent('string')).toBeNull();
        expect(parseStreamEvent(null)).toBeNull();
    });

    it('extracts event from nested event property', () => {
        expect(parseStreamEvent({ event: { type: 'text', text: 'nested' } })).toMatchObject({
            type: 'text', text: 'nested'
        });
    });

    it('falls back to raw object when event property is not an object', () => {
        expect(parseStreamEvent({ type: 'direct', text: 'value' })).toMatchObject({
            type: 'direct', text: 'value'
        });
    });
});

describe('parseUsage', () => {
    it('extracts inputTokens from a usage object', () => {
        expect(parseUsage({ usage: { input_tokens: 22594 } })).toEqual({ inputTokens: 22594 });
    });

    it('returns undefined when usage or input_tokens is missing or invalid', () => {
        expect(parseUsage({})).toBeUndefined();
        expect(parseUsage(null)).toBeUndefined();
        expect(parseUsage({ usage: { input_tokens: 'x' } })).toBeUndefined();
    });
});

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

describe('parseStreamLine', () => {
    it('returns null for empty lines', () => {
        expect(parseStreamLine('')).toBeNull();
        expect(parseStreamLine('   ')).toBeNull();
    });

    it('returns text chunk for plain text on parse failure', () => {
        expect(parseStreamLine('not json')).toEqual({ type: 'text', content: 'not json' });
    });

    it('parses assistant envelope with thinking block', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: {
                content: [{ type: 'thinking', thinking: 'step 1' }]
            }
        });
        expect(parseStreamLine(line)).toEqual({ type: 'thinking', content: 'step 1' });
    });

    it('parses assistant envelope with text block', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: {
                content: [{ type: 'text', text: 'hello' }]
            }
        });
        expect(parseStreamLine(line)).toEqual({ type: 'text', content: 'hello' });
    });

    it('parses assistant envelope with tool_call block', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: {
                content: [{ type: 'tool_call', name: 'read', input: { path: '/tmp' } }]
            }
        });
        const expected: StreamChunk = {
            type: 'tool',
            content: '',
            toolName: 'read',
            toolDetail: JSON.stringify({ path: '/tmp' })
        };
        expect(parseStreamLine(line)).toEqual(expected);
    });

    it('parses user envelope with text block', () => {
        const line = JSON.stringify({
            type: 'user',
            message: {
                content: [{ type: 'text', text: 'user hello' }]
            }
        });
        expect(parseStreamLine(line)).toEqual({ type: 'text', content: 'user hello' });
    });

    it('returns null for assistant envelope without recognized blocks', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: {
                content: [{ type: 'image', url: 'http://x' }]
            }
        });
        expect(parseStreamLine(line)).toBeNull();
    });

    it('parses direct thinking event', () => {
        const line = JSON.stringify({ type: 'thinking', thinking: 'reasoning' });
        expect(parseStreamLine(line)).toEqual({ type: 'thinking', content: 'reasoning' });
    });

    it('parses direct message_delta event', () => {
        const line = JSON.stringify({ type: 'message_delta', text: 'delta' });
        expect(parseStreamLine(line)).toEqual({ type: 'text', content: 'delta' });
    });

    it('parses direct tool_call event', () => {
        const line = JSON.stringify({ type: 'tool_call', name: 'write', input: 'data' });
        const expected: StreamChunk = {
            type: 'tool',
            content: '',
            toolName: 'write',
            toolDetail: 'data'
        };
        expect(parseStreamLine(line)).toEqual(expected);
    });

    it('parses result event', () => {
        const line = JSON.stringify({ type: 'result', result: 'done' });
        expect(parseStreamLine(line)).toEqual({ type: 'done', content: 'done' });
    });

    it('carries token usage from a result event', () => {
        const line = JSON.stringify({ type: 'result', result: 'done', usage: { input_tokens: 22594, output_tokens: 3 } });
        expect(parseStreamLine(line)).toEqual({ type: 'done', content: 'done', usage: { inputTokens: 22594 } });
    });

    it('parses error event', () => {
        const line = JSON.stringify({ type: 'error', error: 'fail' });
        expect(parseStreamLine(line)).toEqual({ type: 'error', content: 'fail' });
    });

    it('falls back to message when error field is missing', () => {
        const line = JSON.stringify({ type: 'error', message: 'oops' });
        expect(parseStreamLine(line)).toEqual({ type: 'error', content: 'oops' });
    });

    it('uses fallback text fields for unknown events', () => {
        const line = JSON.stringify({ type: 'unknown', content: 'fallback' });
        expect(parseStreamLine(line)).toEqual({ type: 'text', content: 'fallback' });
    });

    it('returns null for unknown events without fallback text', () => {
        const line = JSON.stringify({ type: 'unknown', value: 123 });
        expect(parseStreamLine(line)).toBeNull();
    });

    // ---- 增量流式（--include-partial-messages）----

    it('parses a content_block_delta text_delta stream_event as a text chunk', () => {
        const line = JSON.stringify({
            type: 'stream_event',
            event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } }
        });
        expect(parseStreamLine(line)).toEqual({ type: 'text', content: '你好' });
    });

    it('parses a content_block_delta thinking_delta stream_event as a thinking chunk', () => {
        const line = JSON.stringify({
            type: 'stream_event',
            event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } }
        });
        expect(parseStreamLine(line)).toEqual({ type: 'thinking', content: 'hmm' });
    });

    it('returns null for an empty text_delta', () => {
        const line = JSON.stringify({
            type: 'stream_event',
            event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '' } }
        });
        expect(parseStreamLine(line)).toBeNull();
    });

    it('returns null for non-delta stream_events (message_start / content_block_stop)', () => {
        expect(parseStreamLine(JSON.stringify({ type: 'stream_event', event: { type: 'message_start' } }))).toBeNull();
        expect(parseStreamLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_stop' } }))).toBeNull();
    });

    it('in streaming mode, drops the duplicate text block from the trailing assistant envelope', () => {
        const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '你好呀' }] } });
        // 默认（非 streaming）仍解析出 text，保持向后兼容
        expect(parseStreamLine(line)).toEqual({ type: 'text', content: '你好呀' });
        // streaming 模式下跳过，避免与增量 delta 的正文翻倍
        expect(parseStreamLine(line, true)).toBeNull();
    });

    it('in streaming mode, drops the duplicate thinking block from the assistant envelope', () => {
        const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'reason' }] } });
        expect(parseStreamLine(line, true)).toBeNull();
    });

    it('in streaming mode, still keeps tool_call blocks from the assistant envelope', () => {
        const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_call', name: 'read', input: { path: '/tmp' } }] } });
        expect(parseStreamLine(line, true)).toEqual({
            type: 'tool', content: '', toolName: 'read', toolDetail: JSON.stringify({ path: '/tmp' })
        });
    });
});
