import { HermesAcpProvider } from '../src/providers/hermes/acpProvider';
import { AcpClient, AcpStartError } from '../src/providers/acp/client';
import { makeFakeClient, consume } from './helpers/fakeAcpClient';

jest.mock('../src/providers/acp/client', () => {
    const actual = jest.requireActual('../src/providers/acp/client');
    return { ...actual, AcpClient: jest.fn() }; // 保留真实 AcpStartError，启动错误分级才能生效
});

describe('HermesAcpProvider', () => {
    it('握手失败文案写 Hermes CLI，不写 codebuddy', async () => {
        const kit = makeFakeClient(AcpClient as jest.MockedClass<typeof AcpClient>);
        kit.fake.ensureStarted.mockRejectedValue(new AcpStartError('handshake-failed', 'process exited (0) before handshake'));
        const p = new HermesAcpProvider();
        p.setConversationLookup({ getAcpSessionId: () => undefined, setAcpSessionId: () => {} });
        const sent = consume(p.sendMessage('conv-1', 'x', '/tmp/vault'));
        await expect(sent).rejects.toThrow('Hermes CLI 握手失败：process exited (0) before handshake');
        await expect(sent).rejects.not.toThrow(/codebuddy/i);
    });
    it('forkSession 走 session/fork RPC 并返回新 id（无 /branch prompt）', async () => {
        const kit = makeFakeClient(AcpClient as jest.MockedClass<typeof AcpClient>);
        const p = new HermesAcpProvider();
        p.setConversationLookup({ getAcpSessionId: () => undefined, setAcpSessionId: () => {} });
        const newId = await p.forkSession('conv-1', '分支名', '/tmp/vault');
        expect(newId).toBe('forked-1');
        const methods = kit.fake.request.mock.calls.map((c) => c[0]);
        expect(methods).toContain('session/fork');
        expect(kit.fake.rawRequest.mock.calls.map((c) => c[0])).not.toContain('session/prompt');
    });
    it('setCustomAgentsJson 为空操作（hermes 无 --agents）', () => {
        const p = new HermesAcpProvider();
        expect(() => p.setCustomAgentsJson('{"a":{}}')).not.toThrow();
    });
    it('握手前模型列表只有 auto（不泄 codebuddy 兜底列表）', () => {
        makeFakeClient(AcpClient as jest.MockedClass<typeof AcpClient>);
        const p = new HermesAcpProvider();
        expect(p.getAvailableModels()).toEqual(['auto']);
    });
    it('按底座模型去重，保留当前模型条目', () => {
        makeFakeClient(AcpClient as jest.MockedClass<typeof AcpClient>);
        const kit = makeFakeClient(AcpClient as jest.MockedClass<typeof AcpClient>);
        const p = new HermesAcpProvider();
        kit.events().onModels([
            { id: 'deepseek-hermes:deepseek-flash', name: 'current flash' },
            { id: 'deepseek:deepseek-flash', name: 'deepseek flash' },
            { id: 'deepseek:deepseek-v4-pro', name: 'deepseek pro' },
            { id: 'custom:deepseek-hermes:deepseek-flash', name: 'custom flash' },
            { id: 'custom:deepseek-hermes:deepseek-v4-pro', name: 'custom pro' },
        ], 'deepseek-hermes:deepseek-flash');
        expect(p.getAvailableModels()).toEqual([
            'deepseek-hermes:deepseek-flash',
            'deepseek:deepseek-v4-pro',
        ]);
    });

    it('用户已选别名时去重保留该条目', () => {
        makeFakeClient(AcpClient as jest.MockedClass<typeof AcpClient>);
        const kit = makeFakeClient(AcpClient as jest.MockedClass<typeof AcpClient>);
        const p = new HermesAcpProvider();
        p.setModel('custom:deepseek-hermes:deepseek-v4-pro');
        kit.events().onModels([
            { id: 'deepseek-hermes:deepseek-flash' },
            { id: 'deepseek:deepseek-v4-pro' },
            { id: 'custom:deepseek-hermes:deepseek-v4-pro' },
        ], 'deepseek-hermes:deepseek-flash');
        expect(p.getAvailableModels()).toEqual([
            'deepseek-hermes:deepseek-flash',
            'custom:deepseek-hermes:deepseek-v4-pro',
        ]);
    });

    it('getAvailableModelLabels 用握手 name 字段，缺省回落 id', () => {
        const kit = makeFakeClient(AcpClient as jest.MockedClass<typeof AcpClient>);
        const p = new HermesAcpProvider();
        kit.events().onModels([
            { id: 'custom:k3', name: 'Custom endpoint · k3' },
            { id: 'opencode-free:hy3-free' },
        ]);
        expect(p.getAvailableModelLabels()).toEqual([
            { id: 'custom:k3', label: 'Custom endpoint · k3' },
            { id: 'opencode-free:hy3-free', label: 'opencode-free:hy3-free' },
        ]);
        expect(p.getAvailableModels()).toEqual(['custom:k3', 'opencode-free:hy3-free']);
    });
});
