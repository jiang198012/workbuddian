/** 把当前笔记的选中文字拼成聊天注入块（只读参考，不改笔记） */
export function buildSelectionBlock(selectedText: string, noteName?: string): string {
    if (!selectedText.trim()) return '';
    const from = noteName ? `（来自笔记《${noteName}》）` : '';
    return [
        `用户在当前笔记中选中了以下文字${from}，仅作为聊天参考，请勿修改笔记：`,
        '"""',
        selectedText,
        '"""'
    ].join('\n');
}
