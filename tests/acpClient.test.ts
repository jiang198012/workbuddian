import { spawn } from 'child_process';
import { AcpClient, buildSpawnCommand, classifyHandshakeFailure, isAuthError, type AcpClientEvents } from '../src/providers/acp/client';
import { HERMES_PROFILE } from '../src/providers/hermes/profile';
import { ACP_DEFAULT_PROFILE } from '../src/providers/acp/profile';

jest.mock('child_process');
jest.mock('../src/providers/codebuddy/workbuddySidecar', () => ({ startWorkbuddySidecar: jest.fn() }));
jest.mock('../src/providers/codebuddy/workbuddyHost', () => ({ WorkbuddyHostConnection: { connect: jest.fn() } }));
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
    client.setCliPath('C:\\fake\\codebuddy.exe'); // isWindowsWrapper 分支：直接 spawn
    return { client, events };
}

async function startClient(client: AcpClient, emitJson: (msg: unknown) => void) {
    const started = client.ensureStarted();
    emitJson({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1, agentCapabilities: {} } });
    await started;
}

describe('AcpClient codec & dispatch', () => {
    it('reports missing WorkBuddy without spawning a fallback CLI', async () => {
        const { events } = makeClient();
        const client = new AcpClient(events, { ...ACP_DEFAULT_PROFILE, resolveCliPath: () => '' });
        await expect(client.ensureStarted()).rejects.toMatchObject({ tier: 'cli-not-found' });
        expect(mockedSpawn).not.toHaveBeenCalled();
    });

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

    it('tracks session/load window via loadInFlight until the response lands', async () => {
        // hermes 无回放 meta 标记：回放事件只能靠"load 请求发出到响应到达"的窗口判别
        const { proc, emitJson } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        await startClient(client, emitJson);

        expect(client.loadInFlight('s1')).toBe(false);
        const req = client.request('session/load', { sessionId: 's1', cwd: '/v', mcpServers: [] });
        expect(client.loadInFlight('s1')).toBe(true);
        expect(client.loadInFlight('other')).toBe(false);
        emitJson({ jsonrpc: '2.0', id: 2, result: {} });
        await req;
        expect(client.loadInFlight('s1')).toBe(false);

        // 失败路径同样清窗口（否则后续事件永久被判成回放）
        const failing = client.request('session/load', { sessionId: 's2', cwd: '/v', mcpServers: [] });
        expect(client.loadInFlight('s2')).toBe(true);
        emitJson({ jsonrpc: '2.0', id: 3, error: { code: -32000, message: 'nope' } });
        await expect(failing).rejects.toThrow('nope');
        expect(client.loadInFlight('s2')).toBe(false);
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

    it.each([
        { code: -32000, message: 'Authentication required', data: { category: 'auth' } },
        { code: -32000, message: 'Request refused', data: { category: 'auth' } },
    ])('classifies WorkBuddy structured refusal without stderr (#10): %j', async (error) => {
        const { proc, emitJson } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        await startClient(client, emitJson);
        const req = client.rawRequest('session/prompt', { sessionId: 's1', prompt: [] });
        emitJson({ jsonrpc: '2.0', id: 2, result: {
            stopReason: 'refusal', _meta: { 'codebuddy.ai/errorMessage': JSON.stringify(error) },
        } });
        await expect(req).rejects.toMatchObject({ tier: 'auth-required' });
        client.dispose();
    });

    it.each(['{invalid', 'null', JSON.stringify({ code: -32003, message: 'Quota exceeded', data: { category: 'quota' } })])(
        'does not mistake non-auth or malformed refusal metadata for authentication: %s', async (detail) => {
            const { proc, emitJson } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);
            const { client } = makeClient();
            await startClient(client, emitJson);
            const req = client.rawRequest('session/prompt', { sessionId: 's1', prompt: [] });
            const result = { stopReason: 'refusal', _meta: { 'codebuddy.ai/errorMessage': detail } };
            emitJson({ jsonrpc: '2.0', id: 2, result });
            await expect(req).resolves.toEqual(result);
            client.dispose();
        },
    );

    it('reports WorkBuddy missing-key evidence when a prompt is refused (#10)', async () => {
        const { proc, emit, emitJson } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        await startClient(client, emitJson);
        emit('stderr', 'data', Buffer.from('[AtRestEncryption] unavailable category=missing-'));
        emit('stderr', 'data', Buffer.from('key role=cbc\n'));
        const req = client.rawRequest('session/prompt', { sessionId: 's1', prompt: [] });
        emitJson({ jsonrpc: '2.0', id: 2, result: { stopReason: 'refusal' } });
        await expect(req).rejects.toMatchObject({ tier: 'credential-unavailable' });
        client.dispose();
    });

    it('keeps a refusal without authentication evidence unchanged', async () => {
        const { proc, emitJson } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        await startClient(client, emitJson);
        const req = client.rawRequest('session/prompt', { sessionId: 's1', prompt: [] });
        emitJson({ jsonrpc: '2.0', id: 2, result: { stopReason: 'refusal' } });
        await expect(req).resolves.toEqual({ stopReason: 'refusal' });
        client.dispose();
    });

    it('classifies authentication errors after initialize, including session/new', async () => {
        const { proc, emitJson } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        await startClient(client, emitJson);
        const req = client.request('session/new', { cwd: '/v', mcpServers: [] });
        emitJson({ jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'Authentication required' } });
        await expect(req).rejects.toMatchObject({ tier: 'auth-required' });
        client.dispose();
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
                models: { availableModels: [{ modelId: 'auto' }, { modelId: 'hy3', name: 'Hy3' }] },
            },
        });
        await req;
        expect(events.onModels).toHaveBeenCalledWith([{ id: 'auto' }, { id: 'hy3', name: 'Hy3' }]);
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
        expect(isAuthError('Failed to authorize tool execution')).toBe(false);
        expect(isAuthError('Cannot edit login.ts')).toBe(false);
        expect(isAuthError('boom')).toBe(false);
    });
});

describe('profile 驱动的 spawn 策略（spawnViaNode）', () => {
    function makeEvents(): AcpClientEvents {
        return {
            onSessionUpdate: jest.fn(),
            onPermissionRequest: jest.fn(),
            onAgentNotification: jest.fn(),
            onModels: jest.fn(),
            onExit: jest.fn(),
        };
    }

    it('hermes profile：纯路径直接 spawn，不经 node（bash shim 由 node 解释会 SyntaxError）', async () => {
        const { proc, emitJson } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const client = new AcpClient(makeEvents(), HERMES_PROFILE);
        client.setCliPath('/Users/jiang/.local/bin/hermes');
        await startClient(client, emitJson);
        expect(mockedSpawn).toHaveBeenCalledWith('/Users/jiang/.local/bin/hermes', ['acp'], { shell: false });
    });

    it('codebuddy 默认 profile：纯路径仍走 node 解释（历史行为不变）', async () => {
        const { proc, emitJson } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const client = new AcpClient(makeEvents());
        client.setCliPath('/usr/local/bin/codebuddy');
        client.setNodePath('/fake/node');
        await startClient(client, emitJson);
        expect(mockedSpawn).toHaveBeenCalledWith('/fake/node', ['/usr/local/bin/codebuddy', '--acp'], { shell: false });
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

    it('times out handshake after 30s', async () => {
        jest.useFakeTimers();
        try {
            const { proc } = createFakeProc();
            mockedSpawn.mockReturnValue(proc as any);
            const { client } = makeClient();
            const started = client.ensureStarted();
            const assertion = expect(started).rejects.toMatchObject({ tier: 'handshake-failed' });
            jest.advanceTimersByTime(30_000);
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

    it('ignores late output and close from the previous process after switching CLI paths', async () => {
        const first = createFakeProc();
        mockedSpawn.mockReturnValue(first.proc as any);
        const { client, events } = makeClient();
        await startClient(client, first.emitJson);
        client.setCliPath('/fake/standalone-codebuddy');
        expect(events.onExit).toHaveBeenCalledTimes(1);
        (events.onExit as jest.Mock).mockClear();
        const second = createFakeProc();
        mockedSpawn.mockReturnValue(second.proc as any);
        const restarted = client.ensureStarted();
        const id = JSON.parse(second.stdinWrites[0]).id;
        first.emit('stderr', 'data', Buffer.from('[AtRestEncryption] unavailable category=missing-key role=cbc\n'));
        first.emit('', 'close', null, 'SIGTERM');
        first.emitJson({ jsonrpc: '2.0', method: 'session/update', params: {
            sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'stale' } },
        } });
        second.emitJson({ jsonrpc: '2.0', id, result: { protocolVersion: 1 } });
        await restarted;
        expect(client.running).toBe(true);
        expect(events.onExit).not.toHaveBeenCalled();
        expect(events.onSessionUpdate).not.toHaveBeenCalled();
        const req = client.rawRequest('session/prompt', { sessionId: 's1', prompt: [] });
        second.emitJson({ jsonrpc: '2.0', id: id + 1, result: { stopReason: 'refusal' } });
        await expect(req).resolves.toEqual({ stopReason: 'refusal' });
        client.dispose();
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

describe('AcpClient WorkBuddy hosted transport', () => {
    const startHost = jest.requireMock('../src/providers/codebuddy/workbuddySidecar').startWorkbuddySidecar as jest.Mock;
    const connect = jest.requireMock('../src/providers/codebuddy/workbuddyHost').WorkbuddyHostConnection.connect as jest.Mock;

    beforeEach(() => { startHost.mockReset(); connect.mockReset(); });

    function hostTransport() {
        let receive: (message: Record<string, unknown>) => void;
        let disconnected: (error: Error) => void;
        const runtime = { endpoint: 'http://127.0.0.1:9876', dispose: jest.fn(async () => {}) };
        const connection = {
            send: jest.fn(async (message: Record<string, unknown>) => {
                if (message.method === 'initialize') receive({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } });
            }),
            dispose: jest.fn(async () => {}),
        };
        startHost.mockResolvedValue(runtime);
        connect.mockImplementation(async (_url, onMessage, onDisconnect) => {
            receive = onMessage;
            disconnected = onDisconnect;
            return connection;
        });
        return { runtime, connection, receive: (message: Record<string, unknown>) => receive(message), disconnect: (error: Error) => disconnected(error) };
    }

    it('starts a dedicated Vault worker and uses the original ACP dispatch for replies and permissions', async () => {
        const host = hostTransport();
        const { client, events } = makeClient();
        await client.ensureStarted('/vault');
        expect(startHost).toHaveBeenCalledWith('C:\\fake\\codebuddy.exe', '/vault', 'C:\\fake\\codebuddy.exe', ['--serve'], expect.any(AbortSignal));
        expect(mockedSpawn).not.toHaveBeenCalled();
        const request = client.request('session/new', { cwd: '/vault', mcpServers: [] });
        const sent = host.connection.send.mock.calls.at(-1)![0];
        host.receive({ jsonrpc: '2.0', id: sent.id, result: { sessionId: 'own-session' } });
        await expect(request).resolves.toEqual({ sessionId: 'own-session' });
        host.receive({ jsonrpc: '2.0', id: 99, method: 'session/request_permission', params: { sessionId: 'own-session' } });
        expect(events.onPermissionRequest).toHaveBeenCalledWith(99, { sessionId: 'own-session' });
        client.respond(99, { outcome: { outcome: 'cancelled' } });
        expect(host.connection.send).toHaveBeenLastCalledWith({ jsonrpc: '2.0', id: 99, result: { outcome: { outcome: 'cancelled' } } });
        client.dispose();
        await Promise.resolve();
        expect(host.connection.dispose).toHaveBeenCalledTimes(1);
        expect(host.runtime.dispose).toHaveBeenCalledTimes(1);
    });

    it('marks sessions stale on disconnect and ignores late events from a disposed connection', async () => {
        const host = hostTransport();
        const { client, events } = makeClient();
        await client.ensureStarted('/vault');
        const request = client.request('session/new', { cwd: '/vault' });
        const assertion = expect(request).rejects.toThrow('connection lost');
        host.disconnect(new Error('connection lost'));
        await assertion;
        expect(client.running).toBe(false);
        expect(events.onExit).toHaveBeenCalledTimes(1);
        host.receive({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'old', update: { sessionUpdate: 'agent_message_chunk' } } });
        expect(events.onSessionUpdate).not.toHaveBeenCalled();
        client.dispose();
    });

    it('fails an in-flight prompt without resending it and ignores old events after recovery', async () => {
        const oldHost = hostTransport();
        const { client, events } = makeClient();
        await client.ensureStarted('/vault');
        const prompt = client.request('session/prompt', { sessionId: 'own-session', prompt: [{ type: 'text', text: 'once only' }] });
        const failure = expect(prompt).rejects.toThrow('connection lost');
        await Promise.resolve();
        expect(oldHost.connection.send.mock.calls.filter(([message]) => message.method === 'session/prompt')).toHaveLength(1);
        oldHost.disconnect(new Error('connection lost'));
        await failure;

        const recoveredHost = hostTransport();
        await client.ensureStarted('/vault');
        oldHost.receive({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'own-session', update: { sessionUpdate: 'agent_message_chunk' } } });
        oldHost.receive({ jsonrpc: '2.0', id: 99, method: 'session/request_permission', params: { sessionId: 'own-session' } });
        oldHost.disconnect(new Error('late old disconnect'));
        expect(events.onSessionUpdate).not.toHaveBeenCalled();
        expect(events.onPermissionRequest).not.toHaveBeenCalled();
        expect(events.onExit).toHaveBeenCalledTimes(1);
        expect(client.running).toBe(true);
        expect(recoveredHost.connection.send.mock.calls.filter(([message]) => message.method === 'session/prompt')).toHaveLength(0);
        const update = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'current' } };
        recoveredHost.receive({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'own-session', update } });
        expect(events.onSessionUpdate).toHaveBeenCalledWith('own-session', update);
        client.dispose();
    });

    it('cleans a worker whose startup completes after disposal', async () => {
        const host = hostTransport();
        let finish!: (value: typeof host.runtime) => void;
        startHost.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const { client } = makeClient();
        const starting = client.ensureStarted('/vault');
        const assertion = expect(starting).rejects.toThrow('disposed');
        client.dispose();
        finish(host.runtime);
        await assertion;
        expect(connect).not.toHaveBeenCalled();
        expect(host.runtime.dispose).toHaveBeenCalledTimes(1);
    });

    it('waits for cancelled startup cleanup before creating a replacement worker', async () => {
        const host = hostTransport();
        let finishStartup!: (value: typeof host.runtime) => void;
        let finishCleanup!: () => void;
        startHost.mockImplementationOnce(() => new Promise(resolve => { finishStartup = resolve; }));
        host.runtime.dispose.mockImplementationOnce(() => new Promise<void>(resolve => { finishCleanup = resolve; }));
        const { client } = makeClient();
        const starting = client.ensureStarted('/vault');
        const cancelled = expect(starting).rejects.toThrow('disposed');
        client.dispose();
        const restarting = client.ensureStarted('/vault');
        finishStartup(host.runtime);
        await new Promise(resolve => setImmediate(resolve));
        const creationsBeforeCleanup = startHost.mock.calls.length;
        finishCleanup();
        await cancelled;
        await restarting;
        client.dispose();
        expect(creationsBeforeCleanup).toBe(1);
        expect(startHost).toHaveBeenCalledTimes(2);
    });

    it('retains a failed startup cleanup callback until its old worker is confirmed gone', async () => {
        hostTransport();
        const cleanup = jest.fn(async () => {}).mockRejectedValueOnce(new Error('old worker is still alive'));
        startHost.mockRejectedValueOnce(Object.assign(new Error('startup cleanup failed'), { workbuddyCleanup: cleanup }));
        const { client } = makeClient();
        await expect(client.ensureStarted('/vault')).rejects.toThrow('startup cleanup failed');
        await expect(client.ensureStarted('/vault')).rejects.toThrow('old worker is still alive');
        expect(startHost).toHaveBeenCalledTimes(1);
        await client.ensureStarted('/vault');
        expect(cleanup).toHaveBeenCalledTimes(2);
        expect(startHost).toHaveBeenCalledTimes(2);
        client.dispose();
    });

    it('retains the cleanup barrier when a cancelled startup returns a worker that cannot be cleaned', async () => {
        const host = hostTransport();
        let finish!: (value: typeof host.runtime) => void;
        startHost.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        host.runtime.dispose.mockRejectedValueOnce(new Error('late worker cleanup failed'));
        host.runtime.dispose.mockRejectedValueOnce(new Error('late worker is still alive'));
        const { client } = makeClient();
        const starting = client.ensureStarted('/vault');
        const cancelled = expect(starting).rejects.toThrow('late worker cleanup failed');
        client.dispose();
        finish(host.runtime);
        await cancelled;
        await expect(client.ensureStarted('/vault')).rejects.toThrow('late worker is still alive');
        expect(startHost).toHaveBeenCalledTimes(1);
        await client.ensureStarted('/vault');
        expect(host.runtime.dispose).toHaveBeenCalledTimes(3);
        expect(startHost).toHaveBeenCalledTimes(2);
        client.dispose();
    });

    it('keeps the original pending startup barrier when a waiting restart is cancelled again', async () => {
        const host = hostTransport();
        let finishStartup!: (value: typeof host.runtime) => void;
        let finishCleanup!: () => void;
        startHost.mockImplementationOnce(() => new Promise(resolve => { finishStartup = resolve; }));
        host.runtime.dispose.mockImplementationOnce(() => new Promise<void>(resolve => { finishCleanup = resolve; }));
        const { client } = makeClient();
        const starting = client.ensureStarted('/vault');
        const cancelled = expect(starting).rejects.toThrow('disposed');
        client.dispose();
        const waiting = client.ensureStarted('/vault');
        const waitingCancelled = expect(waiting).rejects.toThrow('disposed');
        client.dispose();
        const restarting = client.ensureStarted('/vault');
        finishStartup(host.runtime);
        await new Promise(resolve => setImmediate(resolve));
        expect(startHost).toHaveBeenCalledTimes(1);
        finishCleanup();
        await cancelled;
        await waitingCancelled;
        await restarting;
        expect(startHost).toHaveBeenCalledTimes(2);
        client.dispose();
    });

    it('waits for the old worker to exit even if HTTP disposal fails first', async () => {
        const host = hostTransport();
        const { client } = makeClient();
        await client.ensureStarted('/vault');
        let finish!: () => void;
        host.connection.dispose.mockRejectedValueOnce(new Error('HTTP already closed'));
        host.runtime.dispose.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        client.dispose();
        const restart = client.ensureStarted('/vault');
        await Promise.resolve();
        await Promise.resolve();
        expect(startHost).toHaveBeenCalledTimes(1);
        finish();
        await restart;
        expect(startHost).toHaveBeenCalledTimes(2);
        client.dispose();
    });

    it('rechecks the old worker cleanup before restarting after a cleanup failure', async () => {
        const host = hostTransport();
        const { client } = makeClient();
        await client.ensureStarted('/vault');
        host.runtime.dispose.mockRejectedValueOnce(new Error('own worker cleanup could not be confirmed'));
        client.dispose();
        await expect(client.ensureStarted('/vault')).resolves.toBeUndefined();
        expect(host.runtime.dispose).toHaveBeenCalledTimes(2);
        expect(startHost).toHaveBeenCalledTimes(2);
        client.dispose();
    });

    it('keeps the old worker cleanup barrier when repeated rechecks still fail', async () => {
        const host = hostTransport();
        const { client } = makeClient();
        await client.ensureStarted('/vault');
        host.runtime.dispose.mockRejectedValueOnce(new Error('initial cleanup failure'));
        host.runtime.dispose.mockRejectedValueOnce(new Error('old worker is still alive'));
        host.runtime.dispose.mockRejectedValueOnce(new Error('old worker cannot be verified'));
        client.dispose();
        await expect(client.ensureStarted('/vault')).rejects.toThrow('old worker is still alive');
        await expect(client.ensureStarted('/vault')).rejects.toThrow('old worker cannot be verified');
        expect(host.runtime.dispose).toHaveBeenCalledTimes(3);
        expect(startHost).toHaveBeenCalledTimes(1);
        expect(client.running).toBe(false);
    });

    it('waits for a cleanup recheck to complete before a single same-Vault restart', async () => {
        const host = hostTransport();
        const { client } = makeClient();
        await client.ensureStarted('/vault');
        let finish!: () => void;
        host.runtime.dispose.mockRejectedValueOnce(new Error('initial cleanup failure'));
        host.runtime.dispose.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        client.dispose();
        const restarting = client.ensureStarted('/vault');
        expect(client.ensureStarted('/vault')).toBe(restarting);
        await new Promise(resolve => setImmediate(resolve));
        expect(host.runtime.dispose).toHaveBeenCalledTimes(2);
        expect(startHost).toHaveBeenCalledTimes(1);
        finish();
        await restarting;
        expect(startHost).toHaveBeenCalledTimes(2);
        client.dispose();
    });

    it('deduplicates startup and rejects a different Vault for a bound worker', async () => {
        const host = hostTransport();
        const { client } = makeClient();
        await Promise.all([client.ensureStarted('/vault'), client.ensureStarted('/vault')]);
        expect(startHost).toHaveBeenCalledTimes(1);
        await expect(client.ensureStarted('/another-vault')).rejects.toThrow('different Vault');
        expect(host.runtime.dispose).not.toHaveBeenCalled();
        client.notify('session/cancel', { sessionId: 'own-session' });
        expect(host.connection.send).toHaveBeenLastCalledWith({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'own-session' } });
        client.dispose();
    });

    it('rejects a different Vault while the same-Vault worker startup is still pending', async () => {
        const host = hostTransport();
        let finish!: (value: typeof host.runtime) => void;
        startHost.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const { client } = makeClient();
        const starting = client.ensureStarted('/vault');
        expect(client.ensureStarted('/vault')).toBe(starting);
        const other = client.ensureStarted('/another-vault');
        const assertion = expect(other).rejects.toThrow('different Vault');
        finish(host.runtime);
        await starting;
        await assertion;
        expect(startHost).toHaveBeenCalledTimes(1);
        client.dispose();
    });

    it.each(['node', 'agents'])('marks loaded sessions stale when %s configuration restarts a worker', async (setting) => {
        hostTransport();
        const { client, events } = makeClient();
        await client.ensureStarted('/vault');
        if (setting === 'node') client.setNodePath('/another/node');
        else client.setExtraArgs(['--agents', '{}']);
        expect(events.onExit).toHaveBeenCalledTimes(1);
        expect(client.running).toBe(false);
        await client.ensureStarted('/vault');
        expect(startHost).toHaveBeenCalledTimes(2);
        client.dispose();
    });
});
