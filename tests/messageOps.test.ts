import { truncateAtMessage, truncateBeforeMessage } from '../src/shared/messageOps';
import type { ChatMessage } from '../src/types';

const msgs: ChatMessage[] = [
    { id: 'u1', role: 'user', content: '问题1', timestamp: 1 },
    { id: 'a1', role: 'assistant', content: '回答1', timestamp: 2 },
    { id: 'u2', role: 'user', content: '问题2', timestamp: 3 },
    { id: 'a2', role: 'assistant', content: '回答2', timestamp: 4 },
    { id: 'u3', role: 'user', content: '问题3', timestamp: 5 },
    { id: 'a3', role: 'assistant', content: '回答3', timestamp: 6 },
];

describe('truncateAtMessage (编辑已发)', () => {
    it('truncates to the target message inclusive', () => {
        expect(truncateAtMessage(msgs, 'u2')!.map(m => m.id)).toEqual(['u1', 'a1', 'u2']);
    });
    it('returns null for unknown id', () => {
        expect(truncateAtMessage(msgs, 'nope')).toBeNull();
    });
});

describe('truncateBeforeMessage (重新生成)', () => {
    it('truncates to before the assistant message, keeping prior user context', () => {
        expect(truncateBeforeMessage(msgs, 'a2')!.map(m => m.id)).toEqual(['u1', 'a1', 'u2']);
    });
    it('returns null for user messages', () => {
        expect(truncateBeforeMessage(msgs, 'u2')).toBeNull();
    });
    it('returns null for unknown id', () => {
        expect(truncateBeforeMessage(msgs, 'nope')).toBeNull();
    });
});
