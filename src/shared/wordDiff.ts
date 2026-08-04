export interface InlineSegment {
    text: string;
    changed: boolean;
}

/**
 * 行内最小 diff：裁掉公共前缀与公共后缀，中段即变更段。
 * 字符级而非词法级——YAGNI，覆盖「改几个字符/插入一段」的绝大多数场景。
 */
export function splitInlineDiff(oldLine: string, newLine: string): { oldSegs: InlineSegment[]; newSegs: InlineSegment[] } {
    let pre = 0;
    const maxPre = Math.min(oldLine.length, newLine.length);
    while (pre < maxPre && oldLine[pre] === newLine[pre]) pre++;
    let suf = 0;
    while (
        suf < Math.min(oldLine.length, newLine.length) - pre
        && oldLine[oldLine.length - 1 - suf] === newLine[newLine.length - 1 - suf]
    ) suf++;

    const build = (line: string): InlineSegment[] => {
        const segs: InlineSegment[] = [];
        if (pre > 0) segs.push({ text: line.slice(0, pre), changed: false });
        const mid = line.slice(pre, line.length - suf);
        if (mid) segs.push({ text: mid, changed: true });
        if (suf > 0) segs.push({ text: line.slice(line.length - suf), changed: false });
        if (!segs.length) segs.push({ text: '', changed: false });
        return segs;
    };
    return { oldSegs: build(oldLine), newSegs: build(newLine) };
}
