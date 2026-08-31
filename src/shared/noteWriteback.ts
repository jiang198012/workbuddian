/** 把 AI 回复写回 Vault 时使用的纯文本格式化与路径工具。 */

export function sanitizeNoteName(name: string): string {
    const cleaned = name
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .replace(/\.+$/g, '')
        .trim();
    return cleaned || 'workbuddian-reply';
}

function yamlSingleQuote(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

export function formatAssistantReply(conversationTitle: string, content: string, timestamp = Date.now()): string {
    const title = conversationTitle.replace(/[\r\n]+/g, ' ').trim() || 'workbuddian-reply';
    const body = content.trim();
    return [
        '---',
        'source: Workbuddian',
        `conversation: ${yamlSingleQuote(title)}`,
        `created: ${new Date(timestamp).toISOString()}`,
        '---',
        '',
        body,
        '',
    ].join('\n');
}

export function nextAvailableNotePath(desiredName: string, existingPaths: Iterable<string>): string {
    const base = sanitizeNoteName(desiredName);
    const existing = new Set(existingPaths);
    const first = `${base}.md`;
    if (!existing.has(first)) return first;
    let index = 2;
    while (existing.has(`${base}-${index}.md`)) index++;
    return `${base}-${index}.md`;
}
