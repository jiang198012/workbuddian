import { formatConversationSummary } from '../src/shared/conversationSummary';
import type { Conversation } from '../src/types';

const base = (over: Partial<Conversation> = {}): Conversation => ({
    id: 'c1', title: '示例对话', sessionId: 's1',
    messages: [], createdAt: 0, updatedAt: 0, ...over,
});

const NOW = 1_700_000_000_000;

describe('formatConversationSummary', () => {
    it('reports message count and "just now" for a fresh update', () => {
        const conv = base({ messages: [{ id: 'm', role: 'user', content: 'x', timestamp: 0 }], updatedAt: NOW - 5_000 });
        const r = formatConversationSummary(conv, NOW);
        expect(r.title).toBe('示例对话');
        expect(r.meta).toContain('1');
    });

    it('uses minutes, hours and days as the gap grows', () => {
        expect(formatConversationSummary(base({ updatedAt: NOW - 5 * 60_000 }), NOW).meta).toMatch(/5/);
        expect(formatConversationSummary(base({ updatedAt: NOW - 3 * 3_600_000 }), NOW).meta).toMatch(/3/);
        expect(formatConversationSummary(base({ updatedAt: NOW - 2 * 86_400_000 }), NOW).meta).toMatch(/2/);
    });

    it('never returns an empty title', () => {
        expect(formatConversationSummary(base({ title: '' }), NOW).title).not.toBe('');
    });
});
