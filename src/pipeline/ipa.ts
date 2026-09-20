/**
 * IPA (International Phonetic Alphabet) annotation for subtitle cues.
 *
 * English uses CMUdict (ARPAbet) with an ARPAbet→IPA mapping and stress
 * marks. Spanish uses a small ordered rule-based G2P plus the standard
 * stress-placement rules (written accent wins; otherwise penultimate for
 * vowel/n/s-final words, final otherwise). Mandarin is intentionally not
 * handled here (it exposes `pinyin` instead).
 *
 * Everything is offline and deterministic: no neural G2P or forced alignment.
 */
import { dictionary } from 'cmu-pronouncing-dictionary';
import type { SubtitleCue } from '../core';

/** True for English language tags (`en`, `en-US`, ...). */
function isEnglish(language: string): boolean {
  return language.toLowerCase().startsWith('en');
}

/** True for Spanish language tags (`es`, `es-MX`, ...). */
function isSpanish(language: string): boolean {
  return language.toLowerCase().startsWith('es');
}

// ---------------------------------------------------------------------------
// English — CMUdict / ARPAbet
// ---------------------------------------------------------------------------

/** ARPAbet consonant bases → IPA. */
const ARPABET_CONSONANTS: Record<string, string> = {
  B: 'b',
  CH: 'tʃ',
  D: 'd',
  DH: 'ð',
  F: 'f',
  G: 'ɡ',
  HH: 'h',
  JH: 'dʒ',
  K: 'k',
  L: 'l',
  M: 'm',
  N: 'n',
  NG: 'ŋ',
  P: 'p',
  R: 'ɹ',
  S: 's',
  SH: 'ʃ',
  T: 't',
  TH: 'θ',
  V: 'v',
  W: 'w',
  Y: 'j',
  Z: 'z',
  ZH: 'ʒ',
};

/** ARPAbet vowel bases → IPA (stress-independent). */
const ARPABET_VOWELS: Record<string, string> = {
  AA: 'ɑ',
  AE: 'æ',
  AO: 'ɔ',
  AW: 'aʊ',
  AY: 'aɪ',
  EH: 'ɛ',
  EY: 'eɪ',
  IH: 'ɪ',
  IY: 'i',
  OW: 'oʊ',
  OY: 'ɔɪ',
  UH: 'ʊ',
  UW: 'u',
};

const ARPABET_VOWEL_BASES = new Set([
  ...Object.keys(ARPABET_VOWELS),
  'AH',
  'ER',
]);

interface Phoneme {
  ipa: string;
  vowel: boolean;
  stress: 0 | 1 | 2;
}

function parsePhoneme(raw: string): Phoneme {
  const match = /^([A-Z]+)([0-2])?$/.exec(raw);
  if (match === null) {
    return { ipa: raw.toLowerCase(), vowel: false, stress: 0 };
  }
  const base = match[1]!;
  const stress = (match[2] === undefined ? 0 : Number(match[2])) as 0 | 1 | 2;
  const vowel = ARPABET_VOWEL_BASES.has(base);

  let ipa: string;
  if (base === 'AH') {
    // Schwa when unstressed, open-mid back when stressed.
    ipa = stress === 0 ? 'ə' : 'ʌ';
  } else if (base === 'ER') {
    ipa = stress === 0 ? 'ɚ' : 'ɝ';
  } else if (vowel) {
    ipa = ARPABET_VOWELS[base]!;
  } else {
    ipa = ARPABET_CONSONANTS[base] ?? base.toLowerCase();
  }

  return { ipa, vowel, stress };
}

/**
 * Whether a consonant run may legally open an English syllable (maximal
 * onset, so `computer` → `kəmˈpjutɚ` with `pj` as the onset and `m` a coda).
 */
function isValidEnglishOnset(suffix: string[]): boolean {
  if (suffix.length === 1) {
    return suffix[0] !== 'ŋ';
  }
  if (suffix.length === 2) {
    const [first, second] = suffix as [string, string];
    if (first === 's') {
      return ['p', 't', 'k', 'm', 'n', 'f', 'l', 'w', 'j'].includes(second);
    }
    return (
      ['l', 'r', 'w', 'j'].includes(second) &&
      !['ŋ', 'l', 'r', 'w', 'j', 's'].includes(first)
    );
  }
  if (suffix.length === 3) {
    const [first, second, third] = suffix as [string, string, string];
    return first === 's' && ['p', 't', 'k'].includes(second) && ['l', 'r', 'w', 'j'].includes(third);
  }
  return false;
}

/** First phoneme of the syllable that owns the stressed vowel (maximal onset). */
function englishOnsetStart(entries: Phoneme[], stressed: number): number {
  let previousVowel = -1;
  for (let i = stressed - 1; i >= 0; i--) {
    if (entries[i]!.vowel) {
      previousVowel = i;
      break;
    }
  }
  if (previousVowel < 0) {
    // Word-initial syllable: every leading consonant is its onset.
    return 0;
  }

  const cluster: string[] = [];
  for (let i = previousVowel + 1; i < stressed; i++) {
    cluster.push(entries[i]!.ipa);
  }
  for (let length = Math.min(3, cluster.length); length >= 1; length--) {
    if (isValidEnglishOnset(cluster.slice(cluster.length - length))) {
      return stressed - length;
    }
  }
  return stressed;
}

/**
 * Map a CMUdict ARPAbet pronunciation to IPA. Stress marks are inserted
 * before the onset of the syllable that owns the stressed vowel (matching
 * `world` → `ˈwɝld` and `computer` → `kəmˈpjutɚ`).
 */
function arpabetToIpa(pronunciation: string): string {
  const entries = pronunciation
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '')
    .map(parsePhoneme);

  const marks = new Map<number, string>();
  entries.forEach((entry, index) => {
    if (!entry.vowel || entry.stress === 0) {
      return;
    }
    marks.set(englishOnsetStart(entries, index), entry.stress === 1 ? 'ˈ' : 'ˌ');
  });

  let out = '';
  entries.forEach((entry, index) => {
    const mark = marks.get(index);
    if (mark !== undefined) {
      out += mark;
    }
    out += entry.ipa;
  });
  return out;
}

/**
 * English IPA for one word, or `null` when it is absent from CMUdict (the
 * caller then keeps the original word unchanged).
 *
 * Homographs use the first CMUdict variant (e.g. `read` → `ˈɹɛd`, not `ˈɹid`).
 */
function englishWord(word: string): string | null {
  const pronunciation = dictionary[word.toLowerCase()];
  if (pronunciation === undefined) {
    return null;
  }
  return arpabetToIpa(pronunciation);
}

// ---------------------------------------------------------------------------
// Spanish — ordered rule-based G2P
// ---------------------------------------------------------------------------

interface SpanishEntry {
  kind: 'vowel' | 'consonant';
  ipa: string;
  accent: boolean;
  glide: boolean;
}

const SPANISH_VOWELS: Record<string, string> = {
  a: 'a',
  e: 'e',
  i: 'i',
  o: 'o',
  u: 'u',
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ú: 'u',
  ü: 'u',
};

const ACCENTED_VOWELS = new Set(['á', 'é', 'í', 'ó', 'ú']);

/** Single-letter Spanish consonants → IPA (r is a tap; rr becomes a trill). */
const SPANISH_CONSONANTS: Record<string, string> = {
  b: 'b',
  c: 'k',
  d: 'd',
  f: 'f',
  g: 'g',
  j: 'x',
  k: 'k',
  l: 'l',
  m: 'm',
  n: 'n',
  ñ: 'ɲ',
  p: 'p',
  q: 'k',
  r: 'ɾ',
  s: 's',
  t: 't',
  w: 'w',
  z: 's',
};

const GLIDES = new Set(['i', 'u', 'ü']);

function consonant(ipa: string): SpanishEntry {
  return { kind: 'consonant', ipa, accent: false, glide: false };
}

function isVowelChar(char: string): boolean {
  return SPANISH_VOWELS[char] !== undefined;
}

/**
 * Ordered Spanish grapheme→phoneme rules. Digraph rules are tried before
 * single letters, mirroring the spec order (`qu`, `gu(e|i)`, `g(e|i)`,
 * `c(e|i)`, `z`, `ll`, `rr`, `ch`, `ñ`, `h`, `v`, `y`, `x`).
 */
function spanishPhonemes(word: string): SpanishEntry[] {
  const lower = word.toLowerCase();
  const entries: SpanishEntry[] = [];
  let i = 0;

  while (i < lower.length) {
    const char = lower[i]!;
    const next = lower[i + 1] ?? '';
    const afterNext = lower[i + 2] ?? '';

    if (char === 'q' && next === 'u') {
      entries.push(consonant('k'));
      i += 2;
      continue;
    }
    if (char === 'g' && next === 'u' && (afterNext === 'e' || afterNext === 'i')) {
      entries.push(consonant('g'));
      i += 2;
      continue;
    }
    if (char === 'g' && (next === 'e' || next === 'i')) {
      entries.push(consonant('x'));
      i += 1;
      continue;
    }
    if (char === 'c' && (next === 'e' || next === 'i')) {
      entries.push(consonant('s'));
      i += 1;
      continue;
    }
    if (char === 'l' && next === 'l') {
      entries.push(consonant('ʝ'));
      i += 2;
      continue;
    }
    if (char === 'r' && next === 'r') {
      entries.push(consonant('r'));
      i += 2;
      continue;
    }
    if (char === 'c' && next === 'h') {
      entries.push(consonant('tʃ'));
      i += 2;
      continue;
    }
    if (char === 'ñ') {
      entries.push(consonant('ɲ'));
      i += 1;
      continue;
    }
    if (char === 'z') {
      entries.push(consonant('s'));
      i += 1;
      continue;
    }
    if (char === 'h') {
      // Silent h.
      entries.push(consonant(''));
      i += 1;
      continue;
    }
    if (char === 'v') {
      entries.push(consonant('b'));
      i += 1;
      continue;
    }
    if (char === 'x') {
      entries.push(consonant('ks'));
      i += 1;
      continue;
    }
    if (char === 'y') {
      // Onset before a vowel → ʝ, otherwise a coda semivowel [i].
      entries.push(consonant(isVowelChar(next) ? 'ʝ' : 'i'));
      i += 1;
      continue;
    }
    if (char === 'r') {
      // Word-initial (and post n/l/s) r is a trill; otherwise a tap.
      const previous = entries[entries.length - 1];
      const trill =
        i === 0 ||
        (previous !== undefined &&
          previous.kind === 'consonant' &&
          ['n', 'l', 's'].includes(previous.ipa));
      entries.push(consonant(trill ? 'r' : 'ɾ'));
      i += 1;
      continue;
    }

    const vowel = SPANISH_VOWELS[char];
    if (vowel !== undefined) {
      entries.push({
        kind: 'vowel',
        ipa: vowel,
        accent: ACCENTED_VOWELS.has(char),
        glide: GLIDES.has(char),
      });
      i += 1;
      continue;
    }

    entries.push(consonant(SPANISH_CONSONANTS[char] ?? char));
    i += 1;
  }

  return entries;
}

/** Voiced stops spirantise between vowels (b→β, d→ð, g→ɣ). */
function spirantise(entries: SpanishEntry[]): void {
  for (let i = 1; i < entries.length - 1; i++) {
    const entry = entries[i]!;
    if (
      entry.kind !== 'consonant' ||
      entries[i - 1]!.kind !== 'vowel' ||
      entries[i + 1]!.kind !== 'vowel'
    ) {
      continue;
    }
    if (entry.ipa === 'b') {
      entry.ipa = 'β';
    } else if (entry.ipa === 'd') {
      entry.ipa = 'ð';
    } else if (entry.ipa === 'g') {
      entry.ipa = 'ɣ';
    }
  }
}

const ONSET_LIQUIDS = new Set(['l', 'r']);
const ONSET_STOPS = new Set(['b', 'c', 'd', 'f', 'g', 'k', 'p', 't']);
const S_ONSETS = new Set(['p', 't', 'k']);

/** Whether two consonants may legally open a Spanish syllable together. */
function isValidOnsetPair(first: string, second: string): boolean {
  if (ONSET_LIQUIDS.has(second) && ONSET_STOPS.has(first)) {
    return true;
  }
  return first === 's' && S_ONSETS.has(second);
}

/**
 * Index of the first phoneme of the stressed syllable: the onset consonants
 * (plus any preceding glide belonging to the diphthong) after the previous
 * vowel, or 0 for a word-initial syllable.
 */
function onsetStart(entries: SpanishEntry[], stressed: number): number {
  let start = stressed;
  while (start - 1 >= 0 && entries[start - 1]!.kind === 'vowel' && entries[start - 1]!.glide) {
    start -= 1;
  }

  let previousVowel = -1;
  for (let i = start - 1; i >= 0; i--) {
    if (entries[i]!.kind === 'vowel') {
      previousVowel = i;
      break;
    }
  }
  if (previousVowel < 0) {
    return 0;
  }

  let trailingConsonants = 0;
  for (let i = start - 1; i > previousVowel; i--) {
    if (entries[i]!.kind === 'consonant') {
      trailingConsonants += 1;
    } else {
      break;
    }
  }

  if (trailingConsonants >= 2) {
    const first = entries[start - 2]!;
    const second = entries[start - 1]!;
    return isValidOnsetPair(first.ipa, second.ipa) ? start - 2 : start - 1;
  }
  if (trailingConsonants === 1) {
    return start - 1;
  }
  return start;
}

/** Unstressed high vowels next to a non-high vowel become glides (i→j, u→w). */
function glidise(entries: SpanishEntry[], stressed: number): void {
  entries.forEach((entry, index) => {
    if (entry.kind !== 'vowel' || !entry.glide || index === stressed) {
      return;
    }
    const touchesNonHigh = [entries[index - 1], entries[index + 1]].some(
      (neighbour) => neighbour !== undefined && neighbour.kind === 'vowel' && !neighbour.glide,
    );
    if (!touchesNonHigh) {
      return;
    }
    if (entry.ipa === 'i') {
      entry.ipa = 'j';
    } else if (entry.ipa === 'u') {
      entry.ipa = 'w';
    }
  });
}

/**
 * Rule-based Spanish IPA for one word. Written accents win; otherwise vowel/
 * n/s-final words stress the penultimate syllable, everything else the last.
 */
function spanishWord(word: string): string {
  const entries = spanishPhonemes(word);
  spirantise(entries);

  const vowelIndexes: number[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind === 'vowel') {
      vowelIndexes.push(index);
    }
  });
  if (vowelIndexes.length === 0) {
    return entries.map((entry) => entry.ipa).join('');
  }

  const writtenAccent = vowelIndexes.find((index) => entries[index]!.accent);
  let stressed: number;
  if (writtenAccent !== undefined) {
    stressed = writtenAccent;
  } else {
    const last = word[word.length - 1] ?? '';
    const endsInVowelOrNS = 'aeioun'.includes(last) || ACCENTED_VOWELS.has(last);
    stressed = endsInVowelOrNS
      ? vowelIndexes[Math.max(0, vowelIndexes.length - 2)]!
      : vowelIndexes[vowelIndexes.length - 1]!;
  }

  glidise(entries, stressed);

  const markAt = onsetStart(entries, stressed);
  let out = '';
  entries.forEach((entry, index) => {
    if (index === markAt) {
      out += 'ˈ';
    }
    out += entry.ipa;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** A whitespace-delimited chunk with any surrounding punctuation split off. */
const WORD_PATTERN = /^([^\p{L}]*)([\p{L}][\p{L}'\u2019]*)([^\p{L}]*)$/u;

function convertWords(text: string, convert: (word: string) => string | null): string {
  return text
    .split(/(\s+)/u)
    .map((chunk) => {
      if (chunk === '' || /^\s+$/u.test(chunk)) {
        return chunk;
      }
      const match = WORD_PATTERN.exec(chunk);
      if (match === null) {
        return chunk;
      }
      const [, prefix, core, suffix] = match;
      const ipa = convert(core!);
      if (ipa === null) {
        return chunk;
      }
      return `${prefix}${ipa}${suffix}`;
    })
    .join('');
}

/**
 * IPA for `text` in `lang`. Words are mapped individually and joined with the
 * original spacing; punctuation is preserved in place. `en*` uses CMUdict,
 * `es*` the rule-based G2P. Unknown English words and unsupported languages
 * are returned unchanged (documented fallback); empty input → empty string.
 */
export function toIpa(text: string, lang: string): string {
  if (text === '') {
    return '';
  }
  if (isEnglish(lang)) {
    return convertWords(text, englishWord);
  }
  if (isSpanish(lang)) {
    return convertWords(text, spanishWord);
  }
  return text;
}

/**
 * Return new cues with `ipa` set from the cue lines. Inputs are never
 * mutated and the existing `words` timings are kept untouched.
 */
export function annotateCuesWithIpa(cues: SubtitleCue[], lang: string): SubtitleCue[] {
  return cues.map((cue) => ({
    ...cue,
    ipa: toIpa(cue.lines.join(' '), lang),
  }));
}
