import { App, Notice, PluginSettingTab, Setting, type DropdownComponent, type TextAreaComponent, type TextComponent } from 'obsidian';
import type WorkbuddianPlugin from '../../main';
import { DEFAULT_SETTINGS, migrateSettings, exportSettings, MAX_PASTED_IMAGE_KEEP } from '../../types';
import { applyLang, t } from '../../i18n';
import { onConfigChanged } from '../../shared/configEvents';
import { resolveCodebuddyPath } from '../../utils/cliPath';
import { LogModal } from './logModal';
import { McpServerModal } from './mcpModal';
import { parseMcpServers, serializeMcpServers, parseClipboardServers, type McpServerEntry } from '../../shared/mcpServers';
import { discoverPlugins, type CodebuddyPluginInfo } from '../../shared/codebuddyPlugins';
import { execFile } from 'child_process';

export class WorkbuddianSettingTab extends PluginSettingTab {
    plugin: WorkbuddianPlugin;
    private thoughtDropdown: DropdownComponent | null = null;

    constructor(app: App, plugin: WorkbuddianPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        // /effort 等 CLI 侧改动经 config 回流更新 settings 后，本页（若已打开）就地刷新下拉（WB-007）
        this.plugin.registerEvent(onConfigChanged(this.app, () => {
            // 只在外部变更（值确实不同）时刷新，避免打扰正在本页操作的用户
            if (this.thoughtDropdown && this.thoughtDropdown.getValue() !== this.plugin.settings.thoughtLevel) {
                this.thoughtDropdown.setValue(this.plugin.settings.thoughtLevel);
            }
        }));
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ===== 通用(语言置顶,基础设置最优先) =====
        new Setting(containerEl).setName(t('settings.general')).setHeading();
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

        // ===== CodeBuddy 连接 =====
        new Setting(containerEl).setName(t('settings.conn')).setHeading();

        // 后端选择:CodeBuddy CLI(完整能力)或 Hermes gateway(纯对话);切换需重载插件
        new Setting(containerEl)
            .setName(t('backend.title'))
            .setDesc(t('backend.desc'))
            .addDropdown(dropdown => dropdown
                .addOptions({ codebuddy: t('backend.codebuddy'), hermes: t('backend.hermes') })
                .setValue(this.plugin.settings.backend)
                .onChange(async (value) => {
                    this.plugin.settings.backend = value as 'codebuddy' | 'hermes';
                    await this.plugin.saveSettings();
                    new Notice(t('hermes.needRestart'));
                    this.display();
                }));

        // Hermes 配置(仅 hermes 后端显示)
        if (this.plugin.settings.backend === 'hermes') {
            new Setting(containerEl)
                .setName(t('hermes.gatewayUrl'))
                .setDesc(t('hermes.gatewayUrlDesc'))
                .addText(text => text
                    .setPlaceholder('http://127.0.0.1:8642')
                    .setValue(this.plugin.settings.hermesGatewayUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.hermesGatewayUrl = value.trim();
                        await this.plugin.saveSettings();
                    }));
            new Setting(containerEl)
                .setName(t('hermes.apiKey'))
                .setDesc(t('hermes.apiKeyDesc'))
                .addText(text => {
                    text.inputEl.type = 'password';
                    text
                        .setValue(this.plugin.settings.hermesApiKey)
                        .onChange(async (value) => {
                            this.plugin.settings.hermesApiKey = value.trim();
                            await this.plugin.saveSettings();
                        });
                })
                .addButton(btn => btn.setButtonText(t('hermes.test')).onClick(async () => {
                    const { HermesProvider } = await import('../../providers/hermes');
                    const p = new HermesProvider();
                    p.setGateway(this.plugin.settings.hermesGatewayUrl, this.plugin.settings.hermesApiKey);
                    const r = await p.testConnection();
                    new Notice(r.ok ? t('hermes.testOk') : `${t('hermes.testFail')}${r.error}`);
                }));
        }

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

        new Setting(containerEl)
            .setName(t('settings.thoughtLevel'))
            .setDesc(t('settings.thoughtLevelDesc'))
            .addDropdown(dropdown => {
                this.thoughtDropdown = dropdown;
                dropdown
                    .addOptions({
                        enabled: 'enabled', minimal: 'minimal', low: 'low', medium: 'medium',
                        high: 'high', xhigh: 'xhigh', max: 'max',
                    })
                    .setValue(this.plugin.settings.thoughtLevel)
                    .onChange(async (value) => {
                        this.plugin.settings.thoughtLevel = value;
                        this.plugin.api.setThoughtLevel(value);
                        await this.plugin.saveSettings();
                    });
            });

        // MCP 可视化列表（单一真相仍是 mcpServersJson；下方 textarea 为原始编辑器）
        let mcpTextarea: TextAreaComponent | null = null;
        const mcpListEl = containerEl.createDiv({ cls: 'workbuddian-mcp-list' });
        const persistMcp = async (servers: McpServerEntry[]) => {
            this.plugin.settings.mcpServersJson = servers.length ? serializeMcpServers(servers) : '';
            this.plugin.api.setMcpServersJson(this.plugin.settings.mcpServersJson);
            await this.plugin.saveSettings();
            mcpTextarea?.setValue(this.plugin.settings.mcpServersJson);
            renderMcpList();
        };
        const renderMcpList = () => {
            mcpListEl.empty();
            const servers = parseMcpServers(this.plugin.settings.mcpServersJson);
            for (const server of servers) {
                new Setting(mcpListEl)
                    .setName(server.name + (server.disabled ? ` (${t('mcp.fieldEnabled')}✕)` : ''))
                    .setDesc([server.command, ...server.args].join(' '))
                    .addToggle(tg => tg.setValue(!server.disabled).onChange(async () => {
                        server.disabled = server.disabled ? undefined : true;
                        await persistMcp(servers);
                    }))
                    .addExtraButton(btn => btn.setIcon('pencil').onClick(() => {
                        new McpServerModal(this.app, server, t('mcp.modalTitleEdit'), (updated) => {
                            Object.assign(server, updated);
                            void persistMcp(servers);
                        }).open();
                    }))
                    .addExtraButton(btn => btn.setIcon('trash-2').onClick(() => {
                        void persistMcp(servers.filter((s) => s !== server));
                    }));
            }
        };
        renderMcpList();
        new Setting(containerEl)
            .addButton(btn => btn.setButtonText(t('mcp.addServer')).onClick(() => {
                new McpServerModal(this.app, null, t('mcp.modalTitleAdd'), (entry) => {
                    void persistMcp([...parseMcpServers(this.plugin.settings.mcpServersJson), entry]);
                }).open();
            }))
            .addButton(btn => btn.setButtonText(t('mcp.importClipboard')).onClick(async () => {
                const text = await navigator.clipboard.readText();
                const imported = parseClipboardServers(text);
                if (!imported.length) {
                    new Notice(t('mcp.importBad'));
                    return;
                }
                const existing = parseMcpServers(this.plugin.settings.mcpServersJson);
                const fresh = imported.filter((i) => !existing.some((e) => e.name === i.name));
                await persistMcp([...existing, ...fresh]);
            }));

        new Setting(containerEl)
            .setName(t('settings.mcpServers'))
            .setDesc(t('settings.mcpServersDesc'))
            .addTextArea(text => { mcpTextarea = text; text
                .setPlaceholder('[{"name":"x","command":"npx","args":["-y","pkg"]}]')
                .setValue(this.plugin.settings.mcpServersJson)
                .onChange(async (value) => {
                    const trimmed = value.trim();
                    if (trimmed) {
                        try {
                            if (!Array.isArray(JSON.parse(trimmed))) throw new Error('not array');
                        } catch {
                            new Notice(t('settings.invalidJson').replace('{field}', t('settings.mcpServers')));
                            return;
                        }
                    }
                    this.plugin.settings.mcpServersJson = trimmed;
                    this.plugin.api.setMcpServersJson(trimmed);
                    await this.plugin.saveSettings();
                    renderMcpList(); // JSON 直编成功后立即重建列表，不再等重开设置页（WB-011）
                })});

        new Setting(containerEl)
            .setName(t('settings.customAgents'))
            .setDesc(t('settings.customAgentsDesc'))
            .addTextArea(text => text
                .setPlaceholder('{"reviewer":{"description":"...","prompt":"..."}}')
                .setValue(this.plugin.settings.customAgentsJson)
                .onChange(async (value) => {
                    const trimmed = value.trim();
                    if (trimmed) {
                        try {
                            const parsed: unknown = JSON.parse(trimmed);
                            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
                        } catch {
                            new Notice(t('settings.invalidJson').replace('{field}', t('settings.customAgents')));
                            return;
                        }
                    }
                    this.plugin.settings.customAgentsJson = trimmed;
                    this.plugin.api.setCustomAgentsJson(trimmed);
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

        new Setting(containerEl)
            .setName(t('settings.autoTitle'))
            .setDesc(t('settings.autoTitleDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoTitle)
                .onChange(async (value) => {
                    this.plugin.settings.autoTitle = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.pastedKeep'))
            .setDesc(t('settings.pastedKeepDesc'))
            .addText(text => text
                .setPlaceholder('20')
                .setValue(String(this.plugin.settings.pastedImageKeep))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num >= 0 && num <= MAX_PASTED_IMAGE_KEEP) {
                        this.plugin.settings.pastedImageKeep = num;
                        await this.plugin.saveSettings();
                    }
                }));

        // ===== 外观 =====
        new Setting(containerEl).setName(t('settings.appearance')).setHeading();

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

        // ===== CodeBuddy 插件管理(沉底:清单类内容不再拦腰截断设置页) =====
        new Setting(containerEl).setName(t('plugins.title')).setHeading();
        this.renderCodebuddyPlugins(containerEl);
    }

    /** R7:CodeBuddy 插件管理——市场默认折叠 + 紧凑行 + 过滤(清单不再撑爆设置页) */
    private renderCodebuddyPlugins(containerEl: HTMLElement): void {
        const codebuddyPath = this.plugin.settings.codebuddyPath || 'codebuddy';
        const plugins = discoverPlugins();
        if (!plugins.length) {
            new Setting(containerEl)
                .setDesc(t('plugins.empty'))
                .setDisabled(true);
            return;
        }

        // 过滤框:输入实时过滤插件名(复用会话搜索思路)
        const filterEl = new Setting(containerEl)
            .addText(text => text.setPlaceholder(t('plugins.filterPlaceholder')))
            .controlEl.querySelector('input') as HTMLInputElement;

        // 按市场分组
        const byMarket = new Map<string, CodebuddyPluginInfo[]>();
        for (const p of plugins) {
            const arr = byMarket.get(p.marketplace) ?? [];
            arr.push(p);
            byMarket.set(p.marketplace, arr);
        }

        const listEl = containerEl.createDiv({ cls: 'workbuddian-plugins-list' });
        const renderList = (filter: string) => {
            listEl.empty();
            const q = filter.trim().toLowerCase();
            for (const [market, list] of byMarket) {
                const filtered = q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list;
                if (!filtered.length) continue;
                // 市场折叠区:标题行(市场名 + 数量 + 展开箭头),默认收起
                const sectionEl = listEl.createDiv({ cls: 'workbuddian-plugin-market' });
                const headerEl = sectionEl.createDiv({ cls: 'workbuddian-plugin-market-header' });
                headerEl.createSpan({ cls: 'workbuddian-plugin-market-chevron', text: '▸' });
                headerEl.createSpan({ cls: 'workbuddian-plugin-market-name', text: market });
                headerEl.createSpan({ cls: 'workbuddian-plugin-market-count', text: `${filtered.length}` });
                const bodyEl = sectionEl.createDiv({ cls: 'workbuddian-plugin-market-body workbuddian-hidden' });
                headerEl.onclick = () => {
                    const collapsed = bodyEl.classList.contains('workbuddian-hidden');
                    bodyEl.toggleClass('workbuddian-hidden', !collapsed);
                    const chevron = headerEl.querySelector('.workbuddian-plugin-market-chevron');
                    if (chevron) chevron.textContent = collapsed ? '▾' : '▸';
                };
                for (const plugin of filtered) {
                    bodyEl.appendChild(this.createPluginRow(plugin, codebuddyPath));
                }
            }
        };
        filterEl.oninput = () => renderList(filterEl.value);
        renderList('');
    }

    /** 插件行:名称 + 描述一行展示(饱满),右侧 hover 出操作按钮(启用/禁用/更新) */
    private createPluginRow(plugin: CodebuddyPluginInfo, codebuddyPath: string): HTMLElement {
        const row = createDiv({ cls: 'workbuddian-plugin-row' });
        const infoEl = row.createDiv({ cls: 'workbuddian-plugin-info' });
        infoEl.createSpan({ cls: 'workbuddian-plugin-name', text: plugin.name });
        infoEl.createSpan({ cls: 'workbuddian-plugin-desc', text: plugin.description || t('plugins.noDesc') });

        const actions = row.createDiv({ cls: 'workbuddian-plugin-actions' });
        const runPluginCmd = (args: string[], btn: HTMLButtonElement) => {
            const label = t(args[0] === 'enable' ? 'plugins.enable' : args[0] === 'disable' ? 'plugins.disable' : 'plugins.update');
            btn.disabled = true;
            btn.setText(t('plugins.working'));
            execFile(codebuddyPath, ['plugin', ...args, plugin.name], { timeout: 20_000 }, (err) => {
                btn.disabled = false;
                btn.setText(label);
                if (err) {
                    new Notice(t('plugins.opFailed').replace('{name}', plugin.name).replace('{err}', err.message));
                } else {
                    const action = t(args[0] === 'enable' ? 'plugins.enable' : args[0] === 'disable' ? 'plugins.disable' : 'plugins.update');
                    new Notice(t('plugins.opDone').replace('{name}', plugin.name).replace('{action}', action));
                }
            });
        };
        for (const action of ['enable', 'disable', 'update'] as const) {
            const btn = actions.createEl('button', {
                cls: 'workbuddian-plugin-action-btn',
                text: t(`plugins.${action}`),
            });
            btn.onclick = () => runPluginCmd([action], btn);
        }
        return row;
    }
}
