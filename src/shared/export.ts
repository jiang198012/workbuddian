import type { Conversation } from '../types';
import { t } from '../i18n';

/** 毫秒时间戳 → HH:MM（用于导出里的时间标注） */
function formatTime(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

/**
 * 把一段对话格式化成 Markdown 文本。
 * 空对话（没有任何消息）返回空字符串，调用方据此判断要不要提示"没有可导出的内容"。
 *
 * 格式:标题 + 元数据行(导出时间/消息数)+ 每条消息(角色 + 时间戳 + 附件标注)
 */
export function formatConversationAsMarkdown(conv: Conversation): string {
    if (conv.messages.length === 0) return '';

    const lines: string[] = [`# ${conv.title}`, ''];
    lines.push(`> ${t('export.metaExportedAt')}: ${formatTime(Date.now())} · ${t('export.metaMessages')}: ${conv.messages.length}`, '');
    for (const msg of conv.messages) {
        const label = msg.role === 'user' ? t('export.roleUser') : t('export.roleAssistant');
        const time = formatTime(msg.timestamp);
        const errMark = msg.isError ? ' ⚠️' : '';
        lines.push(`${label} · ${time}${errMark}:`, msg.content, '');
        if (msg.attachments?.length) {
            lines.push(`> 📎 ${msg.attachments.join(', ')}`, '');
        }
    }
    return lines.join('\n').trimEnd();
}

/**
 * 批量导出:把多个会话合并成一个 Markdown 文件(带分隔线)。
 * 用于"导出所有会话"命令;空数组返回空字符串。
 */
export function formatConversationsAsMarkdown(convs: Conversation[]): string {
    const nonEmpty = convs.filter((c) => c.messages.length > 0);
    if (nonEmpty.length === 0) return '';
    const parts = nonEmpty.map((c) => formatConversationAsMarkdown(c));
    return parts.join('\n\n---\n\n').trimEnd();
}
