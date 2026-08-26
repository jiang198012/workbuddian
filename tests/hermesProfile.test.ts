import { HERMES_PROFILE } from '../src/providers/hermes/profile';

describe('hermes profile 方言', () => {
    it('spawn 入口参数为 acp', () => {
        expect([...HERMES_PROFILE.acpArgs]).toEqual(['acp']);
    });
    it('权限模式出向映射', () => {
        expect(HERMES_PROFILE.mapOutgoingMode('default')).toBe('default');
        expect(HERMES_PROFILE.mapOutgoingMode('acceptEdits')).toBe('accept_edits');
        expect(HERMES_PROFILE.mapOutgoingMode('bypassPermissions')).toBe('dont_ask');
        expect(HERMES_PROFILE.mapOutgoingMode('plan')).toBe('default'); // hermes 无 plan，回落
    });
    it('权限模式入向映射（current_mode_update → UI）', () => {
        expect(HERMES_PROFILE.mapIncomingMode('default')).toBe('default');
        expect(HERMES_PROFILE.mapIncomingMode('accept_edits')).toBe('acceptEdits');
        expect(HERMES_PROFILE.mapIncomingMode('dont_ask')).toBe('bypassPermissions');
        expect(HERMES_PROFILE.mapIncomingMode('unknown-x')).toBeUndefined();
    });
    it('模型下发走 session/set_model；auto 不下发', async () => {
        const calls: Array<Record<string, unknown>> = [];
        const client = {
            request: async <T = unknown>(m: string, p: Record<string, unknown>) => {
                calls.push({ m, ...p }); return {} as T;
            },
        };
        await HERMES_PROFILE.applyRemoteModel(client, 'sid', 'custom:kimi:kimi-k3');
        await HERMES_PROFILE.applyRemoteModel(client, 'sid', 'auto');
        expect(calls).toEqual([{ m: 'session/set_model', sessionId: 'sid', modelId: 'custom:kimi:kimi-k3' }]);
    });
    it('thoughtLevel 不下发；回放无 meta 判别；fork 走原生 RPC', () => {
        expect(HERMES_PROFILE.supportsThoughtLevel).toBe(false);
        expect(HERMES_PROFILE.isReplayUpdate({ _meta: { hermes: { compactionSummary: true } } })).toBe(false);
        expect(HERMES_PROFILE.forkMode).toBe('native-rpc');
        // hermes shim 是 bash 脚本（unset PYTHONPATH; exec venv/python）：直接 spawn，不可由 node 解释
        expect(HERMES_PROFILE.spawnViaNode).toBe(false);
    });
    it('normalizeToolCall 解嵌套 {tool, arguments}（探针实证形态）', () => {
        const out = HERMES_PROFILE.normalizeToolCall({
            title: 'Approve edit: /tmp/x.txt',
            rawInput: { tool: 'write_file', arguments: { path: '/tmp/x.txt', content: 'hi' } },
        });
        expect(out.toolName).toBe('write_file');
        expect(out.rawInput).toEqual({ path: '/tmp/x.txt', content: 'hi' });
        expect(HERMES_PROFILE.normalizeToolCall({ title: 't', rawInput: { path: '/a' } })).toEqual({});
    });
});
