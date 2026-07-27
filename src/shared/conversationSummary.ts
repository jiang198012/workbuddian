import { t } from '../i18n';
import type { Conversation } from '../types';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** 相对更新时间：<1 分钟「刚刚」，<1 小时用分钟，<1 天用小时，否则用天。now 由调用方传入，纯函数不读时钟 */
function relativeTime(diffMs: number): string {
    const diff = Math.max(0, diffMs);
    if (diff < MINUTE) return t('resume.justNow');
    if (diff < HOUR) return `${Math.floor(diff / MINUTE)} ${t('resume.minutesAgo')}`;
    if (diff < DAY) return `${Math.floor(diff / HOUR)} ${t('resume.hoursAgo')}`;
    return `${Math.floor(diff / DAY)} ${t('resume.daysAgo')}`;
}

/** /resume 弹窗里一条会话的展示摘要：标题为空时回退「新对话」，meta 拼消息数 + 相对更新时间 */
export function formatConversationSummary(conv: Conversation, now: number): { title: string; meta: string } {
    const title = conv.title || t('chat.newConversation');
    const meta = `${conv.messages.length} ${t('resume.messageCount')} · ${relativeTime(now - conv.updatedAt)}`;
    return { title, meta };
}
