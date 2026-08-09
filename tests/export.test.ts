import { formatConversationAsMarkdown } from '../src/shared/export';
import type { Conversation } from '../src/types';

function makeConv(messages: Conversation['messages']): Conversation {
    return {
        id: '1', title: 'Test Chat', sessionId: 's1',
        messages, createdAt: 1000, updatedAt: 2000,
    };
}

describe('formatConversationAsMarkdown', () => {
    it('formats messages with role labels and timestamps', () => {
        const conv = makeConv([
            { id: 'm1', role: 'user', content: 'hello', timestamp: 3_600_000 },
            { id: 'm2', role: 'assistant', content: 'hi there', timestamp: 3_700_000 },
        ]);
        const result = formatConversationAsMarkdown(conv);
        expect(result).toContain('# Test Chat');
        expect(result).toContain('> 导出时间:'); // 元数据行
        // 消息带 HH:MM 时间戳(不依赖具体时区,只断言格式)
        expect(result).toMatch(/\*\*用户\*\* · \d{2}:\d{2}:\nhello/);
        expect(result).toMatch(/\*\*AI\*\* · \d{2}:\d{2}:\nhi there/);
    });

    it('annotates attachments and error messages', () => {
        const conv = makeConv([
            { id: 'm1', role: 'user', content: 'see pic', timestamp: 1000, attachments: ['/vault/a.png'] },
            { id: 'm2', role: 'assistant', content: 'error', timestamp: 2000, isError: true },
        ]);
        const result = formatConversationAsMarkdown(conv);
        expect(result).toContain('> 📎 /vault/a.png');
        expect(result).toMatch(/\*\*AI\*\* · \d{2}:\d{2} ⚠️:/);
    });

    it('returns an empty string for a conversation with no messages', () => {
        const conv: Conversation = { id: '2', title: 'Empty', sessionId: '', messages: [], createdAt: 0, updatedAt: 0 };
        expect(formatConversationAsMarkdown(conv)).toBe('');
    });
});
