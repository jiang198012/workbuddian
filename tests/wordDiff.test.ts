import { splitInlineDiff } from '../src/shared/wordDiff';

describe('splitInlineDiff', () => {
    it('trims common prefix and suffix, marks middle as changed', () => {
        const r = splitInlineDiff('const a = 1;', 'const a = 2;');
        expect(r.oldSegs).toEqual([
            { text: 'const a = ', changed: false },
            { text: '1', changed: true },
            { text: ';', changed: false },
        ]);
        expect(r.newSegs).toEqual([
            { text: 'const a = ', changed: false },
            { text: '2', changed: true },
            { text: ';', changed: false },
        ]);
    });
    it('identical lines → single unchanged segment', () => {
        expect(splitInlineDiff('abc', 'abc').oldSegs).toEqual([{ text: 'abc', changed: false }]);
    });
    it('fully different → whole changed', () => {
        const r = splitInlineDiff('foo', 'bar');
        expect(r.oldSegs).toEqual([{ text: 'foo', changed: true }]);
        expect(r.newSegs).toEqual([{ text: 'bar', changed: true }]);
    });
    it('handles empty sides', () => {
        expect(splitInlineDiff('', 'x').newSegs).toEqual([{ text: 'x', changed: true }]);
        expect(splitInlineDiff('x', '').oldSegs).toEqual([{ text: 'x', changed: true }]);
        expect(splitInlineDiff('', '').oldSegs).toEqual([{ text: '', changed: false }]);
    });
    it('insertion in the middle highlights only the inserted part', () => {
        const r = splitInlineDiff('hello world', 'hello brave new world');
        expect(r.oldSegs).toEqual([
            { text: 'hello ', changed: false },
            { text: 'world', changed: false },
        ]);
        expect(r.newSegs).toEqual([
            { text: 'hello ', changed: false },
            { text: 'brave new ', changed: true },
            { text: 'world', changed: false },
        ]);
    });
});
