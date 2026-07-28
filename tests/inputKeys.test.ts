import { shouldSendMessage, isActivationKey, nextSuggestIndex } from '../src/shared/inputKeys';

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

describe('isActivationKey', () => {
    it('treats Enter as an activation key', () => {
        expect(isActivationKey('Enter')).toBe(true);
    });

    it('treats Space as an activation key', () => {
        expect(isActivationKey(' ')).toBe(true);
    });

    it('ignores other keys', () => {
        expect(isActivationKey('Escape')).toBe(false);
        expect(isActivationKey('Tab')).toBe(false);
        expect(isActivationKey('a')).toBe(false);
    });
});

describe('nextSuggestIndex', () => {
    it('moves down and wraps to the top', () => {
        expect(nextSuggestIndex(0, 3, 1)).toBe(1);
        expect(nextSuggestIndex(2, 3, 1)).toBe(0);
    });

    it('moves up and wraps to the bottom', () => {
        expect(nextSuggestIndex(1, 3, -1)).toBe(0);
        expect(nextSuggestIndex(0, 3, -1)).toBe(2);
    });

    it('returns -1 when there is nothing to highlight', () => {
        expect(nextSuggestIndex(0, 0, 1)).toBe(-1);
        expect(nextSuggestIndex(-1, 0, -1)).toBe(-1);
    });

    it('recovers from an out-of-range current index', () => {
        expect(nextSuggestIndex(-1, 3, 1)).toBe(0);
        expect(nextSuggestIndex(9, 3, 1)).toBe(1);
    });
});
