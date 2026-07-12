import { pickFinalContent } from '../src/shared/responseFinalize';

describe('pickFinalContent', () => {
    it('prefers streamed body text', () => {
        expect(pickFinalContent('body', 'think', 'res')).toBe('body');
    });
    it('falls back to thinking when there is no body text', () => {
        expect(pickFinalContent('', 'think', 'res')).toBe('think');
    });
    it('falls back to the result-event text when there is no body or thinking', () => {
        expect(pickFinalContent('', '', 'res')).toBe('res');
    });
    it('returns empty string when nothing was produced', () => {
        expect(pickFinalContent('', '', '')).toBe('');
    });
});
