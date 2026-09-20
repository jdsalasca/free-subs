import { describe, expect, it } from 'vitest';
import * as core from '../../../src/core';
import type { SubtitleCue, SubtitleStyle, TranscriptSegment, WordTiming } from '../../../src/core';

describe('core barrel (src/core/index.ts)', () => {
  it('re-exports every module function', () => {
    const fns: Array<keyof typeof core> = [
      'formatSrtTimestamp',
      'formatVttTimestamp',
      'parseTimestamp',
      'isCjkLanguage',
      'styleForLanguage',
      'detectScript',
      'normalizeWhitespace',
      'normalizeForSubtitles',
      'visibleLength',
      'splitSentences',
      'tokenize',
      'wrapLines',
      'distributeWords',
      'chunkWordsByCapacity',
      'segmentsToCues',
      'mergeShortCues',
      'fixOverlaps',
      'computeCps',
      'reindex',
      'serializeSrt',
      'serializeVtt',
    ];
    for (const name of fns) {
      expect(typeof core[name]).toBe('function');
    }
  });

  it('re-exports the style constants', () => {
    expect(core.DEFAULT_STYLE.maxCharsPerLine).toBe(42);
    expect(core.CJK_STYLE.maxCps).toBe(9);
  });

  it('re-exports the frozen types and works end to end', () => {
    const words: WordTiming[] = core.distributeWords('Hello world', 0, 2000, 'en');
    const segment: TranscriptSegment = {
      text: 'Hello world',
      startMs: 0,
      endMs: 2000,
      words,
    };
    const style: SubtitleStyle = core.DEFAULT_STYLE;
    const cues: SubtitleCue[] = core.segmentsToCues([segment], style, 'en');
    expect(core.serializeSrt(cues)).toContain('Hello world');
  });
});
