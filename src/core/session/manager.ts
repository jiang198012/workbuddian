import type { Conversation, ChatMessage, UsageInfo } from '../../types';
import { generateId, getErrorMessage } from '../../types';
import { fallbackTitle } from '../../shared/autoTitle';
import { t, matchesAnyLang } from '../../i18n';
import { bbError } from '../../shared/logBuffer';

function newConversation(title?: string): Conversation {
    const now = Date.now();
    return {
        id: generateId(),
        title: title?.trim() ? title.trim() : t('chat.newConversation'),
        sessionId: '', // 首次发送消息时分配
        messages: [],
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * 会话集合的内存真相源：工厂 → 查询 → 变更 → 持久化。
 * 持久化经 persistCallback 单点出口，任何写失败只记日志不抛出（聊天不能因落盘失败而中断）。
 * activeId 仅作"初始绑定"提示（view 打开/加载历史时读一次）；运行期活跃指针在每个 view 自己手里。
 */
export class ConversationManager {
    private readonly conversations = new Map<string, Conversation>();
    private activeId: string | null = null;
    private persistCallback: ((convs: Conversation[]) => Promise<void>) | null = null;

    // ---- 工厂 ----

    /** 创建新对话（写入即激活初始指针并持久化） */
    createConversation(title?: string): Conversation {
        const conv = newConversation(title);
        this.conversations.set(conv.id, conv);
        this.activeId = conv.id;
        this.commit();
        return conv;
    }

    /** 分叉会话：复制源会话消息（id 重生成）、写入 CLI 分配的分叉 acpSessionId；源不存在返回 null */
    forkConversation(sourceId: string, title: string, acpSessionId: string): Conversation | null {
        const src = this.conversations.get(sourceId);
        if (!src) return null;
        const forked = this.createConversation(title);
        forked.messages = src.messages.map((m) => ({ ...m, id: generateId() }));
        forked.sessionId = ''; // 首次发送时生成新 key；CLI 侧上下文走 acpSessionId load
        forked.acpSessionId = acpSessionId;
        forked.updatedAt = Date.now();
        this.commit();
        return forked;
    }

    // ---- 查询 ----

    /** 按 id 精确查找，不依赖也不影响初始指针 —— 供各视图维护各自独立的活跃对话指针 */
    getById(id: string): Conversation | null {
        return this.conversations.get(id) || null;
    }

    /** 初始指针指向的对话 */
    getActive(): Conversation | null {
        return (this.activeId && this.conversations.get(this.activeId)) || null;
    }

    /** 全部对话，按更新时间倒序 */
    getAll(): Conversation[] {
        // 置顶的排最前(各自内部按 updatedAt 降序)
        return [...this.conversations.values()].sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return b.updatedAt - a.updatedAt;
        });
    }

    /** 按标题和消息正文做本地大小写不敏感的包含匹配；空串返回全部 */
    search(query: string): Conversation[] {
        const needle = query.trim().toLowerCase();
        const all = this.getAll();
        if (!needle) return all;
        return all.filter((conv) =>
            conv.title.toLowerCase().includes(needle)
            || conv.messages.some((msg) => msg.content.toLowerCase().includes(needle)));
    }

    /** 按 v1 sessionId 反查会话，供 provider 的 ConversationLookup 注入用 */
    findBySessionId(sessionId: string): Conversation | null {
        for (const conv of this.conversations.values()) {
            if (conv.sessionId === sessionId) return conv;
        }
        return null;
    }

    /** 是否已加载过对话数据（避免多面板重复 load() 时用旧快照互相覆盖） */
    hasConversations(): boolean {
        return this.conversations.size > 0;
    }

    // ---- 变更 ----

    /** 追加消息；首条用户消息触发截断标题（跨语言识别默认标题，兼容切换语言前后的旧数据） */
    addMessage(convId: string, role: 'user' | 'assistant', content: string, attachments?: string[]): ChatMessage | null {
        const conv = this.conversations.get(convId);
        if (!conv) return null;
        const msg: ChatMessage = { id: generateId(), role, content, timestamp: Date.now() };
        if (attachments?.length) msg.attachments = attachments;
        conv.messages.push(msg);
        conv.updatedAt = Date.now();
        if (matchesAnyLang(conv.title, 'chat.newConversation') && role === 'user' && content.trim()) {
            conv.title = fallbackTitle(content);
        }
        this.commit();
        return msg;
    }

    /** 更新指定消息内容（用于流式追加）；skipSave 跳过持久化（流式中高频调用，末尾 flush 兜底） */
    updateMessage(convId: string, msgId: string, content: string, skipSave = false): boolean {
        const msg = this.conversations.get(convId)?.messages.find((m) => m.id === msgId);
        if (!msg) return false;
        msg.content = content;
        const conv = this.conversations.get(convId)!;
        conv.updatedAt = Date.now();
        if (!skipSave) this.commit();
        return true;
    }

    /** 记录对话最近一轮的 token 用量（流式内更新，随后 flush 持久化） */
    setUsage(convId: string, usage: UsageInfo): boolean {
        const conv = this.conversations.get(convId);
        if (!conv) return false;
        conv.lastUsage = usage;
        return true;
    }

    /** 把某条消息标记为错误并设置文案 */
    setError(convId: string, msgId: string, content: string): boolean {
        const msg = this.conversations.get(convId)?.messages.find((m) => m.id === msgId);
        if (!msg) return false;
        msg.content = content;
        msg.isError = true;
        this.conversations.get(convId)!.updatedAt = Date.now();
        this.commit();
        return true;
    }

    /** 回写 v1 sessionId（provider 会话 key）；不单独持久化，靠同轮后续 commit/flush 顺带落盘 */
    setSessionId(convId: string, sessionId: string): boolean {
        const conv = this.conversations.get(convId);
        if (!conv) return false;
        conv.sessionId = sessionId;
        return true;
    }

    /** 回写 CLI 分配的 ACP 会话 id；持久化时机同 setSessionId */
    setAcpSessionId(convId: string, acpSessionId: string): boolean {
        const conv = this.conversations.get(convId);
        if (!conv) return false;
        conv.acpSessionId = acpSessionId;
        return true;
    }

    /** 重命名对话（空名拒绝） */
    renameConversation(id: string, newTitle: string): boolean {
        const trimmed = newTitle.trim();
        if (!trimmed) return false;
        const conv = this.conversations.get(id);
        if (!conv) return false;
        conv.title = trimmed;
        conv.updatedAt = Date.now();
        this.commit();
        return true;
    }

    /** 切换会话置顶状态；返回切换后的 pinned 值（未找到返回 null） */
    togglePinned(id: string): boolean | null {
        const conv = this.conversations.get(id);
        if (!conv) return null;
        conv.pinned = !conv.pinned;
        this.commit();
        return conv.pinned;
    }

    /** 切换到指定对话（仅移动初始指针） */
    switchTo(id: string): Conversation | null {
        const conv = this.conversations.get(id);
        if (!conv) return null;
        this.activeId = id;
        return conv;
    }

    /** 删除对话；被删的是初始指针指向的对话时改指到最新一个 */
    deleteConversation(id: string): boolean {
        const existed = this.conversations.delete(id);
        if (!existed) return false;
        if (this.activeId === id) {
            this.activeId = this.getAll()[0]?.id ?? null;
        }
        this.commit();
        return true;
    }

    /** 删除最后一对 user+assistant 消息，返回该 user 文本（供重试重发）；结构不满足返回 null */
    deleteLastExchange(convId: string): string | null {
        const conv = this.conversations.get(convId);
        const messages = conv?.messages;
        if (!conv || !messages || messages.length < 2) return null;
        const last = messages[messages.length - 1];
        const prev = messages[messages.length - 2];
        if (last.role !== 'assistant' || prev.role !== 'user') return null;
        messages.length -= 2;
        conv.updatedAt = Date.now();
        this.commit();
        return prev.content;
    }

    /**
     * 截断会话到某条消息为止（含该条），删除其后的所有消息。
     * 用于消息级操作：编辑已发（改完该条重发）/ 重新生成（截到该条前一条让 AI 重答）。
     * 返回截断后的消息数；目标 id 不存在返回 null。
     */
    truncateToMessage(convId: string, msgId: string, inclusive = true): number | null {
        const conv = this.conversations.get(convId);
        const messages = conv?.messages;
        if (!conv || !messages) return null;
        const idx = messages.findIndex((m) => m.id === msgId);
        if (idx < 0) return null;
        messages.length = inclusive ? idx + 1 : idx;
        conv.updatedAt = Date.now();
        this.commit();
        return messages.length;
    }

    // ---- 持久化 ----

    setPersistCallback(callback: (convs: Conversation[]) => Promise<void>) {
        this.persistCallback = callback;
    }

    /** 变更统一出口：写操作调用它把当前全量交给持久化回调 */
    private commit() {
        if (!this.persistCallback) return;
        // Promise.resolve 包一层：容忍测试里不返回 Promise 的 mock
        void Promise.resolve(this.persistCallback(this.getAll())).catch((err) => {
            bbError('[WB] persist failed:', getErrorMessage(err));
        });
    }

    /** 显式触发持久化（流式结束后调用） */
    async flush(): Promise<void> {
        if (this.persistCallback) await this.persistCallback(this.getAll());
    }

    /** 从持久化数据加载对话；空数据补一个默认新对话 */
    load(conversations: Conversation[]) {
        if (!conversations?.length) {
            this.createConversation();
            return;
        }
        conversations.forEach((conv) => this.conversations.set(conv.id, { ...conv }));
        this.activeId = conversations[0].id;
    }
}
