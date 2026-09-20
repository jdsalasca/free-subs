import { describe, expect, it } from 'vitest';
import { detectLanguageFromText } from '../../../src/pipeline/language';

describe('detectLanguageFromText — es/en/zh', () => {
  it('detects Spanish from a question', () => {
    expect(detectLanguageFromText('¿Qué hora es?')).toBe('es');
  });

  it('detects English from a question', () => {
    expect(detectLanguageFromText('What time is it?')).toBe('en');
  });

  it('detects Chinese from CJK characters', () => {
    expect(detectLanguageFromText('现在几点？')).toBe('zh');
  });

  it('resolves a Spanish-dominant mixed string to Spanish', () => {
    // Documented rule: the stopword score wins; "es"/"hora" outscore English.
    expect(detectLanguageFromText('¿What hora es?')).toBe('es');
  });

  it('returns unknown for numbers only', () => {
    expect(detectLanguageFromText('123 456')).toBe('unknown');
  });

  it('returns unknown for empty input', () => {
    expect(detectLanguageFromText('')).toBe('unknown');
  });
});
