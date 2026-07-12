import type { Conversation, ChatMessage } from '../../types';
import { generateId, getErrorMessage } from '../../types';

export class ConversationManager {
    private conversations: Map<string, Conversation> = new Map();
    private activeId: string | null = null;
    private persistCallback: ((convs: Conversation[]) => Promise<void>) | null = null;

    setPersistCallback(callback: (convs: Conversation[]) => Promise<void>) {
        this.persistCallback = callback;
    }

    /** 判断是否已经加载过对话数据（用于避免多个同时打开的视图重复 load() 时用旧快照互相覆盖） */
    hasConversations(): boolean {
        return this.conversations.size > 0;
    }

    private async persist() {
        if (this.persistCallback) {
            await this.persistCallback(this.getAll());
        }
    }

    private handlePersistError(error: unknown) {
        console.error('[BB] persist failed:', getErrorMessage(error));
    }

    /** 显式触发持久化（流式结束后调用） */
    async flush(): Promise<void> {
        await this.persist();
    }

    /** 从持久化数据加载对话 */
    load(conversations: Conversation[]) {
        if (!conversations || conversations.length === 0) {
            // 创建一个新对话作为默认
            this.createConversation();
            return;
        }
        for (const conv of conversations) {
            this.conversations.set(conv.id, { ...conv });
        }
        // 激活第一个
        this.activeId = conversations[0].id;
    }

    /** 创建新对话 */
    createConversation(title?: string): Conversation {
        const id = generateId();
        const conv: Conversation = {
            id,
            title: title || '新对话',
            sessionId: '', // 首次发送消息时由 Gateway 分配
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        this.conversations.set(id, conv);
        this.activeId = id;
        this.persist().catch((err) => this.handlePersistError(err));
        return conv;
    }

    /** 删除对话 */
    deleteConversation(id: string): boolean {
        if (!this.conversations.has(id)) return false;
        this.conversations.delete(id);
        if (this.activeId === id) {
            const remaining = this.getAll();
            this.activeId = remaining.length > 0 ? remaining[0].id : null;
        }
        this.persist().catch((err) => this.handlePersistError(err));
        return true;
    }

    /** 切换到指定对话 */
    switchTo(id: string): Conversation | null {
        const conv = this.conversations.get(id);
        if (!conv) return null;
        this.activeId = id;
        return conv;
    }

    /** 重命名对话 */
    renameConversation(id: string, newTitle: string): boolean {
        const trimmed = newTitle.trim();
        if (!trimmed) return false;
        const conv = this.conversations.get(id);
        if (!conv) return false;
        conv.title = trimmed;
        conv.updatedAt = Date.now();
        this.persist().catch((err) => this.handlePersistError(err));
        return true;
    }

    /** 获取当前活跃对话 */
    getActive(): Conversation | null {
        if (!this.activeId) return null;
        return this.conversations.get(this.activeId) || null;
    }

    /** 按 id 精确查找对话，不依赖也不影响内部 activeId —— 供各视图维护各自独立的活跃对话指针 */
    getById(id: string): Conversation | null {
        return this.conversations.get(id) || null;
    }

    /** 获取所有对话（按更新时间倒序） */
    getAll(): Conversation[] {
        return Array.from(this.conversations.values())
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    /** 按标题和消息正文做本地大小写不敏感的包含匹配 */
    search(query: string): Conversation[] {
        const trimmed = query.trim().toLowerCase();
        if (!trimmed) return this.getAll();
        return this.getAll().filter((conv) => {
            if (conv.title.toLowerCase().includes(trimmed)) return true;
            return conv.messages.some((msg) => msg.content.toLowerCase().includes(trimmed));
        });
    }

    /** 添加消息到当前活跃对话 */
    addMessage(convId: string, role: 'user' | 'assistant', content: string): ChatMessage | null {
        const conv = this.conversations.get(convId);
        if (!conv) return null;

        const msg: ChatMessage = {
            id: generateId(),
            role,
            content,
            timestamp: Date.now()
        };
        conv.messages.push(msg);
        conv.updatedAt = Date.now();

        // 首条用户消息自动生成标题
        if (conv.title === '新对话' && role === 'user' && content.trim()) {
            conv.title = content.substring(0, 30) + (content.length > 30 ? '...' : '');
        }

        this.persist().catch((err) => this.handlePersistError(err));
        return msg;
    }

    /** 更新指定消息内容（用于流式追加） */
    updateMessage(convId: string, msgId: string, content: string, skipSave = false): boolean {
        const conv = this.conversations.get(convId);
        if (!conv) return false;
        const msg = conv.messages.find(m => m.id === msgId);
        if (!msg) return false;
        msg.content = content;
        conv.updatedAt = Date.now();
        if (!skipSave) {
            this.persist().catch((err) => this.handlePersistError(err));
        }
        return true;
    }

    /** 设置对话的 Gateway sessionId */
    setSessionId(convId: string, sessionId: string): boolean {
        const conv = this.conversations.get(convId);
        if (!conv) return false;
        conv.sessionId = sessionId;
        return true;
    }

    /** 把某条消息标记为错误并设置文案 */
    setError(convId: string, msgId: string, content: string): boolean {
        const conv = this.conversations.get(convId);
        if (!conv) return false;
        const msg = conv.messages.find(m => m.id === msgId);
        if (!msg) return false;
        msg.content = content;
        msg.isError = true;
        conv.updatedAt = Date.now();
        this.persist().catch((err) => this.handlePersistError(err));
        return true;
    }

    /** 删除最后一对 user+assistant 消息，返回该 user 文本（供重试重发）；不满足返回 null */
    deleteLastExchange(convId: string): string | null {
        const conv = this.conversations.get(convId);
        if (!conv || conv.messages.length < 2) return null;
        const last = conv.messages[conv.messages.length - 1];
        const prev = conv.messages[conv.messages.length - 2];
        if (last.role !== 'assistant' || prev.role !== 'user') return null;
        const userText = prev.content;
        conv.messages.splice(conv.messages.length - 2, 2);
        conv.updatedAt = Date.now();
        this.persist().catch((err) => this.handlePersistError(err));
        return userText;
    }

}
