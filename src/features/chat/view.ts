import { ItemView, Component, MarkdownView, setIcon } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { ConversationManager } from '../../core/session/manager';
import { CodebuddyProvider } from '../../providers/codebuddy';
import { type Conversation, type WorkbuddianSettings } from '../../types';
import { WORKBUDDIAN_ICON_ID } from '../../shared/icon';
import { renderTabs, createNewChat } from './tabs';
import { renderMessages } from './render';
import { handleKeydown, sendMessage, adjustTextareaHeight, updateAtSuggest, updateSlashSuggest, loadCustomCommands, renderReferenceChips, openAttachmentPicker, openPermissionMenu, openModelMenu, permissionIcon, captureNoteSelection, handlePaste, handleDrop } from './input';
import { openInstructionModal } from './instructionModal';
import type { SlashCommandInfo } from '../../shared/slashCommand';
import { isActivationKey } from '../../shared/inputKeys';
import { modelLabel } from '../../shared/cliOptions';
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
    instructionBtn!: HTMLButtonElement;
    permissionBtn!: HTMLButtonElement;
    tabBar!: HTMLElement;
    /** 会话搜索框(标签栏,搜索态过滤 tab;空串=显示全部) */
    searchInputEl!: HTMLInputElement;
    searchQuery: string = '';
    /** 上下文用量预警条(用量 ≥80% 显示,提示压缩/新建) */
    usageBannerEl!: HTMLElement;
    isStreaming: boolean = false;
    streamingMsgId: string | null = null;
    /** 本面板悬挂的批准卡：requestId → 兜底 reject optionId（关面板/切会话/卸载时统一答 reject） */
    pendingApprovals = new Map<number, string>();
    /** CLI usage_update 上报的真实上下文窗口（用户未自定义 contextWindowSize 时优先于设置值） */
    cliWindowSize: number | undefined;
    activeRename: { input: HTMLInputElement; commit: () => void } | null = null;
    activeConvId: string | null = null;
    markdownComponent: Component;
    loadDataCallback: () => Promise<Conversation[]>;
    saveSettingsCallback: () => Promise<void>;
    customCommands: SlashCommandInfo[] = [];
    attachChipsEl!: HTMLElement;
    attachments: string[] = [];
    selectionEl!: HTMLElement;
    usageEl!: HTMLElement;
    liveRegionEl!: HTMLElement;
    suggestIndex: number = -1; // 补全下拉当前高亮项，-1 = 无
    selection: { text: string; note: string } | null = null;
    lastMarkdownView: MarkdownView | null = null;
    /** 在飞的自动标题会话 key（可丢弃后台任务）：用户发送新消息时立即取消它，让出串行队列 */
    titleSessionKey: string | null = null;

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
            bbError('[WB] 加载历史对话失败:', e);
        }
    }

    /** 构建/重建整个面板 DOM（用当前语言的 t() 文案）。语言切换时可重复调用刷新界面语言。 */
    private buildUI() {
        const container = this.contentEl;
        container.empty();
        container.addClass('workbuddian-chat-container');

        // 顶部标签栏
        this.tabBar = container.createDiv({ cls: 'workbuddian-tab-bar', attr: { role: 'tablist' } });
        const newBtn = this.tabBar.createEl('button', {
            text: '',
            cls: 'workbuddian-new-chat-btn',
            attr: { title: t('view.newChat'), 'aria-label': t('view.newChat') }
        });
        setIcon(newBtn, 'plus');
        newBtn.onclick = () => createNewChat(this);

        // 会话搜索框:输入实时过滤 tab(调 manager.search),空串恢复全部
        this.searchInputEl = this.tabBar.createEl('input', {
            type: 'text',
            cls: 'workbuddian-search-input',
            attr: { placeholder: t('tabs.searchPlaceholder'), 'aria-label': t('tabs.searchPlaceholder') },
        });
        this.searchInputEl.oninput = () => {
            this.searchQuery = this.searchInputEl.value.trim();
            renderTabs(this);
        };
        this.searchInputEl.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                this.searchInputEl.value = '';
                this.searchQuery = '';
                renderTabs(this);
            }
        };

        this.messageContainer = container.createDiv({ cls: 'workbuddian-messages' });

        // 屏幕阅读器播报区：renderMessages 每次都会清空重建 messageContainer，若把 aria-live 挂在
        // 那上面，整段历史会被当作新增内容反复朗读。改用这个视觉隐藏的独立节点，只写入新回复本身。
        this.liveRegionEl = container.createDiv({
            cls: 'workbuddian-sr-only',
            attr: { 'aria-live': 'polite', role: 'status' }
        });

        // 底部输入区
        this.chipsEl = container.createDiv({ cls: 'workbuddian-ref-chips workbuddian-hidden' });
        this.attachChipsEl = container.createDiv({ cls: 'workbuddian-ref-chips workbuddian-hidden' });
        this.selectionEl = container.createDiv({ cls: 'workbuddian-ref-chips workbuddian-hidden' });
        const inputArea = container.createDiv({ cls: 'workbuddian-input-area' });
        // 上下文用量预警条:用量 ≥80% 时显示,提示压缩/新建(见 renderContextUsage)
        this.usageBannerEl = inputArea.createDiv({ cls: 'workbuddian-usage-banner workbuddian-hidden' });
        const inputBox = inputArea.createDiv({ cls: 'workbuddian-input-box' });
        this.inputEl = inputBox.createEl('textarea', {
            cls: 'workbuddian-input',
            attr: { placeholder: t('view.inputPlaceholder'), rows: '2', 'aria-label': t('input.ariaLabel') }
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

        // 输入框内底部工具栏：左侧 输入相关（模型/附件），右侧 会话控制（授权/指令/用量/发送）
        // 分组 + 低频指令收进「更多」菜单，避免 6 个控件挤一条把模型按钮压到 31px（体检实测）
        const toolbar = inputBox.createDiv({ cls: 'workbuddian-input-toolbar' });

        // 左组：输入相关
        const leftGroup = toolbar.createDiv({ cls: 'workbuddian-toolbar-left' });

        // 模型选择（点击弹出菜单）
        const modelBtn = leftGroup.createDiv({
            cls: 'workbuddian-model-btn',
            attr: { 'aria-label': t('settings.model'), title: t('settings.model'), role: 'button', tabindex: '0' }
        });
        modelBtn.setText(modelLabel(this.settings.model));
        modelBtn.addEventListener('click', () => openModelMenu(this, modelBtn));
        // role="button" 的 div 没有原生键盘激活行为，手动补上 Enter/Space
        modelBtn.addEventListener('keydown', (e: KeyboardEvent) => {
            if (isActivationKey(e.key)) {
                e.preventDefault();
                openModelMenu(this, modelBtn);
            }
        });

        // 附件（系统文件选择器挑任意文件）
        const attachBtn = leftGroup.createEl('button', {
            cls: 'workbuddian-toolbar-btn',
            attr: { 'aria-label': t('input.attach'), title: t('input.attach') }
        });
        setIcon(attachBtn, 'paperclip');
        attachBtn.onclick = () => openAttachmentPicker(this);

        // 右组：会话控制
        const rightGroup = toolbar.createDiv({ cls: 'workbuddian-toolbar-right' });

        // 授权（permission 模式）
        const permBtn = rightGroup.createEl('button', {
            cls: 'workbuddian-toolbar-btn',
            attr: { 'aria-label': t('input.permission') }
        });
        setIcon(permBtn, permissionIcon(this.settings.permissionMode));
        permBtn.setAttribute('title', `${t('input.permission')}: ${t('perm.' + this.settings.permissionMode)}`);
        permBtn.onclick = (e) => openPermissionMenu(this, permBtn, e);
        this.permissionBtn = permBtn;

        // 常驻指令指示：低频功能收进「更多」菜单（有指令时按钮高亮成 accent，点击直接开指令编辑）
        const instrBtn = rightGroup.createEl('button', { cls: 'workbuddian-toolbar-btn' });
        setIcon(instrBtn, 'hash');
        instrBtn.onclick = () => openInstructionModal(this, '');
        this.instructionBtn = instrBtn;
        this.refreshInstructionIndicator();
        // role="img" 配合 aria-label：裸 div 是隐式 role=generic，ARIA 规范禁止在其上用
        // aria-label（多数辅助技术会忽略），见 M2
        this.usageEl = rightGroup.createDiv({ cls: 'workbuddian-usage-ring workbuddian-hidden', attr: { role: 'img' } });
        this.sendBtn = rightGroup.createEl('button', {
            cls: 'workbuddian-send-btn',
            attr: { 'aria-label': t('view.send'), title: t('view.send') }
        });
        setIcon(this.sendBtn, 'send');
        this.sendBtn.onclick = () => {
            if (this.isStreaming) {
                // ACP 定向 cancel：只停本面板会话的在飞轮次，不误杀另一面板（v1 共享进程误杀已消灭）
                this.api.cancel(this.getActiveConversation()?.sessionId);
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

    /** 按 settings.customInstruction 刷新工具栏 # 指示按钮的高亮与提示 */
    refreshInstructionIndicator() {
        if (!this.instructionBtn) return;
        const on = !!this.settings.customInstruction;
        this.instructionBtn.toggleClass('workbuddian-instruction-active', on);
        const label = on ? t('instruction.indicatorOn') : t('instruction.indicatorOff');
        this.instructionBtn.setAttribute('title', label);
        this.instructionBtn.setAttribute('aria-label', label);
    }

    /** 面板关闭/切会话/卸载前，把本面板悬挂的批准卡统一答 reject（批准请求不设超时，不能悬挂到 CLI 侧干等） */
    rejectPendingApprovals(): void {
        for (const [requestId, rejectId] of this.pendingApprovals) this.api.respondPermission(requestId, rejectId);
        this.pendingApprovals.clear();
    }

    async onClose() {
        this.rejectPendingApprovals();
        this.markdownComponent.unload();
    }

    async loadConversations(conversations: Conversation[]) {
        this.manager.load(conversations);
        this.activeConvId = this.manager.getActive()?.id ?? null;
        renderTabs(this);
        await renderMessages(this);
    }
}
