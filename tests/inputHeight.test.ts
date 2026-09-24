import {
    clampTextareaHeight,
    DEFAULT_INPUT_MAX_HEIGHT,
    DEFAULT_INPUT_MIN_HEIGHT,
    normalizeTextareaHeightBounds,
} from '../src/shared/inputHeight';

describe('clampTextareaHeight', () => {
    it('allows the height to shrink again when content becomes shorter', () => {
        expect(clampTextareaHeight(240, 30, 200)).toBe(200);
        expect(clampTextareaHeight(48, 30, 200)).toBe(48);
        expect(clampTextareaHeight(12, 30, 200)).toBe(30);
    });
});

describe('normalizeTextareaHeightBounds', () => {
    it('keeps valid configured minimum and maximum heights', () => {
        expect(normalizeTextareaHeightBounds(48, 320)).toEqual({ minHeight: 48, maxHeight: 320 });
    });

    it('falls back to defaults when a bound is invalid or the range is reversed', () => {
        expect(normalizeTextareaHeightBounds(0, 320)).toEqual({ minHeight: DEFAULT_INPUT_MIN_HEIGHT, maxHeight: DEFAULT_INPUT_MAX_HEIGHT });
        expect(normalizeTextareaHeightBounds(48, 48)).toEqual({ minHeight: DEFAULT_INPUT_MIN_HEIGHT, maxHeight: DEFAULT_INPUT_MAX_HEIGHT });
        expect(normalizeTextareaHeightBounds(320, 48)).toEqual({ minHeight: DEFAULT_INPUT_MIN_HEIGHT, maxHeight: DEFAULT_INPUT_MAX_HEIGHT });
    });
});
