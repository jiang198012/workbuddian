import { parseFileChange, isPlanFilePath } from '../src/shared/toolDetail';

describe('parseFileChange', () => {
    it('parses an Edit into old/new text', () => {
        const detail = JSON.stringify({ file_path: '/a/b.txt', old_string: 'line two', new_string: 'line TWO' });
        expect(parseFileChange('Edit', detail)).toEqual({ kind: 'edit', path: '/a/b.txt', oldText: 'line two', newText: 'line TWO' });
    });

    it('parses a Write as a whole-file addition', () => {
        const detail = JSON.stringify({ file_path: '/a/b.txt', content: 'hello\nworld' });
        expect(parseFileChange('Write', detail)).toEqual({ kind: 'write', path: '/a/b.txt', newText: 'hello\nworld' });
    });

    it('returns null for non-file tools', () => {
        expect(parseFileChange('Read', JSON.stringify({ file_path: '/a/b.txt' }))).toBeNull();
        expect(parseFileChange('Bash', JSON.stringify({ command: 'ls' }))).toBeNull();
    });

    it('returns null when required fields are missing or malformed', () => {
        expect(parseFileChange('Edit', JSON.stringify({ file_path: '/a/b.txt' }))).toBeNull();
        expect(parseFileChange('Write', JSON.stringify({ content: 'x' }))).toBeNull();
        expect(parseFileChange('Edit', 'not json')).toBeNull();
        expect(parseFileChange('Edit', '')).toBeNull();
    });
});

describe('isPlanFilePath', () => {
    it('recognises CodeBuddy plan files', () => {
        expect(isPlanFilePath('/Users/x/.codebuddy/plans/swift-forging-newton.md')).toBe(true);
        expect(isPlanFilePath('C:\\Users\\x\\.codebuddy\\plans\\a.md')).toBe(true);
    });

    it('rejects everything else', () => {
        expect(isPlanFilePath('/Users/x/.codebuddy/plans/notes.txt')).toBe(false);
        expect(isPlanFilePath('/Users/x/notes/plans/a.md')).toBe(false);
        expect(isPlanFilePath('')).toBe(false);
    });
});
