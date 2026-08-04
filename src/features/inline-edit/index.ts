import { App, Editor, Modal, Notice, Setting } from 'obsidian';
import { CodebuddyProvider } from '../../providers/codebuddy';
import { lineDiff, type DiffLine } from '../../shared/lineDiff';
import { renderDiffRows } from '../../shared/diffRows';
import { buildEditPrompt } from '../../shared/editPrompt';
import { t } from '../../i18n';

async function collectEditResult(api: CodebuddyProvider, sessionId: string, prompt: string, vaultPath?: string): Promise<string> {
    let text = '';
    for await (const chunk of api.sendMessage(sessionId, prompt, vaultPath)) {
        if (chunk.type === 'text') text += chunk.content;
        if (chunk.type === 'error') throw new Error(chunk.content);
    }
    return text.trim();
}

class InstructionModal extends Modal {
    constructor(app: App, private onSubmit: (instruction: string) => void) { super(app); }
    onOpen() {
        this.titleEl.setText(t('inline.editTitle'));
        let value = '';
        new Setting(this.contentEl)
            .setName(t('inline.instructionLabel'))
            .addText(txt => { txt.setPlaceholder(t('inline.instructionPlaceholder')); txt.onChange(v => { value = v; }); });
        new Setting(this.contentEl)
            .addButton(b => b.setButtonText(t('inline.editBtn')).setCta().onClick(() => {
                if (!value.trim()) { new Notice(t('inline.instructionRequired')); return; }
                this.close();
                this.onSubmit(value.trim());
            }));
    }
    onClose() { this.contentEl.empty(); }
}

class DiffModal extends Modal {
    constructor(app: App, private diff: DiffLine[], private onAccept: () => void) { super(app); }
    onOpen() {
        this.titleEl.setText(t('inline.previewTitle'));
        const box = this.contentEl.createDiv({ cls: 'workbuddian-diff-box' });
        renderDiffRows(box, this.diff);
        new Setting(this.contentEl)
            .addButton(b => b.setButtonText(t('inline.accept')).setCta().onClick(() => { this.close(); this.onAccept(); }))
            .addButton(b => b.setButtonText(t('inline.reject')).onClick(() => this.close()));
    }
    onClose() {
        this.contentEl.empty();
        // 保险：close 后若容器仍挂在 DOM 上（关闭动画被打断等）主动摘除，防"幽灵弹窗"遮挡后续操作（WB-006）
        window.setTimeout(() => { if (this.containerEl.isConnected) this.containerEl.detach(); }, 300);
    }
}

export function runInlineEdit(app: App, api: CodebuddyProvider, editor: Editor, vaultPath?: string) {
    const selection = editor.getSelection();
    if (!selection.trim()) { new Notice(t('inline.selectFirst')); return; }
    new InstructionModal(app, async (instruction) => {
        const notice = new Notice(t('inline.editing'), 0);
        try {
            const edited = await collectEditResult(api, api.generateId(), buildEditPrompt(selection, instruction), vaultPath);
            notice.hide();
            if (!edited) { new Notice(t('inline.noResult')); return; }
            new DiffModal(app, lineDiff(selection, edited), () => editor.replaceSelection(edited)).open();
        } catch (e) {
            notice.hide();
            new Notice(t('inline.editFailed') + (e instanceof Error ? e.message : String(e)));
        }
    }).open();
}
