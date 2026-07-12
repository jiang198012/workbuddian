/** 组装强约束编辑 prompt：只要正文、不要解释 */
export function buildEditPrompt(selection: string, instruction: string): string {
    return [
        '请按下面的要求改写「原文」。',
        '只输出改写后的正文，不要任何解释、开场白、结束语或代码块标记。',
        '',
        `要求：${instruction}`,
        '',
        '原文：',
        selection,
    ].join('\n');
}
