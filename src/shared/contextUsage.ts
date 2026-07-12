/** 把 token 数格式化为紧凑显示：<1000 原样，≥1000 用一位小数的 k */
export function formatTokenCount(n: number): string {
    if (n < 1000) return String(n);
    return (n / 1000).toFixed(1) + 'k';
}

/** 已用 token 占上下文窗口的百分比（四舍五入，封顶 100；窗口非正数时返回 0） */
export function contextPercent(used: number, windowSize: number): number {
    if (windowSize <= 0) return 0;
    return Math.min(100, Math.round((used / windowSize) * 100));
}
