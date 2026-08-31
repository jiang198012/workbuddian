import { formatAssistantReply, nextAvailableNotePath, sanitizeNoteName } from '../src/shared/noteWriteback';

describe('note writeback helpers', () => {
    it('sanitizes unsafe note names and provides a fallback', () => {
        expect(sanitizeNoteName('  需求/方案:*?  ')).toBe('需求方案');
        expect(sanitizeNoteName('   ')).toBe('workbuddian-reply');
    });

    it('formats a reply with stable metadata and content', () => {
        const output = formatAssistantReply('标题\n含引号', '答复内容\n\n下一段', 0);
        expect(output).toContain('source: Workbuddian');
        expect(output).toContain("conversation: '标题 含引号'");
        expect(output).toContain('created: 1970-01-01T00:00:00.000Z');
        expect(output.endsWith('答复内容\n\n下一段\n')).toBe(true);
    });

    it('adds a numeric suffix when a note path already exists', () => {
        expect(nextAvailableNotePath('Ideas', new Set(['Ideas.md', 'Ideas-2.md']))).toBe('Ideas-3.md');
        expect(nextAvailableNotePath('Ideas', new Set())).toBe('Ideas.md');
    });
});
