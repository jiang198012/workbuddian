import { buildSelectionBlock } from '../src/shared/selection';

describe('buildSelectionBlock', () => {
    it('returns an empty string for a blank selection', () => {
        expect(buildSelectionBlock('')).toBe('');
        expect(buildSelectionBlock('   ')).toBe('');
    });

    it('wraps the selection with a chat-only instruction and includes the note name', () => {
        const block = buildSelectionBlock('hello world', 'Note A');
        expect(block.startsWith('用户在当前笔记')).toBe(true);
        expect(block).toContain('hello world');
        expect(block).toContain('Note A');
    });

    it('omits the note reference when no note name is given', () => {
        const block = buildSelectionBlock('just text');
        expect(block).toContain('just text');
        expect(block).not.toContain('来自笔记');
    });
});
