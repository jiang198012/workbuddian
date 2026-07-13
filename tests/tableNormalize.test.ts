import { ensureTableBlankLines } from '../src/shared/tableNormalize';

describe('ensureTableBlankLines', () => {
    it('inserts a blank line when a table follows text with only a single newline', () => {
        const input = '**主要目录结构**：\n| 目录 | 内容 |\n|---|---|\n| a | b |';
        const output = ensureTableBlankLines(input);
        expect(output).toBe('**主要目录结构**：\n\n| 目录 | 内容 |\n|---|---|\n| a | b |');
    });

    it('leaves an already-separated table untouched (idempotent)', () => {
        const input = '文字\n\n| 目录 | 内容 |\n|---|---|\n| a | b |';
        expect(ensureTableBlankLines(input)).toBe(input);
    });

    it('is idempotent when applied twice', () => {
        const input = 'text\n| a | b |\n|---|---|\n| 1 | 2 |';
        const once = ensureTableBlankLines(input);
        expect(ensureTableBlankLines(once)).toBe(once);
    });

    it('leaves a table at the very start of the document untouched', () => {
        const input = '| a | b |\n|---|---|\n| 1 | 2 |';
        expect(ensureTableBlankLines(input)).toBe(input);
    });

    it('does not touch pipes inside a fenced code block', () => {
        const input = '```\ntext\n| a | b |\n|---|---|\n```';
        expect(ensureTableBlankLines(input)).toBe(input);
    });

    it('handles a tilde-fenced code block', () => {
        const input = '~~~\ntext\n| a | b |\n| --- | --- |\n~~~';
        expect(ensureTableBlankLines(input)).toBe(input);
    });

    it('does not treat a thematic break after prose as a table', () => {
        const input = 'some prose\n---\nmore prose';
        expect(ensureTableBlankLines(input)).toBe(input);
    });

    it('returns input unchanged when there are no pipes at all', () => {
        const input = '# Title\n\nplain paragraph\nwith two lines';
        expect(ensureTableBlankLines(input)).toBe(input);
    });

    it('handles aligned delimiter rows with colons', () => {
        const input = 'caption\n| L | R |\n| :--- | ---: |\n| 1 | 2 |';
        expect(ensureTableBlankLines(input)).toBe('caption\n\n| L | R |\n| :--- | ---: |\n| 1 | 2 |');
    });

    it('fixes the real-world reply sample verbatim', () => {
        const input = [
            '**主要目录结构**：',
            '| 目录 | 内容 |',
            '|---|---|',
            '| `时间线/` | 历史笔记 |',
            '',
            '**根目录关键文件**：',
            '- `MOC.md`',
        ].join('\n');
        const output = ensureTableBlankLines(input);
        expect(output).toContain('**主要目录结构**：\n\n| 目录 | 内容 |');
        // 表格之后原本就有的空行与后续内容不受影响
        expect(output).toContain('| `时间线/` | 历史笔记 |\n\n**根目录关键文件**：');
    });
});
