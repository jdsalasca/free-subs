/**
 * Line wrapping for subtitle cues.
 *
 * Latin text is wrapped with a dynamic program that balances line lengths,
 * never breaking words. CJK text is wrapped between characters while keeping
 * punctuation attached to the correct side of the line break.
 */
import {
  detectScript,
  isCjkLanguage,
  normalizeWhitespace,
  visibleLength,
} from './text';
import type { SubtitleStyle } from './types';

/** Characters that must never begin a CJK line. */
const CJK_CLOSING = new Set(['、', '。', '，', '！', '？', '：', '；', '」', '』', '）', '】', '》']);
/** Characters that must never end a CJK line. */
const CJK_OPENING = new Set(['「', '『', '（', '【', '《']);
/** Han ideographs (CJK Unified Ideographs + Extension A). */
const CJK_IDEOGRAPH_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;

interface Partition {
  maxLen: number;
  lines: string[];
}

/** Code-point length, including spaces (used for line-width limits). */
function totalLength(text: string): number {
  return [...text].length;
}

/** Width of `words[from..to]` once joined with single spaces. */
function lineWidth(words: string[], from: number, to: number): number {
  let total = 0;
  for (let i = from; i <= to; i++) {
    const word = words[i];
    if (word !== undefined) {
      total += visibleLength(word);
    }
  }
  return total + Math.max(0, to - from);
}

/**
 * Partition `words` into exactly `k` lines minimizing the longest line.
 * Returns `null` when the partition is impossible.
 */
function bestPartition(words: string[], k: number): Partition | null {
  const n = words.length;
  if (k <= 0 || n === 0 || k > n) {
    return null;
  }

  const dp: number[][] = Array.from({ length: k + 1 }, () =>
    new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY),
  );
  const choice: number[][] = Array.from({ length: k + 1 }, () =>
    new Array<number>(n + 1).fill(-1),
  );

  const firstRow = dp[0];
  if (firstRow !== undefined) {
    firstRow[0] = 0;
  }

  for (let j = 1; j <= k; j++) {
    for (let i = j; i <= n; i++) {
      let best = Number.POSITIVE_INFINITY;
      let bestPrev = -1;
      for (let p = j - 1; p < i; p++) {
        const prevRow = dp[j - 1];
        const prev = prevRow === undefined ? undefined : prevRow[p];
        if (prev === undefined || !Number.isFinite(prev)) {
          continue;
        }
        const cost = Math.max(prev, lineWidth(words, p, i - 1));
        if (cost < best) {
          best = cost;
          bestPrev = p;
        }
      }
      const row = dp[j];
      const choiceRow = choice[j];
      if (row !== undefined) {
        row[i] = best;
      }
      if (choiceRow !== undefined) {
        choiceRow[i] = bestPrev;
      }
    }
  }

  const finalRow = dp[k];
  const finalCost = finalRow === undefined ? undefined : finalRow[n];
  if (finalCost === undefined || !Number.isFinite(finalCost)) {
    return null;
  }

  const lines: string[] = [];
  let i = n;
  for (let j = k; j >= 1; j--) {
    const choiceRow = choice[j];
    const p = choiceRow === undefined ? -1 : (choiceRow[i] ?? -1);
    if (p < 0) {
      return null;
    }
    lines.unshift(words.slice(p, i).join(' '));
    i = p;
  }

  return { maxLen: finalCost, lines };
}

function wrapLatin(text: string, style: SubtitleStyle): string[] {
  const words = text.split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) {
    return [];
  }

  const single = words.join(' ');
  if (words.length === 1 || totalLength(single) <= style.maxCharsPerLine) {
    return [single];
  }

  const maxLines = Math.max(1, style.maxLines);
  for (let k = 2; k <= maxLines; k++) {
    const partition = bestPartition(words, k);
    if (partition !== null && partition.maxLen <= style.maxCharsPerLine) {
      return partition.lines;
    }
  }

  const fallback = bestPartition(words, maxLines);
  return fallback === null ? [single] : fallback.lines;
}

function wrapCjk(text: string, style: SubtitleStyle): string[] {
  const chars = [...text].filter((ch) => !/\s/.test(ch));
  if (chars.length === 0) {
    return [];
  }

  const maxChars = Math.max(1, style.maxCharsPerLine);
  const maxLines = Math.max(1, style.maxLines);
  if (chars.length <= maxChars) {
    return [chars.join('')];
  }

  const lineCount = Math.min(maxLines, Math.ceil(chars.length / maxChars));
  if (lineCount <= 1) {
    return [chars.join('')];
  }

  const lines: string[] = [];
  let i = 0;
  for (let li = 0; li < lineCount; li++) {
    const remainingLines = lineCount - li;
    const remainingChars = chars.length - i;
    let end: number;

    if (li === lineCount - 1) {
      end = chars.length;
    } else {
      end = Math.min(i + Math.ceil(remainingChars / remainingLines), chars.length);

      let endChar = chars[end - 1];
      while (end - 1 > i && endChar !== undefined && CJK_OPENING.has(endChar)) {
        end--;
        endChar = chars[end - 1];
      }

      while (end < chars.length) {
        const nextChar = chars[end];
        if (nextChar === undefined || !CJK_CLOSING.has(nextChar)) {
          break;
        }
        end++;
      }
    }

    if (end <= i) {
      end = Math.min(i + 1, chars.length);
    }
    lines.push(chars.slice(i, end).join(''));
    i = end;
  }

  return lines;
}

interface Unit {
  text: string;
  cjk: boolean;
}

interface ParsedUnits {
  units: Unit[];
  /** Whether a whitespace run preceded the unit in the source text. */
  spaceBefore: boolean[];
}

/** Split mixed CJK/latin text into atomic units; latin runs stay whole. */
function parseUnits(text: string): ParsedUnits {
  const units: Unit[] = [];
  const spaceBefore: boolean[] = [];
  let pendingSpace = false;
  let latin = '';

  const flushLatin = (): void => {
    if (latin !== '') {
      units.push({ text: latin, cjk: false });
      spaceBefore.push(pendingSpace);
      pendingSpace = false;
      latin = '';
    }
  };

  for (const ch of text) {
    if (/\s/.test(ch)) {
      flushLatin();
      pendingSpace = true;
    } else if (CJK_IDEOGRAPH_RE.test(ch)) {
      flushLatin();
      units.push({ text: ch, cjk: true });
      spaceBefore.push(pendingSpace);
      pendingSpace = false;
    } else {
      latin += ch;
    }
  }
  flushLatin();
  return { units, spaceBefore };
}

function unitWidth(unit: Unit): number {
  return unit.cjk ? 1 : visibleLength(unit.text);
}

/** Rendered width of `units[from..to]`, counting separating spaces. */
function groupWidth(parsed: ParsedUnits, from: number, to: number): number {
  let total = 0;
  for (let i = from; i <= to; i++) {
    if (i > from && parsed.spaceBefore[i] === true) {
      total += 1;
    }
    const unit = parsed.units[i];
    if (unit !== undefined) {
      total += unitWidth(unit);
    }
  }
  return total;
}

function renderGroup(parsed: ParsedUnits, from: number, to: number): string {
  let out = '';
  for (let i = from; i <= to; i++) {
    if (i > from && parsed.spaceBefore[i] === true) {
      out += ' ';
    }
    const unit = parsed.units[i];
    if (unit !== undefined) {
      out += unit.text;
    }
  }
  return out;
}

/** Partition units into exactly `k` lines minimizing the longest width. */
function bestUnitPartition(parsed: ParsedUnits, k: number): string[] | null {
  const n = parsed.units.length;
  if (k <= 0 || n === 0 || k > n) {
    return null;
  }

  const dp: number[][] = Array.from({ length: k + 1 }, () =>
    new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY),
  );
  const choice: number[][] = Array.from({ length: k + 1 }, () =>
    new Array<number>(n + 1).fill(-1),
  );

  const firstRow = dp[0];
  if (firstRow !== undefined) {
    firstRow[0] = 0;
  }

  for (let j = 1; j <= k; j++) {
    for (let i = j; i <= n; i++) {
      let best = Number.POSITIVE_INFINITY;
      let bestPrev = -1;
      for (let p = j - 1; p < i; p++) {
        const prevRow = dp[j - 1];
        const prev = prevRow === undefined ? undefined : prevRow[p];
        if (prev === undefined || !Number.isFinite(prev)) {
          continue;
        }
        const cost = Math.max(prev, groupWidth(parsed, p, i - 1));
        if (cost < best) {
          best = cost;
          bestPrev = p;
        }
      }
      const row = dp[j];
      const choiceRow = choice[j];
      if (row !== undefined) {
        row[i] = best;
      }
      if (choiceRow !== undefined) {
        choiceRow[i] = bestPrev;
      }
    }
  }

  const finalRow = dp[k];
  const finalCost = finalRow === undefined ? undefined : finalRow[n];
  if (finalCost === undefined || !Number.isFinite(finalCost)) {
    return null;
  }

  const lines: string[] = [];
  let i = n;
  for (let j = k; j >= 1; j--) {
    const choiceRow = choice[j];
    const p = choiceRow === undefined ? -1 : (choiceRow[i] ?? -1);
    if (p < 0) {
      return null;
    }
    lines.unshift(renderGroup(parsed, p, i - 1));
    i = p;
  }
  return lines;
}

/**
 * Wrap mixed CJK/latin text without breaking inside latin words. Latin runs
 * are atomic units; lines are balanced by rendered width.
 */
function wrapMixed(text: string, style: SubtitleStyle): string[] {
  const parsed = parseUnits(text);
  const n = parsed.units.length;
  if (n === 0) {
    return [];
  }

  const single = renderGroup(parsed, 0, n - 1);
  if (n === 1 || groupWidth(parsed, 0, n - 1) <= style.maxCharsPerLine) {
    return [single];
  }

  const maxLines = Math.max(1, style.maxLines);
  for (let k = 2; k <= maxLines; k++) {
    const lines = bestUnitPartition(parsed, k);
    if (
      lines !== null &&
      lines.every((line) => totalLength(line) <= style.maxCharsPerLine)
    ) {
      return lines;
    }
  }

  const fallback = bestUnitPartition(parsed, maxLines);
  return fallback === null ? [single] : fallback;
}

/** Wrap normalized text into at most `style.maxLines` display lines. */
export function wrapLines(
  text: string,
  style: SubtitleStyle,
  lang: string,
): string[] {
  const normalized = normalizeWhitespace(text);
  if (normalized === '') {
    return [];
  }

  const script = detectScript(normalized);
  if (script === 'cjk') {
    return wrapCjk(normalized, style);
  }
  if (script === 'mixed' && isCjkLanguage(lang)) {
    return wrapMixed(normalized, style);
  }
  return wrapLatin(normalized, style);
}
