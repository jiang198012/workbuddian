export interface DiffLine { type: 'equal' | 'add' | 'remove'; text: string; }

/** 行级 diff（LCS）：按 \n 切行，回溯输出 equal/remove/add 序列 */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
    const a = oldText.split('\n');
    const b = newText.split('\n');
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const out: DiffLine[] = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
        if (a[i] === b[j]) { out.push({ type: 'equal', text: a[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'remove', text: a[i] }); i++; }
        else { out.push({ type: 'add', text: b[j] }); j++; }
    }
    while (i < m) { out.push({ type: 'remove', text: a[i] }); i++; }
    while (j < n) { out.push({ type: 'add', text: b[j] }); j++; }
    return out;
}
