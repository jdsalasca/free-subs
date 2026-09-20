/**
 * Mandarin pinyin annotation.
 *
 * Wraps `pinyin-pro` (native ESM, works under Node 20 without a bundler) to
 * produce tone-marked pinyin while preserving punctuation and leaving
 * non-Chinese text untouched. A right-to-left third-tone sandhi pass is
 * applied within each prosodic group (groups are split on punctuation and
 * whitespace, so the pass never crosses them).
 */
import { pinyin } from 'pinyin-pro';
import type { SubtitleCue } from '../core';

/**
 * Punctuation after which the syllable separator inserted by `pinyin-pro`
 * should be removed: ASCII marks plus common CJK equivalents.
 */
const SPACE_BEFORE_PUNCTUATION =
  /\s+([.,;:!?%)\]}\u3001\u3002\u2026\u2019\u201d\u300b\u300d\u300f\u3011])/gu;

/** Opening punctuation after which the inserted separator should be removed. */
const SPACE_AFTER_OPENING = /([(\[{<])\s+/gu;

/**
 * Split points for prosodic groups: whitespace runs and runs of characters
 * that are neither letters, digits nor spaces (i.e. punctuation/symbols).
 * Captured so the delimiters survive the split.
 */
const PROSODIC_SPLIT = /(\s+|[^\p{L}\p{N}\s]+)/u;

/** Third-tone (caron) spellings → second-tone (acute) spellings. */
const CARON_TO_ACUTE: Record<string, string> = {
  ǎ: 'á',
  ě: 'é',
  ǐ: 'í',
  ǒ: 'ó',
  ǔ: 'ú',
  ǚ: 'ǘ',
};

const THIRD_TONE = /[ǎěǐǒǔǚ]/u;

function toHalfwidthChar(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0x3000) {
    return ' ';
  }
  if (code >= 0xff01 && code <= 0xff5e) {
    return String.fromCharCode(code - 0xfee0);
  }
  return char;
}

function toHalfwidth(text: string): string {
  let out = '';
  for (const char of text) {
    out += toHalfwidthChar(char);
  }
  return out;
}

/** Tidy `pinyin-pro` output: halfwidth punctuation, no stray separators. */
function tidyPinyin(raw: string): string {
  let out = '';
  for (const char of raw) {
    out += toHalfwidthChar(char);
  }
  out = out.replace(SPACE_BEFORE_PUNCTUATION, '$1');
  out = out.replace(SPACE_AFTER_OPENING, '$1');
  return out.replace(/\s+/gu, ' ').trim();
}

function toSecondTone(syllable: string): string {
  return syllable.replace(/[ǎěǐǒǔǚ]/gu, (char) => CARON_TO_ACUTE[char] ?? char);
}

/**
 * Right-to-left third-tone sandhi inside one prosodic group: in every run of
 * consecutive third-tone syllables, all but the last become second tone.
 * (A single third tone is left unchanged and non-tonal tokens break a run.)
 */
function applyThirdToneSandhi(reading: string): string {
  const syllables = reading.split(' ').filter((syllable) => syllable !== '');
  let i = 0;
  while (i < syllables.length) {
    if (!THIRD_TONE.test(syllables[i]!)) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < syllables.length && THIRD_TONE.test(syllables[end]!)) {
      end += 1;
    }
    for (let k = i; k < end - 1; k++) {
      syllables[k] = toSecondTone(syllables[k]!);
    }
    i = end;
  }
  return syllables.join(' ');
}

/** Convert one prosodic group (no internal punctuation/whitespace). */
function convertProsodicGroup(group: string): string {
  if (group === '') {
    return '';
  }
  const reading = pinyin(group, { toneType: 'symbol', nonZh: 'consecutive' });
  return tidyPinyin(applyThirdToneSandhi(reading));
}

/** Tone-marked pinyin for `text`; punctuation preserved, non-Chinese as-is. */
export function toPinyin(text: string): string {
  if (text === '') {
    return '';
  }
  const parts = text.split(PROSODIC_SPLIT);
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (i % 2 === 1) {
      // Delimiter: keep whitespace as a single space, pad punctuation so the
      // final tidy pass can normalise spacing exactly as before.
      out += /^\s+$/u.test(part) ? ' ' : ` ${toHalfwidth(part)} `;
    } else {
      out += convertProsodicGroup(part);
    }
  }
  return tidyPinyin(out);
}

/** One pinyin string per word, aligned by index with the input words. */
export function pinyinForWords(words: Array<{ text: string }>): string[] {
  return words.map((word) => toPinyin(word.text));
}

/**
 * Return new cues with `pinyin` set from the cue lines. Inputs are never
 * mutated and the existing `words` timings are kept untouched.
 */
export function annotateCuesWithPinyin(cues: SubtitleCue[]): SubtitleCue[] {
  return cues.map((cue) => ({
    ...cue,
    pinyin: toPinyin(cue.lines.join(' ')),
  }));
}
