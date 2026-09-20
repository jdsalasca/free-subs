import { describe, expect, it } from 'vitest';
import { isChineseHallucination, normalizeChineseText } from '../../../src/pipeline/zh';

describe('normalizeChineseText', () => {
  it('converts traditional characters to simplified', () => {
    expect(normalizeChineseText('謝謝觀看')).toBe('谢谢观看');
    expect(normalizeChineseText('這是測試')).toBe('这是测试');
  });

  it('removes spaces between CJK characters', () => {
    expect(normalizeChineseText('這 是 測 試')).toBe('这是测试');
    expect(normalizeChineseText('你 好 世界')).toBe('你好世界');
  });

  it('normalises fullwidth digits and punctuation', () => {
    expect(normalizeChineseText('１２３ＡＢＣ')).toBe('123ABC');
    expect(normalizeChineseText('你好，世界！')).toBe('你好,世界!');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeChineseText('  你好   世界  ')).toBe('你好世界');
  });

  it('returns an empty string for empty input', () => {
    expect(normalizeChineseText('')).toBe('');
  });
});

describe('isChineseHallucination', () => {
  it('flags common BoH phrases in either script', () => {
    expect(isChineseHallucination('谢谢观看')).toBe(true);
    expect(isChineseHallucination('感謝觀看')).toBe(true);
    expect(isChineseHallucination('感謝收看')).toBe(true);
    expect(isChineseHallucination('請訂閱頻道')).toBe(true);
    expect(isChineseHallucination('字幕由 Amara.org 提供')).toBe(true);
  });

  it('flags repeated character loops', () => {
    expect(isChineseHallucination('哈哈哈哈哈')).toBe(true);
  });

  it('does not flag ordinary text', () => {
    expect(isChineseHallucination('這是普通的一句話')).toBe(false);
    expect(isChineseHallucination('今天天氣很好')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(isChineseHallucination('')).toBe(false);
  });
});
