import { Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { CodebuddyProvider } from './providers/codebuddy';
import { HermesProvider } from './providers/hermes';
import { WorkbuddianChatView, VIEW_TYPE_CHAT } from './features/chat/view';
import { ConversationManager } from './core/session/manager';
import { migrateSettings, normalizePersistedData, getErrorMessage, type WorkbuddianSettings, type PersistedData } from './types';
import { WorkbuddianSettingTab } from './features/settings/tab';
import { registerWorkbuddianIcon, WORKBUDDIAN_ICON_ID } from './shared/icon';
import { applyPrimaryColor } from './shared/primaryColor';
import { runInlineEdit } from './features/inline-edit';
import { FloatingInlineEdit } from './features/inline-edit/floatingEdit';
import { createNewChat } from './features/chat/tabs';
import { openInstructionModal } from './features/chat/instructionModal';
import { applyLang, t } from './i18n';
import { bbError } from './shared/logBuffer';

/**
 * 插件入口。启动顺序有意固定：
 * 设置（含语言）→ 图标/主色调 → provider + 灌配置 → 会话管理器（共享单实例）→
 * ACP 会话 id 读写桥 → 视图注册 → ribbon/命令 → 设置页。
 * 任何一步抛错都收敛到 onload 顶层，弹 Notice 而不是让 Obsidian 静默挂起。
 */
export default class WorkbuddianPlugin extends Plugin {
    settings: WorkbuddianSettings;
    api: CodebuddyProvider | HermesProvider;
    chatView: WorkbuddianChatView | null = null;
    manager: ConversationManager;

    async onload() {
        try {
            await this.loadSettings();
            applyLang(this.settings.language);
            registerWorkbuddianIcon(); // 品牌图标须在使用该 id 之前注册
            applyPrimaryColor(this.settings.primaryColor);

            this.api = this.settings.backend === 'hermes' ? new HermesProvider() : new CodebuddyProvider();
            this.applySettingsToApi();

            // 所有聊天视图共享同一个 ConversationManager：避免侧边栏 + 主编辑区
            // 两个面板各自持有内存状态、互相用旧快照覆盖对方的改动
            this.manager = new ConversationManager();
            this.manager.setPersistCallback((conversations) => this.persistConversations(conversations));

            // provider 懒加载/回写 ACP 会话 id 的桥（Conversation.acpSessionId 为唯一真相）
            this.api.setConversationLookup({
                getAcpSessionId: (key) => this.manager.findBySessionId(key)?.acpSessionId,
                setAcpSessionId: (key, id) => {
                    const conv = this.manager.findBySessionId(key);
                    if (conv) this.manager.setAcpSessionId(conv.id, id);
                },
            });

            this.registerView(VIEW_TYPE_CHAT, (leaf) => this.buildChatView(leaf));
            this.addRibbonIcon(WORKBUDDIAN_ICON_ID, t('cmd.ribbonTooltip'), () => void this.activateView());
            this.registerCommands();
            this.addSettingTab(new WorkbuddianSettingTab(this.app, this));
        } catch (e) {
            bbError('[WB] 插件加载失败:', e);
            new Notice(t('cmd.loadFailed'));
        }
    }

    onunload() {
        this.api.dispose();
        applyPrimaryColor('');
    }

    /** 视图工厂：每个 leaf 一个 view，共享 api/manager/settings 与两个数据回调 */
    private buildChatView(leaf: WorkspaceLeaf): WorkbuddianChatView {
        const view = new WorkbuddianChatView(leaf, this.api, this.manager, this.settings, async () => {
            const data = normalizePersistedData(await this.loadData());
            return data.conversations || [];
        }, async () => { await this.saveSettings(); });
        this.chatView = view;
        return view;
    }

    private registerCommands() {
        this.addCommand({ id: 'open-chat', name: t('cmd.openChat'), callback: () => void this.activateView() });
        this.addCommand({
            id: 'open-chat-main-pane',
            name: t('cmd.openChatMainPane'),
            callback: () => void this.activateMainPaneView(),
        });
        this.addCommand({
            id: 'inline-edit',
            name: t('cmd.inlineEdit'),
            editorCallback: (editor) => {
                const basePath = (this.app.vault.adapter as { basePath?: string }).basePath;
                runInlineEdit(this.app, this.api, editor, basePath);
            },
        });
        // 浮动内联编辑:选区上方出浮动工具条,就地改不弹窗
        this.addCommand({
            id: 'inline-edit-floating',
            name: t('cmd.inlineEditFloating'),
            // 快捷键:Cmd/Ctrl+Shift+E(可在 Obsidian 设置改)
            hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'E' }],
            editorCallback: (editor) => {
                const basePath = (this.app.vault.adapter as { basePath?: string }).basePath;
                new FloatingInlineEdit(this.api, editor, basePath).open();
            },
        });

        // 编辑器右键菜单:选中文字 → 右键 →「Workbuddian编辑」(更人性化,不用开命令面板)
        this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
            if (!editor.getSelection().trim()) return; // 无选区不加项
            // 保存选区:点菜单项时编辑器失焦,选区会被清,先存下来触发时恢复
            const savedSel = {
                from: editor.getCursor('from'),
                to: editor.getCursor('to'),
                text: editor.getSelection(),
            };
            menu.addItem((item) =>
                item.setTitle(t('cmd.inlineEditFloating')).setIcon('wand-2').onClick(() => {
                    const basePath = (this.app.vault.adapter as { basePath?: string }).basePath;
                    new FloatingInlineEdit(this.api, editor, basePath, savedSel).open();
                })
            );
        }));

        // 命令面板增强：常用操作快捷键级入口（A2）
        this.addCommand({
            id: 'new-chat',
            name: t('cmd.newChat'),
            callback: () => {
                void this.activateView();
                // 等待面板出现后新建对话
                setTimeout(() => {
                    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
                    const view = leaf?.view as WorkbuddianChatView | undefined;
                    if (view) void createNewChat(view);
                }, 300);
            },
        });
        this.addCommand({
            id: 'edit-instruction',
            name: t('cmd.editInstruction'),
            callback: () => {
                void this.activateView();
                setTimeout(() => {
                    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
                    const view = leaf?.view as WorkbuddianChatView | undefined;
                    if (view) openInstructionModal(view, '');
                }, 300);
            },
        });
        this.addCommand({
            id: 'open-settings',
            name: t('cmd.openSettings'),
            callback: () => {
                // app.setting 是 Obsidian 运行时存在但类型未公开的 API,类型断言访问
                const setting = (this.app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => void } }).setting;
                if (setting?.open) setting.open();
                if (setting?.openTabById) setting.openTabById('workbuddian');
            },
        });
        this.addCommand({
            id: 'export-current-chat',
            name: t('cmd.exportChat'),
            callback: () => {
                const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
                const view = leaf?.view as WorkbuddianChatView | undefined;
                if (!view) { new Notice(t('cmd.openChatFirst')); return; }
                void this.exportCurrentChat(view);
            },
        });
        // 批量导出:把所有会话合并成一个 Markdown 笔记
        this.addCommand({
            id: 'export-all-chats',
            name: t('cmd.exportAllChats'),
            callback: () => {
                void this.exportAllChats();
            },
        });
        this.addCommand({
            id: 'search-chats',
            name: t('cmd.searchChats'),
            callback: () => {
                void this.activateView();
                setTimeout(() => {
                    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
                    const view = leaf?.view as WorkbuddianChatView | undefined;
                    if (view) view.searchInputEl?.focus();
                }, 300);
            },
        });
    }

    /** 导出当前会话为笔记（命令面板增强） */
    private async exportCurrentChat(view: WorkbuddianChatView): Promise<void> {
        const conv = view.getActiveConversation();
        if (!conv || conv.messages.length === 0) {
            new Notice(t('tabs.nothingToExport'));
            return;
        }
        const { formatConversationAsMarkdown } = await import('./shared/export');
        const markdown = formatConversationAsMarkdown(conv);
        if (!markdown) { new Notice(t('tabs.nothingToExport')); return; }
        const fileName = `${conv.title.replace(/[\\/:*?"<>|]/g, ' ')}.md`;
        try {
            await this.app.vault.create(fileName, markdown);
            new Notice(t('tabs.exportedAs').replace('{name}', fileName));
        } catch (err) {
            new Notice(t('tabs.exportFailed').replace('{err}', getErrorMessage(err)));
        }
    }

    /** 批量导出所有会话为一个 Markdown 笔记(带分隔线) */
    private async exportAllChats(): Promise<void> {
        const convs = this.manager.getAll();
        const { formatConversationsAsMarkdown } = await import('./shared/export');
        const markdown = formatConversationsAsMarkdown(convs);
        if (!markdown) { new Notice(t('tabs.nothingToExport')); return; }
        const date = new Date().toISOString().slice(0, 10);
        const fileName = `workbuddian-导出-${date}.md`;
        try {
            await this.app.vault.create(fileName, markdown);
            new Notice(t('tabs.exportedAs').replace('{name}', fileName));
        } catch (err) {
            new Notice(t('tabs.exportFailed').replace('{err}', getErrorMessage(err)));
        }
    }

    /** 会话持久化单点：读出旧数据、换掉会话段、整体写回（管理器回调唯一入口） */
    private async persistConversations(conversations: import('./types').Conversation[]): Promise<void> {
        const data = normalizePersistedData(await this.loadData());
        await this.saveData({ ...data, conversations });
    }

    /** 语言切换后就地刷新所有已打开的聊天面板，无需重开面板或 Cmd+R */
    refreshOpenViews() {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
            const view = leaf.view;
            if (view instanceof WorkbuddianChatView) void view.refreshUI();
        }
    }

    /** 把当前 settings 灌入 provider（onload 与「重置为默认」复用） */
    applySettingsToApi() {
        this.api.setCodebuddyPath(this.settings.codebuddyPath);
        this.api.setTimeout(this.settings.cliTimeoutMinutes * 60_000);
        this.api.setNodePath(this.settings.nodePath);
        this.api.setModel(this.settings.model);
        this.api.setPermissionMode(this.settings.permissionMode);
        this.api.setMcpServersJson(this.settings.mcpServersJson);
        this.api.setCustomAgentsJson(this.settings.customAgentsJson);
        this.api.setThoughtLevel(this.settings.thoughtLevel);
        // Hermes 后端:灌 gateway 地址 + API key
        if (this.api instanceof HermesProvider) {
            this.api.setGateway(this.settings.hermesGatewayUrl, this.settings.hermesApiKey);
        }
    }

    /** 复用已有 leaf 或新建右侧 leaf，然后 reveal + focus；失败给分级 Notice */
    private async openPanel(createLeaf: () => WorkspaceLeaf | null, errNotice: string) {
        try {
            const { workspace } = this.app;
            let leaf = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
            if (!leaf) {
                // setViewState 只对新 leaf 调用：对已有 leaf 重设会重建视图、丢掉输入框/滚动状态
                leaf = createLeaf();
                if (leaf) await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
            }
            if (leaf) {
                await workspace.revealLeaf(leaf);
                workspace.setActiveLeaf(leaf, { focus: true });
            } else {
                new Notice(t('cmd.cannotCreatePanel'));
            }
        } catch (e) {
            bbError('[WB] 打开聊天面板失败:', e);
            new Notice(errNotice);
        }
    }

    async activateView() {
        await this.openPanel(() => {
            // 全新 Obsidian 环境下右侧边栏可能还没有 leaf，先尝试创建右侧 leaf；
            // 失败则回退到创建普通 root leaf
            const { workspace } = this.app;
            return workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
        }, t('cmd.openPanelFailed'));
    }

    async activateMainPaneView() {
        await this.openPanel(() => this.app.workspace.getLeaf('tab'), t('cmd.openMainPaneFailed'));
    }

    async loadPersistedConversations() {
        if (!this.chatView) return;
        const { conversations = [] } = normalizePersistedData(await this.loadData());
        await this.chatView.loadConversations(conversations);
    }

    async loadSettings() {
        const data = normalizePersistedData(await this.loadData());
        this.settings = migrateSettings(data.settings);
    }

    async saveSettings() {
        const merged: PersistedData = {
            ...normalizePersistedData(await this.loadData()),
            settings: this.settings,
        };
        await this.saveData(merged);
        this.api.setCodebuddyPath(this.settings.codebuddyPath);
        applyPrimaryColor(this.settings.primaryColor);
    }
}
