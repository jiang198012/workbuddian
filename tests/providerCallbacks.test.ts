import { CodebuddyProvider } from '../src/providers/codebuddy';
import { AcpClient } from '../src/providers/codebuddy/acp/client';
import type { PermissionCardData } from '../src/providers/codebuddy/acp/permission';
import { t } from '../src/i18n';
import { getLogs, clearLogs } from '../src/shared/logBuffer';
import { makeFakeClient, deferred, flush, consume, PERMISSION_PARAMS } from './helpers/fakeAcpClient';

jest.mock('../src/providers/codebuddy/acp/client', () => {
    const actual = jest.requireActual('../src/providers/codebuddy/acp/client');
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
    it('getAvailableModels falls back before any session, then serves handshake models', async () => {
        const kit = makeFakeClient(MockAcpClient);
        const api = new CodebuddyProvider();
        expect(api.getAvailableModels()).toContain('hy3'); // FALLBACK_MODEL_OPTIONS
        kit.events().onModels(['auto', 'hy3', 'glm-5.2']);
        expect(api.getAvailableModels()).toEqual(['auto', 'hy3', 'glm-5.2']);
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
