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

/**
 * Enter / Space 是否应「激活」一个自定义可点击控件（role="button" 的 div/span 没有原生键盘激活行为，
 * 需手动补上）。供各处 ✕ 按钮 / 标签 / 会话列表行等复用，避免重复写按键判断。
 */
export function isActivationKey(key: string): boolean {
    return key === 'Enter' || key === ' ';
}
