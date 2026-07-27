export interface FileEdit { kind: 'edit'; path: string; oldText: string; newText: string; }
export interface FileWrite { kind: 'write'; path: string; newText: string; }
export type FileChange = FileEdit | FileWrite;

/** 工具入参 JSON → 可 diff 的文件改动；非文件工具、字段缺失或 JSON 非法时返回 null */
export function parseFileChange(toolName: string, toolDetail: string): FileChange | null {
    let input: unknown;
    try {
        input = JSON.parse(toolDetail);
    } catch {
        return null;
    }
    if (typeof input !== 'object' || input === null) return null;
    const obj = input as Record<string, unknown>;
    const path = typeof obj.file_path === 'string' ? obj.file_path : '';
    if (!path) return null;

    if (toolName === 'Edit') {
        const oldText = obj.old_string;
        const newText = obj.new_string;
        if (typeof oldText !== 'string' || typeof newText !== 'string') return null;
        return { kind: 'edit', path, oldText, newText };
    }
    if (toolName === 'Write') {
        const content = obj.content;
        if (typeof content !== 'string') return null;
        return { kind: 'write', path, newText: content };
    }
    return null;
}

/** 是否 CodeBuddy 写出的计划文件（.codebuddy/plans 下的 .md），跨平台兼容 / 与 \ */
export function isPlanFilePath(p: string): boolean {
    const norm = p.replace(/\\/g, '/');
    return norm.includes('/.codebuddy/plans/') && norm.endsWith('.md');
}
