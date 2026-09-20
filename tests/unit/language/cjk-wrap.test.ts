import { describe, expect, it } from 'vitest';
import { CJK_STYLE } from '../../../src/core/types';
import { wrapLines } from '../../../src/core/wrap';

const LONG_CJK = '这是一个非常长的中文字符串用来测试换行是否满足要求';
const CLOSING = '、。！？：；」』）】》';
const OPENING = '「『（【《';

describe('CJK kinsoku wrapping', () => {
  it('wraps a long Chinese string into at most 2 lines of at most 16 chars', () => {
    const lines = wrapLines(LONG_CJK, CJK_STYLE, 'zh');
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const line of lines) {
      expect([...line].length).toBeLessThanOrEqual(16);
    }
    expect(lines.join('')).toBe(LONG_CJK);
  });

  it('never starts a line with closing punctuation', () => {
    const text = '你好世界再见朋友大家、谢谢来看这个节目吧';
    const lines = wrapLines(text, CJK_STYLE, 'zh');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      const first = [...line][0] ?? '';
      expect(CLOSING.includes(first)).toBe(false);
    }
  });

  it('never ends a line with opening punctuation', () => {
    const text = '你好世界再见朋友大「谢谢来看这个节目吧你好';
    const lines = wrapLines(text, CJK_STYLE, 'zh');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      const last = [...line].at(-1) ?? '';
      expect(OPENING.includes(last)).toBe(false);
    }
  });

  it('wraps a latin+CJK cue without breaking inside the latin word', () => {
    const lines = wrapLines('你好 internationalization 世界朋友', CJK_STYLE, 'zh');
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.filter((line) => line.includes('internationalization'))).toHaveLength(1);
    for (const line of lines) {
      const withoutWord = line.replace('internationalization', '');
      expect(withoutWord.includes('internation')).toBe(false);
      expect(withoutWord.includes('alization')).toBe(false);
    }
  });

  it('balances a latin+CJK cue that fits on two lines', () => {
    expect(wrapLines('你好 hello 世界朋友谢谢大家', CJK_STYLE, 'zh')).toEqual([
      '你好 hello',
      '世界朋友谢谢大家',
    ]);
  });
});
