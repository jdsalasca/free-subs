import { describe, expect, it } from 'vitest';
import { normalizeForSubtitles } from '../../../src/core/text';

describe('normalizeForSubtitles — numbers untouched', () => {
  it.each<[string, string]>([
    ['3.14', 'en'],
    ['1.234,56', 'es'],
    ['2026年', 'zh'],
    ['50%', 'en'],
    ['$1,200', 'en'],
  ])('keeps %s intact (%s)', (input, lang) => {
    expect(normalizeForSubtitles(input, lang)).toBe(input);
  });

  it('keeps numbers intact inside a sentence', () => {
    expect(normalizeForSubtitles('Son 1.234,56 euros al 50%', 'es')).toBe(
      'Son 1.234,56 euros al 50%',
    );
  });
});
