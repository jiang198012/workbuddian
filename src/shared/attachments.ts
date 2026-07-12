/** 从绝对路径取文件名（跨平台，兼容 / 与 \） */
export function fileBasename(p: string): string {
    const parts = p.split(/[\\/]/);
    return parts[parts.length - 1] || p;
}

/** 把附加的文件绝对路径拼成注入区块，交给 CLI 用其文件工具读取 */
export function buildAttachmentBlock(paths: string[]): string {
    if (paths.length === 0) return '';
    const lines = ['用户附加了以下文件（请用你的文件读取工具查看其内容）：', ''];
    for (const p of paths) lines.push(`- ${p}`);
    return lines.join('\n');
}
