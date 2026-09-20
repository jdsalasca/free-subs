import { describe, expect, it } from 'vitest';
import type { SubtitleCue } from '../../../src/core';
import { annotateCuesWithPinyin, pinyinForWords, toPinyin } from '../../../src/pipeline/pinyin';

describe('toPinyin third-tone sandhi', () => {
  it('turns all but the last third tone into a second tone', () => {
    expect(toPinyin('你好')).toBe('ní hǎo');
  });

  it('applies sandhi to a three-syllable run', () => {
    expect(toPinyin('展览馆')).toBe('zhán lán guǎn');
  });

  it('applies sandhi across the syllables of one prosodic group', () => {
    expect(toPinyin('我很好')).toBe('wó hén hǎo');
  });

  it('keeps a single third tone unchanged', () => {
    expect(toPinyin('好')).toBe('hǎo');
  });

  it('does not apply sandhi across punctuation', () => {
    // Each `你好` is its own prosodic group: the last 3rd tone of each stays.
    expect(toPinyin('你好，你好')).toBe('ní hǎo, ní hǎo');
  });

  it('does not apply sandhi across whitespace', () => {
    expect(toPinyin('你好 你好')).toBe('ní hǎo ní hǎo');
  });

  it('does not touch non-third-tone syllables or Latin words', () => {
    expect(toPinyin('世界')).toBe('shì jiè');
    expect(toPinyin('Hello 你好 world')).toBe('Hello ní hǎo world');
  });

  it('returns an empty string for empty input', () => {
    expect(toPinyin('')).toBe('');
  });
});

describe('pinyin helpers pick up sandhi', () => {
  it('pinyinForWords returns one sandhi-applied string per word', () => {
    expect(pinyinForWords([{ text: '你好' }, { text: '世界' }])).toEqual(['ní hǎo', 'shì jiè']);
  });

  it('annotateCuesWithPinyin stores the sandhi-applied reading', () => {
    const cues: SubtitleCue[] = [
      {
        index: 1,
        startMs: 0,
        endMs: 1000,
        lines: ['你好', '世界'],
      },
    ];

    const annotated = annotateCuesWithPinyin(cues);

    expect(annotated[0]?.pinyin).toBe('ní hǎo shì jiè');
    expect(cues[0]?.pinyin).toBeUndefined();
  });
});
