/** 将输入框自然高度限制在允许范围内。 */
export function clampTextareaHeight(scrollHeight: number, minHeight: number, maxHeight: number): number {
    return Math.min(Math.max(scrollHeight, minHeight), maxHeight);
}
