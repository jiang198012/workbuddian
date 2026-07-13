import { t, setLang, applyLang, detectLang, matchesAnyLang, STRINGS } from '../src/i18n';

/** 临时把 localStorage 'language' 设成某值，跑完还原（node 测试环境默认无 window） */
function withObsidianLang(value: string | null, fn: () => void) {
    const g = global as unknown as { window?: unknown };
    const prev = g.window;
    g.window = { localStorage: { getItem: (k: string) => (k === 'language' ? value : null) } };
    try { fn(); } finally { g.window = prev; }
}

describe('detectLang', () => {
    it('returns zh for a zh-prefixed Obsidian language', () => {
        withObsidianLang('zh-CN', () => expect(detectLang()).toBe('zh'));
    });
    it('returns en for an explicit English setting', () => {
        withObsidianLang('en', () => expect(detectLang()).toBe('en'));
    });
    it('returns en when the language key is empty (Obsidian default English)', () => {
        withObsidianLang('', () => expect(detectLang()).toBe('en'));
    });
    it('returns en when the language key is absent', () => {
        withObsidianLang(null, () => expect(detectLang()).toBe('en'));
    });
});

describe('matchesAnyLang', () => {
    it('matches the zh value of a key', () => {
        expect(matchesAnyLang('新对话', 'chat.newConversation')).toBe(true);
    });
    it('matches the en value of a key', () => {
        expect(matchesAnyLang('New chat', 'chat.newConversation')).toBe(true);
    });
    it('does not match an unrelated value', () => {
        expect(matchesAnyLang('随便起的名字', 'chat.newConversation')).toBe(false);
    });
    it('returns false for an unknown key', () => {
        expect(matchesAnyLang('x', '__missing__')).toBe(false);
    });
});

describe('i18n', () => {
    it('returns zh text when lang is zh', () => {
        setLang('zh');
        expect(t('chat.send')).toBe('发送');
    });

    it('applyLang switches to an explicit language', () => {
        applyLang('en');
        expect(t('chat.send')).toBe('Send');
        applyLang('zh');
        expect(t('chat.send')).toBe('发送');
    });
    it('returns en text when lang is en', () => {
        setLang('en');
        expect(t('chat.send')).toBe('Send');
    });
    it('falls back to the key for unknown entries', () => {
        expect(t('__missing__')).toBe('__missing__');
    });
    it('every entry has both zh and en', () => {
        for (const [key, val] of Object.entries(STRINGS)) {
            expect(typeof val.zh).toBe('string');
            expect(val.zh.length).toBeGreaterThan(0);
            expect(typeof val.en).toBe('string');
            expect(val.en.length).toBeGreaterThan(0);
        }
    });
});
