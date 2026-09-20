/**
 * Segmentation: turning transcript segments into timed, display-ready cues.
 *
 * The pipeline is: normalize -> distribute words -> chunk by capacity ->
 * wrap lines -> merge cues that are too short -> fix overlaps -> reindex.
 */
import { detectScript, isCjkLanguage, normalizeForSubtitles, tokenize, visibleLength } from './text';
import { wrapLines } from './wrap';
import type { SubtitleCue, SubtitleStyle, TranscriptSegment, WordTiming } from './types';

/** Punctuation that strongly ends a thought and justifies an early break. */
const STRONG_PUNCTUATION = new Set(['.', '!', '?', '…', '。', '！', '？']);

/** Code-point length, including spaces. */
function totalLength(text: string): number {
  return [...text].length;
}

function usesCjkSpacing(lang: string, sample: string): boolean {
  return isCjkLanguage(lang) || detectScript(sample) === 'cjk';
}

function joinWordTexts(texts: string[], lang: string): string {
  if (texts.length === 0) {
    return '';
  }
  const sample = texts.join(' ');
  return usesCjkSpacing(lang, sample) ? texts.join('') : texts.join(' ');
}

function joinTwoTexts(a: string, b: string, lang: string): string {
  if (a === '') {
    return b;
  }
  if (b === '') {
    return a;
  }
  return usesCjkSpacing(lang, `${a} ${b}`) ? `${a}${b}` : `${a} ${b}`;
}

function cloneWord(word: WordTiming): WordTiming {
  return { ...word };
}

function cloneCue(cue: SubtitleCue): SubtitleCue {
  const copy: SubtitleCue = {
    index: cue.index,
    startMs: cue.startMs,
    endMs: cue.endMs,
    lines: [...cue.lines],
  };
  if (cue.words !== undefined) {
    copy.words = cue.words.map(cloneWord);
  }
  return copy;
}

/**
 * Distribute a segment's duration across its tokens, proportionally to the
 * visible length of each token (minimum weight of 1).
 */
export function distributeWords(
  text: string,
  startMs: number,
  endMs: number,
  lang: string,
): WordTiming[] {
  const tokens = tokenize(text, lang);
  if (tokens.length === 0) {
    return [];
  }

  if (endMs <= startMs) {
    return tokens.map((token) => ({ text: token, startMs, endMs: startMs }));
  }

  const weights = tokens.map((token) => Math.max(1, visibleLength(token)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const duration = endMs - startMs;
  const result: WordTiming[] = [];
  let cumulative = 0;
  let previousBoundary = startMs;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    cumulative += weights[i] ?? 0;
    const boundary =
      i === tokens.length - 1
        ? endMs
        : startMs + Math.round((duration * cumulative) / totalWeight);
    result.push({ text: token, startMs: previousBoundary, endMs: boundary });
    previousBoundary = boundary;
  }

  return result;
}

/**
 * Group word timings into chunks that fit `maxCharsPerLine * maxLines`.
 * A chunk is closed early when it ends with strong punctuation and is at
 * least 25% of the maximum capacity.
 */
export function chunkWordsByCapacity(
  words: WordTiming[],
  style: SubtitleStyle,
  lang: string,
): WordTiming[][] {
  if (words.length === 0) {
    return [];
  }

  const maxTotal = style.maxCharsPerLine * style.maxLines;
  const earlyThreshold = maxTotal * 0.25;
  const chunks: WordTiming[][] = [];
  let current: WordTiming[] = [];

  const flush = (): void => {
    if (current.length > 0) {
      chunks.push(current);
      current = [];
    }
  };

  for (const word of words) {
    const candidate = [...current, word];
    if (current.length > 0 && totalLength(joinWordTexts(candidate.map((w) => w.text), lang)) > maxTotal) {
      flush();
      current = [word];
    } else {
      current = candidate;
    }

    const text = joinWordTexts(current.map((w) => w.text), lang);
    const lastChar = [...text].at(-1);
    if (
      earlyThreshold > 0 &&
      lastChar !== undefined &&
      STRONG_PUNCTUATION.has(lastChar) &&
      totalLength(text) >= earlyThreshold
    ) {
      flush();
    }
  }

  flush();
  return chunks;
}

function cueText(cue: SubtitleCue, lang: string): string {
  if (cue.words !== undefined && cue.words.length > 0) {
    return joinWordTexts(cue.words.map((w) => w.text), lang);
  }
  return joinWordTexts(cue.lines, lang);
}

function fitsCapacity(text: string, style: SubtitleStyle): boolean {
  return totalLength(text) <= style.maxCharsPerLine * style.maxLines;
}

function canMerge(a: SubtitleCue, b: SubtitleCue, style: SubtitleStyle, lang: string): boolean {
  if (b.endMs - a.startMs > style.maxDurationMs) {
    return false;
  }
  return fitsCapacity(joinTwoTexts(cueText(a, lang), cueText(b, lang), lang), style);
}

function mergeTwo(a: SubtitleCue, b: SubtitleCue, style: SubtitleStyle, lang: string): SubtitleCue {
  const text = joinTwoTexts(cueText(a, lang), cueText(b, lang), lang);
  const merged: SubtitleCue = {
    index: a.index,
    startMs: a.startMs,
    endMs: b.endMs,
    lines: wrapLines(text, style, lang),
  };
  if (a.words !== undefined && b.words !== undefined) {
    merged.words = [...a.words.map(cloneWord), ...b.words.map(cloneWord)];
  }
  return merged;
}

function extendCue(cue: SubtitleCue, next: SubtitleCue | undefined, style: SubtitleStyle): void {
  const target = cue.startMs + style.minDurationMs;
  let cap = cue.startMs + style.maxDurationMs;
  if (next !== undefined) {
    cap = Math.min(cap, next.startMs - style.minGapMs);
  }
  const allowed = Math.max(cue.endMs, cap);
  cue.endMs = Math.max(cue.endMs, Math.min(target, allowed));
}

/** Build display-ready cues from raw transcript segments. */
export function segmentsToCues(
  segments: TranscriptSegment[],
  style: SubtitleStyle,
  lang: string,
): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let counter = 0;

  for (const segment of segments) {
    const normalized = normalizeForSubtitles(segment.text, lang);
    const words =
      segment.words !== undefined && segment.words.length > 0
        ? segment.words
        : distributeWords(normalized, segment.startMs, segment.endMs, lang);

    if (words.length === 0) {
      continue;
    }

    for (const chunk of chunkWordsByCapacity(words, style, lang)) {
      const first = chunk[0];
      const last = chunk[chunk.length - 1];
      if (first === undefined || last === undefined) {
        continue;
      }
      const text = joinWordTexts(chunk.map((w) => w.text), lang);
      cues.push({
        index: counter,
        startMs: first.startMs,
        endMs: last.endMs,
        lines: wrapLines(text, style, lang),
        words: chunk.map(cloneWord),
      });
      counter++;
    }
  }

  return reindex(fixOverlaps(mergeShortCues(cues, style, lang), style.minGapMs));
}

/** Merge or extend cues whose duration is below `style.minDurationMs`. */
export function mergeShortCues(
  cues: SubtitleCue[],
  style: SubtitleStyle,
  lang: string,
): SubtitleCue[] {
  const list = cues.map(cloneCue);
  let i = 0;

  while (i < list.length) {
    const cue = list[i];
    if (cue === undefined) {
      break;
    }

    if (cue.endMs - cue.startMs >= style.minDurationMs) {
      i++;
      continue;
    }

    const next = list[i + 1];
    if (next !== undefined && canMerge(cue, next, style, lang)) {
      const merged = mergeTwo(cue, next, style, lang);
      list.splice(i, 2, merged);
      continue;
    }

    const previous = list[i - 1];
    if (previous !== undefined && canMerge(previous, cue, style, lang)) {
      const merged = mergeTwo(previous, cue, style, lang);
      list.splice(i - 1, 2, merged);
      i = Math.max(0, i - 1);
      continue;
    }

    extendCue(cue, next, style);
    i++;
  }

  return list;
}

/** Clamp overlapping cues to leave `minGapMs` and drop empty results. */
export function fixOverlaps(cues: SubtitleCue[], minGapMs: number): SubtitleCue[] {
  const list = cues.map(cloneCue);
  for (let i = 0; i < list.length - 1; i++) {
    const current = list[i];
    const next = list[i + 1];
    if (current === undefined || next === undefined) {
      continue;
    }
    const maxEnd = next.startMs - minGapMs;
    if (current.endMs > maxEnd) {
      current.endMs = maxEnd;
    }
  }
  return list.filter((cue) => cue.endMs > cue.startMs);
}

/** Visible characters per second for a cue. */
export function computeCps(cue: SubtitleCue): number {
  const durationMs = cue.endMs - cue.startMs;
  if (durationMs <= 0) {
    return 0;
  }
  let characters = 0;
  for (const line of cue.lines) {
    characters += visibleLength(line);
  }
  return characters / (durationMs / 1000);
}

/** Renumber cues with 1-based indexes in their current order. */
export function reindex(cues: SubtitleCue[]): SubtitleCue[] {
  return cues.map((cue, position) => {
    const copy = cloneCue(cue);
    copy.index = position + 1;
    return copy;
  });
}
