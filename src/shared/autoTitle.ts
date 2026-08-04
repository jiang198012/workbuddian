/** 自动会话标题的纯逻辑：fallback 公式、生成结果清洗、覆盖保护 */

/** manager 的截断式 fallback 标题（首条 user 消息前 30 字） */
export function fallbackTitle(content: string): string {
    return content.substring(0, 30) + (content.length > 30 ? '...' : '');
}

/** 清洗模型输出的标题：取首行、去引号句号、限 20 字；空则返回空串（调用方放弃） */
export function sanitizeTitle(raw: string): string {
    const firstLine = (raw.split('\n')[0] ?? '').trim();
    const stripped = firstLine.replace(/^["'「『《<]+|["'」』》>。.!?！？]+$/g, '').trim();
    return stripped.slice(0, 20);
}

/** 仅当当前标题仍是 fallback（用户未手动改名）时才允许自动标题覆盖 */
export function shouldApplyAutoTitle(currentTitle: string, userText: string): boolean {
    return currentTitle === fallbackTitle(userText);
}
