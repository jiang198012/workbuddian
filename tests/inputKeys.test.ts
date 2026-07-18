import { shouldSendMessage } from '../src/shared/inputKeys';

describe('shouldSendMessage', () => {
    const base = { key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 };

    it('sends on a plain Enter', () => {
        expect(shouldSendMessage(base)).toBe(true);
    });

    it('does not send on Shift+Enter (newline instead)', () => {
        expect(shouldSendMessage({ ...base, shiftKey: true })).toBe(false);
    });

    it('does not send while an IME is composing (isComposing=true) — Enter confirms the candidate', () => {
        expect(shouldSendMessage({ ...base, isComposing: true })).toBe(false);
    });

    it('does not send during IME composition reported via keyCode 229', () => {
        expect(shouldSendMessage({ ...base, keyCode: 229 })).toBe(false);
    });

    it('ignores non-Enter keys', () => {
        expect(shouldSendMessage({ ...base, key: 'a' })).toBe(false);
    });

    it('tolerates a missing keyCode (only isComposing matters)', () => {
        expect(shouldSendMessage({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true);
        expect(shouldSendMessage({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
    });
});
