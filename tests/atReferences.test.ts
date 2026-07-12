import { extractAtQuery, parseAtReferences } from '../src/shared/atReferences';

describe('extractAtQuery', () => {
    it('returns the partial query right after an @', () => {
        expect(extractAtQuery('hello @foo', 10)).toEqual({ query: 'foo', start: 6 });
    });

    it('returns an empty query for a bare @', () => {
        expect(extractAtQuery('hello @', 7)).toEqual({ query: '', start: 6 });
    });

    it('returns null when there is no @ before the cursor', () => {
        expect(extractAtQuery('hello world', 11)).toBeNull();
    });

    it('returns null when whitespace breaks the @ trigger', () => {
        expect(extractAtQuery('@foo bar', 8)).toBeNull();
    });

    it('returns null when the cursor is inside an already-inserted @[[...]] reference', () => {
        expect(extractAtQuery('see @[[Note]] please', 12)).toBeNull();
    });
});

describe('parseAtReferences', () => {
    it('extracts note names from @[[...]] markers', () => {
        expect(parseAtReferences('check @[[Note A]] and @[[Note B]]')).toEqual(['Note A', 'Note B']);
    });

    it('deduplicates repeated references', () => {
        expect(parseAtReferences('@[[Note A]] again @[[Note A]]')).toEqual(['Note A']);
    });

    it('returns an empty array when there are no references', () => {
        expect(parseAtReferences('no references here')).toEqual([]);
    });
});
