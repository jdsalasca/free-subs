import { describe, expect, it } from 'vitest';
import { toPinyin } from '../../../src/pipeline/pinyin';
import { tokenize } from '../../../src/core/text';
import { normalizeChineseText } from '../../../src/pipeline/zh';

describe('code-switching (CJK + latin)', () => {
  it('keeps a latin brand name intact when generating pinyin', () => {
    expect(toPinyin('我用iPhone看电影')).toBe('wǒ yòng iPhone kàn diàn yǐng');
  });

  it('treats a latin run as ONE token in CJK tokenization', () => {
    expect(tokenize('我用iPhone看电影', 'zh')).toEqual([
      '我',
      '用',
      'iPhone',
      '看',
      '电',
      '影',
    ]);
  });

  it('keeps multiple latin runs whole in CJK tokenization', () => {
    expect(tokenize('我用iPhone看Apple电影', 'zh')).toEqual([
      '我',
      '用',
      'iPhone',
      '看',
      'Apple',
      '电',
      '影',
    ]);
  });

  it('removes CJK spacing but keeps single spaces around latin runs', () => {
    expect(normalizeChineseText('我 用 iPhone 看 电影')).toBe('我用 iPhone 看电影');
  });
});
