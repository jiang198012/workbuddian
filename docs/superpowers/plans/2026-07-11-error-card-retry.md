# 友好错误卡片 + 重试 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 错误以卡片呈现（图标 + 文案 + [重试][打开设置]）；重试重发最近一次出错的 user 消息。

**Architecture:** `ChatMessage.isError?` 标记；manager 加 `setError`/`deleteLastExchange`（纯逻辑可测）；`sendMessage` 解耦出 `sendText`，重试复用之；`render.ts` 加错误卡片。

**Tech Stack:** TypeScript、Jest（manager 纯逻辑）、esbuild、Obsidian view。

## Global Constraints

- `isError?: boolean` 可选字段，无迁移。
- 错误产生点存原始文案（不加「错误:」前缀）。
- 重试仅覆盖"最近一次"（`deleteLastExchange` 只认最后两条）。
- **本仓库非 git**：不 commit；每 Task 以构建/测试收尾。
- **部署铁律**：build 后 python 部署三文件到 iCloud vault 再 `Cmd+R`。
- **验证 bundle 用 ASCII 锚点**（`deleteLastExchange`/`renderErrorCard`），勿 grep 中文。
- 命令：`npx jest`（全量须由 130 增至 135 绿）；`npm run build`。

---

## File Structure

| 文件 | 动作 |
|---|---|
| `src/types/index.ts` | Modify（`isError?`） |
| `src/core/session/manager.ts` | Modify（`setError`/`deleteLastExchange`） |
| `tests/manager.test.ts` | Modify（单测） |
| `src/features/chat/input.ts` | Modify（`sendText` 重构 + 错误 setError + retry + openSettings） |
| `src/features/chat/render.ts` | Modify（错误卡片） |
| `styles.css` | Modify（卡片样式） |

---

## Task 1: 数据模型 + manager（TDD）

**Files:** Modify `src/types/index.ts`、`src/core/session/manager.ts`；Test `tests/manager.test.ts`

**Interfaces:**
- `ChatMessage.isError?: boolean`
- `setError(convId, msgId, content): boolean`
- `deleteLastExchange(convId): string | null`

- [ ] **Step 1: 写失败测试**

在 `tests/manager.test.ts` 最后一个 `it(...)` 之后、`});`（describe 结束）之前追加：

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/manager.test.ts`
Expected: FAIL（`setError`/`deleteLastExchange` 不存在）。

- [ ] **Step 3: 实现**

(a) `src/types/index.ts` 的 `ChatMessage` 接口加一行：

```ts
export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    isError?: boolean;
}
```

(b) `src/core/session/manager.ts` 在 `setSessionId` 方法之后（类结束 `}` 之前）加：

```ts
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
```

- [ ] **Step 4: 通过 + 全量回归**

Run: `npx jest tests/manager.test.ts && npx jest > /tmp/wb_13_t1.log 2>&1; echo "exit:$?"; grep -E "Tests:" /tmp/wb_13_t1.log`
Expected: 单文件 PASS；全量 `Tests: 135 passed`（130 + 5）。

---

## Task 2: input.ts —— sendText 重构 + 错误 setError + 重试 + 打开设置

**Files:** Modify `src/features/chat/input.ts`

**Interfaces:**
- Consumes: `setError`/`deleteLastExchange`（Task 1）
- Produces: `sendText(view, text)`、`retryLastMessage(view)`、`openWorkbuddianSettings(view)`

- [ ] **Step 1: 用下列两函数替换现有 `sendMessage` 函数**

（Read `input.ts` 确认当前 `sendMessage` 全文后整体替换；主体逻辑不变，仅：拆出 `sendText`、两处错误改 `setError`。）

```ts
export async function sendMessage(view: WorkbuddianChatView) {
    if (view.isStreaming) return;

    const text = view.inputEl.value.trim();
    if (!text) return;

    const slash = parseSlashCommand(text);
    if (slash?.name === 'clear') {
        // /clear：本地新建对话，不发 CLI
        await createNewChat(view);
        view.inputEl.value = '';
        adjustTextareaHeight(view);
        return;
    }

    view.inputEl.value = '';
    adjustTextareaHeight(view);
    await sendText(view, text);
}

export async function sendText(view: WorkbuddianChatView, text: string) {
    // 确保有活跃对话
    let conv = view.getActiveConversation();
    if (!conv) {
        conv = view.manager.createConversation();
        view.activeConvId = conv.id;
        renderTabs(view);
    }

    // 首次对话自动生成 sessionId，后续多轮对话保持上下文连贯
    if (!conv.sessionId) {
        conv.sessionId = view.api.generateId();
    }

    const convId = conv.id;
    view.manager.addMessage(convId, 'user', text);
    await renderMessages(view);

    const aiMsg = view.manager.addMessage(convId, 'assistant', '');
    if (!aiMsg) return;

    view.streamingMsgId = aiMsg.id;
    view.isStreaming = true;
    view.sendBtn.setText('停止');
    await renderMessages(view);

    const slash = parseSlashCommand(text);
    let firstChunk = true;
    let thinkingContent = '';
    let textContent = '';
    try {
        let contextText: string;
        if (slash) {
            // 斜杠命令：原样透传，不注入 vault 前缀 / 笔记链接 / @引用
            contextText = text;
        } else {
            const referenceBlock = await buildReferenceBlock(view, text);
            const currentNoteLink = view.settings.injectCurrentNoteLink ? buildCurrentNoteLink(view) : '';
            contextText = assembleContextText(
                text, view.vaultPath, view.settings.injectVaultContext, currentNoteLink, referenceBlock
            );
        }

        const streamingBubble = view.messageContainer.querySelector(
            `.workbuddian-message-assistant:last-child .workbuddian-bubble`
        );
        if (!(streamingBubble instanceof HTMLElement)) {
            throw new Error('找不到 Assistant 消息气泡');
        }

        for await (const chunk of view.api.sendMessage(conv.sessionId, contextText, view.vaultPath)) {
            const bubble = streamingBubble;

            if (firstChunk) {
                firstChunk = false;
                const thinking = bubble.querySelector('.workbuddian-thinking');
                if (thinking instanceof HTMLElement) {
                    thinking.addClass('workbuddian-thinking-fadeout');
                    await new Promise(r => window.setTimeout(r, 200));
                    thinking.remove();
                }
            }

            if (chunk.type === 'thinking') {
                thinkingContent += chunk.content;
                let block = bubble.querySelector('.workbuddian-thinking-block');
                if (!(block instanceof HTMLElement)) {
                    block = bubble.createDiv({ cls: 'workbuddian-thinking-block' });
                    const header = block.createDiv({ cls: 'workbuddian-thinking-header' });
                    const icon = header.createSpan({ cls: 'workbuddian-thinking-header-icon' });
                    setIcon(icon, 'sparkles');
                    header.createSpan({ cls: 'workbuddian-thinking-header-text', text: '思考中...' });
                    const chevron = header.createSpan({ cls: 'workbuddian-thinking-header-chevron', text: '▾' });

                    const bodyDiv = block.createDiv({ cls: 'workbuddian-thinking-body workbuddian-hidden' });
                    header.addEventListener('click', () => {
                        const hidden = bodyDiv.hasClass('workbuddian-hidden');
                        bodyDiv.toggleClass('workbuddian-hidden', !hidden);
                        chevron.textContent = hidden ? '▾' : '▸';
                    });
                }
                const body = block.querySelector('.workbuddian-thinking-body');
                if (body instanceof HTMLElement) {
                    body.setText(thinkingContent);
                }
            } else if (chunk.type === 'tool') {
                let toolsBlock = bubble.querySelector('.workbuddian-tools-block');
                if (!(toolsBlock instanceof HTMLElement)) {
                    toolsBlock = bubble.createDiv({ cls: 'workbuddian-tools-block' });
                    const hdr = toolsBlock.createDiv({ cls: 'workbuddian-tools-header' });
                    const icon = hdr.createSpan({ cls: 'workbuddian-tools-header-icon' });
                    setIcon(icon, 'wrench');
                    hdr.createSpan({ cls: 'workbuddian-tools-header-text', text: '工具调用' });
                    const chevron = hdr.createSpan({ cls: 'workbuddian-tools-header-chevron', text: '▾' });

                    hdr.addEventListener('click', () => {
                        const list = toolsBlock.querySelector('.workbuddian-tools-list');
                        if (list instanceof HTMLElement) {
                            const hidden = list.hasClass('workbuddian-hidden');
                            list.toggleClass('workbuddian-hidden', !hidden);
                            chevron.textContent = hidden ? '▾' : '▸';
                        }
                    });
                    toolsBlock.createDiv({ cls: 'workbuddian-tools-list workbuddian-hidden' });
                }
                const list = toolsBlock.querySelector('.workbuddian-tools-list');
                if (list instanceof HTMLElement) {
                    const toolName = chunk.toolName || '';
                    const toolDetail = chunk.toolDetail || '';
                    let iconName = 'wrench';
                    if (toolName.includes('read') || toolName.includes('查看') || toolName.includes('读取')) {
                        iconName = 'file-text';
                    } else if (toolName.includes('write') || toolName.includes('编辑') || toolName.includes('写入')) {
                        iconName = 'pencil';
                    } else if (toolName.includes('search') || toolName.includes('搜索') || toolName.includes('查找')) {
                        iconName = 'search';
                    }

                    const row = list.createDiv({ cls: 'workbuddian-tool-call' });
                    const icon = row.createSpan({ cls: 'workbuddian-tool-call-icon' });
                    setIcon(icon, iconName);
                    row.createSpan({
                        cls: 'workbuddian-tool-call-text',
                        text: `${toolName} ${toolDetail}`.trim()
                    });
                }
            } else if (chunk.type === 'text') {
                textContent += chunk.content;
                view.manager.updateMessage(convId, aiMsg.id, textContent, true);
                await renderMarkdownContent(view, bubble, textContent);
            } else if (chunk.type === 'error') {
                view.manager.setError(convId, aiMsg.id, chunk.content);
                new Notice(`请求失败: ${chunk.content}`);
            }
        }

        const finalContent = textContent || thinkingContent;
        view.manager.updateMessage(convId, aiMsg.id, finalContent);

        if (!finalContent) {
            view.manager.updateMessage(convId, aiMsg.id, '（无响应，请重试）');
        }

        const thinkingLabel = streamingBubble.querySelector('.workbuddian-thinking-header-text');
        if (thinkingLabel instanceof HTMLElement) {
            thinkingLabel.setText('已思考');
        }
        await renderMessages(view);
        await view.manager.flush();
    } catch (error: unknown) {
        const message = getErrorMessage(error);
        view.manager.setError(convId, aiMsg.id, message);
        new Notice(`请求失败: ${message}`);
        await renderMessages(view);
    } finally {
        view.isStreaming = false;
        view.streamingMsgId = null;
        view.sendBtn.setText('发送');
    }
}

/** 重试最近一次出错的发送：删最后一对 user+assistant，用同一 user 文本重发 */
export async function retryLastMessage(view: WorkbuddianChatView) {
    if (view.isStreaming) return;
    const conv = view.getActiveConversation();
    if (!conv) return;
    const text = view.manager.deleteLastExchange(conv.id);
    if (!text) return;
    await renderMessages(view);
    await sendText(view, text);
}

/** 打开 Workbuddian 设置页（Obsidian 私有 API，缺失时静默） */
export function openWorkbuddianSettings(view: WorkbuddianChatView) {
    const setting = (view.app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => void } }).setting;
    setting?.open?.();
    setting?.openTabById?.('workbuddian');
}
```

- [ ] **Step 2: 构建验证**

Run: `cd <project> && npm run build && echo build-ok && grep -c "retryLastMessage" main.js`
Expected: `build-ok`；grep ≥ 1。

---

## Task 3: render.ts 错误卡片 + styles.css

**Files:** Modify `src/features/chat/render.ts`、`styles.css`

- [ ] **Step 1: render.ts import**

把 `render.ts` 首部：
```ts
import { MarkdownRenderer, setIcon } from 'obsidian';
import type { ChatMessage } from '../../types';
import type { WorkbuddianChatView } from './view';
```
改为：
```ts
import { MarkdownRenderer, setIcon } from 'obsidian';
import type { ChatMessage } from '../../types';
import type { WorkbuddianChatView } from './view';
import { retryLastMessage, openWorkbuddianSettings } from './input';
```

- [ ] **Step 2: renderMessage 加 isError 分支**

把 `renderMessage` 里：
```ts
    if (isWaiting) {
        renderThinkingIndicator(bubble);
    } else if (msg.role === 'assistant') {
        await renderMarkdownContent(view, bubble, msg.content);
    } else {
        bubble.createSpan({ text: msg.content });
    }
```
改为：
```ts
    if (isWaiting) {
        renderThinkingIndicator(bubble);
    } else if (msg.isError) {
        renderErrorCard(view, bubble, msg);
    } else if (msg.role === 'assistant') {
        await renderMarkdownContent(view, bubble, msg.content);
    } else {
        bubble.createSpan({ text: msg.content });
    }
```

- [ ] **Step 3: 新增 renderErrorCard**

在 `renderThinkingIndicator` 函数之后插入：
```ts
export function renderErrorCard(view: WorkbuddianChatView, bubble: HTMLElement, msg: ChatMessage) {
    const card = bubble.createDiv({ cls: 'workbuddian-error-card' });
    const header = card.createDiv({ cls: 'workbuddian-error-header' });
    const icon = header.createSpan({ cls: 'workbuddian-error-icon' });
    setIcon(icon, 'alert-triangle');
    header.createSpan({ cls: 'workbuddian-error-title', text: '出错了' });
    card.createDiv({ cls: 'workbuddian-error-body', text: msg.content });
    const actions = card.createDiv({ cls: 'workbuddian-error-actions' });
    const retryBtn = actions.createEl('button', { cls: 'workbuddian-error-btn', text: '重试' });
    retryBtn.onclick = () => retryLastMessage(view);
    const settingsBtn = actions.createEl('button', { cls: 'workbuddian-error-btn', text: '打开设置' });
    settingsBtn.onclick = () => openWorkbuddianSettings(view);
}
```

- [ ] **Step 4: styles.css 追加**

用 python 追加（`open('styles.css','a')`）：
```css
.workbuddian-error-card {
    border: 1px solid var(--text-error);
    border-radius: var(--workbuddian-radius-sm);
    padding: var(--workbuddian-gap-md);
    background: var(--background-primary-alt);
}
.workbuddian-error-header {
    display: flex;
    align-items: center;
    gap: var(--workbuddian-gap-xs);
    color: var(--text-error);
    font-weight: 600;
    margin-bottom: var(--workbuddian-gap-xs);
}
.workbuddian-error-body {
    color: var(--text-muted);
    font-size: 0.9em;
    white-space: pre-wrap;
    margin-bottom: var(--workbuddian-gap-md);
}
.workbuddian-error-actions {
    display: flex;
    gap: var(--workbuddian-gap-xs);
}
.workbuddian-error-btn {
    cursor: pointer;
}
```

- [ ] **Step 5: 构建 + 全量回归**

Run:
```bash
cd <project>
npm run build && echo build-ok
npx jest > /tmp/wb_13_t3.log 2>&1; echo "exit:$?"; grep -E "Tests:" /tmp/wb_13_t3.log
grep -c "renderErrorCard" main.js
```
Expected: `build-ok`；`Tests: 135 passed`；grep ≥ 1。

---

## Task 4: 部署 + 人工验收

- [ ] **Step 1: 部署**

Run:
```bash
python3 - <<'PY'
import glob, os, shutil, hashlib
dev='<project>'
docs='<icloud-docs>'
dst=glob.glob(f'{docs}/*/.obsidian/plugins/workbuddian')[0]
for f in ['main.js','styles.css','manifest.json']:
    shutil.copy2(os.path.join(dev,f), os.path.join(dst,f))
h=lambda p: hashlib.md5(open(p,'rb').read()).hexdigest()
print('main.js md5 一致:', h(f'{dev}/main.js')==h(f'{dst}/main.js'))
print('styles.css md5 一致:', h(f'{dev}/styles.css')==h(f'{dst}/styles.css'))
print('含 renderErrorCard:', 'renderErrorCard' in open(f'{dst}/main.js',encoding='utf-8').read())
PY
```
Expected: 两个 md5 一致 `True`；`含 renderErrorCard: True`。

- [ ] **Step 2: Obsidian 人工验收**

`Cmd+R` 后：把 CodeBuddy 路径故意改错 → 发消息触发错误 → 确认：
1. 显示错误卡片（⚠️ + 「出错了」+ 文案 + [重试][打开设置]），非纯文本。
2. 改回正确路径后点「重试」→ 删除该次出错、用同一文本重发成功。
3. 点「打开设置」→ 打开 Workbuddian 设置页。
4. 普通成功消息渲染不变。

---

## Self-Review

**1. Spec coverage：** ①isError→Task1；②manager→Task1；③错误点 setError→Task2；④sendText→Task2；⑤重试/设置→Task2；⑥卡片→Task3；⑦样式→Task3；测试→Task1。

**2. Placeholder scan：** 无 TBD；`sendText` 整体给出完整代码；卡片/样式完整。

**3. Type consistency：** `setError`/`deleteLastExchange`/`sendText`/`retryLastMessage`/`openWorkbuddianSettings`/`renderErrorCard` 定义与调用签名一致；`render.ts` import `input.ts` 两函数（bundle 后单文件，循环无碍）。
