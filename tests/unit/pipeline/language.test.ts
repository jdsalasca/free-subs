import { describe, expect, it } from 'vitest';
import { detectLanguageFromText } from '../../../src/pipeline/language';

describe('detectLanguageFromText', () => {
  it('detects English from stopwords', () => {
    expect(detectLanguageFromText('The quick brown fox is in the house and it was for you')).toBe(
      'en',
    );
  });

  it('detects Spanish from stopwords', () => {
    expect(
      detectLanguageFromText('El zorro marrón está en la casa con el perro y la gata'),
    ).toBe('es');
  });

  it('is case-insensitive', () => {
    expect(detectLanguageFromText('THE AND OF TO IN IS IT')).toBe('en');
    expect(detectLanguageFromText('EL LA LOS LAS DE QUE Y EN')).toBe('es');
  });

  it('detects Chinese from any CJK character', () => {
    expect(detectLanguageFromText('你好世界')).toBe('zh');
    expect(detectLanguageFromText('Hello 世界')).toBe('zh');
  });

  it('returns unknown for a tie', () => {
    expect(detectLanguageFromText('the la')).toBe('unknown');
  });

  it('returns unknown when there are no stopwords', () => {
    expect(detectLanguageFromText('xyzzy plugh')).toBe('unknown');
    expect(detectLanguageFromText('12345 67890')).toBe('unknown');
    expect(detectLanguageFromText('')).toBe('unknown');
  });

  it('only matches whole words', () => {
    expect(detectLanguageFromText('theatre')).toBe('unknown');
  });
});
