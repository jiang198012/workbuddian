import type { DiffLine } from './lineDiff';
import { splitInlineDiff } from './wordDiff';

/**
 * diff 行渲染：成块 remove+add 按下标配对做行内高亮，其余行纯文本。
 * 聊天工具 diff / 批准卡 Edit 预览 / inline edit DiffModal 三处共用。
 */
export function renderDiffRows(diffBody: HTMLElement, diffLines: DiffLine[]): void {
    const appendRow = (type: DiffLine['type'], prefix: string, segs: Array<{ text: string; changed: boolean }>) => {
        const row = diffBody.createDiv({ cls: `workbuddian-diff-line workbuddian-diff-${type}` });
        row.createSpan({ text: prefix });
        for (const seg of segs) {
            const span = row.createSpan({ text: seg.text });
            if (seg.changed) span.addClass('workbuddian-diff-hl');
        }
    };
    for (let i = 0; i < diffLines.length; i++) {
        const line = diffLines[i];
        if (line.type === 'remove') {
            // 收成块：连续 remove 后跟连续 add，按下标配对做行内 diff
            const removes: DiffLine[] = [];
            while (i < diffLines.length && diffLines[i].type === 'remove') removes.push(diffLines[i++]);
            const adds: DiffLine[] = [];
            while (i < diffLines.length && diffLines[i].type === 'add') adds.push(diffLines[i++]);
            i--; // for 循环自增补偿
            const paired = Math.min(removes.length, adds.length);
            for (let k = 0; k < paired; k++) {
                const { oldSegs, newSegs } = splitInlineDiff(removes[k].text, adds[k].text);
                appendRow('remove', '- ', oldSegs);
                appendRow('add', '+ ', newSegs);
            }
            for (let k = paired; k < removes.length; k++) appendRow('remove', '- ', [{ text: removes[k].text, changed: false }]);
            for (let k = paired; k < adds.length; k++) appendRow('add', '+ ', [{ text: adds[k].text, changed: false }]);
        } else {
            const prefix = line.type === 'add' ? '+ ' : '  ';
            appendRow(line.type, prefix, [{ text: line.text, changed: false }]);
        }
    }
}
