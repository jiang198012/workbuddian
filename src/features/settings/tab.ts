import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type WorkbuddianPlugin from '../../main';
import { DEFAULT_SETTINGS, migrateSettings, exportSettings } from '../../types';
import { t } from '../../i18n';

const MODEL_OPTIONS: Record<string, string> = {
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
        new Setting(containerEl).setName(t('settings.conn')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.path'))
            .setDesc(t('settings.pathDesc'))
            .addText(text => text
                .setPlaceholder(t('settings.pathPlaceholder'))
                .setValue(this.plugin.settings.codebuddyPath)
                .onChange(async (value) => {
                    this.plugin.settings.codebuddyPath = value;
                    this.plugin.api.setCodebuddyPath(value);
                    await this.plugin.saveSettings();
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

        new Setting(containerEl)
            .setName(t('settings.model'))
            .setDesc(t('settings.modelDesc'))
            .addDropdown(dropdown => dropdown
                .addOptions({ auto: t('settings.modelAuto'), ...MODEL_OPTIONS })
                .setValue(this.plugin.settings.model)
                .onChange(async (value) => {
                    this.plugin.settings.model = value;
                    this.plugin.api.setModel(value);
                    await this.plugin.saveSettings();
                }));

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
            .setName(t('settings.primary'))
            .setDesc(t('settings.primaryDesc'))
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
                .setTooltip(t('settings.resetTooltip'))
                .onClick(async () => {
                    this.plugin.settings.primaryColor = '';
                    await this.plugin.saveSettings();
                    this.display();
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

        // ===== 备份 =====
        new Setting(containerEl).setName(t('settings.backup')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.export'))
            .setDesc(t('settings.exportDesc'))
            .addButton(btn => btn.setButtonText(t('settings.exportBtn')).onClick(async () => {
                await navigator.clipboard.writeText(exportSettings(this.plugin.settings));
                new Notice(t('settings.exportDone'));
            }));

        let importValue = '';
        new Setting(containerEl)
            .setName(t('settings.import'))
            .setDesc(t('settings.importDesc'))
            .addTextArea(ta => {
                ta.setPlaceholder(t('settings.importPlaceholder'));
                ta.onChange(v => { importValue = v; });
            })
            .addButton(btn => btn.setButtonText(t('settings.importBtn')).setWarning().onClick(async () => {
                try {
                    this.plugin.settings = migrateSettings(JSON.parse(importValue));
                    this.plugin.applySettingsToApi();
                    await this.plugin.saveSettings();
                    new Notice(t('settings.importDone'));
                    this.display();
                } catch (e) {
                    new Notice(t('settings.importErr'));
                }
            }));
    }
}
