import { Notice, Plugin } from 'obsidian';
import { CodebuddyProvider } from './providers/codebuddy';
import { WorkbuddianChatView, VIEW_TYPE_CHAT } from './features/chat/view';
import { ConversationManager } from './core/session/manager';
import { migrateSettings, normalizePersistedData, type WorkbuddianSettings, type PersistedData } from './types';
import { WorkbuddianSettingTab } from './features/settings/tab';
import { registerWorkbuddianIcon, WORKBUDDIAN_ICON_ID } from './shared/icon';
import { applyPrimaryColor } from './shared/primaryColor';

export default class WorkbuddianPlugin extends Plugin {
    settings: WorkbuddianSettings;
    api: CodebuddyProvider;
    chatView: WorkbuddianChatView | null = null;
    manager: ConversationManager;

    async onload() {
        try {
            await this.loadSettings();

            // 注册品牌图标，供 ribbon 按钮与视图 tab 使用（须在使用该 id 之前）
            registerWorkbuddianIcon();

            // 应用已保存的主色调（空则跟随主题）
            applyPrimaryColor(this.settings.primaryColor);

            this.api = new CodebuddyProvider();
            this.applySettingsToApi();

            // 所有聊天视图共享同一个 ConversationManager 实例，避免侧边栏 + 主编辑区
            // 两个面板同时打开时各自持有独立内存状态、互相用旧快照覆盖对方的改动
            this.manager = new ConversationManager();
            this.manager.setPersistCallback(async (conversations) => {
                const data = normalizePersistedData(await this.loadData());
                data.conversations = conversations;
                await this.saveData(data);
            });

            // 注册聊天视图
            this.registerView(
                VIEW_TYPE_CHAT,
                (leaf) => {
                    const view = new WorkbuddianChatView(leaf, this.api, this.manager, this.settings, async () => {
                        const data = normalizePersistedData(await this.loadData());
                        return data.conversations || [];
                    });
                    this.chatView = view;
                    return view;
                }
            );

            // Ribbon 按钮
            this.addRibbonIcon(WORKBUDDIAN_ICON_ID, 'Workbuddian 聊天', async () => {
                await this.activateView();
            });

            // 命令面板
            this.addCommand({
                id: 'open-chat',
                name: '打开聊天面板',
                callback: async () => {
                    await this.activateView();
                }
            });

            this.addCommand({
                id: 'open-chat-main-pane',
                name: '在主编辑区打开大面板',
                callback: async () => {
                    await this.activateMainPaneView();
                }
            });

            this.addSettingTab(new WorkbuddianSettingTab(this.app, this));
        } catch (e) {
            console.error('[BB] 插件加载失败:', e);
            new Notice('Workbuddian 加载失败，请查看 Console');
        }
    }

    onunload() {
        this.api.cancel();
        applyPrimaryColor('');
    }

    /** 把当前 settings 灌入 provider（onload 与「重置为默认」复用） */
    applySettingsToApi() {
        this.api.setCodebuddyPath(this.settings.codebuddyPath);
        this.api.setTimeout(this.settings.cliTimeoutMinutes * 60_000);
        this.api.setNodePath(this.settings.nodePath);
        this.api.setModel(this.settings.model);
    }

    async activateView() {
        try {
            const { workspace } = this.app;
            let leaf = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];

            if (!leaf) {
                // 全新 Obsidian 环境下右侧边栏可能还没有 leaf，先尝试创建右侧 leaf
                leaf = workspace.getRightLeaf(false);

                if (!leaf) {
                    // 右侧边栏也创建失败时，回退到创建普通 root leaf
                    leaf = workspace.getLeaf(true);
                }

                if (leaf) {
                    await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
                }
            }

            if (leaf) {
                await workspace.revealLeaf(leaf);
                workspace.setActiveLeaf(leaf, { focus: true });
            } else {
                new Notice('Workbuddian：无法创建聊天面板');
            }
        } catch (e) {
            console.error('[BB] 打开聊天面板失败:', e);
            new Notice('Workbuddian：打开面板失败，请查看 Console');
        }
    }

    async activateMainPaneView() {
        try {
            const { workspace } = this.app;
            const leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
            await workspace.revealLeaf(leaf);
            workspace.setActiveLeaf(leaf, { focus: true });
        } catch (e) {
            console.error('[BB] 打开主编辑区面板失败:', e);
            new Notice('Workbuddian：打开主编辑区面板失败，请查看 Console');
        }
    }

    async loadPersistedConversations() {
        const data = normalizePersistedData(await this.loadData());
        if (this.chatView) {
            await this.chatView.loadConversations(data.conversations || []);
        }
    }

    async loadSettings() {
        const data = normalizePersistedData(await this.loadData());
        this.settings = migrateSettings(data.settings);
    }

    async saveSettings() {
        const existingData = normalizePersistedData(await this.loadData());
        const merged: PersistedData = { ...existingData, settings: this.settings };
        await this.saveData(merged);
        this.api.setCodebuddyPath(this.settings.codebuddyPath);
        applyPrimaryColor(this.settings.primaryColor);
    }
}
