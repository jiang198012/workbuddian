import { Modal, Setting } from 'obsidian';
import type { WorkbuddianChatView } from './view';
import { t } from '../../i18n';

class InstructionModal extends Modal {
    constructor(private view: WorkbuddianChatView, private initial: string) {
        super(view.app);
    }
    onOpen() {
        const { contentEl } = this;
        new Setting(contentEl).setName(t('instruction.modalTitle')).setHeading();
        const ta = contentEl.createEl('textarea', {
            cls: 'workbuddian-instruction-textarea',
            attr: { placeholder: t('instruction.placeholder'), rows: '6' },
        });
        ta.value = this.initial;
        const bar = contentEl.createDiv({ cls: 'workbuddian-instruction-buttons' });
        const clearBtn = bar.createEl('button', { text: t('instruction.clear') });
        clearBtn.onclick = () => { ta.value = ''; ta.focus(); };
        const saveBtn = bar.createEl('button', { text: t('instruction.save'), cls: 'mod-cta' });
        saveBtn.onclick = async () => {
            this.view.settings.customInstruction = ta.value.trim();
            await this.view.saveSettingsCallback();
            this.view.refreshInstructionIndicator();
            this.close();
        };
    }
    onClose() { this.contentEl.empty(); }
}

/** 打开常驻指令弹窗；addition 非空则预填「现有指令 +（换行）+ addition」 */
export function openInstructionModal(view: WorkbuddianChatView, addition: string) {
    const existing = view.settings.customInstruction || '';
    const initial = addition ? (existing ? `${existing}\n${addition}` : addition) : existing;
    new InstructionModal(view, initial).open();
}
