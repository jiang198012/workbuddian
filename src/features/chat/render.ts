import { MarkdownRenderer, Notice, setIcon } from 'obsidian';
import type { ChatMessage } from '../../types';
import type { WorkbuddianChatView } from './view';
import { retryLastMessage, openWorkbuddianSettings, thumbSrc, renderContextUsage, adjustTextareaHeight } from './input';
import { ensureTableBlankLines } from '../../shared/tableNormalize';
import { fileBasename, isAbsolutePath } from '../../shared/attachments';
import { isImagePath } from '../../shared/imageStore';
import { t } from '../../i18n';

export async function renderMessages(view: WorkbuddianChatView) {
    view.messageContainer.empty();
    const conv = view.getActiveConversation();
    if (!conv) {
        const empty = view.messageContainer.createDiv({ cls: 'workbuddian-empty-chat' });
        const icon = empty.createDiv({ cls: 'workbuddian-empty-chat-icon' });
        setIcon(icon, 'message-square');
        empty.createDiv({ cls: 'workbuddian-empty-chat-title', text: t('render.emptyTitle') });
        empty.createDiv({ cls: 'workbuddian-empty-chat-subtitle', text: t('render.emptySubtitle') });

        // 快速开始建议：点击填入输入框并聚焦，降低冷启动门槛
        const suggestions = empty.createDiv({ cls: 'workbuddian-empty-suggestions' });
        for (const s of [t('render.suggestSummarize'), t('render.suggestExplain'), t('render.suggestRewrite')]) {
            const chip = suggestions.createEl('button', { cls: 'workbuddian-empty-suggestion', text: s });
            chip.onclick = () => {
                view.inputEl.value = s;
                adjustTextareaHeight(view);
                view.inputEl.focus();
            };
        }

        renderContextUsage(view); // 无对话时一并收起用量圆环，避免残留上一个对话的数值
        return;
    }

    for (const msg of conv.messages) {
        await renderMessage(view, msg);
    }

    scrollToBottom(view);
    renderContextUsage(view);
}

export async function renderMessage(view: WorkbuddianChatView, msg: ChatMessage) {
    const row = view.messageContainer.createDiv({
        cls: `workbuddian-message-row workbuddian-message-${msg.role}`
    });
    const bubble = row.createDiv({ cls: 'workbuddian-bubble' });

    // 仅当前正在等待回复的消息显示思考指示器
    const isWaiting = msg.role === 'assistant' && msg.content === '' && msg.id === view.streamingMsgId;
    if (isWaiting) {
        renderThinkingIndicator(bubble);
    } else if (msg.isError) {
        renderErrorCard(view, bubble, msg);
    } else if (msg.role === 'assistant') {
        await renderMarkdownContent(view, bubble, msg.content);
    } else {
        if (msg.attachments && msg.attachments.length > 0) {
            const attachmentsRow = bubble.createDiv({ cls: 'workbuddian-message-attachments' });
            for (const entry of msg.attachments) {
                renderAttachmentChip(view, attachmentsRow, entry);
            }
        }
        bubble.createSpan({ text: msg.content });
    }

    // 复制按钮：有内容且非等待/错误的消息，hover 整行时浮出
    if (!isWaiting && !msg.isError && msg.content) {
        renderCopyButton(row, msg.content);
    }
    return row;
}

/** 单个附件 chip：图片出缩略图，其余（含旧数据的纯文件名）出文件名 */
function renderAttachmentChip(view: WorkbuddianChatView, row: HTMLElement, entry: string) {
    const chip = row.createDiv({ cls: 'workbuddian-attachment-chip' });
    const name = fileBasename(entry);
    if (!isAbsolutePath(entry) || !isImagePath(entry)) {
        renderNameChip(chip, name);
        return;
    }
    const src = thumbSrc(view, entry);
    if (!src) {
        renderNameChip(chip, name); // 文件读不到（已被清理 / 换了机器）
        return;
    }
    chip.addClass('workbuddian-image-chip');
    const img = chip.createEl('img', {
        cls: 'workbuddian-image-thumb',
        attr: { alt: name, title: name },
    });
    img.onerror = () => {
        chip.empty();
        chip.removeClass('workbuddian-image-chip');
        renderNameChip(chip, name);
    };
    img.src = src;
}

/** paperclip + 文件名（正常的非图片附件，以及缩略图加载失败后的降级） */
function renderNameChip(chip: HTMLElement, name: string) {
    setIcon(chip.createSpan({ cls: 'workbuddian-attachment-chip-icon' }), 'paperclip');
    chip.createSpan({ cls: 'workbuddian-attachment-chip-name', text: name });
}

/** 在消息行底部加「复制」按钮（默认隐藏，hover 行浮出）；点击复制该消息原始文本 */
export function renderCopyButton(row: HTMLElement, content: string) {
    const actions = row.createDiv({ cls: 'workbuddian-message-actions' });
    const copyBtn = actions.createEl('button', {
        cls: 'workbuddian-message-action-btn',
        attr: { 'aria-label': t('render.copy'), title: t('render.copy') }
    });
    setIcon(copyBtn, 'copy');
    copyBtn.onclick = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setIcon(copyBtn, 'check');
            copyBtn.setAttribute('title', t('render.copied'));
            window.setTimeout(() => {
                setIcon(copyBtn, 'copy');
                copyBtn.setAttribute('title', t('render.copy'));
            }, 1500);
        } catch {
            new Notice(t('render.copyFailed'));
        }
    };
}

export function renderThinkingIndicator(bubble: HTMLElement) {
    const thinking = bubble.createDiv({ cls: 'workbuddian-thinking' });
    thinking.createSpan({ cls: 'workbuddian-thinking-text', text: t('render.thinking') });
    const dots = thinking.createDiv({ cls: 'workbuddian-thinking-dots' });
    for (let i = 0; i < 3; i++) {
        dots.createSpan({ cls: 'workbuddian-dot' });
    }
}

export function renderErrorCard(view: WorkbuddianChatView, bubble: HTMLElement, msg: ChatMessage) {
    const card = bubble.createDiv({ cls: 'workbuddian-error-card' });
    const header = card.createDiv({ cls: 'workbuddian-error-header' });
    const icon = header.createSpan({ cls: 'workbuddian-error-icon' });
    setIcon(icon, 'alert-triangle');
    header.createSpan({ cls: 'workbuddian-error-title', text: t('render.errorTitle') });
    // 错误时间：诊断更有用（区分「刚发生」与「历史遗留」）
    if (msg.timestamp) {
        const time = new Date(msg.timestamp).toLocaleTimeString();
        header.createSpan({ cls: 'workbuddian-error-time', text: time });
    }
    card.createDiv({ cls: 'workbuddian-error-body', text: msg.content });
    const actions = card.createDiv({ cls: 'workbuddian-error-actions' });
    const retryBtn = actions.createEl('button', { cls: 'workbuddian-error-btn', text: t('render.retry') });
    retryBtn.onclick = () => retryLastMessage(view);
    const settingsBtn = actions.createEl('button', { cls: 'workbuddian-error-btn', text: t('render.openSettings') });
    settingsBtn.onclick = () => openWorkbuddianSettings(view);
}

export async function renderMarkdownContent(view: WorkbuddianChatView, bubble: HTMLElement, content: string): Promise<void> {
    if (!content) return;

    // 保留已有的思考块和工具块
    const thinkingBlock = bubble.querySelector('.workbuddian-thinking-block');
    const toolsBlock = bubble.querySelector('.workbuddian-tools-block');

    // 查找或创建 Markdown 容器（复用已有容器避免频繁 DOM 创建）
    let markdownContainer = bubble.querySelector('.workbuddian-markdown-content');
    if (!(markdownContainer instanceof HTMLElement)) {
        markdownContainer = bubble.createDiv({ cls: 'workbuddian-markdown-content' });
    }

    if (!(markdownContainer instanceof HTMLElement)) return;

    // 关键:始终把 Markdown 容器锚定在 bubble 末尾(思考块/工具块之后)。
    // 之前用「插到思考块之前」的写法,但思考块/工具块会在流式过程中被重建,
    // 重建后正文容器就落到了它们后面——思考内容被当成正文渲染(泄漏)。
    // 正文是「结果」,思考/工具是「过程」,正文必须在最后。
    const lastBlock = (() => {
        const thinking = bubble.querySelector('.workbuddian-thinking-block');
        const tools = bubble.querySelector('.workbuddian-tools-block');
        if (thinking instanceof HTMLElement && tools instanceof HTMLElement) {
            // 两者都存在:取 DOM 顺序更靠后的那个
            return thinking.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING ? tools : thinking;
        }
        return (thinking instanceof HTMLElement) ? thinking : (tools instanceof HTMLElement) ? tools : null;
    })();

    if (lastBlock instanceof HTMLElement) {
        // 只有当前不在正确位置时才移动,避免频繁 DOM 操作
        if (markdownContainer.previousElementSibling !== lastBlock) {
            lastBlock.insertAdjacentElement('afterend', markdownContainer);
        }
    } else if (markdownContainer.parentElement !== bubble) {
        bubble.appendChild(markdownContainer);
    }

    // 清空之前渲染的内容
    markdownContainer.empty();

    await MarkdownRenderer.render(
        view.app,
        ensureTableBlankLines(content),
        markdownContainer,
        '',
        view.markdownComponent
    );

    // 代码块级复制：给每个 <pre> 包一层容器 + 右上角复制钮（hover 代码块浮出）。
    // 消息级复制在行操作里，但代码块往往很长，用户只想复制那一段。
    markdownContainer.querySelectorAll('pre').forEach((pre) => {
        if (!(pre instanceof HTMLElement)) return;
        if (pre.querySelector('.workbuddian-code-copy-wrap')) return; // 已包过

        const wrap = pre.createDiv({ cls: 'workbuddian-code-copy-wrap' });
        pre.before(wrap); // 把 pre 移进 wrap
        wrap.appendChild(pre);

        const btn = wrap.createEl('button', {
            cls: 'workbuddian-code-copy-btn',
            attr: { 'aria-label': t('render.copyCode'), title: t('render.copyCode') }
        });
        setIcon(btn, 'copy');
        btn.onclick = async () => {
            const code = pre.textContent ?? '';
            try {
                await navigator.clipboard.writeText(code);
                setIcon(btn, 'check');
                btn.setAttribute('title', t('render.copied'));
                window.setTimeout(() => {
                    setIcon(btn, 'copy');
                    btn.setAttribute('title', t('render.copyCode'));
                }, 1500);
            } catch {
                new Notice(t('render.copyFailed'));
            }
        };
    });
}

export function scrollToBottom(view: WorkbuddianChatView) {
    view.messageContainer.scrollTop = view.messageContainer.scrollHeight;
}
