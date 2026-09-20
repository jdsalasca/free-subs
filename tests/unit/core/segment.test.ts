import { describe, expect, it } from 'vitest';
import {
  chunkWordsByCapacity,
  computeCps,
  distributeWords,
  fixOverlaps,
  mergeShortCues,
  reindex,
  segmentsToCues,
} from '../../../src/core/segment';
import type { SubtitleCue, SubtitleStyle, WordTiming } from '../../../src/core/types';

const STYLE: SubtitleStyle = {
  maxCharsPerLine: 20,
  maxLines: 2,
  minDurationMs: 1000,
  maxDurationMs: 7000,
  maxCps: 17,
  minGapMs: 80,
};

function isMonotonic(words: WordTiming[]): boolean {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === undefined || w.endMs < w.startMs) {
      return false;
    }
    const next = words[i + 1];
    if (next !== undefined && next.startMs < w.endMs) {
      return false;
    }
  }
  return true;
}

describe('distributeWords', () => {
  it('returns [] for empty text', () => {
    expect(distributeWords('', 0, 1000, 'en')).toEqual([]);
  });

  it('splits duration proportionally to visible length', () => {
    const words = distributeWords('one two three', 0, 3000, 'en');
    expect(words).toHaveLength(3);
    expect(words[0]).toEqual({ text: 'one', startMs: 0, endMs: 818 });
    expect(words[1]).toEqual({ text: 'two', startMs: 818, endMs: 1636 });
    expect(words[2]).toEqual({ text: 'three', startMs: 1636, endMs: 3000 });
  });

  it('keeps timings monotonic and spans the whole segment', () => {
    const words = distributeWords('the quick brown fox jumps', 1000, 6000, 'en');
    expect(words[0]?.startMs).toBe(1000);
    expect(words[words.length - 1]?.endMs).toBe(6000);
    expect(isMonotonic(words)).toBe(true);
  });

  it('gives each CJK character an equal slice', () => {
    expect(distributeWords('你好世界', 0, 4000, 'zh')).toEqual([
      { text: '你', startMs: 0, endMs: 1000 },
      { text: '好', startMs: 1000, endMs: 2000 },
      { text: '世', startMs: 2000, endMs: 3000 },
      { text: '界', startMs: 3000, endMs: 4000 },
    ]);
  });

  it('produces zero-length words when duration is not positive', () => {
    const words = distributeWords('hi there', 5000, 5000, 'en');
    expect(words).toHaveLength(2);
    for (const word of words) {
      expect(word.startMs).toBe(5000);
      expect(word.endMs).toBe(5000);
    }
  });
});

describe('chunkWordsByCapacity', () => {
  it('splits latin words once capacity is exceeded', () => {
    const style: SubtitleStyle = { ...STYLE, maxCharsPerLine: 10, maxLines: 1 };
    const words = distributeWords('aaaa bbbb cccc', 0, 3000, 'en');
    const chunks = chunkWordsByCapacity(words, style, 'en');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.map((w) => w.text)).toEqual(['aaaa', 'bbbb']);
    expect(chunks[1]?.map((w) => w.text)).toEqual(['cccc']);
  });

  it('closes a chunk early after strong punctuation', () => {
    const words = distributeWords('Hello there. friend', 0, 3000, 'en');
    const chunks = chunkWordsByCapacity(words, STYLE, 'en');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.map((w) => w.text)).toEqual(['Hello', 'there.']);
    expect(chunks[1]?.map((w) => w.text)).toEqual(['friend']);
  });

  it('never produces an empty chunk even for oversized words', () => {
    const style: SubtitleStyle = { ...STYLE, maxCharsPerLine: 3, maxLines: 1 };
    const words: WordTiming[] = [
      { text: 'unbreakable', startMs: 0, endMs: 1000 },
      { text: 'ok', startMs: 1000, endMs: 1200 },
    ];
    const chunks = chunkWordsByCapacity(words, style, 'en');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.[0]?.text).toBe('unbreakable');
    expect(chunks[1]?.[0]?.text).toBe('ok');
  });

  it('joins CJK chunks without spaces', () => {
    const style: SubtitleStyle = { ...STYLE, maxCharsPerLine: 4, maxLines: 1 };
    const words = distributeWords('你好世界再见', 0, 6000, 'zh');
    const chunks = chunkWordsByCapacity(words, style, 'zh');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.map((w) => w.text)).toEqual(['你', '好', '世', '界']);
    expect(chunks[1]?.map((w) => w.text)).toEqual(['再', '见']);
  });
});

describe('segmentsToCues', () => {
  it('chunks word timings into cues end to end', () => {
    const words: WordTiming[] = [
      { text: 'Hello', startMs: 0, endMs: 1000 },
      { text: 'world.', startMs: 1000, endMs: 2000 },
      { text: 'Goodbye', startMs: 2000, endMs: 3000 },
      { text: 'now.', startMs: 3000, endMs: 4000 },
    ];
    const cues = segmentsToCues(
      [{ text: 'Hello world. Goodbye now.', startMs: 0, endMs: 4000, words }],
      STYLE,
      'en',
    );
    expect(cues).toHaveLength(2);
    expect(cues[0]?.index).toBe(1);
    expect(cues[0]?.lines).toEqual(['Hello world.']);
    expect(cues[0]?.startMs).toBe(0);
    expect(cues[0]?.endMs).toBe(1920);
    expect(cues[0]?.words).toHaveLength(2);
    expect(cues[1]?.index).toBe(2);
    expect(cues[1]?.lines).toEqual(['Goodbye now.']);
    expect(cues[1]?.startMs).toBe(2000);
    expect(cues[1]?.endMs).toBe(4000);
  });

  it('distributes words when none are provided', () => {
    const cues = segmentsToCues(
      [{ text: 'Hello world', startMs: 0, endMs: 2000 }],
      STYLE,
      'en',
    );
    expect(cues).toHaveLength(1);
    expect(cues[0]?.lines).toEqual(['Hello world']);
    expect(cues[0]?.words).toHaveLength(2);
    expect(cues[0]?.endMs).toBe(2000);
  });

  it('normalizes segment text before processing', () => {
    const cues = segmentsToCues(
      [{ text: '  Hello   world  ', startMs: 0, endMs: 2000 }],
      STYLE,
      'en',
    );
    expect(cues[0]?.lines).toEqual(['Hello world']);
  });
});

describe('mergeShortCues', () => {
  it('merges a short cue into the next one', () => {
    const cues: SubtitleCue[] = [
      { index: 1, startMs: 0, endMs: 500, lines: ['Hi'], words: [{ text: 'Hi', startMs: 0, endMs: 500 }] },
      {
        index: 2,
        startMs: 600,
        endMs: 3000,
        lines: ['there friend'],
        words: [
          { text: 'there', startMs: 600, endMs: 1800 },
          { text: 'friend', startMs: 1800, endMs: 3000 },
        ],
      },
    ];
    const merged = mergeShortCues(cues, STYLE, 'en');
    expect(merged).toHaveLength(1);
    expect(merged[0]?.startMs).toBe(0);
    expect(merged[0]?.endMs).toBe(3000);
    expect(merged[0]?.lines).toEqual(['Hi there friend']);
    expect(merged[0]?.words).toHaveLength(3);
  });

  it('merges a short cue into the previous one when there is no next', () => {
    const cues: SubtitleCue[] = [
      {
        index: 1,
        startMs: 0,
        endMs: 4000,
        lines: ['long enough'],
        words: [
          { text: 'long', startMs: 0, endMs: 2000 },
          { text: 'enough', startMs: 2000, endMs: 4000 },
        ],
      },
      { index: 2, startMs: 4100, endMs: 4400, lines: ['x'], words: [{ text: 'x', startMs: 4100, endMs: 4400 }] },
    ];
    const merged = mergeShortCues(cues, STYLE, 'en');
    expect(merged).toHaveLength(1);
    expect(merged[0]?.startMs).toBe(0);
    expect(merged[0]?.endMs).toBe(4400);
    expect(merged[0]?.words).toHaveLength(3);
  });

  it('extends a short cue up to the next start minus the gap', () => {
    const tight: SubtitleStyle = { ...STYLE, maxDurationMs: 2000 };
    const cues: SubtitleCue[] = [
      { index: 1, startMs: 0, endMs: 500, lines: ['Hi'] },
      { index: 2, startMs: 700, endMs: 4000, lines: ['long next cue'] },
    ];
    const result = mergeShortCues(cues, tight, 'en');
    expect(result[0]?.endMs).toBe(620);
  });

  it('extends a short cue up to minDuration when nothing blocks it', () => {
    const cues: SubtitleCue[] = [{ index: 1, startMs: 0, endMs: 200, lines: ['Hi'] }];
    const result = mergeShortCues(cues, STYLE, 'en');
    expect(result[0]?.endMs).toBe(1000);
  });
});

describe('fixOverlaps', () => {
  it('clamps a previous end to leave the minimum gap', () => {
    const cues: SubtitleCue[] = [
      { index: 1, startMs: 0, endMs: 2200, lines: ['a'] },
      { index: 2, startMs: 2100, endMs: 3000, lines: ['b'] },
    ];
    const fixed = fixOverlaps(cues, 100);
    expect(fixed).toHaveLength(2);
    expect(fixed[0]?.endMs).toBe(2000);
    expect(fixed[1]?.startMs).toBe(2100);
  });

  it('drops cues that become empty after clamping', () => {
    const cues: SubtitleCue[] = [
      { index: 1, startMs: 0, endMs: 100, lines: ['a'] },
      { index: 2, startMs: 50, endMs: 300, lines: ['b'] },
    ];
    const fixed = fixOverlaps(cues, 100);
    expect(fixed).toHaveLength(1);
    expect(fixed[0]?.startMs).toBe(50);
    expect(fixed[0]?.endMs).toBe(300);
  });
});

describe('computeCps', () => {
  it('computes visible characters per second', () => {
    expect(computeCps({ index: 1, startMs: 0, endMs: 1000, lines: ['Hello'] })).toBe(5);
  });

  it('counts all lines', () => {
    expect(computeCps({ index: 1, startMs: 0, endMs: 1000, lines: ['ab', 'cde'] })).toBe(5);
  });

  it('returns 0 for non-positive durations', () => {
    expect(computeCps({ index: 1, startMs: 1000, endMs: 1000, lines: ['Hello'] })).toBe(0);
    expect(computeCps({ index: 1, startMs: 1000, endMs: 500, lines: ['Hello'] })).toBe(0);
  });
});

describe('reindex', () => {
  it('renumbers cues from 1 in order', () => {
    const cues: SubtitleCue[] = [
      { index: 99, startMs: 0, endMs: 1000, lines: ['a'] },
      { index: -1, startMs: 1000, endMs: 2000, lines: ['b'] },
    ];
    expect(reindex(cues).map((cue) => cue.index)).toEqual([1, 2]);
  });
});
