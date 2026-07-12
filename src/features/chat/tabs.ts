import { Notice, setIcon, Menu } from 'obsidian';
import { getErrorMessage } from '../../types';
import { formatConversationAsMarkdown } from '../../shared/export';
import { t } from '../../i18n';
import type { WorkbuddianChatView } from './view';
import { renderMessages } from './render';

export async function createNewChat(view: WorkbuddianChatView) {
    const conv = view.manager.createConversation();
    view.activeConvId = conv.id;
    renderTabs(view);
    await renderMessages(view);
}

export async function switchToChat(view: WorkbuddianChatView, id: string) {
    if (!view.manager.getById(id)) return;
    view.activeConvId = id;
    renderTabs(view);
    await renderMessages(view);
}

export async function deleteChat(view: WorkbuddianChatView, id: string, e: UIEvent) {
    e.stopPropagation();
    const wasActive = view.activeConvId === id;
    view.manager.deleteConversation(id);
    if (wasActive) {
        view.activeConvId = view.manager.getAll()[0]?.id ?? null;
    }
    renderTabs(view);
    await renderMessages(view);
}

/** 渲染标签栏 */
export function renderTabs(view: WorkbuddianChatView) {
    if (view.activeRename) {
        const prev = view.activeRename;
        view.activeRename = null;
        prev.input.removeEventListener('blur', prev.commit);
        prev.commit();
        return;
    }

    // 保留新建按钮
    const newBtn = view.tabBar.querySelector('.workbuddian-new-chat-btn');
    // 清除旧标签
    const oldTabs = view.tabBar.querySelectorAll('.workbuddian-tab');
    oldTabs.forEach(t => t.remove());

    const query = view.searchInput?.value ?? '';
    const conversations = view.manager.search(query);
    const activeId = view.activeConvId;

    for (const conv of conversations) {
        const tab = view.tabBar.createDiv({ cls: 'workbuddian-tab' });
        if (conv.id === activeId) {
            tab.addClass('workbuddian-tab-active');
        }
        const titleSpan = tab.createSpan({ text: conv.title, cls: 'workbuddian-tab-title' });
        titleSpan.onclick = (e: MouseEvent) => {
            if (e.detail >= 2) {
                e.stopPropagation();
            }
        };
        titleSpan.ondblclick = (e: MouseEvent) => {
            e.stopPropagation();
            beginRenameTab(view, tab, titleSpan, conv.id);
        };
        const closeBtn = tab.createSpan({
            cls: 'workbuddian-tab-close',
            attr: { title: t('tabs.close'), 'aria-label': t('tabs.close'), role: 'button', tabindex: '0' }
        });
        setIcon(closeBtn, 'x');
        closeBtn.onclick = (e: MouseEvent) => deleteChat(view, conv.id, e);
        closeBtn.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void deleteChat(view, conv.id, e);
            }
        };
        tab.onclick = () => {
            if (view.activeRename && tab.contains(view.activeRename.input)) {
                return;
            }
            switchToChat(view, conv.id);
        };
        tab.oncontextmenu = (e: MouseEvent) => {
            e.preventDefault();
            showTabContextMenu(view, e, conv.id);
        };

        // 把新建按钮放在最后
        if (newBtn) {
            tab.after(newBtn);
        }
    }
}

export function beginRenameTab(view: WorkbuddianChatView, tab: HTMLElement, titleSpan: HTMLElement, convId: string) {
    if (view.activeRename) {
        const prev = view.activeRename;
        view.activeRename = null;
        prev.input.removeEventListener('blur', prev.commit);
        prev.commit();
    }

    const currentTitle = titleSpan.textContent || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentTitle;
    input.className = 'workbuddian-tab-rename-input';
    input.addEventListener('click', (e: MouseEvent) => e.stopPropagation());
    titleSpan.replaceWith(input);
    input.focus();
    input.select();

    let settled = false;
    const commit = () => {
        if (settled) return;
        settled = true;
        view.activeRename = null;
        view.manager.renameConversation(convId, input.value);
        renderTabs(view);
    };
    const cancel = () => {
        if (settled) return;
        settled = true;
        view.activeRename = null;
        input.removeEventListener('blur', commit);
        renderTabs(view);
    };

    view.activeRename = { input, commit };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
        }
    });
}

export function showTabContextMenu(view: WorkbuddianChatView, e: MouseEvent, convId: string) {
    const conv = view.manager.getAll().find(c => c.id === convId);
    if (!conv) return;
    const menu = new Menu();

    menu.addItem((item) =>
        item.setTitle(t('tabs.exportAsNote')).setIcon('file-down').onClick(async () => {
            const markdown = formatConversationAsMarkdown(conv);
            if (!markdown) {
                new Notice(t('tabs.nothingToExport'));
                return;
            }
            const fileName = `${conv.title.replace(/[\\/:*?"<>|]/g, ' ')}.md`;
            try {
                await view.app.vault.create(fileName, markdown);
                new Notice(t('tabs.exportedAs').replace('{name}', fileName));
            } catch (err) {
                new Notice(t('tabs.exportFailed').replace('{err}', getErrorMessage(err)));
            }
        })
    );

    menu.addItem((item) =>
        item.setTitle(t('tabs.copyToClipboard')).setIcon('copy').onClick(async () => {
            const markdown = formatConversationAsMarkdown(conv);
            if (!markdown) {
                new Notice(t('tabs.nothingToExport'));
                return;
            }
            try {
                await navigator.clipboard.writeText(markdown);
                new Notice(t('tabs.copiedToClipboard'));
            } catch (err) {
                new Notice(t('tabs.copyFailed').replace('{err}', getErrorMessage(err)));
            }
        })
    );

    menu.showAtMouseEvent(e);
}
