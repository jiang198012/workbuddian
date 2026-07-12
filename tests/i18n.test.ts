import { t, setLang, STRINGS } from '../src/i18n';

describe('i18n', () => {
    it('returns zh text when lang is zh', () => {
        setLang('zh');
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
