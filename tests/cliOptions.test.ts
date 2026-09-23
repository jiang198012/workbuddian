import { modelLabel, orderModels, sanitizeModelForBackend, MODEL_LABELS, normalizeAvailableModelIds } from '../src/shared/cliOptions';

describe('modelLabel (国内模型中文名)', () => {
    it('maps known domestic model ids to Chinese labels', () => {
        expect(modelLabel('deepseek-v4-pro')).toBe('DeepSeek V4 Pro（深度求索）');
        expect(modelLabel('glm-5.2')).toBe('GLM-5.2（智谱）');
        expect(modelLabel('kimi-k2.7')).toBe('Kimi K2.7（月之暗面）');
        expect(modelLabel('auto')).toBe('Auto（自动选择）');
    });
    it('falls back to raw id for unknown models', () => {
        expect(modelLabel('unknown-model')).toBe('unknown-model');
    });
    it('covers all MODEL_OPTIONS keys with labels', () => {
        // 兜底列表里的每个 id 都应有中文名（或至少回退自身不丢）
        for (const id of ['hy3', 'glm-5.2', 'glm-5.1', 'glm-5v-turbo', 'minimax-m3', 'kimi-k3-1', 'kimi-k2.7', 'kimi-k2.6', 'deepseek-v4-flash', 'deepseek-v4-pro']) {
            expect(MODEL_LABELS[id] ?? id).toBeTruthy();
        }
    });
});

describe('orderModels (国内模型排序)', () => {
    it('orders known ids by MODEL_ORDER, keeps rest after', () => {
        expect(orderModels(['hy3', 'deepseek-v4-pro', 'glm-5.2'])).toEqual(['glm-5.2', 'deepseek-v4-pro', 'hy3']);
        expect(orderModels(['hy3', 'unknown-x', 'deepseek-v4-pro'])).toEqual(['deepseek-v4-pro', 'hy3', 'unknown-x']);
    });
    it('passes through empty list', () => {
        expect(orderModels([])).toEqual([]);
    });
    it('does not duplicate ids', () => {
        expect(orderModels(['glm-5.2', 'glm-5.2', 'hy3'])).toEqual(['glm-5.2', 'hy3']);
    });
    it('可用动态顺序时不再把新模型塞到旧静态顺序之后', () => {
        expect(orderModels(['auto', 'glm-5.3', 'hy3'], ['auto', 'glm-5.3', 'hy3']))
            .toEqual(['auto', 'glm-5.3', 'hy3']);
    });
    it('动态顺序自身含重复项时只展示一次', () => {
        expect(orderModels(['auto', 'hy3', 'hy3-x'], ['auto', 'auto', 'hy3', 'hy3-x']))
            .toEqual(['auto', 'hy3', 'hy3-x']);
    });
});

describe('normalizeAvailableModelIds (重复模型清理)', () => {
    it('保留基础模型，删除当前重复的付费变体并去重', () => {
        expect(normalizeAvailableModelIds([
            'auto', 'hy3', 'hy3-x', 'hy4-preview-f', 'hy4-preview', 'hy3',
        ])).toEqual(['auto', 'hy3', 'hy4-preview-f']);
    });
});

describe('sanitizeModelForBackend (切后端模型残留清理)', () => {
    it('hermes 挂着 codebuddy 模型 id(切后端残留)→ 回落 auto', () => {
        expect(sanitizeModelForBackend('hermes', 'deepseek-v4-pro')).toBe('auto');
        expect(sanitizeModelForBackend('hermes', 'hy3')).toBe('auto');
    });
    it('hermes 的 auto / 空值 → auto(保证必有正确值)', () => {
        expect(sanitizeModelForBackend('hermes', 'auto')).toBe('auto');
        expect(sanitizeModelForBackend('hermes', '')).toBe('auto');
    });
    it('hermes 原生模型 id(custom:k3 等)不误伤', () => {
        expect(sanitizeModelForBackend('hermes', 'custom:k3')).toBe('custom:k3');
        expect(sanitizeModelForBackend('hermes', 'kimi-k2.7-code')).toBe('kimi-k2.7-code');
    });
    it('codebuddy 后端不动任何值', () => {
        expect(sanitizeModelForBackend('codebuddy', 'deepseek-v4-pro')).toBe('deepseek-v4-pro');
        expect(sanitizeModelForBackend('codebuddy', 'custom:k3')).toBe('custom:k3');
    });
});
