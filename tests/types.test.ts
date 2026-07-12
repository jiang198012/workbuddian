import { DEFAULT_SETTINGS, migrateSettings, isObject, getString, getNumber, getBoolean, getErrorMessage, normalizePersistedData, exportSettings, type Conversation } from '../src/types';

describe('DEFAULT_SETTINGS', () => {
    it('should accept empty codebuddyPath', () => {
        expect(DEFAULT_SETTINGS.codebuddyPath).toBe('');
    });
    it('should have sensible cliTimeoutMinutes', () => {
        expect(DEFAULT_SETTINGS.cliTimeoutMinutes).toBe(5);
    });
    it('should have empty nodePath by default', () => {
        expect(DEFAULT_SETTINGS.nodePath).toBe('');
    });
    it('should have vault context injection on by default', () => {
        expect(DEFAULT_SETTINGS.injectVaultContext).toBe(true);
    });
    it('should have current note link injection off by default', () => {
        expect(DEFAULT_SETTINGS.injectCurrentNoteLink).toBe(false);
    });
    it('should default model to auto', () => {
        expect(DEFAULT_SETTINGS.model).toBe('auto');
    });
    it('should default primaryColor to empty string', () => {
        expect(DEFAULT_SETTINGS.primaryColor).toBe('');
    });
    it('should have settings version 5', () => {
        expect(DEFAULT_SETTINGS.version).toBe(5);
    });
});

describe('migrateSettings', () => {
    it('should return defaults for null', () => {
        const r = migrateSettings(null);
        expect(r.codebuddyPath).toBe('');
        expect(r.cliTimeoutMinutes).toBe(DEFAULT_SETTINGS.cliTimeoutMinutes);
        expect(r.nodePath).toBe(DEFAULT_SETTINGS.nodePath);
        expect(r.injectVaultContext).toBe(DEFAULT_SETTINGS.injectVaultContext);
        expect(r.injectCurrentNoteLink).toBe(DEFAULT_SETTINGS.injectCurrentNoteLink);
        expect(r.model).toBe(DEFAULT_SETTINGS.model);
        expect(r.version).toBe(DEFAULT_SETTINGS.version);
    });

    it('should return defaults for non-object values', () => {
        expect(migrateSettings('string')).toEqual(DEFAULT_SETTINGS);
        expect(migrateSettings(123)).toEqual(DEFAULT_SETTINGS);
    });

    it('should merge stored values', () => {
        const r = migrateSettings({
            codebuddyPath: '/custom/codebuddy',
            cliTimeoutMinutes: 10,
            nodePath: '/usr/local/bin/node',
            injectVaultContext: false,
            injectCurrentNoteLink: true,
            model: 'glm-5.2'
        });
        expect(r.codebuddyPath).toBe('/custom/codebuddy');
        expect(r.cliTimeoutMinutes).toBe(10);
        expect(r.nodePath).toBe('/usr/local/bin/node');
        expect(r.injectVaultContext).toBe(false);
        expect(r.injectCurrentNoteLink).toBe(true);
        expect(r.model).toBe('glm-5.2');
    });

    it('should ignore invalid cliTimeoutMinutes', () => {
        expect(migrateSettings({ cliTimeoutMinutes: 0 }).cliTimeoutMinutes).toBe(DEFAULT_SETTINGS.cliTimeoutMinutes);
        expect(migrateSettings({ cliTimeoutMinutes: -5 }).cliTimeoutMinutes).toBe(DEFAULT_SETTINGS.cliTimeoutMinutes);
        expect(migrateSettings({ cliTimeoutMinutes: '10' }).cliTimeoutMinutes).toBe(DEFAULT_SETTINGS.cliTimeoutMinutes);
    });

    it('should ignore invalid injectVaultContext/injectCurrentNoteLink types', () => {
        expect(migrateSettings({ injectVaultContext: 'yes' }).injectVaultContext).toBe(DEFAULT_SETTINGS.injectVaultContext);
        expect(migrateSettings({ injectCurrentNoteLink: 1 }).injectCurrentNoteLink).toBe(DEFAULT_SETTINGS.injectCurrentNoteLink);
    });

    it('should no longer output a maxConversations field', () => {
        const r = migrateSettings({ maxConversations: 20 }) as unknown as Record<string, unknown>;
        expect(r.maxConversations).toBeUndefined();
    });

    it('should reset version to current', () => {
        const r = migrateSettings({ version: 1 });
        expect(r.version).toBe(DEFAULT_SETTINGS.version);
    });

    it('should default primaryColor to empty when missing', () => {
        expect(migrateSettings({}).primaryColor).toBe('');
    });
    it('should preserve a valid primaryColor', () => {
        expect(migrateSettings({ primaryColor: '#a855f7' }).primaryColor).toBe('#a855f7');
    });
    it('should reset non-string primaryColor to empty', () => {
        expect(migrateSettings({ primaryColor: 123 }).primaryColor).toBe('');
        expect(migrateSettings({ primaryColor: { r: 1 } }).primaryColor).toBe('');
    });
    it('should migrate stored version 4 up to 5', () => {
        expect(migrateSettings({ version: 4 }).version).toBe(5);
    });
});

describe('type helpers', () => {
    describe('isObject', () => {
        it('returns true for plain objects', () => {
            expect(isObject({})).toBe(true);
            expect(isObject({ a: 1 })).toBe(true);
        });

        it('returns false for arrays, null, and primitives', () => {
            expect(isObject(null)).toBe(false);
            expect(isObject([])).toBe(false);
            expect(isObject('string')).toBe(false);
            expect(isObject(123)).toBe(false);
        });
    });

    describe('getString', () => {
        it('returns string values', () => {
            expect(getString({ key: 'value' }, 'key')).toBe('value');
        });

        it('returns undefined for non-strings', () => {
            expect(getString({ key: 123 }, 'key')).toBeUndefined();
            expect(getString({}, 'missing')).toBeUndefined();
        });
    });

    describe('getNumber', () => {
        it('returns number values', () => {
            expect(getNumber({ key: 42 }, 'key')).toBe(42);
        });

        it('returns undefined for non-numbers', () => {
            expect(getNumber({ key: '42' }, 'key')).toBeUndefined();
            expect(getNumber({}, 'missing')).toBeUndefined();
        });
    });

    describe('getBoolean', () => {
        it('returns boolean values', () => {
            expect(getBoolean({ key: true }, 'key')).toBe(true);
            expect(getBoolean({ key: false }, 'key')).toBe(false);
        });

        it('returns undefined for non-booleans', () => {
            expect(getBoolean({ key: 'true' }, 'key')).toBeUndefined();
            expect(getBoolean({ key: 1 }, 'key')).toBeUndefined();
            expect(getBoolean({}, 'missing')).toBeUndefined();
        });
    });

    describe('getErrorMessage', () => {
        it('extracts Error message', () => {
            expect(getErrorMessage(new Error('boom'))).toBe('boom');
        });

        it('returns string as-is', () => {
            expect(getErrorMessage('plain string')).toBe('plain string');
        });

        it('falls back to default for unknown values', () => {
            expect(getErrorMessage(null)).toBe('未知错误');
            expect(getErrorMessage({})).toBe('未知错误');
        });
    });

    describe('normalizePersistedData', () => {
        it('returns empty object for invalid input', () => {
            expect(normalizePersistedData(null)).toEqual({});
            expect(normalizePersistedData('string')).toEqual({});
        });

        it('preserves conversations array', () => {
            const conversations: Conversation[] = [{ id: '1', title: 't', sessionId: '', messages: [], createdAt: 0, updatedAt: 0 }];
            expect(normalizePersistedData({ conversations })).toEqual({ conversations });
        });

        it('normalizes settings object', () => {
            const result = normalizePersistedData({ settings: { codebuddyPath: '/path' } });
            expect(result.settings?.codebuddyPath).toBe('/path');
            expect(result.settings?.version).toBe(DEFAULT_SETTINGS.version);
        });
    });

    describe('exportSettings', () => {
        it('serializes settings to JSON that round-trips through migrateSettings', () => {
            const json = exportSettings(DEFAULT_SETTINGS);
            expect(JSON.parse(json)).toEqual(DEFAULT_SETTINGS);
            expect(migrateSettings(JSON.parse(json))).toEqual(DEFAULT_SETTINGS);
        });
    });
});
