import { formatTokenCount, contextPercent } from '../src/shared/contextUsage';

describe('formatTokenCount', () => {
    it('shows the raw integer below 1000', () => {
        expect(formatTokenCount(0)).toBe('0');
        expect(formatTokenCount(999)).toBe('999');
    });

    it('formats thousands with one decimal and a k suffix', () => {
        expect(formatTokenCount(1000)).toBe('1.0k');
        expect(formatTokenCount(22594)).toBe('22.6k');
        expect(formatTokenCount(200000)).toBe('200.0k');
    });
});

describe('contextPercent', () => {
    it('computes the rounded percentage of the window used', () => {
        expect(contextPercent(22594, 200000)).toBe(11);
    });

    it('caps at 100 when usage exceeds the window', () => {
        expect(contextPercent(250000, 200000)).toBe(100);
    });

    it('returns 0 for a non-positive window size', () => {
        expect(contextPercent(1000, 0)).toBe(0);
        expect(contextPercent(1000, -5)).toBe(0);
    });
});
