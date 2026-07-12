/**
 * 收尾时选定最终展示内容：优先流式正文，其次思考，最后 `result` 事件文本。
 * 最后一级兜底避免「只在 result 事件里给了文本、没走流式 text chunk」的回复被误判为「无响应」。
 */
export function pickFinalContent(text: string, thinking: string, result: string): string {
    return text || thinking || result;
}
