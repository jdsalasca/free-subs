import { describe, expect, it } from 'vitest';
import type { SubtitleStyle } from '../../../src/core/types';
import { wrapLines } from '../../../src/core/wrap';

const LATIN: SubtitleStyle = {
  maxCharsPerLine: 20,
  maxLines: 2,
  minDurationMs: 1000,
  maxDurationMs: 7000,
  maxCps: 17,
  minGapMs: 80,
};

const CJK: SubtitleStyle = {
  maxCharsPerLine: 4,
  maxLines: 2,
  minDurationMs: 1000,
  maxDurationMs: 7000,
  maxCps: 9,
  minGapMs: 80,
};

describe('wrapLines (latin)', () => {
  it('returns [] for an empty string', () => {
    expect(wrapLines('', LATIN, 'en')).toEqual([]);
  });

  it('returns [] for whitespace only', () => {
    expect(wrapLines('    ', LATIN, 'en')).toEqual([]);
  });

  it('keeps a short text on a single line', () => {
    expect(wrapLines('Hello world', LATIN, 'en')).toEqual(['Hello world']);
  });

  it('balances long text across two lines', () => {
    expect(wrapLines('alpha beta gamma delta', LATIN, 'en')).toEqual([
      'alpha beta',
      'gamma delta',
    ]);
  });

  it('allows a single word longer than the limit to overflow', () => {
    expect(wrapLines('supercalifragilistic', LATIN, 'en')).toEqual([
      'supercalifragilistic',
    ]);
  });

  it('never breaks a long word apart', () => {
    expect(wrapLines('internationalization ok', LATIN, 'en')).toEqual([
      'internationalization',
      'ok',
    ]);
  });

  it('never returns more than maxLines lines', () => {
    const single: SubtitleStyle = { ...LATIN, maxLines: 1, maxCharsPerLine: 5 };
    const lines = wrapLines('one two three four', single, 'en');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('one two three four');
  });
});

describe('wrapLines (CJK)', () => {
  it('keeps a short CJK text on a single line', () => {
    expect(wrapLines('你好世界', CJK, 'zh')).toEqual(['你好世界']);
  });

  it('balances CJK text across two lines by character count', () => {
    expect(wrapLines('你好世界你好', CJK, 'zh')).toEqual(['你好世', '界你好']);
  });

  it('never starts a line with closing punctuation', () => {
    expect(wrapLines('你好啊。再见', CJK, 'zh')).toEqual(['你好啊。', '再见']);
  });

  it('never ends a line with opening punctuation', () => {
    expect(wrapLines('你好「世界」', CJK, 'zh')).toEqual(['你好', '「世界」']);
  });

  it('never returns more than maxLines lines', () => {
    const lines = wrapLines('一二三四五六七八九十甲乙丙丁', CJK, 'zh');
    expect(lines).toHaveLength(2);
    expect(lines.join('')).toBe('一二三四五六七八九十甲乙丙丁');
  });

  it('returns [] for an empty CJK string', () => {
    expect(wrapLines('   ', CJK, 'zh')).toEqual([]);
  });
});
