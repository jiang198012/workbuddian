import { App, Modal, Notice, Setting } from 'obsidian';
import type { McpServerEntry, McpServerEnv } from '../../shared/mcpServers';
import { t } from '../../i18n';

function parseEnvLines(text: string): McpServerEnv[] {
    return text.split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('='))
        .map((line) => {
            const idx = line.indexOf('=');
            return { name: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
        })
        .filter((e) => e.name.length > 0);
}

/** MCP 服务器增/改表单（stdio；http/sse 形态经探针证实 ACP 不接受，见 spec R5） */
export class McpServerModal extends Modal {
    private entry: McpServerEntry;

    constructor(
        app: App,
        entry: McpServerEntry | null,
        private readonly modalTitle: string,
        private readonly onSave: (e: McpServerEntry) => void,
    ) {
        super(app);
        this.entry = entry ?? { name: '', command: '', args: [], env: [] };
    }

    onOpen() {
        this.titleEl.setText(this.modalTitle);
        const { contentEl } = this;
        let { name, command, disabled } = this.entry;
        let argsText = this.entry.args.join(' ');
        let envText = this.entry.env.map((e) => `${e.name}=${e.value}`).join('\n');

        new Setting(contentEl).setName(t('mcp.fieldName'))
            .addText(txt => txt.setValue(name).onChange(v => { name = v.trim(); }));
        new Setting(contentEl).setName(t('mcp.fieldCommand'))
            .addText(txt => txt.setPlaceholder('npx / node / uvx …').setValue(command).onChange(v => { command = v.trim(); }));
        new Setting(contentEl).setName(t('mcp.fieldArgs'))
            .addText(txt => txt.setPlaceholder('-y some-package').setValue(argsText).onChange(v => { argsText = v; }));
        new Setting(contentEl).setName(t('mcp.fieldEnv'))
            .addTextArea(txt => txt.setPlaceholder('KEY=VALUE').setValue(envText).onChange(v => { envText = v; }));
        new Setting(contentEl).setName(t('mcp.fieldEnabled'))
            .addToggle(tg => tg.setValue(!disabled).onChange(v => { disabled = !v; }));

        new Setting(contentEl).addButton(b => b.setButtonText(t('mcp.save')).setCta().onClick(() => {
            if (!name) {
                new Notice(t('mcp.nameRequired'));
                return;
            }
            this.onSave({
                name, command,
                args: argsText.split(/\s+/).filter(Boolean),
                env: parseEnvLines(envText),
                disabled: disabled ? true : undefined,
            });
            this.close();
        }));
    }

    onClose() { this.contentEl.empty(); }
}
