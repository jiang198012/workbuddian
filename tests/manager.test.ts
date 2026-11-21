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

    it('stores attachments when provided', () => {
        const conv = manager.createConversation();
        const msg = manager.addMessage(conv.id, 'user', 'hello', ['doc.pdf', 'img.png']);
        expect(msg).not.toBeNull();
        expect(msg!.attachments).toEqual(['doc.pdf', 'img.png']);
    });

    it('does not include attachments field when none provided', () => {
        const conv = manager.createConversation();
        const msg = manager.addMessage(conv.id, 'user', 'hello');
        expect(msg).not.toBeNull();
        expect(msg!.attachments).toBeUndefined();
    });

    it('does not include attachments field when empty array provided', () => {
        const conv = manager.createConversation();
        const msg = manager.addMessage(conv.id, 'user', 'hello', []);
        expect(msg).not.toBeNull();
        expect(msg!.attachments).toBeUndefined();
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

    it('stores workspace overrides and drafts per conversation', () => {
        const first = manager.createConversation('first');
        const second = manager.createConversation('second');
        expect(manager.updateWorkspace(first.id, { model: 'deepseek-v4-pro', customInstruction: 'short' })).toBe(true);
        expect(manager.setDraft(first.id, { text: 'unfinished', attachments: ['a.pdf'] })).toBe(true);
        expect(manager.getById(first.id)?.workspace).toEqual({ model: 'deepseek-v4-pro', customInstruction: 'short' });
        expect(manager.getById(first.id)?.draft).toEqual({ text: 'unfinished', attachments: ['a.pdf'] });
        expect(manager.getById(second.id)?.workspace).toBeUndefined();
        expect(manager.getById(second.id)?.draft).toBeUndefined();
        expect(manager.setDraft(first.id, null)).toBe(true);
        expect(manager.getById(first.id)?.draft).toBeUndefined();
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

describe('acpSessionId', () => {
    it('setAcpSessionId stores id without persisting immediately', () => {
        const manager = new ConversationManager();
        const persist = jest.fn();
        manager.setPersistCallback(persist);
        const conv = manager.createConversation();
        persist.mockClear();
        expect(manager.setAcpSessionId(conv.id, 'acp-1')).toBe(true);
        expect(manager.getById(conv.id)?.acpSessionId).toBe('acp-1');
        expect(manager.setAcpSessionId('missing', 'acp-1')).toBe(false);
        expect(persist).not.toHaveBeenCalled();
    });

    it('findBySessionId locates conversation by v1 sessionId', () => {
        const manager = new ConversationManager();
        const conv = manager.createConversation();
        manager.setSessionId(conv.id, 'v1-uuid');
        expect(manager.findBySessionId('v1-uuid')?.id).toBe(conv.id);
        expect(manager.findBySessionId('nope')).toBeNull();
    });

    it('acpSessionId survives load roundtrip', () => {
        const manager = new ConversationManager();
        manager.load([{ id: 'c1', title: 't', sessionId: 's', acpSessionId: 'acp-9', messages: [], createdAt: 1, updatedAt: 1 }]);
        expect(manager.getById('c1')?.acpSessionId).toBe('acp-9');
    });
});

describe('forkConversation', () => {
    it('copies messages, writes acpSessionId, persists, and returns new conversation', () => {
        const manager = new ConversationManager();
        const persist = jest.fn();
        manager.setPersistCallback(persist);
        const src = manager.createConversation('源会话');
        manager.addMessage(src.id, 'user', 'hello');
        manager.addMessage(src.id, 'assistant', 'world');
        persist.mockClear();
        const forked = manager.forkConversation(src.id, '分叉 - 源会话', 'acp-forked-1');
        expect(forked).not.toBeNull();
        expect(forked!.messages.map((m) => m.content)).toEqual(['hello', 'world']);
        expect(forked!.messages[0].id).not.toBe(src.messages[0].id); // 消息 id 重新生成
        expect(forked!.acpSessionId).toBe('acp-forked-1');
        expect(forked!.sessionId).toBe('');
        expect(persist).toHaveBeenCalled();
        expect(manager.forkConversation('missing', 't', 'x')).toBeNull();
    });

    it('copies workspace overrides but starts the fork with an empty draft', () => {
        const manager = new ConversationManager();
        const src = manager.createConversation('源会话');
        manager.updateWorkspace(src.id, { model: 'deepseek-v4-pro' });
        manager.setDraft(src.id, { text: 'draft', attachments: ['x.md'] });
        const forked = manager.forkConversation(src.id, '分叉', 'acp-forked-2');
        expect(forked?.workspace).toEqual({ model: 'deepseek-v4-pro' });
        expect(forked?.draft).toBeUndefined();
    });
});

describe('closing tabs keeps conversations (#16)', () => {
    const withMessage = (manager: ConversationManager, title: string) => {
        const conv = manager.createConversation(title);
        manager.addMessage(conv.id, 'user', `${title} message`);
        return conv;
    };

    it('closes a conversation without deleting it and moves the initial pointer to an open one', () => {
        const manager = new ConversationManager();
        const a = withMessage(manager, 'A');
        const b = withMessage(manager, 'B');
        expect(manager.closeConversation(b.id)).toBe('closed');
        expect(manager.getById(b.id)?.closed).toBe(true);
        expect(manager.getById(b.id)?.messages).toHaveLength(1);
        expect(manager.getOpen().map((c) => c.id)).toEqual([a.id]);
        expect(manager.getAll().map((c) => c.id)).toContain(b.id);
        expect(manager.getActive()?.id).toBe(a.id);
        expect(manager.search('B message').map((c) => c.id)).toEqual([b.id]);
        expect(manager.closeConversation('missing')).toBeNull();
    });

    it('discards an empty conversation on close but keeps one that only has a draft', () => {
        const manager = new ConversationManager();
        withMessage(manager, 'A');
        const empty = manager.createConversation('empty');
        const drafted = manager.createConversation('drafted');
        manager.setDraft(drafted.id, { text: 'unsent', attachments: [] });
        expect(manager.closeConversation(empty.id)).toBe('deleted');
        expect(manager.getById(empty.id)).toBeNull();
        expect(manager.closeConversation(drafted.id)).toBe('closed');
        expect(manager.getById(drafted.id)?.draft?.text).toBe('unsent');
    });

    it('leaves a fresh open conversation when the last open tab is closed', () => {
        const manager = new ConversationManager();
        const only = withMessage(manager, 'only');
        expect(manager.closeConversation(only.id)).toBe('closed');
        const open = manager.getOpen();
        expect(open).toHaveLength(1);
        expect(open[0].id).not.toBe(only.id);
        expect(open[0].messages).toEqual([]);
        expect(manager.getActive()?.id).toBe(open[0].id);
    });

    it('also leaves an open conversation when deleting the last open tab while others are closed', () => {
        const manager = new ConversationManager();
        const closed = withMessage(manager, 'closed');
        const last = withMessage(manager, 'last');
        manager.closeConversation(closed.id);
        expect(manager.deleteConversation(last.id)).toBe(true);
        const open = manager.getOpen();
        expect(open).toHaveLength(1);
        expect(open[0].id).not.toBe(closed.id);
        expect(manager.getActive()?.id).toBe(open[0].id);
    });

    it('reopens a closed conversation and persists the closed flag', () => {
        const manager = new ConversationManager();
        const persist = jest.fn(async (_convs: Conversation[]) => {});
        manager.setPersistCallback(persist);
        withMessage(manager, 'A');
        const b = withMessage(manager, 'B');
        manager.closeConversation(b.id);
        const saved = persist.mock.calls.at(-1)![0];
        expect(saved.find((c) => c.id === b.id)?.closed).toBe(true);
        expect(manager.reopenConversation(b.id)).toBe(true);
        expect(manager.getById(b.id)?.closed).toBeUndefined();
        expect(manager.getOpen().map((c) => c.id)).toContain(b.id);
        expect(manager.reopenConversation(b.id)).toBe(false);
        expect(manager.reopenConversation('missing')).toBe(false);
    });

    it('loads closed flags strictly and starts on the first open conversation', () => {
        const manager = new ConversationManager();
        manager.load([
            { id: 'c', title: 'closed', sessionId: '', messages: [], createdAt: 3, updatedAt: 3, closed: true },
            { id: 'junk', title: 'junk flag', sessionId: '', messages: [], createdAt: 2, updatedAt: 2,
                closed: 'yes' as unknown as boolean },
            { id: 'o', title: 'open', sessionId: '', messages: [], createdAt: 1, updatedAt: 1 },
        ]);
        expect(manager.getById('c')?.closed).toBe(true);
        expect(manager.getById('junk')?.closed).toBeUndefined();
        expect(manager.getActive()?.id).toBe('junk');
        expect(manager.getOpen().map((c) => c.id)).toEqual(['junk', 'o']);
    });
});
