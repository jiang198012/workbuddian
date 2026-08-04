import { App, Modal, Setting } from 'obsidian';
import { t } from '../../i18n';

export type ExternalAccessDecision = 'once' | 'always' | 'cancel';

/**
 * vault 外附件读取授权弹窗（WB-002）：CLI default 模式对 Read 工具一律自动放行（含 cwd 之外），
 * 所以"读取 vault 外附件前必须授权"只能由插件侧把关。允许一次 / 总是允许（按路径持久化）/ 取消（不发送）。
 */
class ExternalAccessModal extends Modal {
    constructor(
        app: App,
        private readonly paths: string[],
        private readonly decide: (d: ExternalAccessDecision) => void,
    ) { super(app); }

    onOpen(): void {
        this.titleEl.setText(t('external.title'));
        this.contentEl.createDiv({ cls: 'workbuddian-external-access-desc', text: t('external.desc') });
        const list = this.contentEl.createEl('ul', { cls: 'workbuddian-external-access-list' });
        for (const p of this.paths) list.createEl('li', { text: p });
        new Setting(this.contentEl)
            .addButton(b => b.setButtonText(t('external.allowOnce')).setCta()
                // 必须先 decide 再 close：close 触发的 onClose 会把未决定的弹窗视为取消，
                // 先 close 会让"允许"永远被取消分支抢先（WB-RT-002 实测：允许后未发送）
                .onClick(() => { this.decide('once'); this.close(); }))
            .addButton(b => b.setButtonText(t('approval.alwaysAllow'))
                .onClick(() => { this.decide('always'); this.close(); }))
            .addButton(b => b.setButtonText(t('approval.cancel'))
                .onClick(() => { this.decide('cancel'); this.close(); }));
    }

    onClose(): void { this.contentEl.empty(); }
}

/** 打开授权弹窗并等待决定；Esc / 点遮罩关闭视为取消 */
export function confirmExternalAccess(app: App, paths: string[]): Promise<ExternalAccessDecision> {
    return new Promise((resolve) => {
        let settled = false;
        const decide = (d: ExternalAccessDecision) => {
            if (settled) return;
            settled = true;
            resolve(d);
        };
        const modal = new ExternalAccessModal(app, paths, decide);
        const baseOnClose = modal.onClose.bind(modal);
        modal.onClose = () => { baseOnClose(); decide('cancel'); };
        modal.open();
    });
}
