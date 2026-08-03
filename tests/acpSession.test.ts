import {
    AcpSession, SessionRegistry,
    type AcpClientFacade, type ConversationLookup, type TurnHandlers,
} from '../src/providers/codebuddy/acp/session';
import type { PermissionCardData } from '../src/providers/codebuddy/acp/permission';

type FakeClient = AcpClientFacade & { request: jest.Mock; notify: jest.Mock; respond: jest.Mock };

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function makeFakeClient(overrides?: (method: string, params: Record<string, unknown>) => unknown): FakeClient {
    return {
        request: jest.fn(async (method: string, params: Record<string, unknown>) => {
            if (overrides) {
                const r = overrides(method, params);
                if (r !== undefined) return r;
            }
            if (method === 'session/new') return { sessionId: 'acp-new-1' };
            if (method === 'session/load') throw new Error('session not found');
            return {};
        }),
        notify: jest.fn(),
        respond: jest.fn(),
    } as FakeClient;
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

    it('accumulates tool_call_update rawInput without emitting chunks', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const s = await loadedSession(client);
        const handlers = makeHandlers();
        const done = s.prompt('hi', handlers);
        s.handleUpdate({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Write', rawInput: {}, _meta: { 'codebuddy.ai/toolName': 'Write' } });
        s.handleUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', rawInput: { file_path: 'a.md' } });
        await done;
        expect(handlers.onChunk).toHaveBeenCalledTimes(1);
        expect(handlers.onChunk).toHaveBeenCalledWith({ type: 'tool', content: '', toolName: 'Write', toolDetail: '' });
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
