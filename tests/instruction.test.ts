import { parseInstructionInput, buildInstructionBlock } from '../src/shared/instruction';

describe('parseInstructionInput', () => {
    it('returns the text after # (trimmed)', () => {
        expect(parseInstructionInput('#foo')).toBe('foo');
        expect(parseInstructionInput('# foo ')).toBe('foo');
        expect(parseInstructionInput('  #foo')).toBe('foo');
    });
    it('returns empty string for a lone #', () => {
        expect(parseInstructionInput('#')).toBe('');
        expect(parseInstructionInput('  #  ')).toBe('');
    });
    it('returns null when not starting with #', () => {
        expect(parseInstructionInput('foo')).toBeNull();
        expect(parseInstructionInput('a#b')).toBeNull();
        expect(parseInstructionInput('')).toBeNull();
    });
});

describe('buildInstructionBlock', () => {
    it('returns empty string for blank instruction', () => {
        expect(buildInstructionBlock('')).toBe('');
        expect(buildInstructionBlock('   ')).toBe('');
    });
    it('wraps a non-empty instruction as a preamble block', () => {
        expect(buildInstructionBlock('be concise')).toBe('[用户常驻指令]\nbe concise');
        expect(buildInstructionBlock('  be concise  ')).toBe('[用户常驻指令]\nbe concise');
    });
});
