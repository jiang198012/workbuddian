/** 从绝对路径取文件名（跨平台，兼容 / 与 \） */
export function fileBasename(p: string): string {
    const parts = p.split(/[\\/]/);
    return parts[parts.length - 1] || p;
}

/** 取绝对路径的父目录（跨平台，兼容 / 与 \）；无分隔符则原样返回，根下文件保留根 '/' */
export function fileDir(p: string): string {
    const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    if (idx < 0) return p;
    if (idx === 0) return p.slice(0, 1);
    return p.slice(0, idx);
}

/** 附件绝对路径 → 去重后的父目录列表，供 CLI 用 --add-dir 放开这些目录的读取权限 */
export function attachmentDirs(paths: string[]): string[] {
    return [...new Set(paths.map(fileDir))];
}

/** 把附加的文件绝对路径拼成注入区块，交给 CLI 用其文件工具读取 */
export function buildAttachmentBlock(paths: string[]): string {
    if (paths.length === 0) return '';
    const lines = ['用户附加了以下文件（请用你的文件读取工具查看其内容）：', ''];
    for (const p of paths) lines.push(`- ${p}`);
    return lines.join('\n');
}
