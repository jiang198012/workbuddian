import { App, Notice, PluginSettingTab, Setting, type TextComponent } from 'obsidian';
import type WorkbuddianPlugin from '../../main';
import { DEFAULT_SETTINGS, migrateSettings, exportSettings } from '../../types';
import { applyLang, t } from '../../i18n';
import { resolveCodebuddyPath } from '../../utils/cliPath';
import { LogModal } from './logModal';

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
        new Setting(containerEl).setName(t('settings.conn')).setHeading();

        let pathInput: TextComponent;
        new Setting(containerEl)
            .setName(t('settings.path'))
            .setDesc(t('settings.pathDesc'))
            .addText(text => {
                pathInput = text;
                text
                    .setPlaceholder(t('settings.pathPlaceholder'))
                    .setValue(this.plugin.settings.codebuddyPath)
                    .onChange(async (value) => {
                        this.plugin.settings.codebuddyPath = value;
                        this.plugin.api.setCodebuddyPath(value);
                        await this.plugin.saveSettings();
                    });
            })
            .addExtraButton(btn => btn
                .setIcon('search')
                .setTooltip(t('settings.pathDetect'))
                .onClick(async () => {
                    // 按 Win/Mac 的 WorkBuddy 默认安装位置探测；探到真实路径就填入，否则提示手动指定
                    const detected = resolveCodebuddyPath('');
                    if (detected && detected !== 'codebuddy') {
                        this.plugin.settings.codebuddyPath = detected;
                        this.plugin.api.setCodebuddyPath(detected);
                        await this.plugin.saveSettings();
                        pathInput.setValue(detected);
                        new Notice(t('settings.pathDetected').replace('{path}', detected));
                    } else {
                        new Notice(t('settings.pathNotFound'));
                    }
                }));

        new Setting(containerEl)
            .setName(t('settings.node'))
            .setDesc(t('settings.nodeDesc'))
            .addText(text => text
                .setPlaceholder(t('settings.nodePlaceholder'))
                .setValue(this.plugin.settings.nodePath)
                .onChange(async (value) => {
                    this.plugin.settings.nodePath = value;
                    this.plugin.api.setNodePath(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.timeout'))
            .setDesc(t('settings.timeoutDesc'))
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

        // 模型 / 授权已移到聊天工具栏前台，设置页不再重复

        // ===== 上下文注入 =====
        new Setting(containerEl).setName(t('settings.inject')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.injectVault'))
            .setDesc(t('settings.injectVaultDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.injectVaultContext)
                .onChange(async (value) => {
                    this.plugin.settings.injectVaultContext = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.injectNote'))
            .setDesc(t('settings.injectNoteDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.injectCurrentNoteLink)
                .onChange(async (value) => {
                    this.plugin.settings.injectCurrentNoteLink = value;
                    await this.plugin.saveSettings();
                }));

        // ===== 外观 =====
        new Setting(containerEl).setName(t('settings.appearance')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.language'))
            .setDesc(t('settings.languageDesc'))
            .addDropdown(dropdown => dropdown
                .addOptions({ auto: t('settings.langAuto'), zh: t('settings.langZh'), en: t('settings.langEn') })
                .setValue(this.plugin.settings.language)
                .onChange(async (value) => {
                    this.plugin.settings.language = value as 'auto' | 'zh' | 'en';
                    applyLang(this.plugin.settings.language);
                    await this.plugin.saveSettings();
                    this.plugin.refreshOpenViews(); // 已打开的聊天面板就地刷新语言
                    this.display();
                    new Notice(t('settings.langReload'));
                }));

        new Setting(containerEl)
            .setName(t('settings.primary'))
            .setDesc(t('settings.primaryDesc'))
            .addColorPicker(picker => {
                const current = this.plugin.settings.primaryColor || '#C8B487';
                picker
                    .setValue(current)
                    .onChange(async (value) => {
                        this.plugin.settings.primaryColor = value;
                        await this.plugin.saveSettings();
                    });
            })
            .addExtraButton(btn => btn
                .setIcon('rotate-ccw')
                .setTooltip(t('settings.resetTooltip'))
                .onClick(async () => {
                    this.plugin.settings.primaryColor = '';
                    await this.plugin.saveSettings();
                    this.display();
                }));

        new Setting(containerEl)
            .setName(t('settings.contextWindow'))
            .setDesc(t('settings.contextWindowDesc'))
            .addText(text => text
                .setPlaceholder('200000')
                .setValue(String(this.plugin.settings.contextWindowSize))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.contextWindowSize = num;
                        await this.plugin.saveSettings();
                    }
                }));

        // ===== 重置 =====
        new Setting(containerEl).setName(t('settings.reset')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.resetDefault'))
            .setDesc(t('settings.resetDesc'))
            .addButton(btn => {
                btn.setButtonText(t('settings.resetDefault')).setWarning();
                let armed = false;
                let timer: number | null = null;
                btn.onClick(async () => {
                    if (!armed) {
                        armed = true;
                        btn.setButtonText(t('settings.resetConfirm'));
                        timer = window.setTimeout(() => {
                            armed = false;
                            btn.setButtonText(t('settings.resetDefault'));
                        }, 3000);
                        return;
                    }
                    if (timer !== null) window.clearTimeout(timer);
                    this.plugin.settings = { ...DEFAULT_SETTINGS };
                    this.plugin.applySettingsToApi();
                    await this.plugin.saveSettings();
                    this.display();
                    new Notice(t('settings.resetDone'));
                });
            });

        // ===== 导入 / 导出设置 =====
        new Setting(containerEl).setName(t('settings.importExport')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.export'))
            .setDesc(t('settings.exportDesc'))
            .addButton(btn => btn.setButtonText(t('settings.exportBtn')).onClick(() => {
                // 存为 JSON 文件（Blob + <a download>），不再写剪贴板
                const blob = new Blob([exportSettings(this.plugin.settings)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'workbuddian-settings.json';
                a.click();
                URL.revokeObjectURL(url);
                new Notice(t('settings.exportDone'));
            }));

        new Setting(containerEl)
            .setName(t('settings.import'))
            .setDesc(t('settings.importDesc'))
            .addButton(btn => btn.setButtonText(t('settings.importBtn')).setWarning().onClick(() => {
                // 系统文件选择器挑 .json，读文件内容后覆盖设置
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json,application/json';
                input.onchange = async () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    try {
                        this.plugin.settings = migrateSettings(JSON.parse(await file.text()));
                        this.plugin.applySettingsToApi();
                        await this.plugin.saveSettings();
                        new Notice(t('settings.importDone'));
                        this.display();
                    } catch (e) {
                        new Notice(t('settings.importErr'));
                    }
                };
                input.click();
            }));

        // ===== 日志 =====
        new Setting(containerEl).setName(t('settings.logs')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.viewLogs'))
            .setDesc(t('settings.logsDesc'))
            .addButton(btn => btn.setButtonText(t('settings.viewLogs')).onClick(() => {
                new LogModal(this.app).open();
            }));
    }
}
