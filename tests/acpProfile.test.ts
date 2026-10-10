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
    it('模型下发失败会拒绝并只返回包含模型 ID 的本地错误', async () => {
        const failure = await CODEBUDDY_PROFILE.applyRemoteModel(
            { request: async <T = unknown>() => { throw new Error('vendor-private-detail'); } },
            'sid', 'hy3-x',
        ).then(() => null, (e: Error) => e);
        expect(failure).toBeInstanceOf(Error);
        expect(failure?.message).toContain('hy3-x');
        expect(failure?.message).not.toContain('vendor-private-detail');
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
        // 未取得实时目录之前不能展示静态型号。
        expect([...CODEBUDDY_PROFILE.fallbackModels]).toEqual(['auto']);
    });
});
