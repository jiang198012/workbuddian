import { Notice, setIcon } from 'obsidian';
import { getErrorMessage } from '../../types';
import { extractAtQuery, parseAtReferences } from '../../shared/atReferences';
import { assembleContextText } from '../../core/context/assembleContext';
import type { WorkbuddianChatView } from './view';
import { renderMessages, renderMarkdownContent } from './render';
import { renderTabs, createNewChat } from './tabs';
import { parseSlashCommand, extractSlashQuery, filterSlashCommands } from '../../shared/slashCommand';

export function adjustTextareaHeight(view: WorkbuddianChatView) {
    view.inputEl.style.setProperty('--workbuddian-input-height', `${view.inputEl.scrollHeight}px`);
}

export function updateAtSuggest(view: WorkbuddianChatView) {
    const cursorPos = view.inputEl.selectionStart ?? view.inputEl.value.length;
    const state = extractAtQuery(view.inputEl.value, cursorPos);
    if (!state) {
        view.atSuggestEl.addClass('workbuddian-hidden');
        view.atSuggestEl.empty();
        return;
    }

    const query = state.query.toLowerCase();
    const files = view.app.vault.getMarkdownFiles()
        .filter(f => f.basename.toLowerCase().includes(query))
        .slice(0, 8);

    view.atSuggestEl.empty();
    if (files.length === 0) {
        view.atSuggestEl.addClass('workbuddian-hidden');
        return;
    }
    view.atSuggestEl.removeClass('workbuddian-hidden');
    for (const file of files) {
        const item = view.atSuggestEl.createDiv({ cls: 'workbuddian-at-suggest-item', text: file.basename });
        item.onclick = () => insertAtReference(view, file.basename);
    }
}

export function insertAtReference(view: WorkbuddianChatView, noteName: string) {
    const cursorPos = view.inputEl.selectionStart ?? view.inputEl.value.length;
    const state = extractAtQuery(view.inputEl.value, cursorPos);
    if (state) {
        const { start } = state;
        const value = view.inputEl.value;
        let end = start + 1;
        while (end < value.length && !/[\s\]]/.test(value[end])) {
            end++;
        }
        const before = value.slice(0, start);
        const after = value.slice(end);
        const insertion = `@[[${noteName}]] `;
        view.inputEl.value = before + insertion + after;
        const newCursorPos = before.length + insertion.length;
        view.inputEl.setSelectionRange(newCursorPos, newCursorPos);
        view.inputEl.focus();
    }

    view.atSuggestEl.addClass('workbuddian-hidden');
    view.atSuggestEl.empty();
    adjustTextareaHeight(view);
}

/** 输入 / 命令补全：命中返回 true（渲染命令候选，@ 补全不接管），否则 false */
export function updateSlashSuggest(view: WorkbuddianChatView): boolean {
    const cursorPos = view.inputEl.selectionStart ?? view.inputEl.value.length;
    const query = extractSlashQuery(view.inputEl.value, cursorPos);
    if (query === null) return false;

    const matches = filterSlashCommands(query);
    view.atSuggestEl.empty();
    if (matches.length === 0) {
        view.atSuggestEl.addClass('workbuddian-hidden');
        return true;
    }
    view.atSuggestEl.removeClass('workbuddian-hidden');
    for (const cmd of matches) {
        const item = view.atSuggestEl.createDiv({ cls: 'workbuddian-at-suggest-item' });
        item.createSpan({ text: `/${cmd.name}` });
        item.createSpan({ cls: 'workbuddian-slash-cmd-desc', text: cmd.desc });
        item.onclick = () => insertSlashCommand(view, cmd.name);
    }
    return true;
}

export function insertSlashCommand(view: WorkbuddianChatView, name: string) {
    view.inputEl.value = `/${name} `;
    const pos = view.inputEl.value.length;
    view.inputEl.setSelectionRange(pos, pos);
    view.inputEl.focus();
    view.atSuggestEl.addClass('workbuddian-hidden');
    view.atSuggestEl.empty();
    adjustTextareaHeight(view);
}

/** 解析消息里所有 @[[笔记名]] 引用，读取笔记全文拼成独立的上下文区块 */
export async function buildReferenceBlock(view: WorkbuddianChatView, text: string): Promise<string> {
    const names = parseAtReferences(text);
    if (names.length === 0) return '';

    const parts: string[] = ['以下是消息中通过 @ 引用的笔记内容：', ''];
    for (const name of names) {
        const file = view.app.vault.getMarkdownFiles().find(f => f.basename === name);
        if (!file) {
            parts.push(`引用笔记「${name}」未找到，已跳过。`, '');
            continue;
        }
        const content = await view.app.vault.read(file);
        parts.push(`### ${name}`, content, '');
    }
    return parts.join('\n');
}

/** 生成"当前正在查看笔记"提示行；无活动笔记时返回空字符串 */
export function buildCurrentNoteLink(view: WorkbuddianChatView): string {
    const file = view.app.workspace.getActiveFile();
    if (!file) return '';
    return `当前正在查看笔记：《${file.basename}》（${file.path}）`;
}

export async function handleKeydown(view: WorkbuddianChatView, e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        await sendMessage(view);
    }
}

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

    // 添加用户消息
    const convId = conv.id;
    view.manager.addMessage(convId, 'user', text);
    await renderMessages(view);

    // 创建 AI 消息占位，标记为等待回复中
    const aiMsg = view.manager.addMessage(convId, 'assistant', '');
    if (!aiMsg) return;

    view.streamingMsgId = aiMsg.id;
    view.isStreaming = true;
    view.sendBtn.setText('停止');
    await renderMessages(view);

    // 流式发送
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
                // 移除思考指示器
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

        // 流式结束后再渲染一次，确保思考指示器等占位元素被清除
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
