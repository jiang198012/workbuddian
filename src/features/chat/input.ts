import { Menu, Notice, setIcon } from 'obsidian';
import { getErrorMessage } from '../../types';
import { extractAtQuery, parseAtReferences, removeAtReference } from '../../shared/atReferences';
import { assembleContextText } from '../../core/context/assembleContext';
import type { WorkbuddianChatView } from './view';
import { renderMessages, renderMarkdownContent } from './render';
import { renderTabs, createNewChat } from './tabs';
import { parseSlashCommand, extractSlashQuery, filterSlashCommands, commandNameFromPath, parseCommandFrontmatter, type SlashCommandInfo } from '../../shared/slashCommand';
import { fileBasename, buildAttachmentBlock } from '../../shared/attachments';
import { buildSelectionBlock } from '../../shared/selection';
import { MODEL_OPTIONS, PERMISSION_MODE_CHOICES, type PermissionMode } from '../../shared/cliOptions';
import { t } from '../../i18n';

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
    renderReferenceChips(view);
    adjustTextareaHeight(view);
}

/** 渲染输入框上方的引用 chips（textarea 里 @[[...]] 的可视镜像 + 删除入口） */
export function renderReferenceChips(view: WorkbuddianChatView) {
    const names = parseAtReferences(view.inputEl.value);
    view.chipsEl.empty();
    if (names.length === 0) {
        view.chipsEl.addClass('workbuddian-hidden');
        return;
    }
    view.chipsEl.removeClass('workbuddian-hidden');
    for (const name of names) {
        const chip = view.chipsEl.createDiv({ cls: 'workbuddian-ref-chip' });
        chip.createSpan({ cls: 'workbuddian-ref-chip-name', text: name });
        const close = chip.createSpan({ cls: 'workbuddian-ref-chip-close', attr: { 'aria-label': t('input.removeReference'), role: 'button', tabindex: '0' } });
        setIcon(close, 'x');
        close.onclick = () => removeReference(view, name);
    }
}

/** 渲染附件 chips（来自 view.attachments 的绝对路径，显示文件名 + ✕ 删除） */
export function renderAttachmentChips(view: WorkbuddianChatView) {
    view.attachChipsEl.empty();
    if (view.attachments.length === 0) {
        view.attachChipsEl.addClass('workbuddian-hidden');
        return;
    }
    view.attachChipsEl.removeClass('workbuddian-hidden');
    view.attachments.forEach((path, idx) => {
        const chip = view.attachChipsEl.createDiv({ cls: 'workbuddian-ref-chip' });
        chip.createSpan({ cls: 'workbuddian-ref-chip-name', text: fileBasename(path), attr: { title: path } });
        const close = chip.createSpan({ cls: 'workbuddian-ref-chip-close', attr: { 'aria-label': t('input.removeReference'), role: 'button', tabindex: '0' } });
        setIcon(close, 'x');
        close.onclick = () => {
            view.attachments.splice(idx, 1);
            renderAttachmentChips(view);
        };
    });
}

/** 读取当前笔记编辑器的选中文字，存入 view.selection 并刷新选区 chip（无选区则清空） */
export function captureNoteSelection(view: WorkbuddianChatView) {
    const mv = view.lastMarkdownView;
    let text = '';
    try {
        text = mv?.editor?.getSelection() ?? '';
    } catch {
        text = '';
    }
    view.selection = text.trim() ? { text, note: mv?.file?.basename ?? '' } : null;
    renderSelectionChip(view);
}

/** 渲染选区 chip（笔记名 + 选区预览 + ✕ 移除）；无选区时隐藏 */
export function renderSelectionChip(view: WorkbuddianChatView) {
    view.selectionEl.empty();
    if (!view.selection) {
        view.selectionEl.addClass('workbuddian-hidden');
        return;
    }
    view.selectionEl.removeClass('workbuddian-hidden');
    const chip = view.selectionEl.createDiv({ cls: 'workbuddian-ref-chip workbuddian-selection-chip' });
    const icon = chip.createSpan({ cls: 'workbuddian-ref-chip-icon' });
    setIcon(icon, 'text-select');
    const preview = view.selection.text.replace(/\s+/g, ' ').trim().slice(0, 40);
    const label = view.selection.note ? `${view.selection.note}: ${preview}` : preview;
    chip.createSpan({ cls: 'workbuddian-ref-chip-name', text: label, attr: { title: view.selection.text } });
    // 实时镜像当前笔记选区，无手动 ✕：取消选择即消失
}

/** 打开系统文件选择器挑任意文件，把绝对路径加入待发送附件 */
export function openAttachmentPicker(view: WorkbuddianChatView) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = () => {
        for (const f of Array.from(input.files || [])) {
            const p = (f as File & { path?: string }).path;
            if (p && !view.attachments.includes(p)) view.attachments.push(p);
        }
        renderAttachmentChips(view);
    };
    input.click();
}

/** 各 permission 模式的区分图标（完全访问＝盾牌内感叹号） */
const PERMISSION_MODE_ICONS: Record<PermissionMode, string> = {
    default: 'shield',
    plan: 'eye',
    acceptEdits: 'check',
    bypassPermissions: 'shield-alert'
};

/** 当前 permission 模式对应的按钮图标（未知模式回退盾牌） */
export function permissionIcon(mode: PermissionMode): string {
    return PERMISSION_MODE_ICONS[mode] ?? 'shield';
}

/** 弹出 permission 模式菜单（仅默认 / 完全访问），选中后写设置 + 灌 CLI + 换图标 + 持久化 */
export function openPermissionMenu(view: WorkbuddianChatView, btn: HTMLElement, evt: MouseEvent) {
    const menu = new Menu();
    for (const mode of PERMISSION_MODE_CHOICES) {
        menu.addItem(item => item
            .setTitle(t('perm.' + mode))
            .setIcon(permissionIcon(mode))
            .setChecked(view.settings.permissionMode === mode)
            .onClick(async () => {
                view.settings.permissionMode = mode;
                view.api.setPermissionMode(mode);
                setIcon(btn, permissionIcon(mode));
                btn.setAttribute('title', `${t('input.permission')}: ${t('perm.' + mode)}`);
                await view.saveSettingsCallback();
            }));
    }
    menu.showAtMouseEvent(evt);
}

/** 弹出模型选择菜单（供悬停/点击触发），选中后写设置 + 灌 CLI + 更新按钮文字 + 持久化 */
export function openModelMenu(view: WorkbuddianChatView, btn: HTMLElement) {
    const menu = new Menu();
    for (const id of ['auto', ...Object.keys(MODEL_OPTIONS)]) {
        menu.addItem(item => item
            .setTitle(id)
            .setChecked(view.settings.model === id)
            .onClick(async () => {
                view.settings.model = id;
                view.api.setModel(id);
                btn.setText(id);
                await view.saveSettingsCallback();
            }));
    }
    const rect = btn.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
}

/** 从 textarea 删除某条引用（点 chip 的 ✕）并刷新 chips */
export function removeReference(view: WorkbuddianChatView, name: string) {
    view.inputEl.value = removeAtReference(view.inputEl.value, name);
    renderReferenceChips(view);
    adjustTextareaHeight(view);
    view.inputEl.focus();
}

/** 输入 / 命令补全：命中返回 true（渲染命令候选，@ 补全不接管），否则 false */
export function updateSlashSuggest(view: WorkbuddianChatView): boolean {
    const cursorPos = view.inputEl.selectionStart ?? view.inputEl.value.length;
    const query = extractSlashQuery(view.inputEl.value, cursorPos);
    if (query === null) return false;

    void loadCustomCommands(view); // 后台刷新自定义命令缓存，供下次补全使用

    const q = query.toLowerCase();
    const matches = [
        ...filterSlashCommands(query),
        ...view.customCommands.filter(c => c.name.toLowerCase().startsWith(q)),
    ];
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

/** 扫描 vault 下 .codebuddy/commands 内的命令 md，读 frontmatter，刷新自定义命令缓存 */
export async function loadCustomCommands(view: WorkbuddianChatView): Promise<void> {
    const prefix = '.codebuddy/commands/';
    const files = view.app.vault.getFiles().filter(f => f.path.startsWith(prefix) && f.extension === 'md');
    const cmds: SlashCommandInfo[] = [];
    for (const f of files) {
        const rel = f.path.slice(prefix.length);
        const content = await view.app.vault.read(f);
        const fm = parseCommandFrontmatter(content);
        cmds.push({ name: commandNameFromPath(rel), desc: fm.description || t('input.customCommand') });
    }
    view.customCommands = cmds;
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
    renderReferenceChips(view);
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
    setIcon(view.sendBtn, 'square');
    view.sendBtn.setAttribute('aria-label', t('input.stop'));
    view.sendBtn.setAttribute('title', t('input.stop'));
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
            const attachmentBlock = buildAttachmentBlock(view.attachments);
            const selectionBlock = view.selection ? buildSelectionBlock(view.selection.text, view.selection.note) : '';
            const extraBlock = [referenceBlock, attachmentBlock, selectionBlock].filter(Boolean).join('\n\n---\n\n');
            const currentNoteLink = view.settings.injectCurrentNoteLink ? buildCurrentNoteLink(view) : '';
            contextText = assembleContextText(
                text, view.vaultPath, view.settings.injectVaultContext, currentNoteLink, extraBlock
            );
            // 附件用完即清空；选区是实时镜像，取消选择才消失，这里不清
            if (view.attachments.length) {
                view.attachments = [];
                renderAttachmentChips(view);
            }
        }

        const streamingBubble = view.messageContainer.querySelector(
            `.workbuddian-message-assistant:last-child .workbuddian-bubble`
        );
        if (!(streamingBubble instanceof HTMLElement)) {
            throw new Error(t('input.bubbleNotFound'));
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
                    header.createSpan({ cls: 'workbuddian-thinking-header-text', text: t('input.thinking') });
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
                    hdr.createSpan({ cls: 'workbuddian-tools-header-text', text: t('input.toolCall') });
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
                new Notice(`${t('input.requestFailed')}: ${chunk.content}`);
            } else if (chunk.type === 'done') {
                // result 事件带的 token 用量 → 存入会话，供上下文指示器渲染（末尾 flush 持久化）
                if (chunk.usage) view.manager.setUsage(convId, chunk.usage);
            }
        }

        const finalContent = textContent || thinkingContent;
        view.manager.updateMessage(convId, aiMsg.id, finalContent);

        if (!finalContent) {
            view.manager.updateMessage(convId, aiMsg.id, t('input.noResponse'));
        }

        // 流式结束后再渲染一次，确保思考指示器等占位元素被清除
        const thinkingLabel = streamingBubble.querySelector('.workbuddian-thinking-header-text');
        if (thinkingLabel instanceof HTMLElement) {
            thinkingLabel.setText(t('input.thought'));
        }
        await renderMessages(view);
        await view.manager.flush();
    } catch (error: unknown) {
        const message = getErrorMessage(error);
        view.manager.setError(convId, aiMsg.id, message);
        new Notice(`${t('input.requestFailed')}: ${message}`);
        await renderMessages(view);
    } finally {
        view.isStreaming = false;
        view.streamingMsgId = null;
        setIcon(view.sendBtn, 'send');
        view.sendBtn.setAttribute('aria-label', t('input.send'));
        view.sendBtn.setAttribute('title', t('input.send'));
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
