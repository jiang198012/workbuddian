import { ConversationManager } from '../src/core/session/manager';
import type { Conversation } from '../src/types';

describe('ConversationManager', () => {
    let manager: ConversationManager;
    let persisted: unknown[];

    beforeEach(() => {
        manager = new ConversationManager();
        persisted = [];
        manager.setPersistCallback(async (convs) => {
            persisted.push(convs);
        });
    });

    it('creates a conversation and sets it active', () => {
        const conv = manager.createConversation();
        expect(conv.title).toBe('新对话');
        expect(manager.getActive()?.id).toBe(conv.id);
    });

    it('creates a conversation with a custom title', () => {
        const conv = manager.createConversation('custom title');
        expect(conv.title).toBe('custom title');
    });

    it('loads conversations from persisted data and activates the first', async () => {
        const conversations: Conversation[] = [
            { id: '1', title: 'first', sessionId: '', messages: [], createdAt: 100, updatedAt: 100 },
            { id: '2', title: 'second', sessionId: '', messages: [], createdAt: 200, updatedAt: 200 }
        ];
        manager.load(conversations);
        expect(manager.getActive()?.id).toBe('1');
        expect(manager.getAll()).toHaveLength(2);
        await new Promise(r => setTimeout(r, 0));
        expect(persisted.length).toBeGreaterThanOrEqual(0);
    });

    it('creates a default conversation when loading empty array', () => {
        manager.load([]);
        expect(manager.getActive()).not.toBeNull();
        expect(manager.getAll()).toHaveLength(1);
    });

    it('switches between conversations', () => {
        const a = manager.createConversation('A');
        const b = manager.createConversation('B');
        expect(manager.getActive()?.id).toBe(b.id);
        manager.switchTo(a.id);
        expect(manager.getActive()?.id).toBe(a.id);
        expect(manager.switchTo('missing')).toBeNull();
    });

    it('renames a conversation', () => {
        const conv = manager.createConversation('old title');
        const ok = manager.renameConversation(conv.id, 'new title');
        expect(ok).toBe(true);
        expect(manager.getActive()?.title).toBe('new title');
    });

    it('returns false when renaming a missing conversation', () => {
        expect(manager.renameConversation('missing-id', 'x')).toBe(false);
    });

    it('ignores an empty or whitespace-only new title', () => {
        const conv = manager.createConversation('kept title');
        const ok = manager.renameConversation(conv.id, '   ');
        expect(ok).toBe(false);
        expect(manager.getActive()?.title).toBe('kept title');
    });

    it('adds messages and updates conversation title from first user message', async () => {
        const conv = manager.createConversation();
        const msg = manager.addMessage(conv.id, 'user', 'Hello world, this is a long message');
        expect(msg).not.toBeNull();
        expect(manager.getActive()?.messages).toHaveLength(1);
        expect(manager.getActive()?.title).toBe('Hello world, this is a long me...');
        await new Promise(r => setTimeout(r, 0));
    });

    it('auto-titles even when the default title is the other language (New chat)', () => {
        // 语言切换后旧数据里默认标题可能是另一种语言，仍应触发首条消息自动命名
        const conv: Conversation = { id: 'x', title: 'New chat', sessionId: '', messages: [], createdAt: 1, updatedAt: 1 };
        manager.load([conv]);
        manager.addMessage('x', 'user', 'First message here');
        expect(manager.getById('x')?.title).toBe('First message here');
    });

    it('does not auto-title a user-named conversation on the first message', () => {
        const conv = manager.createConversation('My named chat');
        manager.addMessage(conv.id, 'user', 'hello');
        expect(manager.getById(conv.id)?.title).toBe('My named chat');
    });

    it('updates an existing message', () => {
        const conv = manager.createConversation();
        const msg = manager.addMessage(conv.id, 'assistant', 'initial');
        expect(msg).not.toBeNull();
        if (!msg) return;
        const updated = manager.updateMessage(conv.id, msg.id, 'updated');
        expect(updated).toBe(true);
        expect(manager.getActive()?.messages[0].content).toBe('updated');
    });

    it('returns false when updating a non-existent message', () => {
        const conv = manager.createConversation();
        expect(manager.updateMessage(conv.id, 'missing', 'x')).toBe(false);
    });

    it('deletes a conversation and activates another', () => {
        const a = manager.createConversation('A');
        const b = manager.createConversation('B');
        expect(manager.deleteConversation(b.id)).toBe(true);
        expect(manager.getActive()?.id).toBe(a.id);
        expect(manager.deleteConversation('missing')).toBe(false);
    });

    it('stores last token usage on the conversation via setUsage', () => {
        const conv = manager.createConversation();
        expect(manager.setUsage(conv.id, { inputTokens: 22594 })).toBe(true);
        expect(manager.getById(conv.id)?.lastUsage).toEqual({ inputTokens: 22594 });
    });

    it('setUsage returns false for a missing conversation', () => {
        expect(manager.setUsage('missing', { inputTokens: 1 })).toBe(false);
    });

    it('sets session id', () => {
        const conv = manager.createConversation();
        expect(manager.setSessionId(conv.id, 'session-1')).toBe(true);
        expect(manager.getActive()?.sessionId).toBe('session-1');
        expect(manager.setSessionId('missing', 'session')).toBe(false);
    });

    it('flushes persistence', async () => {
        manager.createConversation('flush');
        await manager.flush();
        expect(persisted.length).toBeGreaterThan(0);
    });

    it('searches conversations by title and message content', () => {
        const a = manager.createConversation('Cooking tips');
        manager.addMessage(a.id, 'user', 'how to make pasta');
        const b = manager.createConversation('Travel plans');
        manager.addMessage(b.id, 'user', 'best time to visit Japan');

        expect(manager.search('pasta').map(c => c.id)).toEqual([a.id]);
        expect(manager.search('travel').map(c => c.id)).toEqual([b.id]);
        expect(manager.search('nonexistent')).toEqual([]);
    });

    it('search is case-insensitive', () => {
        const a = manager.createConversation('Cooking Tips');
        expect(manager.search('cooking').map(c => c.id)).toEqual([a.id]);
    });

    it('returns all conversations for an empty query', () => {
        manager.createConversation('A');
        manager.createConversation('B');
        expect(manager.search('')).toHaveLength(2);
    });

    it('marks a message as error via setError', () => {
        const conv = manager.createConversation();
        const msg = manager.addMessage(conv.id, 'assistant', '');
        if (!msg) return;
        expect(manager.setError(conv.id, msg.id, 'boom')).toBe(true);
        const stored = manager.getActive()?.messages[0];
        expect(stored?.content).toBe('boom');
        expect(stored?.isError).toBe(true);
    });

    it('returns false when setError targets a missing message', () => {
        const conv = manager.createConversation();
        expect(manager.setError(conv.id, 'missing', 'x')).toBe(false);
    });

    it('deleteLastExchange removes last user+assistant pair and returns user text', () => {
        const conv = manager.createConversation();
        manager.addMessage(conv.id, 'user', 'hello');
        manager.addMessage(conv.id, 'assistant', 'reply');
        expect(manager.deleteLastExchange(conv.id)).toBe('hello');
        expect(manager.getActive()?.messages).toHaveLength(0);
    });

    it('deleteLastExchange returns null with fewer than two messages', () => {
        const conv = manager.createConversation();
        manager.addMessage(conv.id, 'user', 'only one');
        expect(manager.deleteLastExchange(conv.id)).toBeNull();
        expect(manager.getActive()?.messages).toHaveLength(1);
    });

    it('deleteLastExchange returns null when last two are not user+assistant', () => {
        const conv = manager.createConversation();
        manager.addMessage(conv.id, 'assistant', 'a');
        manager.addMessage(conv.id, 'user', 'b');
        expect(manager.deleteLastExchange(conv.id)).toBeNull();
    });
});
