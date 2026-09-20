/**
 * Mandarin text normalisation.
 *
 * Traditional characters are converted to simplified with OpenCC (`opencc-js`,
 * which works as a native ESM package under Node 20), fullwidth ASCII is
 * mapped back to halfwidth, and whitespace between CJK characters is removed.
 */
import { Converter } from 'opencc-js';

const CONVERTER = Converter({ from: 't', to: 'cn' });

/** Han ideographs (CJK Unified Ideographs + Extension A). */
const CJK_CLASS = '[\\u3400-\\u4dbf\\u4e00-\\u9fff]';
const CJK_SPACE_RE = new RegExp(`(?<=${CJK_CLASS})\\s+(?=${CJK_CLASS})`, 'g');
/** Whitespace, punctuation and symbols, used for compact BoH matching. */
const NOISE_RE = /[\s\p{P}\p{S}]+/gu;

/** Boilerplate/hallucination phrases, stored in simplified form. */
const BOH_ZH = [
  '谢谢观看',
  '感谢观看',
  '感谢收看',
  '谢谢大家观看',
  '请订阅',
  '请订阅频道',
  '订阅频道',
  '请点赞',
  '请关注',
  '字幕由',
  '字幕组',
  '字幕志愿者',
  '翻译由',
];

function toHalfwidth(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x3000) {
      out += ' ';
    } else if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
    } else {
      out += ch;
    }
  }
  return out;
}

function compact(text: string): string {
  return text
    .replace(NOISE_RE, '')
    .split('')
    .filter((ch) => ch !== '')
    .join('');
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

/** Traditional → simplified, halfwidth, no CJK spacing, trimmed. */
export function normalizeChineseText(text: string): string {
  if (text === '') {
    return '';
  }
  let out = CONVERTER(text);
  out = toHalfwidth(out);
  out = out.replace(CJK_SPACE_RE, '');
  return out.replace(/\s+/g, ' ').trim();
}

/** Whether text is Chinese boilerplate or a degenerate repetition loop. */
export function isChineseHallucination(text: string): boolean {
  if (text.trim() === '') {
    return false;
  }

  const simplified = normalizeChineseText(text);
  const cleaned = compact(simplified);
  if (cleaned === '') {
    return false;
  }

  if (hasRepeatedLoop(cleaned)) {
    return true;
  }

  // Remove every known BoH phrase; a near-empty remainder means the whole
  // segment was boilerplate.
  let remainder = cleaned;
  for (const phrase of BOH_ZH) {
    const target = compact(phrase);
    if (target !== '') {
      remainder = remainder.split(target).join('');
    }
  }
  if (remainder.length <= 1) {
    return true;
  }

  // Otherwise require a substantial overlap with a BoH phrase.
  for (const phrase of BOH_ZH) {
    const target = compact(phrase);
    if (target !== '' && cleaned.includes(target) && target.length >= cleaned.length * 0.5) {
      return true;
    }
    if (target !== '' && cleaned.startsWith(target)) {
      return true;
    }
  }

  return false;
}
