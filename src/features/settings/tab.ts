import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type WorkbuddianPlugin from '../../main';
import { DEFAULT_SETTINGS } from '../../types';

const MODEL_OPTIONS: Record<string, string> = {
    auto: 'Auto（默认，由 CodeBuddy 自动选择）',
    hy3: 'hy3',
    'glm-5.2': 'glm-5.2',
    'glm-5.1': 'glm-5.1',
    'glm-5v-turbo': 'glm-5v-turbo',
    'minimax-m3': 'minimax-m3',
    'kimi-k2.7': 'kimi-k2.7',
    'kimi-k2.6': 'kimi-k2.6',
    'deepseek-v4-flash': 'deepseek-v4-flash',
    'deepseek-v4-pro': 'deepseek-v4-pro'
};

export class WorkbuddianSettingTab extends PluginSettingTab {
    plugin: WorkbuddianPlugin;

    constructor(app: App, plugin: WorkbuddianPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ===== CodeBuddy 连接 =====
        new Setting(containerEl).setName('CodeBuddy 连接').setHeading();

        new Setting(containerEl)
            .setName('CodeBuddy 路径')
            .setDesc('codebuddy 可执行文件路径。如 WorkBuddy 自定义安装，路径通常为：安装目录\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy（右键 WorkBuddy 快捷方式 → 打开文件位置 可找到安装目录）')
            .addText(text => text
                .setPlaceholder('WorkBuddy安装目录\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy')
                .setValue(this.plugin.settings.codebuddyPath)
                .onChange(async (value) => {
                    this.plugin.settings.codebuddyPath = value;
                    this.plugin.api.setCodebuddyPath(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('手动指定 Node.js 路径')
            .setDesc('留空则自动探测。如果自动探测失败（例如非标准安装路径），可以在这里手动指定 node 可执行文件的完整路径')
            .addText(text => text
                .setPlaceholder('留空 = 自动探测')
                .setValue(this.plugin.settings.nodePath)
                .onChange(async (value) => {
                    this.plugin.settings.nodePath = value;
                    this.plugin.api.setNodePath(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('CLI 超时时长（分钟）')
            .setDesc('CodeBuddy CLI 单次响应最长等待时间，超过会强制中断')
            .addText(text => text
                .setPlaceholder('5')
                .setValue(String(this.plugin.settings.cliTimeoutMinutes))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.cliTimeoutMinutes = num;
                        this.plugin.api.setTimeout(num * 60_000);
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('模型')
            .setDesc('CodeBuddy CLI 使用的模型')
            .addDropdown(dropdown => dropdown
                .addOptions(MODEL_OPTIONS)
                .setValue(this.plugin.settings.model)
                .onChange(async (value) => {
                    this.plugin.settings.model = value;
                    this.plugin.api.setModel(value);
                    await this.plugin.saveSettings();
                }));

        // ===== 上下文注入 =====
        new Setting(containerEl).setName('上下文注入').setHeading();

        new Setting(containerEl)
            .setName('注入 Vault 上下文')
            .setDesc('开启后，每次发送消息都会自动附上当前 Vault 路径，让 AI 基于 Vault 中的文件回答问题')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.injectVaultContext)
                .onChange(async (value) => {
                    this.plugin.settings.injectVaultContext = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('注入当前笔记链接')
            .setDesc('开启后，每次发送消息都会附上当前正在查看的笔记标题和路径（不包含正文内容）')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.injectCurrentNoteLink)
                .onChange(async (value) => {
                    this.plugin.settings.injectCurrentNoteLink = value;
                    await this.plugin.saveSettings();
                }));

        // ===== 外观 =====
        new Setting(containerEl).setName('外观').setHeading();

        new Setting(containerEl)
            .setName('聊天主色调')
            .setDesc('自定义聊天面板的强调色（用户气泡、发送按钮、边框、focus 高亮等）。点「恢复默认」跟随 Obsidian 主题色。')
            .addColorPicker(picker => {
                const current = this.plugin.settings.primaryColor
                    || getComputedStyle(document.body).getPropertyValue('--interactive-accent').trim()
                    || '#7c3aed';
                picker
                    .setValue(current)
                    .onChange(async (value) => {
                        this.plugin.settings.primaryColor = value;
                        await this.plugin.saveSettings();
                    });
            })
            .addExtraButton(btn => btn
                .setIcon('rotate-ccw')
                .setTooltip('恢复默认（跟随主题色）')
                .onClick(async () => {
                    this.plugin.settings.primaryColor = '';
                    await this.plugin.saveSettings();
                    this.display();
                }));

        // ===== 重置 =====
        new Setting(containerEl).setName('重置').setHeading();

        new Setting(containerEl)
            .setName('重置为默认')
            .setDesc('清空所有自定义设置，恢复到插件默认值（包括路径、模型、注入开关、主色调）。')
            .addButton(btn => {
                btn.setButtonText('重置为默认').setWarning();
                let armed = false;
                let timer: number | null = null;
                btn.onClick(async () => {
                    if (!armed) {
                        armed = true;
                        btn.setButtonText('确认重置？');
                        timer = window.setTimeout(() => {
                            armed = false;
                            btn.setButtonText('重置为默认');
                        }, 3000);
                        return;
                    }
                    if (timer !== null) window.clearTimeout(timer);
                    this.plugin.settings = { ...DEFAULT_SETTINGS };
                    this.plugin.applySettingsToApi();
                    await this.plugin.saveSettings();
                    this.display();
                    new Notice('已重置为默认设置');
                });
            });
    }
}
