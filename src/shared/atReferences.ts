/**
 * 判断光标是否正处于一次 "@笔记名" 输入过程中。
 * 从光标位置向前找最近的 @，中间不能出现空白/换行/] （避免匹配到已插入的 @[[...]] 内部）。
 */
export function extractAtQuery(text: string, cursorPos: number): { query: string; start: number } | null {
    const upToCursor = text.slice(0, cursorPos);
    const atIndex = upToCursor.lastIndexOf('@');
    if (atIndex === -1) return null;
    const between = upToCursor.slice(atIndex + 1);
    if (/[\s\]]/.test(between)) return null;
    return { query: between, start: atIndex };
}

/** 从最终发送的消息文本里提取所有 @[[笔记名]] 引用，按出现顺序去重 */
export function parseAtReferences(text: string): string[] {
    const names: string[] = [];
    for (const match of text.matchAll(/@\[\[([^\]]+)\]\]/g)) {
        if (!names.includes(match[1])) {
            names.push(match[1]);
        }
    }
    return names;
}

/** 从文本中删除某个 @[[笔记名]] 引用的所有出现（含一个尾随空格）；name 做正则转义 */
export function removeAtReference(text: string, name: string): string {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`@\\[\\[${escaped}\\]\\]\\s?`, 'g'), '');
}
