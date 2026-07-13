/**
 * 在缺少前导空行的 markdown 表格前补一个空行。
 *
 * 背景：按 CommonMark/GFM，表格不能「打断」段落——表格前必须有空行，否则表头
 * 那几行会被并入上一段当普通文字，竖线 `|` 原样渲染成源码。模型有时会在表格前
 * 漏掉空行（例如 `**标题**：` 后直接跟表格），Obsidian 的引擎照 GFM 规则就不
 * 会渲染成表格。这里在渲染前统一补上。
 *
 * 零回归保证：已有空行的表格、代码围栏（``` / ~~~）内的竖线、文档开头的表格
 * 都不改动；只针对「分隔行 + 上一行是表头 + 再上一行是非空非表格文字」这一种
 * 情形补空行。纯函数，便于单测。
 */
export function ensureTableBlankLines(md: string): string {
    if (!md.includes('|')) return md;

    const lines = md.split('\n');
    const out: string[] = [];
    let fenceChar = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fence = detectFence(line);

        if (fenceChar) {
            // 已在代码围栏内：遇到同类型收尾围栏才退出，其间不做任何规整
            if (fence === fenceChar) fenceChar = '';
            out.push(line);
            continue;
        }
        if (fence) {
            fenceChar = fence;
            out.push(line);
            continue;
        }

        // 当前行是表格分隔行、上一行像表头、再上一行是非空且非表格文字
        // → 表格缺前导空行，在表头前插入一个空行
        if (
            isDelimiterRow(line) &&
            i >= 2 &&
            isTableRowish(lines[i - 1]) &&
            lines[i - 2].trim() !== '' &&
            !isTableRowish(lines[i - 2])
        ) {
            out.splice(out.length - 1, 0, '');
        }
        out.push(line);
    }

    return out.join('\n');
}

/** 识别代码围栏起止行，返回归一化标记（```→'`'，~~~→'~'），非围栏返回空串 */
function detectFence(line: string): string {
    const m = line.match(/^ {0,3}(`{3,}|~{3,})/);
    return m ? m[1][0] : '';
}

/** 表格分隔行：整行仅由 | : - 和空格组成，且至少含一个 -（如 |---|---| 或 :--|--:） */
function isDelimiterRow(line: string): boolean {
    const t = line.trim();
    if (!t.includes('-')) return false;
    return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(t);
}

/** 像表格行：非空且含竖线 */
function isTableRowish(line: string): boolean {
    return line.trim() !== '' && line.includes('|');
}
