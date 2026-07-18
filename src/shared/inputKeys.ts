/**
 * 判断一次 keydown 是否应触发「发送消息」。
 * 规则：非组合键的 Enter 才发送；Shift+Enter 换行；
 * 输入法组字中（有候选）时 Enter 用于确认候选、不发送——
 * `isComposing` 是标准信号，`keyCode === 229` 兼容部分浏览器的组字态。
 */
export function shouldSendMessage(e: { key: string; shiftKey: boolean; isComposing: boolean; keyCode?: number }): boolean {
    if (e.key !== 'Enter' || e.shiftKey) return false;
    if (e.isComposing || e.keyCode === 229) return false;
    return true;
}
