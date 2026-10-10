import { CodebuddyProvider } from '../src/providers/codebuddy';
import { AcpClient, AcpStartError } from '../src/providers/acp/client';
import type { PermissionCardData } from '../src/providers/acp/permission';
import { t } from '../src/i18n';
import { getLogs, clearLogs } from '../src/shared/logBuffer';
import { makeFakeClient, deferred, flush, consume, PERMISSION_PARAMS } from './helpers/fakeAcpClient';

jest.mock('../src/providers/acp/client', () => {
    const actual = jest.requireActual('../src/providers/acp/client');
    return { ...actual, AcpClient: jest.fn() };
});
const MockAcpClient = AcpClient as jest.MockedClass<typeof AcpClient>;

beforeEach(() => { MockAcpClient.mockReset(); });

/** prompt 挂起、session/new 固定回 acp-1 的 fake 配置 */
function hangPrompt(kit: ReturnType<typeof makeFakeClient>) {
    const promptGate = deferred<{ stopReason: string }>();
    kit.fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
        if (method === 'session/prompt') return promptGate.promise;
        if (method === 'session/new') return { sessionId: 'acp-1' };
        if (method === 'session/load') throw new Error('not found');
        return {};
    });
    return promptGate;
}

describe('provider side channels', () => {
    it('forwards permission requests to the registered callback with card data', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const promptGate = hangPrompt(kit);
        const api = new CodebuddyProvider();
        const cards: PermissionCardData[] = [];
        api.onPermissionRequest('s1', (data) => cards.push(data));
        const streaming = consume(api.sendMessage('s1', 'write', '/v'));
        await flush();
        expect(kit.fake.ensureStarted).toHaveBeenCalledWith('/v');
        kit.events().onPermissionRequest(0, PERMISSION_PARAMS);
        expect(cards).toHaveLength(1);
        expect(cards[0]).toMatchObject({ requestId: 0, toolName: 'Write', isPlanApproval: false });
        promptGate.resolve({ stopReason: 'end_turn' });
        await streaming;
    });

    it('respondPermission answers the agent through the owning session', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const promptGate = hangPrompt(kit);
        const api = new CodebuddyProvider();
        api.onPermissionRequest('s1', () => {});
        const streaming = consume(api.sendMessage('s1', 'write', '/v'));
        await flush();
        kit.events().onPermissionRequest(0, PERMISSION_PARAMS);
        api.respondPermission(0, 'allow');
        expect(kit.fake.respond).toHaveBeenCalledWith(0, { outcome: { outcome: 'selected', optionId: 'allow' } });
        promptGate.resolve({ stopReason: 'end_turn' });
        await streaming;
    });

    it('auto-rejects permission when no callback registered', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const promptGate = hangPrompt(kit);
        const api = new CodebuddyProvider();
        const streaming = consume(api.sendMessage('s1', 'write', '/v'));
        await flush();
        kit.events().onPermissionRequest(0, PERMISSION_PARAMS);
        expect(kit.fake.respond).toHaveBeenCalledWith(0, { outcome: { outcome: 'selected', optionId: 'reject' } });
        promptGate.resolve({ stopReason: 'end_turn' });
        await streaming;
    });

    it('auto-rejects permission for an unknown session id', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const promptGate = hangPrompt(kit);
        const api = new CodebuddyProvider();
        api.onPermissionRequest('s1', () => {});
        const streaming = consume(api.sendMessage('s1', 'write', '/v'));
        await flush();
        kit.events().onPermissionRequest(7, { ...PERMISSION_PARAMS, sessionId: 'acp-ghost' });
        expect(kit.fake.respond).toHaveBeenCalledWith(7, { outcome: { outcome: 'selected', optionId: 'reject' } });
        promptGate.resolve({ stopReason: 'end_turn' });
        await streaming;
    });

    it('rejectPendingPermissions(sessionKey) answers reject only for that session', async () => {
        const kit = makeFakeClient(MockAcpClient);
        let newCount = 0;
        const gates = new Map<string, ReturnType<typeof deferred<{ stopReason: string }>>>();
        kit.fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
            if (method === 'session/prompt') {
                const d = deferred<{ stopReason: string }>();
                gates.set(String(params.sessionId), d);
                return d.promise;
            }
            if (method === 'session/new') return { sessionId: `acp-${++newCount}` };
            if (method === 'session/load') {
                if (String(params.sessionId).startsWith('acp-')) return {}; // 已分配会话的再激活 load（WB-RT-001）放行
                throw new Error('not found');
            }
            return {};
        });
        const api = new CodebuddyProvider();
        api.onPermissionRequest('s1', () => {});
        api.onPermissionRequest('s2', () => {});
        const c1 = consume(api.sendMessage('s1', 'a', '/v'));
        const c2 = consume(api.sendMessage('s2', 'b', '/v'));
        await flush();
        kit.events().onPermissionRequest(0, PERMISSION_PARAMS); // acp-1
        kit.events().onPermissionRequest(1, { ...PERMISSION_PARAMS, sessionId: 'acp-2' });
        api.rejectPendingPermissions('s1');
        expect(kit.fake.respond).toHaveBeenCalledWith(0, { outcome: { outcome: 'selected', optionId: 'reject' } });
        expect(kit.fake.respond).not.toHaveBeenCalledWith(1, expect.anything());
        api.rejectPendingPermissions();
        expect(kit.fake.respond).toHaveBeenCalledWith(1, { outcome: { outcome: 'selected', optionId: 'reject' } });
        gates.get('acp-1')!.resolve({ stopReason: 'end_turn' });
        gates.get('acp-2')!.resolve({ stopReason: 'end_turn' });
        await Promise.all([c1, c2]);
    });

    it('routes usage updates to onUsage and config updates to onConfigUpdate', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const promptGate = hangPrompt(kit);
        const api = new CodebuddyProvider();
        const usages: Array<[number, number]> = [];
        const configs: Array<{ mode?: string; model?: string }> = [];
        api.onUsage('s1', (used, size) => usages.push([used, size]));
        api.onConfigUpdate('s1', (cfg) => configs.push(cfg));
        const streaming = consume(api.sendMessage('s1', 'x', '/v'));
        await flush();
        kit.events().onSessionUpdate('acp-1', { sessionUpdate: 'usage_update', used: 100, size: 168000 });
        kit.events().onSessionUpdate('acp-1', { sessionUpdate: 'current_mode_update', currentModeId: 'plan' });
        kit.events().onSessionUpdate('acp-1', {
            sessionUpdate: 'config_option_update',
            configOptions: [{ id: 'model', currentValue: 'glm-5.2' }],
        });
        expect(usages).toEqual([[100, 168000]]);
        expect(configs).toEqual([{ mode: 'plan' }, { model: 'glm-5.2' }]);
        promptGate.resolve({ stopReason: 'end_turn' });
        await streaming;
    });

    it('forwards out-of-turn config updates instead of dropping them (WB-007 /effort 回流)', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const api = new CodebuddyProvider(); // 默认 fake：prompt 立即 end_turn
        const configs: Array<{ mode?: string; model?: string; thoughtLevel?: string }> = [];
        api.onConfigUpdate('s1', (cfg) => configs.push(cfg));
        await consume(api.sendMessage('s1', 'x', '/v')); // 轮次结束，session handlers 已空
        configs.length = 0;
        kit.events().onSessionUpdate('acp-1', {
            sessionUpdate: 'config_option_update',
            configOptions: [{ id: 'thought_level', currentValue: 'low' }],
        });
        expect(configs).toEqual([{ thoughtLevel: 'low' }]);
    });

    it('routes session_info_update under an unknown id to the session with an in-flight fork (WB-004)', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const branchGate = deferred<{ stopReason: string }>();
        kit.fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
            if (method === 'session/prompt') {
                const blocks = params.prompt as Array<{ type?: string; text?: string }>;
                if (blocks[0]?.text?.startsWith('/branch')) return branchGate.promise;
                return { stopReason: 'end_turn' };
            }
            if (method === 'session/new') return { sessionId: 'acp-1' };
            if (method === 'session/load') {
                if (String(params.sessionId).startsWith('acp-')) return {}; // 已分配会话的再激活 load（WB-RT-001）放行
                throw new Error('not found');
            }
            return {};
        });
        const api = new CodebuddyProvider();
        await consume(api.sendMessage('s1', 'x', '/v')); // s1 加载为 acp-1
        const forked = api.forkSession('s1', '分叉 - 测试', '/v');
        await flush();
        expect(kit.fake.ensureStarted).toHaveBeenLastCalledWith('/v');
        // CLI 把分叉回报挂在新会话 id 下：路由层归给正在 fork 的会话
        kit.events().onSessionUpdate('acp-brand-new', {
            sessionUpdate: 'session_info_update',
            _meta: { 'codebuddy.ai/sessionReset': true, 'codebuddy.ai/newSessionId': 'acp-brand-new' },
        });
        branchGate.resolve({ stopReason: 'end_turn' });
        await expect(forked).resolves.toBe('acp-brand-new');
    });

    it('logs unmatched session updates instead of silently dropping them', async () => {
        const kit = makeFakeClient(MockAcpClient);
        new CodebuddyProvider();
        clearLogs();
        kit.events().onSessionUpdate('acp-ghost', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'x' } });
        expect(getLogs().some((l) => l.includes('无归属会话') && l.includes('acp-ghost'))).toBe(true);
    });

    it('re-routes stream payload tagged to an out-of-turn session to the single in-flight session (WB-RT-001/005)', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const gates = new Map<string, ReturnType<typeof deferred<{ stopReason: string }>>>();
        let newCount = 0;
        const api = new CodebuddyProvider();
        kit.fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
            if (method === 'session/prompt') {
                const sid = String(params.sessionId);
                if (sid === 'acp-1') return { stopReason: 'end_turn' };
                const d = deferred<{ stopReason: string }>();
                gates.set(sid, d);
                return d.promise;
            }
            if (method === 'session/new') return { sessionId: `acp-${++newCount}` };
            if (method === 'session/load') {
                if (String(params.sessionId).startsWith('acp-')) return {}; // 已分配会话的再激活 load（WB-RT-001）放行
                throw new Error('not found');
            }
            return {};
        });
        await consume(api.sendMessage('s1', 'a', '/v')); // s1 → acp-1，结束
        const chunks: Array<{ type: string; content: string }> = [];
        const streaming = (async () => {
            for await (const c of api.sendMessage('s2', 'b', '/v')) chunks.push(c);
        })();
        await flush();
        // CLI 把 s2 的流式事件误标到 acp-1（已空闲）：应纠偏归给在飞的 s2
        kit.events().onSessionUpdate('acp-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '误标文本' } });
        await flush(); // chunk 经生成器队列异步落入 chunks
        expect(chunks.some((c) => c.type === 'text' && c.content === '误标文本')).toBe(true);
        gates.get('acp-2')!.resolve({ stopReason: 'end_turn' });
        await streaming;
    });

    it('restarts the CLI process after a zero-chunk end_turn (CLI 状态机卡死自愈)', async () => {
        const kit = makeFakeClient(MockAcpClient);
        // 默认 fake：prompt 立即 end_turn、全程零 chunk —— 卡死特征
        const api = new CodebuddyProvider();
        await consume(api.sendMessage('s1', 'x', '/v'));
        expect(kit.fake.dispose).toHaveBeenCalled();
    });

    it('routes first-load history to its loading session instead of another in-flight turn', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const load = deferred<{ models: {}; modes: {} }>();
        const activeTurn = deferred<{ stopReason: string }>();
        const loadingTurn = deferred<{ stopReason: string }>();
        kit.fake.request.mockImplementation(async (method, params) => {
            if (method === 'session/load') {
                return params.sessionId === 'acp-loading' ? load.promise : { models: {}, modes: {} };
            }
            if (method === 'session/prompt') {
                return params.sessionId === 'acp-active' ? activeTurn.promise : loadingTurn.promise;
            }
            return {};
        });
        const api = new CodebuddyProvider();
        api.setConversationLookup({ getAcpSessionId: (key) => `acp-${key}`, setAcpSessionId: () => {} });
        const active = consume(api.sendMessage('active', 'current', '/v'));
        await flush();
        const loading = consume(api.sendMessage('loading', 'next', '/v'));
        await flush();
        const history = {
            sessionUpdate: 'agent_message_chunk', messageId: 'old-loading-message',
            content: { type: 'text', text: 'other conversation history' },
        };
        kit.events().onSessionUpdate('acp-loading', history);
        kit.events().onSessionUpdate('acp-active', {
            sessionUpdate: 'agent_message_chunk', messageId: 'active-answer', content: { type: 'text', text: 'current answer' },
        });
        activeTurn.resolve({ stopReason: 'end_turn' });
        const activeChunks = await active;
        load.resolve({ models: {}, modes: {} });
        await flush();
        kit.events().onSessionUpdate('acp-loading', history); // 新轮无 history 标记的同 ID 回放也应被过滤。
        kit.events().onSessionUpdate('acp-loading', {
            sessionUpdate: 'agent_message_chunk', messageId: 'loading-answer', content: { type: 'text', text: 'next answer' },
        });
        loadingTurn.resolve({ stopReason: 'end_turn' });
        const loadingChunks = await loading;
        expect(activeChunks.filter((chunk) => chunk.type === 'text')).toEqual([{ type: 'text', content: 'current answer' }]);
        expect(loadingChunks.filter((chunk) => chunk.type === 'text')).toEqual([{ type: 'text', content: 'next answer' }]);
    });

    it('does not restart after a turn that produced chunks', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const promptGate = deferred<{ stopReason: string }>();
        kit.fake.request.mockImplementation(async (method: string) => {
            if (method === 'session/prompt') return promptGate.promise;
            if (method === 'session/new') return { sessionId: 'acp-1' };
            if (method === 'session/load') throw new Error('not found');
            return {};
        });
        const api = new CodebuddyProvider();
        const streaming = consume(api.sendMessage('s1', 'x', '/v'));
        await flush();
        kit.events().onSessionUpdate('acp-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } });
        promptGate.resolve({ stopReason: 'end_turn' });
        await streaming;
        expect(kit.fake.dispose).not.toHaveBeenCalled();
    });

    it('dispose rejects parked permissions and disposes the client', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const promptGate = hangPrompt(kit);
        const api = new CodebuddyProvider();
        api.onPermissionRequest('s1', () => {});
        const streaming = consume(api.sendMessage('s1', 'write', '/v'));
        await flush();
        kit.events().onPermissionRequest(0, PERMISSION_PARAMS);
        api.dispose();
        expect(kit.fake.respond).toHaveBeenCalledWith(0, { outcome: { outcome: 'selected', optionId: 'reject' } });
        expect(kit.fake.dispose).toHaveBeenCalled();
        promptGate.resolve({ stopReason: 'cancelled' });
        await streaming;
    });

    it('turn ending leaves no parked permissions (finally 兜底拒答)', async () => {
        const kit = makeFakeClient(MockAcpClient);
        kit.fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
            if (method === 'session/prompt') return { stopReason: 'end_turn' }; // 立即结束
            if (method === 'session/new') return { sessionId: 'acp-1' };
            if (method === 'session/load') {
                if (String(params.sessionId).startsWith('acp-')) return {}; // 已分配会话的再激活 load（WB-RT-001）放行
                throw new Error('not found');
            }
            return {};
        });
        const api = new CodebuddyProvider();
        api.onPermissionRequest('s1', () => {});
        await consume(api.sendMessage('s1', 'x', '/v'));
        // 轮次已结束，respondPermission 找不到悬挂请求时不应答、不抛错
        api.respondPermission(99, 'allow');
        expect(kit.fake.respond).not.toHaveBeenCalled();
    });
});

describe('provider turnFailed stopReason', () => {
    it.each([
        ['auth-required', 'provider.notLoggedIn'],
        ['credential-unavailable', 'provider.credentialUnavailable'],
    ] as const)('shows recovery guidance for a %s error during the prompt', async (tier, messageKey) => {
        const kit = makeFakeClient(MockAcpClient);
        const request = kit.fake.request.getMockImplementation()!;
        kit.fake.request.mockImplementation(async (method, params) => {
            if (method === 'session/prompt') throw new AcpStartError(tier, 'Authentication required');
            return request(method, params);
        });
        const api = new CodebuddyProvider();
        await expect(consume(api.sendMessage('s1', 'x', '/v'))).rejects.toThrow(t(messageKey));
    });

    it('throws localized error for non-standard stopReason (refusal 等)', async () => {
        const kit = makeFakeClient(MockAcpClient);
        kit.fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
            if (method === 'session/prompt') return { stopReason: 'refusal' };
            if (method === 'session/new') return { sessionId: 'acp-1' };
            if (method === 'session/load') {
                if (String(params.sessionId).startsWith('acp-')) return {}; // 已分配会话的再激活 load（WB-RT-001）放行
                throw new Error('not found');
            }
            return {};
        });
        const api = new CodebuddyProvider();
        await expect(consume(api.sendMessage('s1', 'x', '/v')))
            .rejects.toThrow(t('provider.turnFailed').replace('{reason}', 'refusal'));
    });
});

describe('models & config sync', () => {
    it('目录尚未取得时只提供 Auto，不用静态型号冒充可用模型', () => {
        makeFakeClient(MockAcpClient);
        expect(new CodebuddyProvider().getAvailableModels()).toEqual(['auto']);
    });

    it('动态目录保留新型号与顺序，同名重复项只保留首个真实 ID', () => {
        const kit = makeFakeClient(MockAcpClient);
        const api = new CodebuddyProvider();
        kit.events().onModels([
            { id: 'hy4-preview', name: 'Hy4 preview' },
            { id: 'hy3', name: 'Hy3' },
            { id: 'hy3-x', name: 'Hy3' },
            { id: 'glm-5.3', name: 'GLM-5.3' },
        ]);
        expect(api.getAvailableModelLabels()).toEqual([
            { id: 'hy4-preview', label: 'Hy4 preview' },
            { id: 'hy3', label: 'Hy3' },
            { id: 'glm-5.3', label: 'GLM-5.3' },
        ]);
    });

    it('目录请求失败会明确拒绝，且不会返回旧的静态清单', async () => {
        const kit = makeFakeClient(MockAcpClient);
        kit.fake.ensureStarted.mockRejectedValue(new Error('private vendor detail'));
        const api = new CodebuddyProvider();
        await expect(api.refreshAvailableModels('/vault')).rejects.toThrow();
        expect(api.getAvailableModels()).toEqual(['auto']);
    });

    it('worker 退出后重新发现目录，不复用上次模型清单', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const api = new CodebuddyProvider();
        kit.events().onModels([{ id: 'old-model' }]);
        kit.events().onExit(0, null);
        kit.fake.request.mockResolvedValue({ sessionId: 'new-discovery',
            models: { availableModels: [{ modelId: 'glm-5.3', name: 'GLM-5.3' }] } });
        await api.refreshAvailableModels('/vault');
        expect(api.getAvailableModels()).toEqual(['glm-5.3']);
    });

    it('发现目录的新会话不会让下一条聊天消息发到错误的活动会话', async () => {
        const kit = makeFakeClient(MockAcpClient);
        let created = 0;
        let activeId = '';
        kit.fake.request.mockImplementation(async (method, params) => {
            if (method === 'session/new') {
                activeId = ++created === 1 ? 'chat-session' : 'discovery-session';
                return { sessionId: activeId, models: { availableModels: [{ modelId: 'glm-5.3' }] } };
            }
            if (method === 'session/load') {
                if (params.sessionId !== 'chat-session') throw new Error('not found');
                activeId = 'chat-session';
                return { models: {}, modes: {} };
            }
            if (method === 'session/prompt') {
                if (activeId !== 'chat-session') throw new Error('wrong active session');
                kit.events().onSessionUpdate('chat-session', {
                    sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' },
                });
                return { stopReason: 'end_turn' };
            }
            return {};
        });
        const api = new CodebuddyProvider();
        await consume(api.sendMessage('s1', 'first', '/vault'));
        await api.refreshAvailableModels('/vault');
        await expect(consume(api.sendMessage('s1', 'next', '/vault'))).resolves.toEqual([
            expect.objectContaining({ type: 'text', content: 'ok' }), expect.objectContaining({ type: 'done' }),
        ]);
    });

    it('聊天预加载后排在目录发现后，仍会重新激活聊天再发送', async () => {
        const kit = makeFakeClient(MockAcpClient);
        let activeId = '';
        const trace: string[] = [];
        kit.fake.request.mockImplementation(async (method, params) => {
            if (method === 'session/load') {
                activeId = String(params.sessionId);
                trace.push(`load:${activeId}`);
                return { models: {}, modes: {} };
            }
            if (method === 'session/new') {
                activeId = 'discovery';
                trace.push('new:discovery');
                return { sessionId: activeId, models: { availableModels: [{ modelId: 'glm-5.3' }] } };
            }
            if (method === 'session/prompt') {
                trace.push(`prompt:${activeId}`);
                if (activeId !== 'chat') throw new Error('wrong active session');
                kit.events().onSessionUpdate('chat', {
                    sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' },
                });
                return { stopReason: 'end_turn' };
            }
            return {};
        });
        const api = new CodebuddyProvider();
        await consume(api.sendMessage('chat', 'first', '/vault'));
        trace.length = 0;
        const hold = deferred<void>();
        let tail: Promise<unknown> = hold.promise;
        kit.fake.enqueuePrompt.mockImplementation((fn: () => Promise<unknown>) => {
            const queued = tail.then(fn);
            tail = queued.catch(() => {});
            return queued;
        });
        const discovery = api.refreshAvailableModels('/vault');
        await flush();
        const send = consume(api.sendMessage('chat', 'next', '/vault'));
        await flush();
        expect(kit.fake.enqueuePrompt).toHaveBeenCalledTimes(3); // 首轮、发现、已预加载的下一轮
        hold.resolve();
        await discovery;
        await expect(send).resolves.toEqual([
            expect.objectContaining({ type: 'text', content: 'ok' }), expect.objectContaining({ type: 'done' }),
        ]);
        expect(trace).toEqual(['new:discovery', 'load:chat', 'prompt:chat']);
    });

    it.each([false, true])('指定模型失败时中止发送，不继续 prompt（复用会话=%s）', async (reuseSession) => {
        const kit = makeFakeClient(MockAcpClient);
        let rejectModel = false;
        kit.fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
            if (method === 'session/new') return { sessionId: 'acp-1' };
            if (method === 'session/load') {
                if (params.sessionId === 'acp-1') return { models: {}, modes: {} };
                throw new Error('not found');
            }
            if (method === 'session/set_config_option' && params.configId === 'model' && rejectModel) {
                throw new Error('vendor-private-detail');
            }
            if (method === 'session/prompt') {
                kit.events().onSessionUpdate('acp-1', {
                    sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' },
                });
                return { stopReason: 'end_turn' };
            }
            return {};
        });
        const api = new CodebuddyProvider();
        if (reuseSession) await consume(api.sendMessage('s1', 'first', '/v'));
        kit.fake.request.mockClear();
        kit.fake.rawRequest.mockClear();
        rejectModel = true;
        const failure = await consume(api.sendMessage('s1', 'next', '/v', [], undefined, undefined, undefined,
            { model: 'hy3-x' })).then(() => null, (e: Error) => e);
        expect(failure).toBeInstanceOf(Error);
        expect(failure?.message).toContain('hy3-x');
        expect(failure?.message).not.toContain('vendor-private-detail');
        expect(kit.fake.request).toHaveBeenCalledWith('session/set_config_option',
            { sessionId: 'acp-1', configId: 'model', value: 'hy3-x' });
        expect(kit.fake.rawRequest).not.toHaveBeenCalled();
    });

    it.each(['setModel', 'setPermissionMode', 'setThoughtLevel'] as const)(
        '%s 后台配置失败会记录本地错误，不泄漏远端详情或产生未处理拒绝', async (setter) => {
            const kit = makeFakeClient(MockAcpClient);
            let newCount = 0;
            let rejectLoad = false;
            kit.fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
                if (method === 'session/new') return { sessionId: `acp-${++newCount}` };
                if (method === 'session/load') {
                    if (rejectLoad) throw new Error('vendor-private-detail');
                    if (String(params.sessionId).startsWith('acp-')) return { models: {}, modes: {} };
                    throw new Error('not found');
                }
                if (method === 'session/prompt') {
                    kit.events().onSessionUpdate(String(params.sessionId), {
                        sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' },
                    });
                    return { stopReason: 'end_turn' };
                }
                return {};
            });
            const api = new CodebuddyProvider();
            await consume(api.sendMessage('s1', 'first', '/v'));
            await consume(api.sendMessage('s2', 'second', '/v'));
            clearLogs();
            rejectLoad = true;
            if (setter === 'setModel') api.setModel('hy3-x');
            else if (setter === 'setPermissionMode') api.setPermissionMode('plan');
            else api.setThoughtLevel('high');
            await flush();
            expect(getLogs()).toHaveLength(1);
            expect(getLogs().join('\n')).not.toContain('vendor-private-detail');
        });

    it('getAvailableModels starts with Auto, then serves handshake models', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const api = new CodebuddyProvider();
        expect(api.getAvailableModels()).toEqual(['auto']);
        kit.events().onModels([{ id: 'auto' }, { id: 'hy3' }, { id: 'glm-5.2' }]);
        expect(api.getAvailableModels()).toEqual(['auto', 'hy3', 'glm-5.2']);
    });

    it('保留 ACP 动态模型名称，未知模型不再回落旧的静态标签', () => {
        const kit = makeFakeClient(MockAcpClient);
        const api = new CodebuddyProvider();
        kit.events().onModels([{ id: 'glm-5.3', name: 'GLM-5.3' }]);
        expect(api.getAvailableModelLabels()).toEqual([{ id: 'glm-5.3', label: 'GLM-5.3' }]);
    });

    it('首次打开菜单前可主动从 ACP session/new 刷新模型列表', async () => {
        const kit = makeFakeClient(MockAcpClient);
        kit.fake.request.mockImplementation(async (method: string) => {
            if (method === 'session/new') {
                return { sessionId: 'model-discovery', models: { availableModels: [{ modelId: 'glm-5.3', name: 'GLM-5.3' }] } };
            }
            return {};
        });
        const api = new CodebuddyProvider();
        await api.refreshAvailableModels('/vault');
        expect(kit.fake.ensureStarted).toHaveBeenCalledWith('/vault');
        expect(api.getAvailableModels()).toEqual(['glm-5.3']);
        expect(api.getAvailableModelLabels()).toEqual([{ id: 'glm-5.3', label: 'GLM-5.3' }]);
    });

    it('setModel applies set_config_option to every loaded session', async () => {
        const kit = makeFakeClient(MockAcpClient);
        kit.fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
            if (method === 'session/prompt') return { stopReason: 'end_turn' };
            if (method === 'session/new') return { sessionId: 'acp-1' };
            if (method === 'session/load') {
                if (String(params.sessionId).startsWith('acp-')) return {}; // 已分配会话的再激活 load（WB-RT-001）放行
                throw new Error('not found');
            }
            return {};
        });
        const api = new CodebuddyProvider();
        await consume(api.sendMessage('s1', 'x', '/v'));
        api.setModel('glm-5.2');
        await flush();
        expect(kit.fake.request).toHaveBeenCalledWith('session/set_config_option',
            expect.objectContaining({ sessionId: 'acp-1', configId: 'model', value: 'glm-5.2' }));
    });

    it('setPermissionMode applies set_mode to every loaded session', async () => {
        const kit = makeFakeClient(MockAcpClient);
        kit.fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
            if (method === 'session/prompt') return { stopReason: 'end_turn' };
            if (method === 'session/new') return { sessionId: 'acp-1' };
            if (method === 'session/load') {
                if (String(params.sessionId).startsWith('acp-')) return {}; // 已分配会话的再激活 load（WB-RT-001）放行
                throw new Error('not found');
            }
            return {};
        });
        const api = new CodebuddyProvider();
        await consume(api.sendMessage('s1', 'x', '/v'));
        api.setPermissionMode('plan');
        await flush();
        expect(kit.fake.request).toHaveBeenCalledWith('session/set_mode',
            expect.objectContaining({ sessionId: 'acp-1', modeId: 'plan' }));
    });

    it('setModel before any session is a no-op for the wire but applies on first load', async () => {
        const kit = makeFakeClient(MockAcpClient);
        kit.fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
            if (method === 'session/prompt') return { stopReason: 'end_turn' };
            if (method === 'session/new') return { sessionId: 'acp-1' };
            if (method === 'session/load') {
                if (String(params.sessionId).startsWith('acp-')) return {}; // 已分配会话的再激活 load（WB-RT-001）放行
                throw new Error('not found');
            }
            return {};
        });
        const api = new CodebuddyProvider();
        api.setModel('glm-5.2'); // 无会话：不发请求
        const before = kit.fake.request.mock.calls.length;
        expect(before).toBe(0);
        await consume(api.sendMessage('s1', 'x', '/v')); // 首次加载时应用
        expect(kit.fake.request).toHaveBeenCalledWith('session/set_config_option',
            expect.objectContaining({ configId: 'model', value: 'glm-5.2' }));
    });
});

describe('MCP/agents settings plumbing', () => {
    it('setMcpServersJson propagates parsed servers into session/new params', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const api = new CodebuddyProvider();
        api.setMcpServersJson('[{"name":"fake","command":"node"}]');
        await consume(api.sendMessage('s1', 'x', '/v'));
        expect(kit.fake.request).toHaveBeenCalledWith('session/new',
            expect.objectContaining({ mcpServers: [{ name: 'fake', command: 'node', args: [], env: [] }] }));
    });

    it('invalid mcpServersJson keeps previous value', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const api = new CodebuddyProvider();
        api.setMcpServersJson('[{"name":"fake"}]');
        api.setMcpServersJson('{bad json');
        await consume(api.sendMessage('s1', 'x', '/v'));
        expect(kit.fake.request).toHaveBeenCalledWith('session/new',
            expect.objectContaining({ mcpServers: [{ name: 'fake', command: '', args: [], env: [] }] }));
    });

    it('setCustomAgentsJson forwards --agents extra args; invalid JSON ignored', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const api = new CodebuddyProvider();
        api.setCustomAgentsJson('{"reviewer":{"description":"d","prompt":"p"}}');
        expect(kit.fake.setExtraArgs).toHaveBeenCalledWith(['--agents', '{"reviewer":{"description":"d","prompt":"p"}}']);
        api.setCustomAgentsJson('{bad');
        expect(kit.fake.setExtraArgs).toHaveBeenCalledTimes(1);
        api.setCustomAgentsJson('');
        expect(kit.fake.setExtraArgs).toHaveBeenCalledWith([]);
    });
});

describe('thoughtLevel plumbing', () => {
    it('setThoughtLevel applies set_config_option on loaded sessions', async () => {
        const kit = makeFakeClient(MockAcpClient);
        kit.fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
            if (method === 'session/prompt') return { stopReason: 'end_turn' };
            if (method === 'session/new') return { sessionId: 'acp-1' };
            if (method === 'session/load') {
                if (String(params.sessionId).startsWith('acp-')) return {}; // 已分配会话的再激活 load（WB-RT-001）放行
                throw new Error('not found');
            }
            return {};
        });
        const api = new CodebuddyProvider();
        await consume(api.sendMessage('s1', 'x', '/v'));
        api.setThoughtLevel('high');
        await flush();
        expect(kit.fake.request).toHaveBeenCalledWith('session/set_config_option',
            expect.objectContaining({ sessionId: 'acp-1', configId: 'thought_level', value: 'high' }));
    });
});
