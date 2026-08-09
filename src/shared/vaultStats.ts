/** Vault 统计的纯逻辑（C：vault 上下文统计）。输入文件列表,输出可注入 prompt 的摘要文本。纯逻辑无 obsidian import */

export interface VaultFileInfo {
    /** vault 内路径，如 "folder/note.md" */
    path: string;
    /** 文件内容（仅统计用，可省略以省内存） */
    content?: string;
}

/** 从文件路径提取标签：匹配 content 里的 #tag(不含 frontmatter 标签) */
function extractTags(file: VaultFileInfo): string[] {
    if (!file.content) return [];
    const tags = new Set<string>();
    // 跳过 frontmatter(--- 到 ---)
    const body = file.content.replace(/^---\n[\s\S]*?\n---\n?/, '');
    for (const m of body.matchAll(/#([A-Za-z一-龥][\w一-龥/-]*)/g)) {
        tags.add(m[1]);
    }
    return [...tags];
}

/**
 * 生成 vault 统计摘要文本（供 @stats 引用注入 prompt）。
 * @param files vault 全部文件
 * @param nowMs 当前时间戳（注入"最近笔记"用，默认 Date.now）
 */
export function buildVaultStats(files: VaultFileInfo[], nowMs: number = Date.now()): string {
    const total = files.length;
    const notes = files.filter((f) => f.path.endsWith('.md'));
    const folders = new Set(notes.map((n) => (n.path.includes('/') ? n.path.split('/').slice(0, -1).join('/') : '(根目录)')));

    // 标签统计
    const tagCount = new Map<string, number>();
    for (const n of notes) {
        for (const tag of extractTags(n)) {
            tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
        }
    }
    const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

    // 最近笔记：按名字排序取不出时间，这里由调用方传入 updatedAt? 简化：取路径按字母序前 5
    const recent = notes.map((n) => n.path).sort().slice(0, 5);

    const lines: string[] = [
        '当前 Vault 统计信息：',
        `- 文件总数: ${total}`,
        `- Markdown 笔记: ${notes.length}`,
        `- 目录数: ${folders.size}`,
        '',
        '热门标签(Top 10):',
        ...(topTags.length ? topTags.map(([tag, c]) => `- #${tag} × ${c}`) : ['- (无标签)']),
        '',
        '文件示例(前 5):',
        ...(recent.length ? recent.map((p) => `- ${p}`) : ['- (空 vault)']),
    ];
    return lines.join('\n');
}
