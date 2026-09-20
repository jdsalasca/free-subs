import { describe, expect, it } from 'vitest';
import type { SubtitleCue } from '../../../src/core';
import { buildStudyDocument, serializeStudy } from '../../../src/pipeline/study';

function cue(
  index: number,
  startMs: number,
  endMs: number,
  lines: string[],
  words?: SubtitleCue['words'],
): SubtitleCue {
  const value: SubtitleCue = { index, startMs, endMs, lines };
  if (words !== undefined) {
    value.words = words;
  }
  return value;
}

const ZH_CUE = cue(1, 0, 1000, ['你好', '世界'], [
  { text: '你好', startMs: 0, endMs: 500 },
  { text: '世界', startMs: 500, endMs: 1000 },
]);

const EN_CUE = cue(1, 0, 1000, ['Hello', 'world'], [
  { text: 'Hello', startMs: 0, endMs: 500 },
  { text: 'world', startMs: 500, endMs: 1000 },
]);

describe('buildStudyDocument', () => {
  it('adds pinyin to Chinese cues and to each Chinese word', () => {
    const doc = buildStudyDocument({ language: 'zh', durationMs: 2000, cues: [ZH_CUE] });

    expect(doc.version).toBe(1);
    expect(doc.language).toBe('zh');
    expect(doc.durationMs).toBe(2000);
    expect(doc.cues[0]?.pinyin).toBe('nǐ hǎo shì jiè');
    expect(doc.cues[0]?.words).toEqual([
      { text: '你好', startMs: 0, endMs: 500, pinyin: 'nǐ hǎo' },
      { text: '世界', startMs: 500, endMs: 1000, pinyin: 'shì jiè' },
    ]);
  });

  it('omits pinyin entirely for non-Chinese documents', () => {
    const doc = buildStudyDocument({ language: 'en', durationMs: 1000, cues: [EN_CUE] });

    expect(doc.cues[0]?.pinyin).toBeUndefined();
    expect(doc.cues[0]?.words[0]?.pinyin).toBeUndefined();
    expect(doc.cues[0] !== undefined && 'pinyin' in doc.cues[0]).toBe(false);
    expect(doc.cues[0]?.words[0] !== undefined && 'pinyin' in doc.cues[0].words[0]).toBe(false);
  });

  it('always emits a words array, even without word timings', () => {
    const doc = buildStudyDocument({
      language: 'en',
      durationMs: 1000,
      cues: [cue(1, 0, 1000, ['Hi'])],
    });

    expect(Array.isArray(doc.cues[0]?.words)).toBe(true);
    expect(doc.cues[0]?.words).toEqual([]);
  });

  it('includes every provided translation and only pinyin for Chinese ones', () => {
    const doc = buildStudyDocument({
      language: 'zh',
      durationMs: 1000,
      cues: [ZH_CUE],
      translations: {
        en: [EN_CUE],
        zh: [cue(1, 0, 1000, ['你好'])],
      },
    });

    expect(Object.keys(doc.translations)).toEqual(['en', 'zh']);
    expect(doc.translations.en?.cues[0]?.pinyin).toBeUndefined();
    expect(doc.translations.zh?.cues[0]?.pinyin).toBe('nǐ hǎo');
    expect(doc.translations.zh?.cues[0]?.words).toEqual([]);
  });

  it('defaults translations to an empty object', () => {
    const doc = buildStudyDocument({ language: 'en', durationMs: 0, cues: [] });

    expect(doc.translations).toEqual({});
  });
});

describe('serializeStudy', () => {
  it('round-trips through JSON.parse', () => {
    const doc = buildStudyDocument({
      language: 'zh',
      durationMs: 1000,
      cues: [ZH_CUE],
      translations: { en: [EN_CUE] },
    });

    const text = serializeStudy(doc);

    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(doc);
  });

  it('writes a stable JSON key order', () => {
    const doc = buildStudyDocument({ language: 'zh', durationMs: 1000, cues: [ZH_CUE] });
    const parsed = JSON.parse(serializeStudy(doc)) as Record<string, unknown>;

    expect(Object.keys(parsed)).toEqual(['version', 'language', 'durationMs', 'cues', 'translations']);
    const parsedCue = (parsed.cues as Array<Record<string, unknown>>)[0]!;
    expect(Object.keys(parsedCue)).toEqual(['startMs', 'endMs', 'lines', 'words', 'pinyin']);
    const parsedWord = (parsedCue.words as Array<Record<string, unknown>>)[0]!;
    expect(Object.keys(parsedWord)).toEqual(['text', 'startMs', 'endMs', 'pinyin']);
  });

  it('omits the pinyin key for non-Chinese cues in the serialized output', () => {
    const doc = buildStudyDocument({ language: 'en', durationMs: 1000, cues: [EN_CUE] });
    const parsed = JSON.parse(serializeStudy(doc)) as { cues: Array<Record<string, unknown>> };

    expect(Object.keys(parsed.cues[0]!)).toEqual(['startMs', 'endMs', 'lines', 'words']);
    const word = (parsed.cues[0]!.words as Array<Record<string, unknown>>)[0]!;
    expect(Object.keys(word)).toEqual(['text', 'startMs', 'endMs']);
  });
});
