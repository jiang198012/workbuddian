import { ItemView, Component, MarkdownView, setIcon } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { ConversationManager } from '../../core/session/manager';
import { CodebuddyProvider } from '../../providers/codebuddy';
import { type Conversation, type WorkbuddianSettings } from '../../types';
import { WORKBUDDIAN_ICON_ID } from '../../shared/icon';
import { renderTabs, createNewChat } from './tabs';
import { renderMessages } from './render';
import { handleKeydown, sendMessage, adjustTextareaHeight, updateAtSuggest, updateSlashSuggest, loadCustomCommands, renderReferenceChips, openAttachmentPicker, openPermissionMenu, openModelMenu, permissionIcon, captureNoteSelection, handlePaste, handleDrop } from './input';
import type { SlashCommandInfo } from '../../shared/slashCommand';
import { t } from '../../i18n';
import { bbError } from '../../shared/logBuffer';

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
    isStreaming: boolean = false;
    streamingMsgId: string | null = null;
    activeRename: { input: HTMLInputElement; commit: () => void } | null = null;
    activeConvId: string | null = null;
    markdownComponent: Component;
    loadDataCallback: () => Promise<Conversation[]>;
    saveSettingsCallback: () => Promise<void>;
    customCommands: SlashCommandInfo[] = [];
    attachChipsEl!: HTMLElement;
    attachments: string[] = [];
    selectionEl!: HTMLElement;
    selection: { text: string; note: string } | null = null;
    lastMarkdownView: MarkdownView | null = null;

    get vaultPath(): string | undefined {
        const adapter = this.app.vault.adapter as { basePath?: string };
        return adapter.basePath;
    }

    constructor(leaf: WorkspaceLeaf, api: CodebuddyProvider, manager: ConversationManager, settings: WorkbuddianSettings, loadDataCallback: () => Promise<Conversation[]>, saveSettingsCallback: () => Promise<void>) {
        super(leaf);
        this.api = api;
        this.loadDataCallback = loadDataCallback;
        this.saveSettingsCallback = saveSettingsCallback;
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
        // 追踪最后一个 Markdown 视图：聚焦聊天面板后 workspace.activeEditor 会变空，
        // 需靠它在发送时读回笔记选区（CM 选区在失焦后仍保留）
        this.lastMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
            if (leaf?.view instanceof MarkdownView) this.lastMarkdownView = leaf.view;
        }));

        // 选区实时同步：笔记里选区一变，chip 就跟着出现/更新/消失（去抖）。
        // 注册在 onOpen（一次性），不随 buildUI 重建 —— 避免语言切换重建 DOM 时重复注册。
        let selChangeTimer: number | null = null;
        this.registerDomEvent(document, 'selectionchange', () => {
            if (selChangeTimer !== null) window.clearTimeout(selChangeTimer);
            selChangeTimer = window.setTimeout(() => captureNoteSelection(this), 120);
        });

        this.buildUI();

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
            bbError('[BB] 加载历史对话失败:', e);
        }
    }

    /** 构建/重建整个面板 DOM（用当前语言的 t() 文案）。语言切换时可重复调用刷新界面语言。 */
    private buildUI() {
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

        // 消息区域
        this.messageContainer = container.createDiv({ cls: 'workbuddian-messages' });

        // 底部输入区
        this.chipsEl = container.createDiv({ cls: 'workbuddian-ref-chips workbuddian-hidden' });
        this.attachChipsEl = container.createDiv({ cls: 'workbuddian-ref-chips workbuddian-hidden' });
        this.selectionEl = container.createDiv({ cls: 'workbuddian-ref-chips workbuddian-hidden' });
        const inputArea = container.createDiv({ cls: 'workbuddian-input-area' });
        const inputBox = inputArea.createDiv({ cls: 'workbuddian-input-box' });
        this.inputEl = inputBox.createEl('textarea', {
            cls: 'workbuddian-input',
            attr: { placeholder: t('view.inputPlaceholder'), rows: '2' }
        });
        this.inputEl.onkeydown = (e) => handleKeydown(this, e);
        this.inputEl.oninput = () => {
            adjustTextareaHeight(this);
            renderReferenceChips(this);
            if (!updateSlashSuggest(this)) updateAtSuggest(this);
        };
        // 聚焦输入框时抓取当前笔记的选区，作为聊天上下文 chip（selectionchange 监听在 onOpen 一次性注册）
        this.inputEl.addEventListener('focus', () => captureNoteSelection(this));
        // 粘贴图片 → 落盘加附件
        this.inputEl.addEventListener('paste', (e) => void handlePaste(this, e));
        // 拖拽文件 → 加附件（带 drop 高亮）
        inputBox.addEventListener('dragover', (e) => { e.preventDefault(); inputBox.addClass('workbuddian-drop-active'); });
        inputBox.addEventListener('dragleave', () => inputBox.removeClass('workbuddian-drop-active'));
        inputBox.addEventListener('drop', (e) => { inputBox.removeClass('workbuddian-drop-active'); handleDrop(this, e); });
        this.atSuggestEl = inputArea.createDiv({ cls: 'workbuddian-at-suggest workbuddian-hidden' });

        // 输入框内底部工具栏：左侧 模型/附件/授权，右侧 圆环 + 发送图标
        const toolbar = inputBox.createDiv({ cls: 'workbuddian-input-toolbar' });

        // 模型选择（点击弹出菜单）
        const modelBtn = toolbar.createDiv({
            cls: 'workbuddian-model-btn',
            attr: { 'aria-label': t('settings.model'), title: t('settings.model'), role: 'button', tabindex: '0' }
        });
        modelBtn.setText(this.settings.model);
        modelBtn.addEventListener('click', () => openModelMenu(this, modelBtn));

        // 附件（系统文件选择器挑任意文件）
        const attachBtn = toolbar.createEl('button', {
            cls: 'workbuddian-toolbar-btn',
            attr: { 'aria-label': t('input.attach'), title: t('input.attach') }
        });
        setIcon(attachBtn, 'paperclip');
        attachBtn.onclick = () => openAttachmentPicker(this);

        // 授权（permission 模式）
        const permBtn = toolbar.createEl('button', {
            cls: 'workbuddian-toolbar-btn',
            attr: { 'aria-label': t('input.permission') }
        });
        setIcon(permBtn, permissionIcon(this.settings.permissionMode));
        permBtn.setAttribute('title', `${t('input.permission')}: ${t('perm.' + this.settings.permissionMode)}`);
        permBtn.onclick = (e) => openPermissionMenu(this, permBtn, e);

        const rightGroup = toolbar.createDiv({ cls: 'workbuddian-toolbar-right' });
        this.sendBtn = rightGroup.createEl('button', {
            cls: 'workbuddian-send-btn',
            attr: { 'aria-label': t('view.send'), title: t('view.send') }
        });
        setIcon(this.sendBtn, 'send');
        this.sendBtn.onclick = () => {
            if (this.isStreaming) {
                this.api.cancel();
            } else {
                void sendMessage(this);
            }
        };

        void loadCustomCommands(this); // 预加载 .codebuddy/commands 自定义命令
    }

    /** 语言切换后重建面板 DOM 并保持当前活跃对话与已渲染内容 */
    async refreshUI() {
        const keepActive = this.activeConvId;
        this.buildUI();
        this.activeConvId = keepActive;
        renderTabs(this);
        await renderMessages(this);
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
