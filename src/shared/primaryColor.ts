/** 聊天面板主色调对应的 CSS 变量名（styles.css 以 var() 回退引用） */
export const PRIMARY_COLOR_VAR = '--workbuddian-primary';

/**
 * 把主色写入 document.body（单点覆盖侧边栏 + 主编辑区两个 view）。
 * 空字符串表示「跟随主题」，此时移除变量，靠 CSS 原生 fallback 回退 --interactive-accent。
 */
export function applyPrimaryColor(color: string): void {
    if (color) {
        document.body.style.setProperty(PRIMARY_COLOR_VAR, color);
    } else {
        document.body.style.removeProperty(PRIMARY_COLOR_VAR);
    }
}
