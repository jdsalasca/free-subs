/**
 * Mandarin pinyin annotation.
 *
 * Wraps `pinyin-pro` (native ESM, works under Node 20 without a bundler) to
 * produce tone-marked pinyin while preserving punctuation and leaving
 * non-Chinese text untouched.
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

/** Tone-marked pinyin for `text`; punctuation preserved, non-Chinese as-is. */
export function toPinyin(text: string): string {
  if (text === '') {
    return '';
  }
  // `nonZh: 'consecutive'` keeps Latin words intact instead of spacing out
  // each character; the tidy pass normalises the separators around punctuation.
  return tidyPinyin(pinyin(text, { toneType: 'symbol', nonZh: 'consecutive' }));
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
