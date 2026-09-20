import { describe, expect, it } from 'vitest';
import { annotateCuesWithPinyin, toPinyin } from '../../../src/pipeline/pinyin';
import type { SubtitleCue } from '../../../src/core';

describe('toPinyin — context-aware heteronyms', () => {
  it.each<[string, string]>([
    ['银行', 'yín háng'],
    ['行走', 'xíng zǒu'],
    ['音乐', 'yīn yuè'],
    ['快乐', 'kuài lè'],
    ['长江', 'cháng jiāng'],
    ['长大', 'zhǎng dà'],
  ])('resolves %s as %s', (input, expected) => {
    expect(toPinyin(input)).toBe(expected);
  });

  it('resolves a heteronym inside a full sentence', () => {
    expect(toPinyin('我去银行')).toBe('wǒ qù yín háng');
  });

  it('annotates cue lines with context-aware pinyin', () => {
    const cues: SubtitleCue[] = [{ index: 1, startMs: 0, endMs: 1000, lines: ['银行', '行走'] }];
    const annotated = annotateCuesWithPinyin(cues);
    expect(annotated[0]?.pinyin).toBe('yín háng xíng zǒu');
  });
});
