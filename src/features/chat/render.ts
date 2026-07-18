import { MarkdownRenderer, Notice, setIcon } from 'obsidian';
import type { ChatMessage } from '../../types';
import type { WorkbuddianChatView } from './view';
import { retryLastMessage, openWorkbuddianSettings } from './input';
import { ensureTableBlankLines } from '../../shared/tableNormalize';
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
        return;
    }

    for (const msg of conv.messages) {
        await renderMessage(view, msg);
    }

    scrollToBottom(view);
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
        bubble.createSpan({ text: msg.content });
    }

    // 复制按钮：有内容且非等待/错误的消息，hover 整行时浮出
    if (!isWaiting && !msg.isError && msg.content) {
        renderCopyButton(row, msg.content);
    }
    return row;
}

/** 在消息行底部加「复制」按钮（默认隐藏，hover 行浮出）；点击复制该消息原始文本 */
function renderCopyButton(row: HTMLElement, content: string) {
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

        // 如果有思考块/工具块，将 Markdown 内容插入到它们之前
        if (thinkingBlock instanceof HTMLElement) {
            bubble.insertBefore(markdownContainer, thinkingBlock);
        } else if (toolsBlock instanceof HTMLElement) {
            bubble.insertBefore(markdownContainer, toolsBlock);
        }
    }

    if (!(markdownContainer instanceof HTMLElement)) return;

    // 清空之前渲染的内容
    markdownContainer.empty();

    await MarkdownRenderer.render(
        view.app,
        ensureTableBlankLines(content),
        markdownContainer,
        '',
        view.markdownComponent
    );
}

export function scrollToBottom(view: WorkbuddianChatView) {
    view.messageContainer.scrollTop = view.messageContainer.scrollHeight;
}
