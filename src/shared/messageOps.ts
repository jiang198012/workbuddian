/** 消息级操作的纯逻辑(编辑已发 / 重新生成)。输入消息数组 + 目标 id,输出操作后的新数组 */
import type { ChatMessage } from '../types';

/**
 * 截断到某条消息为止(含该条),删除其后的所有消息。
 * 用于"编辑已发消息":改完该条重发,其后的对话作废。
 * 返回新数组;目标 id 不存在返回 null。
 */
export function truncateAtMessage(messages: ChatMessage[], id: string): ChatMessage[] | null {
    const idx = messages.findIndex((m) => m.id === id);
    if (idx < 0) return null;
    return messages.slice(0, idx + 1);
}

/**
 * 重新生成:截断到目标 assistant 消息的前一条(不含目标),让 AI 基于上文重新回答。
 * 返回新数组(到目标前一条为止);目标不是 assistant / 不存在 / 无前驱返回 null。
 */
export function truncateBeforeMessage(messages: ChatMessage[], id: string): ChatMessage[] | null {
    const idx = messages.findIndex((m) => m.id === id);
    if (idx < 0) return null;
    const target = messages[idx];
    if (target.role !== 'assistant') return null;
    // 截断到目标的前一条(不含目标 assistant 消息),让 AI 重新回答
    return messages.slice(0, idx);
}
