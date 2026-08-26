import { CODEBUDDY_PROFILE } from '../src/providers/codebuddy/profile';

describe('codebuddy profile（行为钉：与现状一致）', () => {
    it('spawn 入口参数为 --acp', () => {
        expect([...CODEBUDDY_PROFILE.acpArgs]).toEqual(['--acp']);
    });
    it('mode 映射恒等', () => {
        expect(CODEBUDDY_PROFILE.mapOutgoingMode('acceptEdits')).toBe('acceptEdits');
        expect(CODEBUDDY_PROFILE.mapIncomingMode('acceptEdits')).toBe('acceptEdits');
    });
    it('模型下发走 set_config_option', async () => {
        const calls: Array<Record<string, unknown>> = [];
        await CODEBUDDY_PROFILE.applyRemoteModel(
            { request: async <T = unknown>(m: string, p: Record<string, unknown>) => { calls.push({ m, ...p }); return {} as T; } },
            'sid', 'claude-x');
        expect(calls).toEqual([{ m: 'session/set_config_option', sessionId: 'sid', configId: 'model', value: 'claude-x' }]);
    });
    it('回放判别认 codebuddy.ai meta', () => {
        expect(CODEBUDDY_PROFILE.isReplayUpdate({ _meta: { 'codebuddy.ai': { mode: 'history' } } })).toBe(true);
        expect(CODEBUDDY_PROFILE.isReplayUpdate({})).toBe(false);
    });
    it('forkMode 为 branch-prompt，thoughtLevel 下发，normalizeToolCall 恒等', () => {
        expect(CODEBUDDY_PROFILE.forkMode).toBe('branch-prompt');
        expect(CODEBUDDY_PROFILE.supportsThoughtLevel).toBe(true);
        expect(CODEBUDDY_PROFILE.normalizeToolCall({ title: 't' })).toEqual({});
        // codebuddy CLI 是 JS 脚本：纯路径须走 node 解释（v1 历史行为）
        expect(CODEBUDDY_PROFILE.spawnViaNode).toBe(true);
    });
});
