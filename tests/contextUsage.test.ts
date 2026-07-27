import { formatTokenCount, contextPercent, usageTooltip, isUsageWarning, USAGE_WARNING_PERCENT } from '../src/shared/contextUsage';

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

describe('usageTooltip', () => {
    it('formats sub-1000 token counts without k', () => {
        expect(usageTooltip(999, 200000)).toBe('999 / 200.0k · 0%');
    });

    it('formats large counts with k and a rounded percentage', () => {
        expect(usageTooltip(22600, 200000)).toBe('22.6k / 200.0k · 11%');
    });

    it('caps the percentage at 100 when usage exceeds the window', () => {
        expect(usageTooltip(250000, 200000)).toBe('250.0k / 200.0k · 100%');
    });

    it('reports 0% for a non-positive window instead of dividing by zero', () => {
        expect(usageTooltip(5000, 0)).toBe('5.0k / 0 · 0%');
    });
});

describe('isUsageWarning', () => {
    it('is false below the threshold', () => {
        expect(isUsageWarning(0)).toBe(false);
        expect(isUsageWarning(79)).toBe(false);
    });

    it('is true at and above the threshold', () => {
        expect(isUsageWarning(USAGE_WARNING_PERCENT)).toBe(true);
        expect(isUsageWarning(100)).toBe(true);
    });
});
