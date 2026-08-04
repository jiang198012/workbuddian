import { Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { CodebuddyProvider } from './providers/codebuddy';
import { WorkbuddianChatView, VIEW_TYPE_CHAT } from './features/chat/view';
import { ConversationManager } from './core/session/manager';
import { migrateSettings, normalizePersistedData, type WorkbuddianSettings, type PersistedData } from './types';
import { WorkbuddianSettingTab } from './features/settings/tab';
import { registerWorkbuddianIcon, WORKBUDDIAN_ICON_ID } from './shared/icon';
import { applyPrimaryColor } from './shared/primaryColor';
import { runInlineEdit } from './features/inline-edit';
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
    api: CodebuddyProvider;
    chatView: WorkbuddianChatView | null = null;
    manager: ConversationManager;

    async onload() {
        try {
            await this.loadSettings();
            applyLang(this.settings.language);
            registerWorkbuddianIcon(); // 品牌图标须在使用该 id 之前注册
            applyPrimaryColor(this.settings.primaryColor);

            this.api = new CodebuddyProvider();
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
