/**
 * Text utilities: language detection, script detection and normalization.
 *
 * The rules follow common subtitle conventions (space-less CJK, normalized
 * quotes, collapsed whitespace). All functions are pure.
 */
import { CJK_STYLE, DEFAULT_STYLE, type SubtitleStyle } from './types';

/** Han ideographs (CJK Unified Ideographs + Extension A). */
const CJK_IDEOGRAPH_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;
/** Any letter from the Latin script, including accents (á, ñ, ü, ...). */
const LATIN_LETTER_RE = /\p{Script=Latin}/u;
/** Invisible / zero-width formatting characters. */
const ZERO_WIDTH_RE = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;
/** Closing characters that stay attached to the sentence before them. */
const CLOSING_CHARS = new Set([
  '"',
  "'",
  ')',
  ']',
  '}',
  '”',
  '’',
  '」',
  '』',
  '）',
  '】',
  '》',
]);
/** Full-width CJK terminators: unambiguous, never need a following space. */
const CJK_TERMINATORS = new Set(['。', '！', '？', '；']);
/** Latin terminators, which need a following space (or end of text). */
const LATIN_TERMINATORS = new Set(['.', '!', '?', ';', '…']);
/**
 * Latin titles/abbreviations whose trailing dot is not a sentence boundary.
 * Stored lower-case and without the dot.
 */
const ABBREVIATIONS = new Set([
  'sr',
  'sra',
  'srta',
  'dr',
  'dra',
  'mr',
  'mrs',
  'ms',
  'prof',
  'st',
]);
/**
 * Grapheme segmenter (Node 20+): keeps combining marks and emoji sequences
 * counted once. `null` when the runtime lacks `Intl.Segmenter`.
 */
const GRAPHEME_SEGMENTER: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** Whether a language code refers to a CJK script (zh*, cmn, ja*, ko*). */
export function isCjkLanguage(lang: string): boolean {
  const lower = lang.trim().toLowerCase();
  return (
    lower.startsWith('zh') ||
    lower.startsWith('cmn') ||
    lower.startsWith('ja') ||
    lower.startsWith('ko')
  );
}

/** Pick the typography rules that match a language. */
export function styleForLanguage(lang: string): SubtitleStyle {
  return isCjkLanguage(lang) ? CJK_STYLE : DEFAULT_STYLE;
}

/** Detect whether text is mostly latin, mostly CJK or genuinely mixed. */
export function detectScript(text: string): 'latin' | 'cjk' | 'mixed' {
  let cjk = 0;
  let latin = 0;
  for (const ch of text) {
    if (CJK_IDEOGRAPH_RE.test(ch)) {
      cjk++;
    } else if (LATIN_LETTER_RE.test(ch)) {
      latin++;
    }
  }

  if (cjk === 0 && latin === 0) {
    return 'latin';
  }
  if (cjk === 0) {
    return 'latin';
  }
  if (latin === 0) {
    return 'cjk';
  }

  const total = cjk + latin;
  if (cjk / total < 0.15) {
    return 'latin';
  }
  if (latin / total < 0.15) {
    return 'cjk';
  }
  return 'mixed';
}

/** Collapse every whitespace run into a single space and trim the result. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Normalize text for display: quotes, zero-width chars, CJK spacing, trim. */
export function normalizeForSubtitles(text: string, lang: string): string {
  let out = text.replace(ZERO_WIDTH_RE, '');
  out = out.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  out = normalizeWhitespace(out);
  out = out.replace(
    /(?<=[\u3400-\u4dbf\u4e00-\u9fff])\s+(?=[\u3400-\u4dbf\u4e00-\u9fff])/g,
    '',
  );
  return out;
}

/**
 * Number of visible characters (grapheme clusters). Combining marks and
 * zero-width-joiner emoji sequences count as a single character.
 */
export function visibleLength(text: string): number {
  if (GRAPHEME_SEGMENTER !== null) {
    let count = 0;
    for (const { segment } of GRAPHEME_SEGMENTER.segment(text)) {
      if (!/\s/u.test(segment)) {
        count++;
      }
    }
    return count;
  }

  // Fallback: skip whitespace and combining marks (no full emoji clustering).
  let count = 0;
  for (const ch of text) {
    if (!/\s/u.test(ch) && !/\p{M}/u.test(ch)) {
      count++;
    }
  }
  return count;
}

/** Whether the `.` at `dotIndex` closes a known title/abbreviation. */
function isAbbreviationDot(text: string, dotIndex: number): boolean {
  let start = dotIndex;
  while (start > 0) {
    const prev = text[start - 1];
    if (prev !== undefined && /[A-Za-z\u00c0-\u024f]/.test(prev)) {
      start--;
    } else {
      break;
    }
  }
  if (start === dotIndex) {
    return false;
  }
  return ABBREVIATIONS.has(text.slice(start, dotIndex).toLowerCase());
}

/**
 * Split text into sentences. Punctuation stays attached; decimals like
 * `3.14` and titles like `Sr.`/`Mr.` are never treated as boundaries.
 */
export function splitSentences(text: string, lang: string): string[] {
  const normalized = normalizeWhitespace(text);
  if (normalized === '') {
    return [];
  }

  const sentences: string[] = [];
  const length = normalized.length;
  let start = 0;
  let i = 0;

  while (i < length) {
    const ch = normalized[i];
    if (ch === undefined) {
      break;
    }
    const isCjkTerminator = CJK_TERMINATORS.has(ch);
    const isLatinTerminator = LATIN_TERMINATORS.has(ch);

    if (isCjkTerminator || isLatinTerminator) {
      if (ch === '.') {
        const next = normalized[i + 1];
        if (next !== undefined && /\d/.test(next)) {
          i++;
          continue;
        }
        if (isAbbreviationDot(normalized, i)) {
          i++;
          continue;
        }
      }

      let end = i + 1;
      while (end < length) {
        const closer = normalized[end];
        if (closer !== undefined && CLOSING_CHARS.has(closer)) {
          end++;
        } else {
          break;
        }
      }

      const after = end < length ? normalized[end] : undefined;
      const boundaryOk = isCjkTerminator
        ? true
        : after === undefined || after === ' ';

      if (boundaryOk) {
        const sentence = normalized.slice(start, end).trim();
        if (sentence !== '') {
          sentences.push(sentence);
        }
        start = end;
        i = end;
        continue;
      }
    }
    i++;
  }

  const rest = normalized.slice(start).trim();
  if (rest !== '') {
    sentences.push(rest);
  }
  return sentences;
}

/**
 * Tokenize text for word-level timing.
 * Latin: whitespace-delimited words. CJK: one token per ideograph, while
 * latin runs inside CJK text stay whole words.
 */
export function tokenize(text: string, lang: string): string[] {
  if (text.trim() === '') {
    return [];
  }

  if (isCjkLanguage(lang) || detectScript(text) === 'cjk') {
    const tokens: string[] = [];
    let buffer = '';
    for (const ch of text) {
      if (/\s/.test(ch)) {
        if (buffer !== '') {
          tokens.push(buffer);
          buffer = '';
        }
        continue;
      }
      if (CJK_IDEOGRAPH_RE.test(ch)) {
        if (buffer !== '') {
          tokens.push(buffer);
          buffer = '';
        }
        tokens.push(ch);
      } else {
        buffer += ch;
      }
    }
    if (buffer !== '') {
      tokens.push(buffer);
    }
    return tokens;
  }

  return text.split(/\s+/).filter((token) => token !== '');
}
