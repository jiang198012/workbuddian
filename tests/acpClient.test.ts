import { spawn } from 'child_process';
import { AcpClient, buildSpawnCommand, classifyHandshakeFailure, isAuthError, type AcpClientEvents } from '../src/providers/codebuddy/acp/client';

jest.mock('child_process');
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

beforeEach(() => { mockedSpawn.mockReset(); });

jest.mock('fs', () => {
    const actualFs = jest.requireActual('fs');
    return { ...actualFs, existsSync: jest.fn(() => true) };
});

function createFakeProc() {
    const handlers: Record<string, Function[]> = {};
    const stdinWrites: string[] = [];
    const proc = {
        stdin: {
            write: (chunk: unknown) => {
                stdinWrites.push(typeof chunk === 'string' ? chunk : String(chunk));
                return true;
            },
            end: () => { /* noop */ },
            on: (event: string, cb: Function) => {
                handlers[`stdin:${event}`] = handlers[`stdin:${event}`] || [];
                handlers[`stdin:${event}`].push(cb);
            }
        },
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
        },
        kill: jest.fn(),
    };
    const emit = (source: string, event: string, ...args: unknown[]) => {
        const key = source ? `${source}:${event}` : event;
        handlers[key]?.forEach(cb => cb(...args));
    };
    const emitJson = (msg: unknown) => emit('stdout', 'data', Buffer.from(JSON.stringify(msg) + '\n'));
    return { proc, emit, emitJson, stdinWrites };
}

function makeClient() {
    const events: AcpClientEvents = {
        onSessionUpdate: jest.fn(),
        onPermissionRequest: jest.fn(),
        onAgentNotification: jest.fn(),
        onModels: jest.fn(),
        onExit: jest.fn(),
    };
    const client = new AcpClient(events);
    client.setCodebuddyPath('C:\\fake\\codebuddy.exe'); // isWindowsWrapper 分支：直接 spawn
    return { client, events };
}

async function startClient(client: AcpClient, emitJson: (msg: unknown) => void) {
    const started = client.ensureStarted();
    emitJson({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1, agentCapabilities: {} } });
    await started;
}

describe('AcpClient codec & dispatch', () => {
    it('writes newline-delimited JSON-RPC requests with incrementing ids', async () => {
        const { proc, emitJson, stdinWrites } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        await startClient(client, emitJson);

        const req = client.request('session/new', { cwd: '/v', mcpServers: [] });
        emitJson({ jsonrpc: '2.0', id: 2, result: { sessionId: 's1' } });
        await expect(req).resolves.toEqual({ sessionId: 's1' });

        expect(stdinWrites).toHaveLength(2);
        expect(JSON.parse(stdinWrites[0])).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'initialize' });
        expect(JSON.parse(stdinWrites[1])).toMatchObject({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/v', mcpServers: [] } });
        expect(stdinWrites[0].endsWith('\n')).toBe(true);
    });

    it('sends initialize with protocolVersion 1 and client capabilities on start', async () => {
        const { proc, emitJson, stdinWrites } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        await startClient(client, emitJson);
        expect(JSON.parse(stdinWrites[0])).toMatchObject({
            method: 'initialize',
            params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } },
        });
    });

    it('routes session/update notifications by sessionId', async () => {
        const { proc, emitJson } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client, events } = makeClient();
        await startClient(client, emitJson);
        const update = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } };
        emitJson({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update } });
        expect(events.onSessionUpdate).toHaveBeenCalledWith('s1', update);
    });

    it('routes session/request_permission to onPermissionRequest and respond writes the result', async () => {
        const { proc, emitJson, stdinWrites } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client, events } = makeClient();
        await startClient(client, emitJson);
        const params = { sessionId: 's1', options: [] as unknown[], toolCall: { toolCallId: 'c1', rawInput: {} } };
        emitJson({ jsonrpc: '2.0', id: 0, method: 'session/request_permission', params });
        expect(events.onPermissionRequest).toHaveBeenCalledWith(0, params);
        client.respond(0, { outcome: { outcome: 'selected', optionId: 'allow' } });
        expect(JSON.parse(stdinWrites[stdinWrites.length - 1])).toEqual({
            jsonrpc: '2.0', id: 0, result: { outcome: { outcome: 'selected', optionId: 'allow' } },
        });
    });

    it('rejects pending request on JSON-RPC error response', async () => {
        const { proc, emitJson } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        await startClient(client, emitJson);
        const req = client.request('session/new', { cwd: '/v', mcpServers: [] });
        emitJson({ jsonrpc: '2.0', id: 2, error: { code: -1, message: 'boom' } });
        await expect(req).rejects.toThrow('boom');
    });

    it('routes _codebuddy.ai/* notifications to onAgentNotification', async () => {
        const { proc, emitJson } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client, events } = makeClient();
        await startClient(client, emitJson);
        const params = { sessionId: 's1', event: 'created', checkpoint: { id: 'cp1' } };
        emitJson({ jsonrpc: '2.0', method: '_codebuddy.ai/checkpoint', params });
        expect(events.onAgentNotification).toHaveBeenCalledWith('_codebuddy.ai/checkpoint', params);
    });

    it('reports models from session/new result via onModels', async () => {
        const { proc, emitJson } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client, events } = makeClient();
        await startClient(client, emitJson);
        const req = client.request('session/new', { cwd: '/v', mcpServers: [] });
        emitJson({
            jsonrpc: '2.0', id: 2, result: {
                sessionId: 's1',
                models: { availableModels: [{ modelId: 'auto' }, { modelId: 'hy3' }] },
            },
        });
        await req;
        expect(events.onModels).toHaveBeenCalledWith(['auto', 'hy3']);
    });

    it('handles fragmented and batched stdout lines', async () => {
        const { proc, emit, emitJson, stdinWrites } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client, events } = makeClient();
        await startClient(client, emitJson);
        const req = client.request('session/new', { cwd: '/v', mcpServers: [] });
        const line = JSON.stringify({ jsonrpc: '2.0', id: 2, result: { sessionId: 's9' } });
        const update = JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's9', update: { sessionUpdate: 'usage_update', used: 1, size: 2 } } });
        // 分两片到达 + 两行拼一个 data 事件
        emit('stdout', 'data', Buffer.from(line.slice(0, 10)));
        emit('stdout', 'data', Buffer.from(line.slice(10) + '\n' + update + '\n'));
        await expect(req).resolves.toEqual({ sessionId: 's9' });
        expect(events.onSessionUpdate).toHaveBeenCalledWith('s9', { sessionUpdate: 'usage_update', used: 1, size: 2 });
        expect(stdinWrites).toHaveLength(2);
    });

    it('ignores non-JSON stdout lines with a log instead of crashing', async () => {
        const { proc, emit, emitJson } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        await startClient(client, emitJson);
        emit('stdout', 'data', Buffer.from('not json at all\n'));
        expect(client.running).toBe(true);
    });

    it('serializes session/prompt: a second prompt is not written until the first settles (WB-001)', async () => {
        const { proc, emitJson, stdinWrites } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        await startClient(client, emitJson);
        const tick = () => new Promise((r) => setTimeout(r, 0));
        const promptWrites = () => stdinWrites.filter((w) => w.includes('"session/prompt"'));

        const r1 = client.request('session/prompt', { sessionId: 's1', prompt: [{ type: 'text', text: '1' }] });
        const r2 = client.request('session/prompt', { sessionId: 's2', prompt: [{ type: 'text', text: '2' }] });
        await tick(); // 让第一个 prompt 经队列微任务出站
        expect(promptWrites()).toHaveLength(1); // 第二个 prompt 还在队列里，未出站

        emitJson({ jsonrpc: '2.0', id: 2, result: { stopReason: 'end_turn' } });
        await r1;
        await tick(); // 队列推进，第二个 prompt 出站
        expect(promptWrites()).toHaveLength(2);
        emitJson({ jsonrpc: '2.0', id: 3, result: { stopReason: 'end_turn' } });
        await expect(r2).resolves.toEqual({ stopReason: 'end_turn' });
    });

    it('does not serialize non-prompt requests behind a prompt', async () => {
        const { proc, emitJson, stdinWrites } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        await startClient(client, emitJson);
        const byMethod = (m: string) => stdinWrites.map((w) => JSON.parse(w)).find((msg) => msg.method === m);
        const prompt = client.request('session/prompt', { sessionId: 's1', prompt: [] }); // 挂起不应答
        const other = client.request('session/new', { cwd: '/v', mcpServers: [] }); // 立即出站
        emitJson({ jsonrpc: '2.0', id: byMethod('session/new').id, result: { sessionId: 's9' } });
        await expect(other).resolves.toEqual({ sessionId: 's9' }); // 不被挂起的 prompt 阻塞
        emitJson({ jsonrpc: '2.0', id: byMethod('session/prompt').id, result: { stopReason: 'end_turn' } });
        await prompt;
    });

    it('rejects a never-answered request after the default timeout (WB-005 悬挂兜底)', async () => {
        jest.useFakeTimers();
        try {
            const { proc, emitJson } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);
            const { client } = makeClient();
            const started = client.ensureStarted();
            emitJson({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1, agentCapabilities: {} } });
            await started;
            const req = client.request('session/new', { cwd: '/v', mcpServers: [] });
            const assertion = expect(req).rejects.toThrow('acp request timeout: session/new');
            await jest.advanceTimersByTimeAsync(90_000);
            await assertion;
        } finally {
            jest.useRealTimers();
        }
    });

    it('prompt requests are bounded by promptTimeoutMs, not the 90s default (长轮次不被误杀)', async () => {
        jest.useFakeTimers();
        try {
            const { proc, emitJson } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);
            const { client } = makeClient();
            const started = client.ensureStarted();
            emitJson({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1, agentCapabilities: {} } });
            await started;
            client.promptTimeoutMs = 300_000;
            const req = client.request('session/prompt', { sessionId: 's1', prompt: [] });
            let settled = false;
            void req.then(() => { settled = true; }, () => { settled = true; });
            await jest.advanceTimersByTimeAsync(91_000); // 超过默认 90s 仍未断
            expect(settled).toBe(false);
            const assertion = expect(req).rejects.toThrow('acp request timeout: session/prompt');
            await jest.advanceTimersByTimeAsync(300_000); // 超过兜底断链
            await assertion;
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('buildSpawnCommand / classifyHandshakeFailure / isAuthError', () => {
    it('spawns bare fallback and windows wrapper directly', () => {
        expect(buildSpawnCommand('codebuddy', '', ['--acp'])).toEqual({ command: 'codebuddy', args: ['--acp'], shell: false });
        expect(buildSpawnCommand('C:\\cb\\codebuddy.cmd', '', ['--acp']))
            .toEqual({ command: 'C:\\cb\\codebuddy.cmd', args: ['--acp'], shell: process.platform === 'win32' });
    });
    it('spawns script paths via node', () => {
        expect(buildSpawnCommand('/usr/local/bin/codebuddy', '/fake/node', ['--acp']))
            .toEqual({ command: '/fake/node', args: ['/usr/local/bin/codebuddy', '--acp'], shell: false });
    });
    it('classifies old CLI without --acp', () => {
        expect(classifyHandshakeFailure('error: unrecognized option: --acp')).toBe('acp-unsupported');
        expect(classifyHandshakeFailure('unknown command "--acp"')).toBe('acp-unsupported');
        expect(classifyHandshakeFailure('some other failure')).toBe('handshake-failed');
        expect(classifyHandshakeFailure('')).toBe('handshake-failed');
    });
    it('detects auth errors', () => {
        expect(isAuthError('authentication required')).toBe(true);
        expect(isAuthError('not logged in')).toBe(true);
        expect(isAuthError('请先登录')).toBe(true);
        expect(isAuthError('boom')).toBe(false);
    });
});

describe('AcpClient lifecycle', () => {
    it('rejects ensureStarted with cli-not-found on ENOENT spawn error', async () => {
        const { proc, emit } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        const started = client.ensureStarted();
        const assertion = expect(started).rejects.toMatchObject({ tier: 'cli-not-found' });
        emit('', 'error', new Error('spawn C:\\fake\\codebuddy.exe ENOENT'));
        await assertion;
        expect(client.running).toBe(false);
    });

    it('classifies early exit with unknown-option stderr as acp-unsupported', async () => {
        const { proc, emit } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        const started = client.ensureStarted();
        const assertion = expect(started).rejects.toMatchObject({ tier: 'acp-unsupported' });
        emit('stderr', 'data', Buffer.from('error: unrecognized option: --acp\n'));
        emit('', 'close', 1, null);
        await assertion;
    });

    it('classifies early exit without telling stderr as handshake-failed', async () => {
        const { proc, emit } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        const started = client.ensureStarted();
        const assertion = expect(started).rejects.toMatchObject({ tier: 'handshake-failed' });
        emit('', 'close', 2, null);
        await assertion;
    });

    it('times out handshake after 10s', async () => {
        jest.useFakeTimers();
        try {
            const { proc } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);
            const { client } = makeClient();
            const started = client.ensureStarted();
            const assertion = expect(started).rejects.toMatchObject({ tier: 'handshake-failed' });
            jest.advanceTimersByTime(10_000);
            await assertion;
        } finally {
            jest.useRealTimers();
        }
    });

    it('rejects in-flight requests and fires onExit when process dies mid-session', async () => {
        const { proc, emit, emitJson } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client, events } = makeClient();
        await startClient(client, emitJson);
        const req = client.request('session/prompt', { sessionId: 's1', prompt: [] });
        await new Promise((r) => setTimeout(r, 0)); // prompt 经串行队列微任务出站，先让请求落进 pending
        const assertion = expect(req).rejects.toThrow('acp process exited');
        emit('', 'close', 1, null);
        await assertion;
        expect(events.onExit).toHaveBeenCalledWith(1, null);
        expect(client.running).toBe(false);
    });

    it('does not fire onExit when spawn error is followed by close (same death)', async () => {
        const { proc, emit } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client, events } = makeClient();
        const started = client.ensureStarted();
        const assertion = expect(started).rejects.toMatchObject({ tier: 'cli-not-found' });
        emit('', 'error', new Error('spawn codebuddy ENOENT'));
        emit('', 'close', -2, null);
        await assertion;
        expect(events.onExit).not.toHaveBeenCalled();
    });

    it('respawns on next ensureStarted after death', async () => {
        const first = createFakeProc();
        mockedSpawn.mockReturnValueOnce(first.proc as any);
        const { client } = makeClient();
        await startClient(client, first.emitJson);
        first.emit('', 'close', 1, null);
        expect(client.running).toBe(false);

        const second = createFakeProc();
        mockedSpawn.mockReturnValueOnce(second.proc as any);
        const restarted = client.ensureStarted();
        // 第二次 spawn 的 initialize 请求 id 递增，按实际写入行应答
        const initReq = JSON.parse(second.stdinWrites[0]);
        second.emitJson({ jsonrpc: '2.0', id: initReq.id, result: { protocolVersion: 1 } });
        await restarted;
        expect(mockedSpawn).toHaveBeenCalledTimes(2);
        expect(client.running).toBe(true);
    });

    it('dispose rejects pending, kills proc, and swallows the resulting close', async () => {
        const { proc, emit, emitJson } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client, events } = makeClient();
        await startClient(client, emitJson);
        const req = client.request('session/prompt', { sessionId: 's1', prompt: [] });
        await new Promise((r) => setTimeout(r, 0)); // prompt 经串行队列微任务出站，先让请求落进 pending
        const assertion = expect(req).rejects.toThrow('acp client disposed');
        client.dispose();
        emit('', 'close', null, 'SIGTERM');
        await assertion;
        expect(proc.kill).toHaveBeenCalled();
        expect(events.onExit).not.toHaveBeenCalled();
        expect(client.running).toBe(false);
    });
});

describe('AcpClient extraArgs & dispose-on-change', () => {
    it('appends extraArgs after --acp', async () => {
        const { proc, emitJson, stdinWrites } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        client.setExtraArgs(['--agents', '{"reviewer":{}}']);
        await startClient(client, emitJson);
        expect(mockedSpawn.mock.calls[0][1]).toEqual(['--acp', '--agents', '{"reviewer":{}}']);
        expect(stdinWrites.length).toBeGreaterThan(0);
    });
    it('disposes a running process when extraArgs change, keeps it when unchanged', async () => {
        const { proc, emitJson } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        await startClient(client, emitJson);
        client.setExtraArgs(['--agents', '{}']);
        expect(proc.kill).toHaveBeenCalled();
        expect(client.running).toBe(false);

        const second = createFakeProc();
        mockedSpawn.mockReturnValueOnce(second.proc as any);
        const restarted = client.ensureStarted();
        const initReq = JSON.parse(second.stdinWrites[0]);
        second.emitJson({ jsonrpc: '2.0', id: initReq.id, result: { protocolVersion: 1 } });
        await restarted;
        second.proc.kill.mockClear();
        client.setExtraArgs(['--agents', '{}']); // 同值不变 → 不重启
        expect(second.proc.kill).not.toHaveBeenCalled();
        expect(client.running).toBe(true);
    });
});
