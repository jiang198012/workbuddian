import { Notice, setIcon, Menu } from 'obsidian';
import { getErrorMessage } from '../../types';
import { formatConversationAsMarkdown } from '../../shared/export';
import { isActivationKey } from '../../shared/inputKeys';
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
    view.rejectPendingApprovals(); // 悬挂批准卡不切走：统一答 reject，不悬挂到 CLI 侧干等
    view.activeConvId = id;
    renderTabs(view);
    await renderMessages(view);
}

export async function deleteChat(view: WorkbuddianChatView, id: string, e: UIEvent) {
    e.stopPropagation();
    await removeChat(view, id);
}

/** 删除对话并刷新（不依赖事件，供 ✕ 按钮与右键菜单共用） */
export async function removeChat(view: WorkbuddianChatView, id: string) {
    const wasActive = view.activeConvId === id;
    view.manager.deleteConversation(id);
    if (wasActive) {
        view.activeConvId = view.manager.getAll()[0]?.id ?? null;
    }
    renderTabs(view);
    await renderMessages(view);
}

/** 删除前确认：Notice 弹"确认删除?"带按钮，点按钮才真删(防误删,3 秒内不点自动消失) */
export function confirmAndRemoveChat(view: WorkbuddianChatView, id: string) {
    const conv = view.manager.getById(id);
    const label = conv ? conv.title : id;
    const notice = new Notice('', 3000);
    const noticeEl = notice.noticeEl;
    noticeEl.createEl('span', { text: `${t('tabs.confirmDelete')}「${label}」？` });
    noticeEl.createEl('button', { text: t('tabs.deleteConfirmBtn'), cls: 'mod-warning' })
        .onclick = () => {
            void removeChat(view, id);
            notice.hide();
        };
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

    // 清除旧标签(新建按钮在 dual-pane 的 sidebar header 或侧栏 tabBar 内,独立于 tab 列表,不清除)
    const oldTabs = view.tabBar.querySelectorAll('.workbuddian-tab');
    oldTabs.forEach(t => t.remove());

    // 会话搜索:搜索态只渲染匹配会话(标题或消息正文)
    const query = view.searchQuery?.trim().toLowerCase() ?? '';
    const conversations = query ? view.manager.search(query) : view.manager.getAll();
    const activeId = view.activeConvId;

    for (const conv of conversations) {
        const isActive = conv.id === activeId;
        const tab = view.tabBar.createDiv({
            cls: 'workbuddian-tab',
            // title 显示完整标题（标签宽 150px 会省略，悬停可看全）
            attr: { role: 'tab', tabindex: '0', 'aria-selected': isActive ? 'true' : 'false', title: conv.title }
        });
        if (isActive) {
            tab.addClass('workbuddian-tab-active');
            // 选中标签自动滚入可视区（标签多时当前对话不被挤出屏幕外）
            queueMicrotask(() => tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
        }
        // 搜索命中时标题片段高亮(<mark>),方便定位命中位置
        const titleSpan = tab.createSpan({ cls: 'workbuddian-tab-title' });
        if (query && conv.title.toLowerCase().includes(query)) {
            const idx = conv.title.toLowerCase().indexOf(query);
            const before = conv.title.slice(0, idx);
            const hit = conv.title.slice(idx, idx + query.length);
            const after = conv.title.slice(idx + query.length);
            titleSpan.appendText(before);
            titleSpan.createEl('mark', { text: hit, cls: 'workbuddian-tab-hit' });
            titleSpan.appendText(after);
        } else {
            titleSpan.setText(conv.title);
        }
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
        closeBtn.onclick = (e: MouseEvent) => { e.stopPropagation(); confirmAndRemoveChat(view, conv.id); };
        closeBtn.onkeydown = (e: KeyboardEvent) => {
            if (isActivationKey(e.key)) {
                e.preventDefault();
                confirmAndRemoveChat(view, conv.id);
            }
        };
        tab.onclick = () => {
            if (view.activeRename && tab.contains(view.activeRename.input)) {
                return;
            }
            switchToChat(view, conv.id);
        };
        // tabindex="0" 的 div 没有原生键盘激活行为，补上 Enter/Space 切换到该对话
        tab.onkeydown = (e: KeyboardEvent) => {
            if (!isActivationKey(e.key)) return;
            if (view.activeRename && tab.contains(view.activeRename.input)) return;
            e.preventDefault();
            switchToChat(view, conv.id);
        };
        tab.oncontextmenu = (e: MouseEvent) => {
            e.preventDefault();
            showTabContextMenu(view, e, conv.id, tab, titleSpan);
        };

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

/** 分叉会话：CLI /branch 开出支线，复制消息历史到新会话并切换 */
async function forkChat(view: WorkbuddianChatView, id: string) {
    const conv = view.manager.getById(id);
    if (!conv) return;
    if (!conv.sessionId) { new Notice(t('tabs.forkNeedMessage')); return; }
    if (view.isStreaming) { new Notice(t('tabs.forkStreaming')); return; }
    const title = `${t('tabs.forkPrefix')} - ${conv.title}`.slice(0, 40);
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

export function showTabContextMenu(view: WorkbuddianChatView, e: MouseEvent, convId: string, tab: HTMLElement, titleSpan: HTMLElement) {
    const conv = view.manager.getAll().find(c => c.id === convId);
    if (!conv) return;
    const menu = new Menu();

    menu.addItem((item) =>
        item.setTitle(t('tabs.rename')).setIcon('pencil').onClick(() => {
            beginRenameTab(view, tab, titleSpan, convId);
        })
    );

    menu.addItem((item) =>
        item.setTitle(t('tabs.fork')).setIcon('git-branch').onClick(() => {
            void forkChat(view, convId);
        })
    );

    menu.addItem((item) =>
        item.setTitle(t('tabs.delete')).setIcon('trash-2').onClick(() => {
            confirmAndRemoveChat(view, convId);
        })
    );

    menu.addSeparator();

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
