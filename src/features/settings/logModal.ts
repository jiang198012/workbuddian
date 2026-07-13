import { App, Modal, Notice } from 'obsidian';
import { getLogs, clearLogs } from '../../shared/logBuffer';
import { t } from '../../i18n';

/** 展示内存里的 [BB] 运行日志，支持复制全部与清空 */
export class LogModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('workbuddian-log-modal');
        contentEl.createEl('h3', { text: t('log.title') });

        const pre = contentEl.createEl('pre', { cls: 'workbuddian-log-body' });
        const render = () => {
            const logs = getLogs();
            pre.setText(logs.length ? logs.join('\n') : t('log.empty'));
        };
        render();

        const actions = contentEl.createDiv({ cls: 'workbuddian-log-actions' });
        const copyBtn = actions.createEl('button', { text: t('log.copy') });
        copyBtn.onclick = async () => {
            await navigator.clipboard.writeText(getLogs().join('\n'));
            new Notice(t('log.copied'));
        };
        const clearBtn = actions.createEl('button', { text: t('log.clear'), cls: 'mod-warning' });
        clearBtn.onclick = () => {
            clearLogs();
            render();
            new Notice(t('log.cleared'));
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}
