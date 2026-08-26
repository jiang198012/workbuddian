import { HermesAcpProvider } from '../src/providers/hermes/acpProvider';
import { AcpClient } from '../src/providers/acp/client';
import { makeFakeClient } from './helpers/fakeAcpClient';

jest.mock('../src/providers/acp/client');

describe('HermesAcpProvider', () => {
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
