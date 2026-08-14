/**
 * 浮动内联编辑:选中文字后在选区上方出浮动工具条(输入指令 + 确认/取消),
 * 就地改,diff 内联预览。不弹 Modal,不打断流程。
 *
 * 复用现有 inline-edit 的 buildEditPrompt/lineDiff/renderDiffRows,只是交互从弹窗改浮动。
 */
import { Editor, Notice } from 'obsidian';
import type { CodebuddyProvider } from '../../providers/codebuddy';
import { lineDiff } from '../../shared/lineDiff';
import { renderDiffRows } from '../../shared/diffRows';
import { buildEditPrompt } from '../../shared/editPrompt';
import { t } from '../../i18n';

/** CodeMirror 编辑器视图(Obsidian 私有属性,类型断言访问) */
type CMView = {
    coordsAtPos: (pos: number, side?: -1 | 1) => { left: number; top: number; bottom: number; right: number } | null;
    state: { doc: { length: number } };
};

function getCMView(editor: Editor): CMView | null {
    const cm = (editor as unknown as { cm?: CMView }).cm;
    return cm && typeof cm.coordsAtPos === 'function' ? cm : null;
}

async function collectEditResult(api: CodebuddyProvider, sessionId: string, prompt: string, vaultPath?: string): Promise<string> {
    let text = '';
    for await (const chunk of api.sendMessage(sessionId, prompt, vaultPath)) {
        if (chunk.type === 'text') text += chunk.content;
        if (chunk.type === 'error') throw new Error(chunk.content);
    }
    return text.trim();
}

/** 浮动工具条:选区上方的输入指令 + 确认/取消;完成后就地 diff 预览 */
export class FloatingInlineEdit {
    private el: HTMLElement | null = null;
    private diffEl: HTMLElement | null = null;
    /** 保存的选区(右键菜单触发时编辑器失焦选区被清,先存下来) */
    private savedSel: { from: { line: number; ch: number }; to: { line: number; ch: number }; text: string } | null = null;

    constructor(
        private api: CodebuddyProvider,
        private editor: Editor,
        private vaultPath?: string,
        savedSel?: { from: { line: number; ch: number }; to: { line: number; ch: number }; text: string } | null,
    ) {
        this.savedSel = savedSel ?? null;
    }

    /** 在当前选区上方打开浮动工具条;无选区则不动作 */
    open(): boolean {
        // 优先用保存的选区(右键菜单触发时编辑器失焦,选区被清,需先恢复)
        let selection = this.editor.getSelection();
        if (!selection.trim() && this.savedSel) {
            this.editor.setSelection(this.savedSel.from, this.savedSel.to);
            selection = this.editor.getSelection();
        }
        if (!selection.trim()) { new Notice(t('inline.selectFirst')); return false; }

        const cm = getCMView(this.editor);
        if (!cm) { new Notice(t('inline.editFailed')); return false; }

        // 选区结束位置(工具条定位点)
        const from = this.editor.getCursor('from');
        const pos = cm.state.doc.length === 0 ? 0 : Math.min(this.cursorToPos(from), cm.state.doc.length);
        const coords = cm.coordsAtPos(pos, 1);
        if (!coords) { new Notice(t('inline.editFailed')); return false; }

        this.close(); // 清掉已有工具条
        this.el = document.body.createDiv({ cls: 'workbuddian-floating-edit' });
        this.el.style.left = `${coords.left}px`;
        this.el.style.top = `${coords.top - 40}px`; // 选区上方

        const input = this.el.createEl('input', {
            type: 'text',
            cls: 'workbuddian-floating-edit-input',
            attr: { placeholder: t('inline.instructionPlaceholder') },
        });
        const confirmBtn = this.el.createEl('button', { text: t('inline.editBtn'), cls: 'workbuddian-floating-edit-btn mod-cta' });
        const cancelBtn = this.el.createEl('button', { text: t('inline.reject'), cls: 'workbuddian-floating-edit-btn' });

        confirmBtn.onclick = () => void this.run(selection, input.value.trim());
        cancelBtn.onclick = () => this.close();
        input.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); void this.run(selection, input.value.trim()); }
            if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
        };
        setTimeout(() => input.focus(), 50);
        return true;
    }

    /** 调 CLI 编辑,完成后就地显示 diff 预览 */
    private async run(selection: string, instruction: string) {
        if (!instruction) { new Notice(t('inline.instructionRequired')); return; }
        if (!this.el) return;
        this.el.empty();
        this.el.createSpan({ text: t('inline.editing'), cls: 'workbuddian-floating-edit-loading' });

        try {
            const edited = await collectEditResult(this.api, this.api.generateId(), buildEditPrompt(selection, instruction), this.vaultPath);
            if (!edited) { this.close(); new Notice(t('inline.noResult')); return; }
            this.showDiff(selection, edited);
        } catch (e) {
            this.close();
            new Notice(t('inline.editFailed') + (e instanceof Error ? e.message : String(e)));
        }
    }

    /** 就地 diff 预览:选区上方显示 diff,确认接受则替换选区 */
    private showDiff(selection: string, edited: string) {
        if (!this.el) return;
        this.el.empty();
        this.diffEl = this.el.createDiv({ cls: 'workbuddian-floating-edit-diff' });
        renderDiffRows(this.diffEl, lineDiff(selection, edited));
        const row = this.el.createDiv({ cls: 'workbuddian-floating-edit-actions' });
        row.createEl('button', { text: t('inline.accept'), cls: 'mod-cta' })
            .onclick = () => { this.editor.replaceSelection(edited); this.close(); };
        row.createEl('button', { text: t('inline.reject') })
            .onclick = () => this.close();
    }

    close() {
        this.el?.remove();
        this.el = null;
        this.diffEl = null;
    }

    /** 把 Obsidian EditorPosition 转 CM 文档偏移(line/ch 线性化) */
    private cursorToPos(pos: { line: number; ch: number }): number {
        // 粗略:用 editor 的 getLine 前缀求偏移(Obsidian 无公开 lineToPos,简化估算)
        let offset = 0;
        for (let i = 0; i < pos.line; i++) {
            offset += (this.editor.getLine(i)?.length ?? 0) + 1; // +1 换行
        }
        return offset + pos.ch;
    }
}
