import { findChatTemplate, CHAT_TEMPLATES } from '../src/shared/chatTemplates';

describe('CHAT_TEMPLATES (会话模板)', () => {
    it('has unique ids', () => {
        const ids = CHAT_TEMPLATES.map(t => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
    it('every template has name/instruction/opener', () => {
        for (const t of CHAT_TEMPLATES) {
            expect(t.name.length).toBeGreaterThan(0);
            expect(t.instruction.length).toBeGreaterThan(0);
            expect(typeof t.opener).toBe('string');
        }
    });
    it('findChatTemplate finds by id', () => {
        expect(findChatTemplate('writing')?.name).toBe('写作助手');
        expect(findChatTemplate('review')?.name).toBe('代码审查');
    });
    it('findChatTemplate returns null for unknown', () => {
        expect(findChatTemplate('nope')).toBeNull();
    });
});
