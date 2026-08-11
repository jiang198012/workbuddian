import {
    AcpSession, SessionRegistry,
    type AcpClientFacade, type ConversationLookup, type TurnHandlers,
} from '../src/providers/codebuddy/acp/session';
import type { PermissionCardData } from '../src/providers/codebuddy/acp/permission';

type FakeClient = AcpClientFacade & {
    request: jest.Mock; notify: jest.Mock; respond: jest.Mock; enqueuePrompt: jest.Mock; rawRequest: jest.Mock;
};

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function makeFakeClient(overrides?: (method: string, params: Record<string, unknown>) => unknown): FakeClient {
    const fake = {
        request: jest.fn(async (method: string, params: Record<string, unknown>) => {
            if (overrides) {
                const r = overrides(method, params);
                if (r !== undefined) return r;
            }
            if (method === 'session/new') return { sessionId: 'acp-new-1' };
            if (method === 'session/load') throw new Error('session not found');
            return {};
        }),
        // 串行队列的测试替身：立即执行（不经队列），rawRequest 转发到 request mock 以套用同一套 stub
        enqueuePrompt: jest.fn(async (fn: () => Promise<unknown>) => fn()),
        rawRequest: jest.fn(),
        notify: jest.fn(),
        respond: jest.fn(),
    };
    fake.rawRequest.mockImplementation((method: string, params: Record<string, unknown>) => fake.request(method, params));
    return fake as unknown as FakeClient;
}

function makeLookup(): ConversationLookup & { getAcpSessionId: jest.Mock; setAcpSessionId: jest.Mock } {
    return { getAcpSessionId: jest.fn(() => undefined), setAcpSessionId: jest.fn() };
}

function makeHandlers(): TurnHandlers & {
    onChunk: jest.Mock; onError: jest.Mock; onPermissionRequest: jest.Mock; onUsage: jest.Mock; onConfigUpdate: jest.Mock;
} {
    return {
        onChunk: jest.fn(), onError: jest.fn(), onPermissionRequest: jest.fn(),
        onUsage: jest.fn(), onConfigUpdate: jest.fn(),
    };
}

const PERMISSION_PARAMS = {
    sessionId: 'acp-stored',
    options: [
        { kind: 'allow_always', name: 'Always Allow', optionId: 'allow_always' },
        { kind: 'allow_once', name: 'Allow', optionId: 'allow' },
        { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
    ],
    toolCall: { toolCallId: 'c1', rawInput: { file_path: 'a.md', content: 'x' }, _meta: { 'codebuddy.ai/toolName': 'Write' } },
};

describe('AcpSession.ensureLoaded', () => {
    it('creates new session and writes back acpSessionId when nothing stored and old-uuid load fails', async () => {
        const client = makeFakeClient();
        const lookup = makeLookup();
        const s = new AcpSession('v1-uuid', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/vault');
        expect(client.request).toHaveBeenCalledWith('session/load', expect.objectContaining({ sessionId: 'v1-uuid', cwd: '/vault' }));
        expect(client.request).toHaveBeenCalledWith('session/new', expect.objectContaining({ cwd: '/vault', mcpServers: [] }));
        expect(s.acpSessionId).toBe('acp-new-1');
        expect(lookup.setAcpSessionId).toHaveBeenCalledWith('v1-uuid', 'acp-new-1');
    });

    it('loads stored acpSessionId directly', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : undefined);
        const lookup = makeLookup();
        lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('v1-uuid', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/vault');
        expect(client.request).toHaveBeenCalledWith('session/load', expect.objectContaining({ sessionId: 'acp-stored' }));
        expect(client.request).not.toHaveBeenCalledWith('session/new', expect.anything());
        expect(s.acpSessionId).toBe('acp-stored');
    });

    it('keeps v1 uuid as acpSessionId when CLI still has that session (v1 --session-id 兼容)', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : undefined);
        const lookup = makeLookup();
        const s = new AcpSession('v1-uuid', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/vault');
        expect(s.acpSessionId).toBe('v1-uuid');
        expect(client.request).not.toHaveBeenCalledWith('session/new', expect.anything());
    });

    it('applies mode/model config after load (set_config_option for model, set_mode for mode)', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : undefined);
        const lookup = makeLookup();
        lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: 'glm-5.2', mode: 'plan' });
        await s.ensureLoaded('/vault');
        expect(client.request).toHaveBeenCalledWith('session/set_config_option',
            expect.objectContaining({ sessionId: 'acp-stored', configId: 'model', value: 'glm-5.2' }));
        expect(client.request).toHaveBeenCalledWith('session/set_mode',
            expect.objectContaining({ sessionId: 'acp-stored', modeId: 'plan' }));
    });

    it('falls back to set_config_option when set_mode is rejected', async () => {
        const client = makeFakeClient((m) => {
            if (m === 'session/load') return {};
            if (m === 'session/set_mode') throw new Error('method not found');
            return undefined;
        });
        const lookup = makeLookup();
        lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: 'plan' });
        await s.ensureLoaded('/vault');
        expect(client.request).toHaveBeenCalledWith('session/set_config_option',
            expect.objectContaining({ configId: 'mode', value: 'plan' }));
    });

    it('skips second load once loaded, but reloads after markStale (进程死亡恢复)', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : undefined);
        const lookup = makeLookup();
        lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/vault');
        const loadCalls = () => client.request.mock.calls.filter((c) => c[0] === 'session/load').length;
        expect(loadCalls()).toBe(1);
        await s.ensureLoaded('/vault');
        expect(loadCalls()).toBe(1);
        s.markStale();
        await s.ensureLoaded('/vault');
        expect(loadCalls()).toBe(2);
        expect(client.request).toHaveBeenLastCalledWith('session/load',
            expect.objectContaining({ sessionId: 'acp-stored' }));
    });
});

describe('AcpSession.prompt + updates', () => {
    async function loadedSession(client: FakeClient) {
        const lookup = makeLookup();
        lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/v');
        return s;
    }

    it('maps updates to chunks during prompting and resolves on end_turn', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const s = await loadedSession(client);
        const handlers = makeHandlers();
        const done = s.prompt('hi', handlers);
        s.handleUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '你好' } });
        s.handleUpdate({ sessionUpdate: 'usage_update', used: 100, size: 168000 });
        await expect(done).resolves.toEqual({ stopReason: 'end_turn' });
        expect(handlers.onChunk).toHaveBeenCalledWith({ type: 'text', content: '你好' });
        expect(handlers.onUsage).toHaveBeenCalledWith(100, 168000);
        expect(s.lastUsage).toEqual({ used: 100, size: 168000 });
        expect(s.status).toBe('idle');
    });

    it('forwards config updates to onConfigUpdate', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const s = await loadedSession(client);
        const handlers = makeHandlers();
        const done = s.prompt('hi', handlers);
        s.handleUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' });
        await done;
        expect(handlers.onConfigUpdate).toHaveBeenCalledWith({ mode: 'plan' });
    });

    it('replaces rawInput snapshot and emits streaming + completed chunks', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const s = await loadedSession(client);
        const handlers = makeHandlers();
        const done = s.prompt('hi', handlers);
        s.handleUpdate({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Write', rawInput: {}, _meta: { 'codebuddy.ai/toolName': 'Write' } });
        s.handleUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', rawInput: { file_path: 'a.md', content: 'l1' } });
        // 快照语义：后到的更短快照直接替换，不做合并
        s.handleUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', rawInput: { file_path: 'a.md', content: '' } });
        s.handleUpdate({
            sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed',
            rawInput: { file_path: 'a.md', content: 'final' }, _meta: { 'codebuddy.ai/toolName': 'Write' },
        });
        await done;
        const chunks = handlers.onChunk.mock.calls.map((c) => c[0]);
        expect(chunks).toHaveLength(4); // tool_call + 2 流式 + 1 completed
        expect(chunks[0]).toMatchObject({ type: 'tool', toolCallId: 'c1', toolName: 'Write' });
        expect(chunks[1]).toMatchObject({ type: 'tool', toolCallId: 'c1', toolDetail: 'a.md' });
        expect(chunks[3]).toMatchObject({
            type: 'tool', toolCallId: 'c1', toolStatus: 'completed',
            toolDetail: JSON.stringify({ file_path: 'a.md', content: 'final' }),
        });
    });

    it('falls back to cached toolName when update lacks _meta', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const s = await loadedSession(client);
        const handlers = makeHandlers();
        const done = s.prompt('hi', handlers);
        s.handleUpdate({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Write', rawInput: {}, _meta: { 'codebuddy.ai/toolName': 'Write' } });
        s.handleUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', rawInput: { file_path: 'a.md' } }); // 无 _meta
        await done;
        expect(handlers.onChunk).toHaveBeenLastCalledWith(
            expect.objectContaining({ toolCallId: 'c1', toolName: 'Write' }),
        );
    });

    it('keeps the accumulated rawInput snapshot when a later update carries none (WB-003)', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const s = await loadedSession(client);
        const handlers = makeHandlers();
        const done = s.prompt('hi', handlers);
        s.handleUpdate({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Write', rawInput: { file_path: 'a.md', content: 'l1' }, _meta: { 'codebuddy.ai/toolName': 'Write' } });
        // completed 不带 rawInput（CLI 常见形态）：不得冲掉快照，完成态仍要有 diff 数据源
        s.handleUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', _meta: { 'codebuddy.ai/toolName': 'Write' } });
        await done;
        expect(handlers.onChunk).toHaveBeenLastCalledWith(expect.objectContaining({
            toolCallId: 'c1', toolStatus: 'completed',
            toolDetail: JSON.stringify({ file_path: 'a.md', content: 'l1' }),
        }));
    });

    it('hydrates rawInput from the permission request so a rawInput-less completed still diffs (WB-003)', async () => {
        const gate = deferred<{ stopReason: string }>();
        const client = makeFakeClient((m) => {
            if (m === 'session/load') return {};
            if (m === 'session/prompt') return gate.promise as unknown as { stopReason: string };
            return undefined;
        });
        const s = await loadedSession(client);
        const handlers = makeHandlers();
        const done = s.prompt('write a file', handlers);
        // default 模式下批准卡是 rawInput 唯一可靠来源：水合进快照
        s.handlePermissionRequest(0, PERMISSION_PARAMS);
        s.respondPermission(0, 'allow');
        s.handleUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed' }); // 无 rawInput、无 _meta
        gate.resolve({ stopReason: 'end_turn' });
        await done;
        expect(handlers.onChunk).toHaveBeenCalledWith(expect.objectContaining({
            toolCallId: 'c1', toolName: 'Write', toolStatus: 'completed',
            toolDetail: JSON.stringify({ file_path: 'a.md', content: 'x' }),
        }));
    });

    it('handles the exact CLI Write event sequence (in_progress→pending→perm→completed) with full diff data', async () => {
        // acp-probe write-perm 实测序列：两个 tool_call（空→全量）+ 批准 + 无 rawInput 的 completed
        const gate = deferred<{ stopReason: string }>();
        const client = makeFakeClient((m) => {
            if (m === 'session/load') return {};
            if (m === 'session/prompt') return gate.promise as unknown as { stopReason: string };
            return undefined;
        });
        const s = await loadedSession(client);
        const handlers = makeHandlers();
        const done = s.prompt('write', handlers);
        const full = { content: 'ok\n', file_path: '/v/probe-write.md' };
        s.handleUpdate({ sessionUpdate: 'tool_call', toolCallId: 'call_1', status: 'in_progress', rawInput: {}, _meta: { 'codebuddy.ai/toolName': 'Write' } });
        s.handleUpdate({ sessionUpdate: 'tool_call', toolCallId: 'call_1', status: 'pending', rawInput: full, _meta: { 'codebuddy.ai/toolName': 'Write' } });
        s.handlePermissionRequest(0, {
            sessionId: 'acp-stored', options: [{ kind: 'allow_once', name: 'Allow', optionId: 'allow' }],
            toolCall: { toolCallId: 'call_1', rawInput: full, _meta: { 'codebuddy.ai/toolName': 'Write' } },
        });
        s.respondPermission(0, 'allow');
        s.handleUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'completed' });
        gate.resolve({ stopReason: 'end_turn' });
        await done;
        const chunks = handlers.onChunk.mock.calls.map((c) => c[0]);
        const completed = chunks.find((c) => c.toolStatus === 'completed');
        expect(completed).toMatchObject({ toolName: 'Write', toolDetail: JSON.stringify(full) });
    });

    it('routes text chunks during an Agent call window into the row output, not the main stream (WB-RT-007)', async () => {
        const gate = deferred<{ stopReason: string }>();
        const client = makeFakeClient((m) => {
            if (m === 'session/load') return {};
            if (m === 'session/prompt') return gate.promise as unknown as { stopReason: string };
            return undefined;
        });
        const s = await loadedSession(client);
        const handlers = makeHandlers();
        const done = s.prompt('use reviewer', handlers);
        s.handleUpdate({ sessionUpdate: 'tool_call', toolCallId: 'a1', title: 'Agent', rawInput: {}, _meta: { 'codebuddy.ai/toolName': 'Agent' } });
        // 窗口内：子代理中继增量 + 全量重复（后者应被 appendTextChunk 去重）
        s.handleUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '审查结论：这段代码存在三个需要修复的问题，分别是空指针、越界与资源泄漏。' } });
        s.handleUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '审查结论：这段代码存在三个需要修复的问题，分别是空指针、越界与资源泄漏。' } });
        s.handleUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'a1', status: 'completed' });
        // 窗口外：主代理总结正常进正文
        s.handleUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'reviewer 的审查结果：…' } });
        gate.resolve({ stopReason: 'end_turn' });
        await done;
        const chunks = handlers.onChunk.mock.calls.map((c) => c[0]);
        const textChunks = chunks.filter((c) => c.type === 'text');
        expect(textChunks).toHaveLength(1); // 中继两口都没进正文
        expect(textChunks[0].content).toBe('reviewer 的审查结果：…');
        const completed = chunks.find((c) => c.toolStatus === 'completed');
        expect(completed.toolOutput).toBe('审查结论：这段代码存在三个需要修复的问题，分别是空指针、越界与资源泄漏。');
    });

    it('drops replay-flagged updates during prompting', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const s = await loadedSession(client);
        const handlers = makeHandlers();
        const done = s.prompt('hi', handlers);
        s.handleUpdate({
            sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'old' },
            _meta: { 'codebuddy.ai': { mode: 'history', offset: 0 } },
        });
        await done;
        expect(handlers.onChunk).not.toHaveBeenCalled();
    });

    it('rejects a second prompt while busy', async () => {
        const gate = deferred<{ stopReason: string }>();
        const client = makeFakeClient((m) => {
            if (m === 'session/load') return {};
            if (m === 'session/prompt') return gate.promise as unknown as { stopReason: string };
            return undefined;
        });
        const s = await loadedSession(client);
        const handlers = makeHandlers();
        const first = s.prompt('hi', handlers);
        await expect(s.prompt('again', handlers)).rejects.toThrow('session busy');
        gate.resolve({ stopReason: 'end_turn' });
        await first;
    });

    it('re-activates via session/load before prompt when another session was loaded since (WB-RT-001/005)', async () => {
        let newCount = 0;
        const client = makeFakeClient((m, params) => {
            if (m === 'session/new') return { sessionId: `acp-${++newCount}` };
            // 幽灵 uuid 首次 load 失败走 new；已分配 id 的再激活 load 成功
            if (m === 'session/load' && String(params.sessionId).startsWith('acp-')) return {};
            if (m === 'session/load') throw new Error('not found');
            if (m === 'session/prompt') return { stopReason: 'end_turn' };
            return undefined;
        });
        const registry = new SessionRegistry(client, makeLookup(), { model: '', mode: '' });
        const a = registry.get('a');
        const b = registry.get('b');
        await a.ensureLoaded('/v'); // acp-1，activation=acp-1
        await b.ensureLoaded('/v'); // acp-2，activation=acp-2（CLI 活动会话切走）
        await a.prompt('hi', makeHandlers()); // 活动会话不是 a：须先重发 session/load(acp-1)
        const calls = () => client.request.mock.calls.map((c) => `${c[0]}:${String((c[1] as { sessionId?: unknown }).sessionId)}`);
        const reactivateIdx = calls().lastIndexOf('session/load:acp-1');
        const promptIdx = calls().findIndex((c) => c === 'session/prompt:acp-1');
        expect(reactivateIdx).toBeGreaterThan(-1);
        expect(reactivateIdx).toBeLessThan(promptIdx);
        await b.prompt('hi', makeHandlers()); // 又切回 b
        expect(calls().lastIndexOf('session/load:acp-2')).toBeGreaterThan(calls().findIndex((c) => c === 'session/prompt:acp-1'));
    });

    it('does not re-load when the session is still the active one', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const s = await loadedSession(client);
        await s.prompt('one', makeHandlers());
        await s.prompt('two', makeHandlers());
        expect(client.request.mock.calls.filter((c) => c[0] === 'session/load')).toHaveLength(1); // 仅 ensureLoaded 那次
    });
});

describe('AcpSession replay swallow (loading guard)', () => {
    it('swallows updates while status is loading', async () => {
        const gate = deferred<Record<string, never>>();
        const client = makeFakeClient((m) => {
            if (m === 'session/load') return gate.promise as unknown as Record<string, never>;
            return undefined;
        });
        const lookup = makeLookup();
        lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: '' });
        const handlers = makeHandlers();
        const loading = s.ensureLoaded('/v');
        expect(s.status).toBe('loading');
        // 强行挂 handlers 以隔离验证 status 守卫本身（正常流程 loading 时无 handlers）
        (s as unknown as { handlers: TurnHandlers }).handlers = handlers;
        s.handleUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'replay' } });
        expect(handlers.onChunk).not.toHaveBeenCalled();
        gate.resolve({});
        await loading;
        expect(s.status).toBe('idle');
    });
});

describe('AcpSession permission', () => {
    async function promptingSession(client: FakeClient, gate: ReturnType<typeof deferred<{ stopReason: string }>>) {
        const lookup = makeLookup();
        lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/v');
        return s;
    }

    it('parks permission request, forwards card data, responds on respondPermission', async () => {
        const gate = deferred<{ stopReason: string }>();
        const client = makeFakeClient((m) => {
            if (m === 'session/load') return {};
            if (m === 'session/prompt') return gate.promise as unknown as { stopReason: string };
            return undefined;
        });
        const s = await promptingSession(client, gate);
        const handlers = makeHandlers();
        const turn = s.prompt('write a file', handlers);
        s.handlePermissionRequest(0, PERMISSION_PARAMS);
        expect(s.status).toBe('awaitingPermission');
        const data = handlers.onPermissionRequest.mock.calls[0][0] as PermissionCardData;
        expect(data).toMatchObject({ requestId: 0, toolName: 'Write', isPlanApproval: false });
        expect(s.hasPendingPermission(0)).toBe(true);

        expect(s.respondPermission(0, 'allow')).toBe(true);
        expect(client.respond).toHaveBeenCalledWith(0, { outcome: { outcome: 'selected', optionId: 'allow' } });
        expect(s.status).toBe('prompting');
        expect(s.respondPermission(0, 'allow')).toBe(false); // 重复应答无效

        gate.resolve({ stopReason: 'end_turn' });
        await turn;
    });

    it('auto-rejects when no handler registered', async () => {
        const gate = deferred<{ stopReason: string }>();
        const client = makeFakeClient((m) => {
            if (m === 'session/load') return {};
            if (m === 'session/prompt') return gate.promise as unknown as { stopReason: string };
            return undefined;
        });
        const s = await promptingSession(client, gate);
        const turn = s.prompt('write', { onChunk: jest.fn(), onError: jest.fn() });
        s.handlePermissionRequest(0, PERMISSION_PARAMS);
        expect(client.respond).toHaveBeenCalledWith(0, { outcome: { outcome: 'selected', optionId: 'reject' } });
        expect(s.hasPendingPermission(0)).toBe(false);
        gate.resolve({ stopReason: 'end_turn' });
        await turn;
    });

    it('rejectPendingPermissions answers reject for all parked requests', async () => {
        const gate = deferred<{ stopReason: string }>();
        const client = makeFakeClient((m) => {
            if (m === 'session/load') return {};
            if (m === 'session/prompt') return gate.promise as unknown as { stopReason: string };
            return undefined;
        });
        const s = await promptingSession(client, gate);
        const handlers = makeHandlers();
        const turn = s.prompt('write', handlers);
        s.handlePermissionRequest(0, PERMISSION_PARAMS);
        s.handlePermissionRequest(1, { ...PERMISSION_PARAMS, toolCall: { ...PERMISSION_PARAMS.toolCall, toolCallId: 'c2' } });
        s.rejectPendingPermissions();
        expect(client.respond).toHaveBeenCalledWith(0, { outcome: { outcome: 'selected', optionId: 'reject' } });
        expect(client.respond).toHaveBeenCalledWith(1, { outcome: { outcome: 'selected', optionId: 'reject' } });
        expect(s.hasPendingPermission(0)).toBe(false);
        gate.resolve({ stopReason: 'end_turn' });
        await turn;
    });
});

describe('AcpSession cancel & failure', () => {
    it('cancelTurn notifies session/cancel and status stays prompting until cancelled result lands (spike 瑕疵⑤)', async () => {
        const gate = deferred<{ stopReason: string }>();
        const client = makeFakeClient((m) => {
            if (m === 'session/load') return {};
            if (m === 'session/prompt') return gate.promise as unknown as { stopReason: string };
            return undefined;
        });
        const lookup = makeLookup();
        lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/v');
        const handlers = makeHandlers();
        const turn = s.prompt('long work', handlers);
        await s.cancelTurn();
        expect(client.notify).toHaveBeenCalledWith('session/cancel', { sessionId: 'acp-stored' });
        expect(s.status).toBe('prompting'); // 未落账不回 idle
        gate.resolve({ stopReason: 'cancelled' });
        await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
        expect(s.status).toBe('idle');
    });

    it('cancelTurn rejects parked permission before notifying', async () => {
        const gate = deferred<{ stopReason: string }>();
        const client = makeFakeClient((m) => {
            if (m === 'session/load') return {};
            if (m === 'session/prompt') return gate.promise as unknown as { stopReason: string };
            return undefined;
        });
        const lookup = makeLookup();
        lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/v');
        const handlers = makeHandlers();
        const turn = s.prompt('work', handlers);
        s.handlePermissionRequest(0, PERMISSION_PARAMS);
        await s.cancelTurn();
        expect(client.respond).toHaveBeenCalledWith(0, { outcome: { outcome: 'selected', optionId: 'reject' } });
        gate.resolve({ stopReason: 'cancelled' });
        await turn;
    });

    it('skips a prompt cancelled while still queued, freeing the slot immediately (标题轮被用户消息抢占)', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : undefined);
        // enqueuePrompt 挂起闭包，模拟"还在排队"
        let release!: () => void;
        const hold = new Promise<void>((r) => { release = r; });
        client.enqueuePrompt.mockImplementation(async (fn: () => Promise<unknown>) => { await hold; return fn(); });
        const lookup = makeLookup();
        lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/v');
        const turn = s.prompt('title task', makeHandlers());
        await s.cancelTurn();
        expect(client.notify).toHaveBeenCalledWith('session/cancel', { sessionId: 'acp-stored' });
        release();
        await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
        expect(client.rawRequest).not.toHaveBeenCalled(); // 到队首直接作废，未占 CLI
        expect(s.status).toBe('idle');
        // 旗标已在 finally 清除：下一轮正常执行
        await s.prompt('next', makeHandlers());
        expect(client.rawRequest).toHaveBeenCalledWith('session/prompt', expect.objectContaining({ sessionId: 'acp-stored' }));
    });

    it('failTurn pushes error to the active turn', async () => {
        const gate = deferred<{ stopReason: string }>();
        const client = makeFakeClient((m) => {
            if (m === 'session/load') return {};
            if (m === 'session/prompt') return gate.promise as unknown as { stopReason: string };
            return undefined;
        });
        const lookup = makeLookup();
        lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/v');
        const handlers = makeHandlers();
        const turn = s.prompt('work', handlers);
        s.failTurn('process died');
        expect(handlers.onError).toHaveBeenCalledWith('process died');
        gate.resolve({ stopReason: 'cancelled' });
        await turn;
    });
});

describe('SessionRegistry', () => {
    it('get creates once, find/byAcpId route correctly, all lists sessions', async () => {
        const client = makeFakeClient();
        const lookup = makeLookup();
        const registry = new SessionRegistry(client, lookup, { model: '', mode: '' });
        const a1 = registry.get('a');
        expect(registry.get('a')).toBe(a1);
        expect(registry.find('a')).toBe(a1);
        expect(registry.find('missing')).toBeUndefined();
        expect(registry.byAcpId('acp-new-1')).toBeUndefined();
        await a1.ensureLoaded('/v');
        expect(registry.byAcpId('acp-new-1')).toBe(a1);
        expect(registry.all()).toEqual([a1]);
    });
});

describe('AcpSession.fork', () => {
    it('sends /branch prompt and returns the captured newSessionId', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const lookup = makeLookup(); lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/v');
        const forked = s.fork('分叉 - 测试');
        // fork 轮期间到达的 newSessionId（handlers 丢弃 chunks，但 fork id 必须捕获）
        s.handleUpdate({ sessionUpdate: 'session_info_update', _meta: { 'codebuddy.ai/sessionReset': true, 'codebuddy.ai/newSessionId': 'acp-forked-1' } });
        // fork 轮的普通 chunk 不得外泄
        s.handleUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'branch ok' } });
        await expect(forked).resolves.toBe('acp-forked-1');
        const promptCall = client.request.mock.calls.find((c) => c[0] === 'session/prompt');
        expect(promptCall![1]).toMatchObject({ sessionId: 'acp-stored', prompt: [{ type: 'text', text: '/branch 分叉 - 测试' }] });
        expect(s.status).toBe('idle');
    });

    it('rejects when not loaded', async () => {
        const client = makeFakeClient();
        const s = new AcpSession('k', client, makeLookup(), { model: '', mode: '' });
        await expect(s.fork('x')).rejects.toThrow('session not loaded');
    });

    it('throws fork failed when no newSessionId arrives', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const lookup = makeLookup(); lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/v');
        await expect(s.fork('x')).rejects.toThrow('fork failed: no session_info_update');
    });

    it('distinguishes timeout from missing report and resets forkPending (WB-004)', async () => {
        jest.useFakeTimers();
        try {
            const gate = deferred<{ stopReason: string }>();
            const client = makeFakeClient((m) => {
                if (m === 'session/load') return {};
                if (m === 'session/prompt') return gate.promise as unknown as { stopReason: string };
                return undefined;
            });
            const lookup = makeLookup(); lookup.getAcpSessionId.mockReturnValue('acp-stored');
            const s = new AcpSession('k', client, lookup, { model: '', mode: '' });
            await s.ensureLoaded('/v');
            const forked = s.fork('x');
            expect(s.forkPending).toBe(true);
            const assertion = expect(forked).rejects.toThrow('fork failed: fork timeout');
            await jest.advanceTimersByTimeAsync(60_000);
            await assertion;
            expect(s.forkPending).toBe(false);
            gate.resolve({ stopReason: 'end_turn' }); // 收尾，防悬挂 promise 告警
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('AcpSession mcpServers injection', () => {
    it('passes config.mcpServers to session/new and session/load', async () => {
        const servers = [{ name: 'fake', command: 'node', args: ['s.mjs'] }];
        const client = makeFakeClient();
        const lookup = makeLookup();
        const s = new AcpSession('k', client, lookup, { model: '', mode: '', mcpServers: servers });
        await s.ensureLoaded('/vault');
        expect(client.request).toHaveBeenCalledWith('session/load', expect.objectContaining({ mcpServers: servers }));
        expect(client.request).toHaveBeenCalledWith('session/new', expect.objectContaining({ mcpServers: servers }));
    });
    it('defaults to empty array when config omits mcpServers', async () => {
        const client = makeFakeClient();
        const s = new AcpSession('k', client, makeLookup(), { model: '', mode: '' });
        await s.ensureLoaded('/vault');
        expect(client.request).toHaveBeenCalledWith('session/new', expect.objectContaining({ mcpServers: [] }));
    });
});

describe('AcpSession.prompt images', () => {
    it('prepends image blocks before the text block', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const lookup = makeLookup(); lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/v');
        await s.prompt('看图说话', { onChunk: jest.fn(), onError: jest.fn() }, [{ data: 'YmFzZTY0', mimeType: 'image/png' }]);
        const call = client.request.mock.calls.find((c) => c[0] === 'session/prompt');
        expect(call![1].prompt).toEqual([
            { type: 'image', data: 'YmFzZTY0', mimeType: 'image/png' },
            { type: 'text', text: '看图说话' },
        ]);
    });
    it('omits image blocks when no images given', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const lookup = makeLookup(); lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/v');
        await s.prompt('纯文本', { onChunk: jest.fn(), onError: jest.fn() });
        const call = client.request.mock.calls.find((c) => c[0] === 'session/prompt');
        expect(call![1].prompt).toEqual([{ type: 'text', text: '纯文本' }]);
    });

    it('bypassPermissions auto-approves permission requests (allow_always, no card)', async () => {
        // WB-R2-001：完全访问仍弹 Write/Edit 批准卡。bypass 模式应自动 allow_always，不弹卡。
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const lookup = makeLookup(); lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: 'bypassPermissions' });
        await s.ensureLoaded('/v');
        const handlers = makeHandlers();
        const done = s.prompt('write file', handlers);
        s.handlePermissionRequest(0, {
            sessionId: 'acp-stored',
            options: [
                { kind: 'allow_always', name: 'Always Allow', optionId: 'allow_always' },
                { kind: 'reject', name: 'Reject', optionId: 'reject' },
            ],
            toolCall: { toolCallId: 'c1', rawInput: { file_path: 'a.md', content: 'x' } },
        });
        // 不弹卡:onPermissionRequest 不被调用
        expect(handlers.onPermissionRequest).not.toHaveBeenCalled();
        // 自动应答 allow_always
        const respond = client.respond.mock.calls.find((c) => c[0] === 0);
        expect(respond).toBeTruthy();
        expect(respond![1]).toEqual({ outcome: { outcome: 'selected', optionId: 'allow_always' } });
        // 状态不进入 awaitingPermission
        expect(s.status).not.toBe('awaitingPermission');
        // rawInput 快照仍采集(diff 数据不丢)
        await done; // prompt 正常结束
    });

    it('bypassPermissions falls back to allow_once when no allow_always option', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const lookup = makeLookup(); lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: 'bypassPermissions' });
        await s.ensureLoaded('/v');
        const handlers = makeHandlers();
        void s.prompt('bash', handlers);
        s.handlePermissionRequest(0, {
            sessionId: 'acp-stored',
            options: [{ kind: 'allow_once', name: 'Allow', optionId: 'allow' }, { kind: 'reject', name: 'Reject', optionId: 'reject' }],
        });
        expect(handlers.onPermissionRequest).not.toHaveBeenCalled();
        const respond = client.respond.mock.calls.find((c) => c[0] === 0);
        expect(respond![1]).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    });
});
