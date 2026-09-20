import { describe, expect, it } from 'vitest';
import type { TranscriptSegment, WordTiming } from '../../../src/core';
import {
  deLoopText,
  dropMicroWords,
  isHallucinationText,
  normalizeSegments,
  smoothTimings,
  snapToRegions,
} from '../../../src/pipeline/postprocess';

function word(text: string, startMs: number, endMs: number): WordTiming {
  return { text, startMs, endMs };
}

describe('deLoopText', () => {
  it('collapses a phrase repeated four or more times', () => {
    expect(deLoopText('hahahaha')).toBe('ha');
    expect(deLoopText('abcabcabcabc')).toBe('abc');
  });

  it('leaves ordinary text untouched', () => {
    expect(deLoopText('Hello world')).toBe('Hello world');
  });

  it('returns an empty string for empty input', () => {
    expect(deLoopText('')).toBe('');
  });
});

describe('isHallucinationText', () => {
  it('flags English boilerplate (BoH) phrases', () => {
    expect(isHallucinationText('Thank you for watching')).toBe(true);
    expect(isHallucinationText('Thanks for watching!')).toBe(true);
    expect(isHallucinationText('Please subscribe')).toBe(true);
    expect(isHallucinationText('Subtitles by Amara.org')).toBe(true);
  });

  it('flags Mandarin boilerplate phrases', () => {
    expect(isHallucinationText('谢谢观看')).toBe(true);
    expect(isHallucinationText('請訂閱頻道')).toBe(true);
  });

  it('flags token and n-gram loops', () => {
    expect(isHallucinationText('you you you you you')).toBe(true);
    expect(isHallucinationText('na na na na na')).toBe(true);
  });

  it('keeps ordinary sentences', () => {
    expect(isHallucinationText('Hello, this is a normal sentence about the weather.')).toBe(false);
    expect(isHallucinationText('今天天气很好，我们去公园散步。')).toBe(false);
  });

  it('treats empty text as a hallucination', () => {
    expect(isHallucinationText('')).toBe(true);
  });
});

describe('dropMicroWords', () => {
  const words: WordTiming[] = [
    word('a', 0, 40),
    word('b', 40, 140),
    word('c', 140, 189),
    word('d', 190, 250),
  ];

  it('drops words shorter than the default 50 ms', () => {
    const kept = dropMicroWords(words);
    expect(kept.map((item) => item.text)).toEqual(['b', 'd']);
  });

  it('honours a custom minimum duration', () => {
    const kept = dropMicroWords(words, 30);
    expect(kept.map((item) => item.text)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns an empty array for empty input', () => {
    expect(dropMicroWords([])).toEqual([]);
  });
});

describe('smoothTimings', () => {
  it('leaves evenly spaced timings unchanged', () => {
    const words = Array.from({ length: 5 }, (_, i) => word(`w${i}`, i * 1000, i * 1000 + 800));
    expect(smoothTimings(words)).toEqual(words);
  });

  it('limits how far a boundary can move', () => {
    const words: WordTiming[] = [
      word('a', 0, 100),
      word('b', 100, 200),
      word('c', 200, 1900),
      word('d', 300, 400),
      word('e', 400, 500),
    ];
    const smoothed = smoothTimings(words);
    expect(smoothed).toHaveLength(words.length);
    for (let i = 0; i < smoothed.length; i++) {
      const original = words[i];
      const current = smoothed[i];
      expect(original).toBeDefined();
      expect(current).toBeDefined();
      if (original === undefined || current === undefined) {
        continue;
      }
      expect(Math.abs(current.startMs - original.startMs)).toBeLessThanOrEqual(120);
      expect(Math.abs(current.endMs - original.endMs)).toBeLessThanOrEqual(120);
      expect(current.startMs).toBeLessThanOrEqual(current.endMs);
    }
  });

  it('keeps starts monotonic', () => {
    const words: WordTiming[] = [word('a', 500, 600), word('b', 100, 200), word('c', 3000, 3100)];
    const smoothed = smoothTimings(words);
    for (let i = 1; i < smoothed.length; i++) {
      const previous = smoothed[i - 1];
      const current = smoothed[i];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      if (previous === undefined || current === undefined) {
        continue;
      }
      expect(current.startMs).toBeGreaterThanOrEqual(previous.startMs);
      expect(current.startMs).toBeLessThanOrEqual(current.endMs);
    }
  });

  it('returns an empty array for empty input', () => {
    expect(smoothTimings([])).toEqual([]);
  });
});

describe('snapToRegions', () => {
  const regions = [
    { startMs: 1000, endMs: 2000 },
    { startMs: 3000, endMs: 4000 },
  ];

  it('snaps boundaries within tolerance to a region edge', () => {
    const segments: TranscriptSegment[] = [
      { text: 'one', startMs: 1050, endMs: 1900 },
      { text: 'two', startMs: 3200, endMs: 3900 },
    ];
    const snapped = snapToRegions(segments, regions);
    expect(snapped).toEqual([
      { text: 'one', startMs: 1000, endMs: 2000 },
      { text: 'two', startMs: 3000, endMs: 4000 },
    ]);
  });

  it('leaves boundaries farther than the tolerance alone', () => {
    const segments: TranscriptSegment[] = [{ text: 'far', startMs: 1500, endMs: 2500 }];
    const snapped = snapToRegions(segments, regions);
    expect(snapped[0]?.startMs).toBe(1500);
    expect(snapped[0]?.endMs).toBe(2500);
  });

  it('honours a custom tolerance', () => {
    const segments: TranscriptSegment[] = [{ text: 'near', startMs: 1200, endMs: 1800 }];
    expect(snapToRegions(segments, regions, 50)[0]?.startMs).toBe(1200);
    expect(snapToRegions(segments, regions, 250)[0]?.startMs).toBe(1000);
  });

  it('keeps segments monotonic and clear of long silences', () => {
    const longGap = [
      { startMs: 0, endMs: 1000 },
      { startMs: 1600, endMs: 2600 },
    ];
    const segments: TranscriptSegment[] = [
      { text: 'a', startMs: 900, endMs: 1500 },
      { text: 'b', startMs: 2400, endMs: 2550 },
    ];
    const snapped = snapToRegions(segments, longGap);
    for (let i = 0; i < snapped.length; i++) {
      const current = snapped[i];
      expect(current).toBeDefined();
      if (current === undefined) {
        continue;
      }
      expect(current.startMs).toBeLessThanOrEqual(current.endMs);
      const insideGap = current.startMs > 1000 && current.startMs < 1600;
      expect(insideGap).toBe(false);
      if (i > 0) {
        const previous = snapped[i - 1];
        expect(previous).toBeDefined();
        if (previous !== undefined) {
          expect(current.startMs).toBeGreaterThanOrEqual(previous.startMs);
        }
      }
    }
  });

  it('returns clones unchanged when there are no regions', () => {
    const segments: TranscriptSegment[] = [{ text: 'x', startMs: 100, endMs: 200 }];
    expect(snapToRegions(segments, [])).toEqual(segments);
  });

  it('returns an empty array for empty input', () => {
    expect(snapToRegions([], regions)).toEqual([]);
  });
});

describe('normalizeSegments', () => {
  const regions = [{ startMs: 0, endMs: 2000 }];

  it('drops micro words, hallucination segments and de-loops text', () => {
    const segments: TranscriptSegment[] = [
      {
        text: 'Hello world',
        startMs: 0,
        endMs: 1000,
        words: [word('Hello', 0, 40), word('world', 40, 1000)],
      },
      { text: 'Thank you for watching', startMs: 1000, endMs: 1200 },
      { text: 'hahahaha', startMs: 1200, endMs: 1400 },
    ];
    const normalized = normalizeSegments(segments, regions, 'en');
    expect(normalized).toHaveLength(2);
    expect(normalized[0]?.text).toBe('world');
    expect(normalized[0]?.words).toEqual([word('world', 0, 1000)]);
    expect(normalized[0]?.startMs).toBe(0);
    expect(normalized[0]?.endMs).toBe(1000);
    expect(normalized[1]?.text).toBe('ha');
  });

  it('returns an empty array when every segment is a hallucination', () => {
    const segments: TranscriptSegment[] = [
      { text: 'Thank you for watching', startMs: 0, endMs: 1000 },
      { text: '谢谢观看', startMs: 1000, endMs: 2000 },
    ];
    expect(normalizeSegments(segments, regions, 'en')).toEqual([]);
  });

  it('works without regions', () => {
    const segments: TranscriptSegment[] = [{ text: 'Hello world', startMs: 0, endMs: 500 }];
    expect(normalizeSegments(segments, [], 'en')).toEqual(segments);
  });

  it('returns an empty array for empty input', () => {
    expect(normalizeSegments([], regions, 'en')).toEqual([]);
  });
});
