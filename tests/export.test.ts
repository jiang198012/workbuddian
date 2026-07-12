import { formatConversationAsMarkdown } from '../src/shared/export';
import type { Conversation } from '../src/types';

describe('formatConversationAsMarkdown', () => {
    it('formats messages with role labels', () => {
        const conv: Conversation = {
            id: '1',
            title: 'Test Chat',
            sessionId: 's1',
            messages: [
                { id: 'm1', role: 'user', content: 'hello', timestamp: 1000 },
                { id: 'm2', role: 'assistant', content: 'hi there', timestamp: 2000 }
            ],
            createdAt: 1000,
            updatedAt: 2000
        };
        const result = formatConversationAsMarkdown(conv);
        expect(result).toContain('# Test Chat');
        expect(result).toContain('**用户**:\nhello');
        expect(result).toContain('**AI**:\nhi there');
    });

    it('returns an empty string for a conversation with no messages', () => {
        const conv: Conversation = {
            id: '2', title: 'Empty', sessionId: '', messages: [], createdAt: 0, updatedAt: 0
        };
        expect(formatConversationAsMarkdown(conv)).toBe('');
    });
});
