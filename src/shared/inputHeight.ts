export const DEFAULT_INPUT_MIN_HEIGHT = 30;
export const DEFAULT_INPUT_MAX_HEIGHT = 200;
const MIN_CONFIGURED_INPUT_HEIGHT = 20;
const MAX_CONFIGURED_INPUT_HEIGHT = 600;

/** 校验并规范化输入框高度范围；无效配置整体回落默认值。 */
export function normalizeTextareaHeightBounds(minHeight: number, maxHeight: number): { minHeight: number; maxHeight: number } {
    const validMin = Number.isInteger(minHeight) && minHeight >= MIN_CONFIGURED_INPUT_HEIGHT && minHeight <= MAX_CONFIGURED_INPUT_HEIGHT;
    const validMax = Number.isInteger(maxHeight) && maxHeight >= MIN_CONFIGURED_INPUT_HEIGHT && maxHeight <= MAX_CONFIGURED_INPUT_HEIGHT;
    if (!validMin || !validMax || minHeight >= maxHeight) {
        return { minHeight: DEFAULT_INPUT_MIN_HEIGHT, maxHeight: DEFAULT_INPUT_MAX_HEIGHT };
    }
    return { minHeight, maxHeight };
}

/** 将输入框自然高度限制在允许范围内。 */
export function clampTextareaHeight(scrollHeight: number, minHeight: number, maxHeight: number): number {
    return Math.min(Math.max(scrollHeight, minHeight), maxHeight);
}
