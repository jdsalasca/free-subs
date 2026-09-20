/**
 * Lightweight language detection for the ASR output.
 *
 * Whisper already reports a language, but this fallback (or override) keeps
 * the subtitle typography correct when the model is unsure. Any CJK
 * character wins; otherwise we score Spanish and English stopwords.
 */

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;

const SPANISH_STOPWORDS = [
  'el',
  'la',
  'los',
  'las',
  'de',
  'que',
  'y',
  'en',
  'un',
  'una',
  'es',
  'por',
  'con',
  'para',
  'no',
  'se',
  'del',
  'al',
];

const ENGLISH_STOPWORDS = [
  'the',
  'of',
  'and',
  'to',
  'in',
  'is',
  'it',
  'you',
  'that',
  'he',
  'was',
  'for',
  'on',
  'are',
  'as',
  'with',
  'his',
  'they',
];

function countMatches(text: string, words: string[]): number {
  const pattern = new RegExp(`\\b(?:${words.join('|')})\\b`, 'gi');
  return text.match(pattern)?.length ?? 0;
}

/** Detect `'es' | 'en' | 'zh' | 'unknown'` from a transcription string. */
export function detectLanguageFromText(text: string): string {
  if (CJK_RE.test(text)) {
    return 'zh';
  }

  const spanish = countMatches(text, SPANISH_STOPWORDS);
  const english = countMatches(text, ENGLISH_STOPWORDS);

  if (spanish > english) {
    return 'es';
  }
  if (english > spanish) {
    return 'en';
  }
  return 'unknown';
}
