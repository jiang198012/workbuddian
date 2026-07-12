export interface SlashCommand {
    name: string;   // 命令名，不含前导 /
    rest: string;   // 命令名之后的参数串（已 trim）
}

/** 解析斜杠命令：trim 后第一行以 / 紧跟非空白才算命令，否则返回 null */
export function parseSlashCommand(text: string): SlashCommand | null {
    const firstLine = text.trim().split('\n')[0];
    const m = firstLine.match(/^\/(\S+)\s*(.*)$/);
    if (!m) return null;
    return { name: m[1], rest: m[2].trim() };
}

export interface SlashCommandInfo { name: string; desc: string; }

export const BUILTIN_SLASH_COMMANDS: SlashCommandInfo[] = [
    { name: 'clear', desc: '清空并新建对话（本地）' },
    { name: 'compact', desc: '压缩上下文' },
    { name: 'context', desc: '查看上下文用量' },
    { name: 'cost', desc: '查看本次花费' },
    { name: 'model', desc: '切换模型' },
    { name: 'permissions', desc: '查看/管理权限' },
    { name: 'resume', desc: '恢复历史会话' },
    { name: 'export', desc: '导出对话' },
    { name: 'status', desc: '查看状态' },
];

/** 光标在第一行、该行以 / 开头、/ 后无空白（仍在命令名 token 内）时，返回命令名前缀，否则 null */
export function extractSlashQuery(value: string, cursor: number): string | null {
    const upto = value.slice(0, cursor);
    if (upto.includes('\n')) return null;
    if (!upto.startsWith('/')) return null;
    const afterSlash = upto.slice(1);
    if (/\s/.test(afterSlash)) return null;
    return afterSlash;
}

export function filterSlashCommands(query: string): SlashCommandInfo[] {
    const q = query.toLowerCase();
    return BUILTIN_SLASH_COMMANDS.filter(c => c.name.toLowerCase().startsWith(q));
}
