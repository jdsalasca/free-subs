/**
 * Post-processing for raw ASR output.
 *
 * The goal is to remove the failure modes catalogued by recent Whisper
 * research: repetition loops, boilerplate ("BoH") hallucinations, sub-50 ms
 * word tokens and jittery timings. Every function is pure and clone-safe.
 */
import type { TranscriptSegment, WordTiming } from '../core';
import type { SpeechRegionLike } from './loudness';
import { isChineseHallucination } from './zh';

const DEFAULT_MIN_WORD_MS = 50;
const DEFAULT_SMOOTH_WINDOW = 5;
const DEFAULT_MAX_DELTA_MS = 120;
const DEFAULT_SNAP_TOLERANCE_MS = 250;
const LONG_SILENCE_MS = 300;

/** English boilerplate/hallucination phrases (lowercased, punctuation-free). */
const BOH_EN = [
  'thank you for watching',
  'thanks for watching',
  'thank you for watching this video',
  'thanks for watching this video',
  'subtitles by',
  'subtitles provided by',
  'subtitle by',
  'amara.org',
  'transcription by',
  'translated by',
  'please subscribe',
  'please like and subscribe',
  'like and subscribe',
  'subscribe to my channel',
  'subscribe',
];

/** Normalise text for hallucination matching: lowercase, tidy whitespace. */
function normalizeForMatch(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\s\u3000]+/g, ' ')
    .toLowerCase()
    .trim();
}

/** Strip punctuation/whitespace so only meaningful characters remain. */
function stripFillers(text: string): string {
  return text.replace(/[\s.,!?…、，。！？:;'"()[\]{}<>—–\-_/\\|*#$%^&+=~`@]+/g, '');
}

function hasRepeatedLoop(text: string): boolean {
  for (const size of [1, 2, 3, 4]) {
    const re = new RegExp(`^(.{${size}})\\1{3,}$`);
    if (re.test(text)) {
      return true;
    }
  }
  return false;
}

/** Collapse a phrase repeated four or more times: `(.{2,20}?)\1{3,}`. */
export function deLoopText(text: string): string {
  if (text === '') {
    return text;
  }
  let out = text;
  const re = /(.{2,20}?)\1{3,}/g;
  for (let pass = 0; pass < 10; pass++) {
    const next = out.replace(re, '$1');
    if (next === out) {
      break;
    }
    out = next;
  }
  return out;
}

/** Whether text is empty, boilerplate, or a repetition loop. */
export function isHallucinationText(text: string): boolean {
  const normalized = normalizeForMatch(text);
  if (normalized === '') {
    return true;
  }

  if (isChineseHallucination(text)) {
    return true;
  }

  const compact = normalized.replace(/\s+/g, '');
  if (hasRepeatedLoop(compact)) {
    return true;
  }

  const tokens = normalized.split(' ').filter((token) => token !== '');
  if (tokens.length >= 4) {
    const unique = new Set(tokens);
    if (unique.size === 1) {
      return true;
    }
    if (unique.size <= Math.max(1, Math.floor(tokens.length / 3))) {
      return true;
    }
  }

  const leftover = stripFillers(
    BOH_EN.reduce((rest, phrase) => rest.split(phrase).join(' '), normalized),
  );
  if (leftover === '') {
    return true;
  }

  for (const phrase of BOH_EN) {
    if (normalized.includes(phrase) && (normalized === phrase || tokens.length <= 6)) {
      return true;
    }
  }

  return false;
}

/** Drop word tokens shorter than `minMs` (default 50 ms). */
export function dropMicroWords(words: WordTiming[], minMs = DEFAULT_MIN_WORD_MS): WordTiming[] {
  return words.filter((word) => word.endMs - word.startMs >= minMs);
}

function clampDelta(original: number, value: number, maxDeltaMs: number): number {
  const limit = Math.max(0, maxDeltaMs);
  return Math.max(original - limit, Math.min(original + limit, value));
}

/** Median filter a numeric series, replicating edge values. */
function medianFilter(values: number[], half: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const window: number[] = [];
    for (let offset = -half; offset <= half; offset++) {
      const index = Math.min(values.length - 1, Math.max(0, i + offset));
      window.push(values[index]!);
    }
    window.sort((a, b) => a - b);
    out.push(window[Math.floor(window.length / 2)]!);
  }
  return out;
}

/**
 * Median-smooth timings (default window 5), clamp each boundary to at most
 * `maxDeltaMs` (default 120) from its original position and keep starts
 * monotonic with `startMs <= endMs`.
 */
export function smoothTimings(
  words: WordTiming[],
  window = DEFAULT_SMOOTH_WINDOW,
  maxDeltaMs = DEFAULT_MAX_DELTA_MS,
): WordTiming[] {
  if (words.length === 0) {
    return [];
  }

  const size = Math.max(1, Math.round(window) | 1);
  const half = Math.floor(size / 2);
  const starts = medianFilter(words.map((word) => word.startMs), half);
  const ends = medianFilter(words.map((word) => word.endMs), half);

  const out: WordTiming[] = words.map((word, index) => ({
    ...word,
    startMs: clampDelta(word.startMs, starts[index]!, maxDeltaMs),
    endMs: clampDelta(word.endMs, ends[index]!, maxDeltaMs),
  }));

  for (let i = 0; i < out.length; i++) {
    const current = out[i]!;
    if (i > 0) {
      current.startMs = Math.max(current.startMs, out[i - 1]!.startMs);
    }
    if (current.endMs < current.startMs) {
      current.endMs = current.startMs;
    }
  }

  return out;
}

function nearest(sorted: number[], value: number, toleranceMs: number): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const edge of sorted) {
    const distance = Math.abs(edge - value);
    if (distance <= toleranceMs && distance < bestDistance) {
      bestDistance = distance;
      best = edge;
    }
  }
  return best;
}

interface SilenceGap {
  startMs: number;
  endMs: number;
}

function longSilenceGaps(regions: SpeechRegionLike[]): SilenceGap[] {
  const sorted = [...regions].sort((a, b) => a.startMs - b.startMs);
  const gaps: SilenceGap[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;
    if (current.startMs - previous.endMs >= LONG_SILENCE_MS) {
      gaps.push({ startMs: previous.endMs, endMs: current.startMs });
    }
  }
  return gaps;
}

function insideGap(value: number, gaps: SilenceGap[]): boolean {
  return gaps.some((gap) => value > gap.startMs && value < gap.endMs);
}

/**
 * Snap segment (and first/last word) boundaries to the nearest speech region
 * edge within `toleranceMs`. Boundaries are never moved into a silence gap of
 * 300 ms or more, and segment starts stay monotonic.
 */
export function snapToRegions(
  segments: TranscriptSegment[],
  regions: SpeechRegionLike[],
  toleranceMs = DEFAULT_SNAP_TOLERANCE_MS,
): TranscriptSegment[] {
  if (segments.length === 0) {
    return [];
  }

  const startEdges = regions.map((region) => region.startMs).sort((a, b) => a - b);
  const endEdges = regions.map((region) => region.endMs).sort((a, b) => a - b);
  const allEdges = [...startEdges, ...endEdges].sort((a, b) => a - b);
  const gaps = longSilenceGaps(regions);

  const snap = (value: number, preferred: number[]): number => {
    const candidate = nearest(preferred, value, toleranceMs) ?? nearest(allEdges, value, toleranceMs);
    if (candidate === null || insideGap(candidate, gaps)) {
      return value;
    }
    return candidate;
  };

  const out: TranscriptSegment[] = segments.map((segment) => {
    const copy: TranscriptSegment = { ...segment };
    if (segment.words !== undefined) {
      copy.words = segment.words.map((word) => ({ ...word }));
    }

    if (regions.length > 0) {
      copy.startMs = snap(copy.startMs, startEdges);
      copy.endMs = snap(copy.endMs, endEdges);
      if (copy.endMs < copy.startMs) {
        copy.endMs = copy.startMs;
      }
      const first = copy.words?.[0];
      const last = copy.words?.[copy.words.length - 1];
      if (first !== undefined) {
        first.startMs = copy.startMs;
      }
      if (last !== undefined) {
        last.endMs = copy.endMs;
      }
    }

    return copy;
  });

  for (let i = 0; i < out.length; i++) {
    const current = out[i]!;
    if (i > 0) {
      current.startMs = Math.max(current.startMs, out[i - 1]!.startMs);
    }
    if (current.endMs < current.startMs) {
      current.endMs = current.startMs;
    }
    const first = current.words?.[0];
    const last = current.words?.[current.words.length - 1];
    if (first !== undefined) {
      first.startMs = Math.max(first.startMs, current.startMs);
    }
    if (last !== undefined) {
      last.endMs = Math.max(last.endMs, current.endMs);
    }
  }

  return out;
}

function joinWords(words: WordTiming[]): string {
  return words.map((word) => word.text).join(' ');
}

/**
 * Full segment cleanup: drop micro words, smooth timings, snap to regions,
 * drop hallucination segments and rebuild segment text/timing from words.
 */
export function normalizeSegments(
  segments: TranscriptSegment[],
  regions: SpeechRegionLike[],
  lang: string,
): TranscriptSegment[] {
  void lang;
  if (segments.length === 0) {
    return [];
  }

  const prepared: TranscriptSegment[] = segments.map((segment) => {
    if (segment.words !== undefined && segment.words.length > 0) {
      const kept = smoothTimings(dropMicroWords(segment.words));
      if (kept.length > 0) {
        return { ...segment, text: joinWords(kept), words: kept };
      }
    }
    const copy: TranscriptSegment = { ...segment, text: deLoopText(segment.text) };
    delete copy.words;
    return copy;
  });

  const snapped = snapToRegions(prepared, regions);
  const filtered = snapped.filter((segment) =>
    segment.words !== undefined && segment.words.length > 0
      ? !isHallucinationText(joinWords(segment.words))
      : !isHallucinationText(segment.text),
  );

  return filtered.map((segment) => {
    if (segment.words !== undefined && segment.words.length > 0) {
      const first = segment.words[0]!;
      const last = segment.words[segment.words.length - 1]!;
      return {
        ...segment,
        text: joinWords(segment.words),
        startMs: first.startMs,
        endMs: last.endMs,
      };
    }
    return segment;
  });
}
