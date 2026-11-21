import { Modal, Notice, setIcon, Menu, Setting } from 'obsidian';
import { getErrorMessage } from '../../types';
import { formatConversationAsMarkdown } from '../../shared/export';
import { isActivationKey } from '../../shared/inputKeys';
import { CHAT_TEMPLATES, type ChatTemplate } from '../../shared/chatTemplates';
import { adjustTextareaHeight } from './input';
import { t } from '../../i18n';
import type { WorkbuddianChatView } from './view';
import { renderMessages } from './render';

export async function createNewChat(view: WorkbuddianChatView) {
    view.persistActiveDraft();
    const conv = view.manager.createConversation();
    view.activeConvId = conv.id;
    renderTabs(view);
    await renderMessages(view);
    view.restoreActiveDraft();
}

/** 模板新建菜单:选中模板后新建会话,应用预设常驻指令 + 预填开场白 */
export function openTemplateMenu(view: WorkbuddianChatView, anchorEl: HTMLElement) {
    const menu = new Menu();
    for (const tpl of CHAT_TEMPLATES) {
        menu.addItem((item) =>
            item.setTitle(tpl.name).onClick(async () => {
                await applyChatTemplate(view, tpl);
            })
        );
    }
    menu.showAtPosition({ x: anchorEl.getBoundingClientRect().left, y: anchorEl.getBoundingClientRect().bottom + 4 });
}

/** 应用会话模板:新建会话,设常驻指令,预填开场白 */
export async function applyChatTemplate(view: WorkbuddianChatView, tpl: ChatTemplate) {
    view.persistActiveDraft();
    const conv = view.manager.createConversation();
    view.activeConvId = conv.id;
    // 应用预设常驻指令(system prompt)
    view.manager.updateWorkspace(conv.id, { customInstruction: tpl.instruction });
    renderTabs(view);
    await renderMessages(view);
    view.restoreActiveDraft();
    // 预填开场白到输入框（放在恢复草稿之后，避免空草稿覆盖模板开场白）
    view.inputEl.value = tpl.opener;
    adjustTextareaHeight(view);
    view.persistActiveDraft();
    view.inputEl.focus();
    new Notice(t('view.templateApplied').replace('{name}', tpl.name));
}

export async function switchToChat(view: WorkbuddianChatView, id: string) {
    if (!view.manager.getById(id)) return;
    view.persistActiveDraft();
    view.rejectPendingApprovals(); // 悬挂批准卡不切走：统一答 reject，不悬挂到 CLI 侧干等
    // 从 /resume 或搜索选中已关闭的会话：重新打开标签，并同步另一面板的标签栏
    if (view.manager.reopenConversation(id)) {
        for (const other of sharedViews(view)) if (other !== view) renderTabs(other);
    }
    view.activeConvId = id;
    renderTabs(view);
    await renderMessages(view);
    view.restoreActiveDraft();
}

/** 共用同一 manager 的所有已打开面板（侧栏 + 主面板） */
function sharedViews(view: WorkbuddianChatView): WorkbuddianChatView[] {
    return view.app.workspace.getLeavesOfType(view.getViewType())
        .map((leaf) => leaf.view as WorkbuddianChatView)
        .filter((other) => other && other.manager === view.manager);
}

export async function deleteChat(view: WorkbuddianChatView, id: string, e: UIEvent) {
    e.stopPropagation();
    await removeChat(view, id);
}

/** 删除对话并刷新（不依赖事件，供右键菜单删除使用） */
export async function removeChat(view: WorkbuddianChatView, id: string) {
    const wasActive = view.activeConvId === id;
    if (wasActive) view.persistActiveDraft();
    if (!view.manager.deleteConversation(id)) return;
    await syncViewsAfterTabRemoved(view, id);
}

/** 关闭标签（✕ 按钮）：会话保留在历史中，可从 /resume 或搜索重新打开；空会话直接丢弃（#16） */
export async function closeChat(view: WorkbuddianChatView, id: string) {
    const wasActive = view.activeConvId === id;
    if (wasActive) {
        view.persistActiveDraft(); // 先落草稿：有未发送内容的会话不能当空会话丢弃
        view.rejectPendingApprovals(); // 与切走会话一致：悬挂批准卡统一答 reject
    }
    const result = view.manager.closeConversation(id);
    if (!result) return;
    await syncViewsAfterTabRemoved(view, id);
    if (result === 'closed') new Notice(t('tabs.closedHint'));
}

/**
 * manager 在两个 view 间共享；删除/关闭后同步刷新所有已打开的面板，避免另一面板的
 * tab/search 仍停在已删除或已关闭的会话上（尤其是当前分叉会话）。
 */
async function syncViewsAfterTabRemoved(view: WorkbuddianChatView, id: string) {
    for (const other of sharedViews(view)) {
        if (other.activeRename) other.activeRename = null;
        const current = other.manager.getById(other.activeConvId ?? '');
        if (other.activeConvId === id || !current || current.closed) {
            other.activeConvId = other.manager.getOpen()[0]?.id ?? null;
        }
        renderTabs(other);
        await renderMessages(other);
        other.restoreActiveDraft();
    }
}

/** 删除确认使用可访问 Modal，避免 Notice 短暂消失或无法被键盘/自动化稳定定位。 */
class DeleteChatModal extends Modal {
    constructor(
        private readonly view: WorkbuddianChatView,
        private readonly id: string,
        private readonly label: string,
    ) { super(view.app); }

    onOpen(): void {
        this.titleEl.setText(t('tabs.confirmDelete'));
        const count = this.view.manager.getById(this.id)?.messages.length ?? 0;
        this.contentEl.createEl('p', {
            text: t('tabs.deleteConfirmBody').replace('{title}', this.label).replace('{count}', String(count)),
        });
        new Setting(this.contentEl)
            .addButton((b) => b.setButtonText(t('tabs.deleteConfirmBtn')).setCta().onClick(() => {
                void removeChat(this.view, this.id);
                this.close();
            }))
            .addButton((b) => b.setButtonText(t('approval.cancel')).onClick(() => this.close()));
    }

    onClose(): void { this.contentEl.empty(); }
}

/** 删除前确认：先显示可访问的 Modal，点确认才真正删除。 */
export function confirmAndRemoveChat(view: WorkbuddianChatView, id: string) {
    const conv = view.manager.getById(id);
    const label = conv ? conv.title : id;
    new DeleteChatModal(view, id, label).open();
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
    // 平时只显示打开的标签；搜索态也覆盖已关闭的会话，点选即重新打开
    const conversations = query ? view.manager.search(query) : view.manager.getOpen();
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
        // 置顶会话显示 📌 标识
        if (conv.pinned) {
            tab.createSpan({ cls: 'workbuddian-tab-pin', text: '📌', attr: { 'aria-label': t('tabs.pinned') } });
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
        closeBtn.onclick = (e: MouseEvent) => { e.stopPropagation(); void closeChat(view, conv.id); };
        closeBtn.onkeydown = (e: KeyboardEvent) => {
            if (isActivationKey(e.key)) {
                e.preventDefault();
                e.stopPropagation(); // 不冒泡到标签自身的 Enter/Space 切换
                void closeChat(view, conv.id);
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

    // 置顶/取消置顶
    menu.addItem((item) =>
        item
            .setTitle(conv.pinned ? t('tabs.unpin') : t('tabs.pin'))
            .setIcon(conv.pinned ? 'pin-off' : 'pin')
            .onClick(() => {
                view.manager.togglePinned(convId);
                renderTabs(view);
            })
    );

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
