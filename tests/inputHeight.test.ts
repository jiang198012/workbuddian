import { clampTextareaHeight } from '../src/shared/inputHeight';

describe('clampTextareaHeight', () => {
    it('allows the height to shrink again when content becomes shorter', () => {
        expect(clampTextareaHeight(240, 30, 200)).toBe(200);
        expect(clampTextareaHeight(48, 30, 200)).toBe(48);
        expect(clampTextareaHeight(12, 30, 200)).toBe(30);
    });
});
