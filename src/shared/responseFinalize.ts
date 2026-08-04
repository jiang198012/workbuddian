/**
 * 收尾时选定最终展示内容：优先流式正文，其次 `result` 事件文本。
 * result 兜底避免「只在 result 事件里给了文本、没走流式 text chunk」的回复被误判为「无响应」。
 * thinking 永不升格为正文：它是内部推理（常为英文草稿），只在可折叠的思考块里展示——
 * 用户 Reject 批准后模型往往不再产正文只产 thinking，兜底会把内部意图泄进气泡（WB-009）。
 */
export function pickFinalContent(text: string, result: string): string {
    return text || result;
}

/**
 * 流式正文追加：对非增量投递做防护（WB-010 Agent 子代理文本重复 2-3 次）。
 * - incoming 是已累积文本的前缀延伸 → 快照式全量下发，替换而非追加；
 * - incoming 与已累积文本尾部完全相同（≥32 字符的整段）→ 中继+总结两路投递的重复，跳过。
 * 32 字符阈值避免误伤正常的小块增量（如模型连续输出相同短词）。
 */
export function appendTextChunk(accumulated: string, incoming: string): string {
    if (!incoming) return accumulated;
    if (!accumulated) return incoming;
    if (incoming.length > accumulated.length && incoming.startsWith(accumulated)) return incoming;
    const MIN_DEDUPE_CHARS = 32;
    if (incoming.length >= MIN_DEDUPE_CHARS && accumulated.endsWith(incoming)) return accumulated;
    return accumulated + incoming;
}
