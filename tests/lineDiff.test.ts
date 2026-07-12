import { lineDiff } from '../src/shared/lineDiff';

describe('lineDiff', () => {
    it('marks identical text as all equal', () => {
        expect(lineDiff('a\nb', 'a\nb')).toEqual([
            { type: 'equal', text: 'a' }, { type: 'equal', text: 'b' },
        ]);
    });
    it('detects a changed line as remove + add', () => {
        expect(lineDiff('a\nb', 'a\nc')).toEqual([
            { type: 'equal', text: 'a' },
            { type: 'remove', text: 'b' },
            { type: 'add', text: 'c' },
        ]);
    });
    it('detects a pure addition', () => {
        expect(lineDiff('a', 'a\nb')).toEqual([
            { type: 'equal', text: 'a' }, { type: 'add', text: 'b' },
        ]);
    });
    it('detects a pure removal', () => {
        expect(lineDiff('a\nb', 'a')).toEqual([
            { type: 'equal', text: 'a' }, { type: 'remove', text: 'b' },
        ]);
    });
});
