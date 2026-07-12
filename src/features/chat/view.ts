import { ItemView, Component, setIcon } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { ConversationManager } from '../../core/session/manager';
import { CodebuddyProvider } from '../../providers/codebuddy';
import { type Conversation, type WorkbuddianSettings } from '../../types';
import { WORKBUDDIAN_ICON_ID } from '../../shared/icon';
import { renderTabs, createNewChat } from './tabs';
import { renderMessages } from './render';
import { handleKeydown, sendMessage, adjustTextareaHeight, updateAtSuggest, updateSlashSuggest, loadCustomCommands, renderReferenceChips } from './input';
import type { SlashCommandInfo } from '../../shared/slashCommand';
import { t } from '../../i18n';

export const VIEW_TYPE_CHAT = "workbuddian-panel";

export class WorkbuddianChatView extends ItemView {
    manager: ConversationManager;
    api: CodebuddyProvider;
    settings: WorkbuddianSettings;
    messageContainer!: HTMLElement;
    inputEl!: HTMLTextAreaElement;
    atSuggestEl!: HTMLElement;
    chipsEl!: HTMLElement;
    sendBtn!: HTMLButtonElement;
    tabBar!: HTMLElement;
    searchInput!: HTMLInputElement;
    isStreaming: boolean = false;
    streamingMsgId: string | null = null;
    activeRename: { input: HTMLInputElement; commit: () => void } | null = null;
    activeConvId: string | null = null;
    markdownComponent: Component;
    loadDataCallback: () => Promise<Conversation[]>;
    customCommands: SlashCommandInfo[] = [];

    get vaultPath(): string | undefined {
        const adapter = this.app.vault.adapter as { basePath?: string };
        return adapter.basePath;
    }

    constructor(leaf: WorkspaceLeaf, api: CodebuddyProvider, manager: ConversationManager, settings: WorkbuddianSettings, loadDataCallback: () => Promise<Conversation[]>) {
        super(leaf);
        this.api = api;
        this.loadDataCallback = loadDataCallback;
        this.manager = manager;
        this.settings = settings;
        this.markdownComponent = new Component();
        this.markdownComponent.load();
    }

    getViewType(): string { return VIEW_TYPE_CHAT; }
    getDisplayText(): string { return t('view.displayText'); }
    getIcon(): string { return WORKBUDDIAN_ICON_ID; }

    getManager(): ConversationManager { return this.manager; }

    getActiveConversation(): Conversation | null {
        return this.activeConvId ? this.manager.getById(this.activeConvId) : null;
    }

    async onOpen() {
        const container = this.contentEl;
        container.empty();
        container.addClass('workbuddian-chat-container');

        // 顶部标签栏
        this.tabBar = container.createDiv({ cls: 'workbuddian-tab-bar' });
        const newBtn = this.tabBar.createEl('button', {
            text: '',
            cls: 'workbuddian-new-chat-btn',
            attr: { title: t('view.newChat'), 'aria-label': t('view.newChat') }
        });
        setIcon(newBtn, 'plus');
        newBtn.onclick = () => createNewChat(this);

        const searchBtn = this.tabBar.createEl('button', {
            text: '',
            cls: 'workbuddian-search-btn',
            attr: { title: t('view.searchChat'), 'aria-label': t('view.searchChat') }
        });
        setIcon(searchBtn, 'search');
        this.searchInput = this.tabBar.createEl('input', {
            cls: 'workbuddian-search-input workbuddian-hidden',
            attr: { type: 'text', placeholder: t('view.searchPlaceholder') }
        });
        searchBtn.onclick = () => {
            const isHidden = this.searchInput.hasClass('workbuddian-hidden');
            this.searchInput.toggleClass('workbuddian-hidden', !isHidden);
            if (isHidden) {
                this.searchInput.focus();
            } else {
                this.searchInput.value = '';
                renderTabs(this);
            }
        };
        this.searchInput.oninput = () => renderTabs(this);

        // 消息区域
        this.messageContainer = container.createDiv({ cls: 'workbuddian-messages' });

        // 底部输入区
        this.chipsEl = container.createDiv({ cls: 'workbuddian-ref-chips workbuddian-hidden' });
        const inputArea = container.createDiv({ cls: 'workbuddian-input-area' });
        this.inputEl = inputArea.createEl('textarea', {
            cls: 'workbuddian-input',
            attr: { placeholder: t('view.inputPlaceholder'), rows: '2' }
        });
        this.inputEl.onkeydown = (e) => handleKeydown(this, e);
        this.inputEl.oninput = () => {
            adjustTextareaHeight(this);
            renderReferenceChips(this);
            if (!updateSlashSuggest(this)) updateAtSuggest(this);
        };
        this.atSuggestEl = inputArea.createDiv({ cls: 'workbuddian-at-suggest workbuddian-hidden' });

        this.sendBtn = inputArea.createEl('button', {
            text: t('view.send'),
            cls: 'workbuddian-send-btn',
            attr: { 'aria-label': t('view.send') }
        });
        this.sendBtn.onclick = () => {
            if (this.isStreaming) {
                this.api.cancel();
            } else {
                void sendMessage(this);
            }
        };

        void loadCustomCommands(this); // 预加载 .codebuddy/commands 自定义命令

        // DOM 构建完成后加载历史对话
        // 若 manager 已经被另一个同时打开的面板加载过，直接复用其内存状态渲染，
        // 不再重新读盘覆盖——避免用旧快照冲掉另一个面板已做的改动
        try {
            if (this.manager.hasConversations()) {
                this.activeConvId = this.manager.getActive()?.id ?? null;
                renderTabs(this);
                await renderMessages(this);
            } else {
                const conversations = await this.loadDataCallback();
                await this.loadConversations(conversations);
            }
        } catch (e) {
            console.error('[BB] 加载历史对话失败:', e);
        }
    }

    async onClose() {
        this.markdownComponent.unload();
    }

    async loadConversations(conversations: Conversation[]) {
        this.manager.load(conversations);
        this.activeConvId = this.manager.getActive()?.id ?? null;
        renderTabs(this);
        await renderMessages(this);
    }
}
