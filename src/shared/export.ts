import type { Conversation } from '../types';
import { t } from '../i18n';

/**
 * 把一段对话格式化成 Markdown 文本。
 * 空对话（没有任何消息）返回空字符串，调用方据此判断要不要提示"没有可导出的内容"。
 */
export function formatConversationAsMarkdown(conv: Conversation): string {
    if (conv.messages.length === 0) return '';

    const lines: string[] = [`# ${conv.title}`, ''];
    for (const msg of conv.messages) {
        const label = msg.role === 'user' ? t('export.roleUser') : t('export.roleAssistant');
        lines.push(`${label}:`, msg.content, '');
    }
    return lines.join('\n').trimEnd();
}
