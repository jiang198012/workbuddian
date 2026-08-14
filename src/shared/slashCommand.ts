import { t } from '../i18n';

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

/** 透传给 CLI 的命令(加 '(CLI)' 标注,区分插件本地命令) */
const CLI_PASSTHROUGH = new Set(['context', 'cost', 'status', 'compact']);

export const BUILTIN_SLASH_COMMANDS: { name: string; descKey: string }[] = [
    { name: 'clear', descKey: 'slash.clear' },
    { name: 'resume', descKey: 'slash.resume' },
    { name: 'effort', descKey: 'slash.effort' },
    // 透传 CLI 的交互式命令(CLI 侧处理,补全里标注)
    { name: 'compact', descKey: 'slash.compact' },
    { name: 'context', descKey: 'slash.context' },
    { name: 'cost', descKey: 'slash.cost' },
    { name: 'status', descKey: 'slash.status' },
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
    return BUILTIN_SLASH_COMMANDS
        .filter(c => c.name.toLowerCase().startsWith(q))
        .map(c => ({
            name: c.name,
            // 透传 CLI 的命令加 '(CLI)' 标注,区分插件本地命令
            desc: CLI_PASSTHROUGH.has(c.name) ? `${t(c.descKey)} (CLI)` : t(c.descKey),
        }));
}

/** `.codebuddy/commands/` 下的相对路径 → 命令名（去 .md，子目录用 : 连接） */
export function commandNameFromPath(relPath: string): string {
    return relPath.replace(/\.md$/, '').split('/').join(':');
}

export interface CommandFrontmatter { description: string; argumentHint: string; }

/** 从命令 md 的 YAML frontmatter 提取 description / argument-hint（缺失为空串） */
export function parseCommandFrontmatter(content: string): CommandFrontmatter {
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    const fm = m ? m[1] : '';
    const desc = fm.match(/^description:\s*(.*)$/m);
    const hint = fm.match(/^argument-hint:\s*(.*)$/m);
    return {
        description: desc ? desc[1].trim() : '',
        argumentHint: hint ? hint[1].trim() : '',
    };
}
