import { findTemplate, filterTemplates, PROMPT_TEMPLATES } from '../src/shared/promptTemplates';

describe('findTemplate (A1 模板 prompt)', () => {
    it('finds template by name, case-insensitive', () => {
        expect(findTemplate('translate')?.name).toBe('translate');
        expect(findTemplate('TRANSLATE')?.name).toBe('translate');
        expect(findTemplate('summarize')?.desc).toBe('总结要点');
    });
    it('returns null for unknown', () => {
        expect(findTemplate('nope')).toBeNull();
    });
});

describe('filterTemplates', () => {
    it('matches by prefix', () => {
        const names = filterTemplates('re').map((t) => t.name);
        expect(names).toContain('rewrite');
        expect(names).toContain('review');
    });
    it('empty query returns all', () => {
        expect(filterTemplates('').length).toBe(PROMPT_TEMPLATES.length);
    });
    it('no match returns empty', () => {
        expect(filterTemplates('zzz')).toEqual([]);
    });
});

describe('PROMPT_TEMPLATES 完整性', () => {
    it('每个模板都有 name/prompt/desc', () => {
        for (const t of PROMPT_TEMPLATES) {
            expect(t.name.length).toBeGreaterThan(0);
            expect(t.prompt.length).toBeGreaterThan(0);
            expect(t.desc.length).toBeGreaterThan(0);
        }
    });
    it('模板名不重复', () => {
        const names = PROMPT_TEMPLATES.map((t) => t.name);
        expect(new Set(names).size).toBe(names.length);
    });
});
