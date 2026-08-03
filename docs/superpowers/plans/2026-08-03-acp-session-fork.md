# 会话分叉（fork）UI 实现计划——任务 A

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. inline 执行。

**Goal:** 会话右键菜单「分叉当前会话」，经 ACP `/branch` 开出支线会话并切换过去。

**Architecture:** `AcpSession.fork()` 发 `/branch` prompt 并从 `session_info_update._meta` 捕获 `newSessionId`；provider 加 `forkSession` 薄壳；manager 加 `forkConversation`（复制消息 + 回写 acpSessionId）；tabs.ts 右键菜单接入。

**Spec:** `docs/superpowers/specs/2026-08-03-acp-session-fork-design.md`

## Global Constraints

- `acp/*` 零 obsidian import；UI 改动仅 tabs.ts 菜单 + handler。
- fork 轮任何 chunk/usage 不进 UI、不写 manager。
- 每 Task `npx jest <相关>` 绿；最后全量 + build。
- 完成后按 conventional commits 提交（已获授权）。

---

### Task 1: `AcpSession.fork()` + newSessionId 捕获

**Files:** Modify `src/providers/codebuddy/acp/session.ts`；Test `tests/acpSession.test.ts`

**Interfaces:**
- Produces: `fork(name: string): Promise<string>`（返回 newSessionId；busy/未加载抛 `'session busy'`/`'session not loaded'`；60s 超时或未捕获 id 抛 `'fork failed'`）；私有字段 `lastForkedSessionId: string | null`。

- [ ] **Step 1: 写失败测试**（追加 `tests/acpSession.test.ts`）

```ts
describe('AcpSession.fork', () => {
    it('sends /branch prompt and returns the captured newSessionId', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const lookup = makeLookup(); lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/v');
        const forked = s.fork('分叉 - 测试');
        // fork 轮期间到达的 newSessionId（handlers 丢弃 chunks，但 fork id 必须捕获）
        s.handleUpdate({ sessionUpdate: 'session_info_update', _meta: { 'codebuddy.ai/sessionReset': true, 'codebuddy.ai/newSessionId': 'acp-forked-1' } });
        // fork 轮的普通 chunk 不得外泄
        s.handleUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'branch ok' } });
        await expect(forked).resolves.toBe('acp-forked-1');
        const promptCall = client.request.mock.calls.find((c) => c[0] === 'session/prompt');
        expect(promptCall![1]).toMatchObject({ sessionId: 'acp-stored', prompt: [{ type: 'text', text: '/branch 分叉 - 测试' }] });
        expect(s.status).toBe('idle');
    });
    it('rejects when busy or not loaded', async () => {
        const client = makeFakeClient();
        const s = new AcpSession('k', client, makeLookup(), { model: '', mode: '' });
        await expect(s.fork('x')).rejects.toThrow('session not loaded');
    });
    it('throws fork failed when no newSessionId arrives', async () => {
        const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
        const lookup = makeLookup(); lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('k', client, lookup, { model: '', mode: '' });
        await s.ensureLoaded('/v');
        await expect(s.fork('x')).rejects.toThrow('fork failed');
    });
});
```

- [ ] **Step 2: 跑测试确认失败** — `npx jest tests/acpSession.test.ts -t fork`。
- [ ] **Step 3: 实现**

```ts
// 字段区加：
private lastForkedSessionId: string | null = null;

// handleUpdate 最前部（status==='loading' 检查之后、handlers 空检查之前）加：
if (update.sessionUpdate === 'session_info_update') {
    const meta = update._meta as Record<string, unknown> | undefined;
    const forked = meta?.['codebuddy.ai/newSessionId'];
    if (meta?.['codebuddy.ai/sessionReset'] && typeof forked === 'string') {
        this.lastForkedSessionId = forked;
    }
}

// 新方法：
/** 会话级分叉：发 /branch prompt，从 session_info_update 捕获 newSessionId；fork 轮 chunk 全部丢弃 */
async fork(name: string): Promise<string> {
    if (this.status !== 'idle') throw new Error('session busy');
    if (!this.acpSessionId) throw new Error('session not loaded');
    this.lastForkedSessionId = null;
    const sink: TurnHandlers = { onChunk: () => {}, onError: () => {} };
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('fork failed')), 60_000));
    const run = this.prompt(`/branch ${name}`, sink);
    await Promise.race([run, timeout]);
    if (!this.lastForkedSessionId) throw new Error('fork failed');
    return this.lastForkedSessionId;
}
```

注意 `prompt()` 会走 session/prompt 并等 stopReason；fork 轮 stopReason end_turn → resolve。`session busy` 复用 prompt 的状态机守卫——fork 自己先检一遍再调 prompt（prompt 内还有一道）。

- [ ] **Step 4: 跑测试确认通过** — `npx jest tests/acpSession.test.ts` 全绿。
- [ ] **Step 5: Commit** — `feat(acp): 会话分叉 fork()（/branch + newSessionId 捕获）`

---

### Task 2: `provider.forkSession()` + `manager.forkConversation()`

**Files:** Modify `src/providers/codebuddy/index.ts`、`src/core/session/manager.ts`；Test `tests/api.test.ts`（fake client 追加）、`tests/manager.test.ts`

**Interfaces:**
- Produces: `forkSession(sessionKey: string, name: string): Promise<string>`；`ConversationManager.forkConversation(sourceId: string, title: string, acpSessionId: string): Conversation | null`。

- [ ] **Step 1: 写失败测试**

`tests/manager.test.ts` 追加：

```ts
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
});
```

`tests/api.test.ts` 追加（fake client 的 session/prompt 对 `/branch ` 前缀文本返 end_turn）：

```ts
it('forkSession loads the session then returns the forked acpSessionId', async () => {
    const { fake, events } = makeFakeClient(MockAcpClient);
    fake.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
        if (method === 'session/prompt') {
            const text = (params.prompt as Array<{ text: string }>)[0].text;
            if (text.startsWith('/branch ')) {
                events().onSessionUpdate('acp-1', { sessionUpdate: 'session_info_update', _meta: { 'codebuddy.ai/sessionReset': true, 'codebuddy.ai/newSessionId': 'acp-forked-9' } });
            }
            return { stopReason: 'end_turn' };
        }
        if (method === 'session/new') return { sessionId: 'acp-1' };
        if (method === 'session/load') throw new Error('not found');
        return {};
    });
    const api = new CodebuddyProvider();
    await expect(api.forkSession('s1', '分叉 - x', '/v')).resolves.toBe('acp-forked-9');
    expect(fake.request).toHaveBeenCalledWith('session/new', expect.objectContaining({ cwd: '/v' }));
});
```

- [ ] **Step 2: 跑测试确认失败** — `npx jest tests/manager.test.ts tests/api.test.ts`。
- [ ] **Step 3: 实现**

`index.ts`（cancel 方法附近加）：

```ts
/** 会话级分叉：懒加载后走 /branch，返回 CLI 分配的新 acpSessionId（失败抛本地化错误） */
async forkSession(sessionKey: string, name: string, vaultPath?: string): Promise<string> {
    const session = this.registry.get(sessionKey);
    try {
        await this.client.ensureStarted();
        await session.ensureLoaded(vaultPath);
    } catch (e) {
        throw new Error(this.startErrorMessage(e));
    }
    return session.fork(name);
}
```

`manager.ts`（`deleteLastExchange` 后加）：

```ts
/** 分叉会话：复制源会话消息（id 重生成）、写入 CLI 分配的分叉 acpSessionId；源不存在返回 null */
forkConversation(sourceId: string, title: string, acpSessionId: string): Conversation | null {
    const src = this.conversations.get(sourceId);
    if (!src) return null;
    const forked = this.createConversation(title);
    forked.messages = src.messages.map((m) => ({ ...m, id: generateId() }));
    forked.sessionId = ''; // 首次发送时由 input.ts 生成 v1 key；CLI 侧上下文走 acpSessionId load
    forked.acpSessionId = acpSessionId;
    forked.updatedAt = Date.now();
    this.persist().catch((err) => this.handlePersistError(err));
    return forked;
}
```

（`generateId` 已在 manager.ts import。）

- [ ] **Step 4: 跑测试确认通过** — `npx jest tests/manager.test.ts tests/api.test.ts` 全绿。
- [ ] **Step 5: Commit** — `feat: provider.forkSession + manager.forkConversation`

---

### Task 3: i18n + tabs 右键菜单 + smoke 增补

**Files:** Modify `src/i18n/index.ts`、`src/features/chat/tabs.ts`、`scripts/acp-smoke.mjs`

- [ ] **Step 1: i18n 新增**（tabs 组附近）：

```ts
'tabs.fork': { zh: '分叉当前会话', en: 'Fork this chat' },
'tabs.forked': { zh: '已分叉：{title}', en: 'Forked: {title}' },
'tabs.forkFailed': { zh: '分叉失败', en: 'Fork failed' },
'tabs.forkNeedMessage': { zh: '先发送一条消息，才能分叉', en: 'Send a message first to fork' },
'tabs.forkStreaming': { zh: '正在响应中，稍候再分叉', en: 'Wait for the response to finish before forking' },
```

- [ ] **Step 2: tabs.ts 菜单项**——先读现有右键菜单构建段（导出/复制菜单处），加「分叉当前会话」项，handler：

```ts
async function forkChat(view: WorkbuddianChatView, id: string) {
    const conv = view.manager.getById(id);
    if (!conv) return;
    if (!conv.sessionId) { new Notice(t('tabs.forkNeedMessage')); return; }
    if (view.isStreaming) { new Notice(t('tabs.forkStreaming')); return; }
    const title = `${t('tabs.fork')} - ${conv.title}`.slice(0, 40); // 自动命名：分叉 - 原标题
    try {
        const forkedAcpId = await view.api.forkSession(conv.sessionId, title, view.vaultPath);
        const forked = view.manager.forkConversation(id, title, forkedAcpId);
        if (!forked) return;
        new Notice(t('tabs.forked').replace('{title}', title));
        await switchToChat(view, forked.id);
    } catch (e) {
        new Notice(`${t('tabs.forkFailed')}: ${getErrorMessage(e)}`);
    }
}
```

（分叉命名形如「分叉当前会话 - 原标题」过长则取 `分叉 - ${原标题}`：用 `'tabs.fork'` 文案会带"当前会话"四字，改硬编码前缀 `分叉 - ` + title？为 i18n 干净，加 key `'tabs.forkPrefix': { zh: '分叉', en: 'Fork' }`，标题 = `${t('tabs.forkPrefix')} - ${conv.title}`。）

`getErrorMessage` 从 types import；`Notice` obsidian import（tabs.ts 已有 obsidian import 则复用）。实现时先读 tabs.ts 菜单段校准锚点。

- [ ] **Step 3: smoke 第 10 步**（scripts/acp-smoke.mjs plan 步之后）：

```js
// 9. fork：/branch → newSessionId → load 验证
let forkedId = null;
p.onMessage((msg) => {
    if (msg.method === 'session/update' && msg.params?.update?.sessionUpdate === 'session_info_update') {
        const meta = msg.params.update._meta ?? {};
        if (meta['codebuddy.ai/sessionReset'] && meta['codebuddy.ai/newSessionId']) forkedId = meta['codebuddy.ai/newSessionId'];
    }
});
await promptRound(p, sessionId, '/branch smoke-fork');
check('/branch 回报 newSessionId', !!forkedId, forkedId ?? '');
if (forkedId) {
    await p.request('session/load', { sessionId: forkedId, cwd: vault, mcpServers: [] });
    check('分叉会话 session/load 恢复', true);
}
```

- [ ] **Step 4: 验证** — `npm run build` + `npx jest` 全量绿 + `node scripts/acp-smoke.mjs`（真 CLI，含 fork 步）。
- [ ] **Step 5: Commit** — `feat(chat): 会话右键分叉入口 + i18n；test(scripts): smoke 增补 fork 回归`

---

### Task 4: 全量验收 + 手测清单增补

- [ ] **Step 1:** `npx jest` 全绿、`npm run build` 过、smoke 输出存档核对。
- [ ] **Step 2:** `docs/manual-test-2026-08-03-acp-v2.md` 增补 A8 用例：
  - A8 会话分叉：任一会话发过消息后，右键标签 →「分叉当前会话」→ 新会话标题「分叉 - …」且含全部历史消息 → 新会话续聊上下文保持（问「前面聊了什么」）→ 切回原会话继续对话，记录其行为（CLI 对原 session 的后续处理未实测，如实记录）。
- [ ] **Step 3: Commit** — `docs: 手测清单增补 fork 用例`。

## Self-Review

- Spec coverage：§4.1 数据流 → Task 1/2/3 ✓；§4.2 组件逐文件有落点；§4.3 边界（fork 超时/busy/原会话行为）→ Task 1 超时 + 手测 A8 记录 ✓；§5 测试策略 ✓；§6 非目标未安排 ✓。
- Placeholder scan：Step 3 tabs 菜单锚点注明"先读校准"——属执行时精确锚定，代码已全量给出。
- Type consistency：`fork(name): Promise<string>`、`forkSession(key, name, vaultPath?)`、`forkConversation(sourceId, title, acpSessionId)` 三处签名与测试一致；`lastForkedSessionId` 仅 session 内部。
