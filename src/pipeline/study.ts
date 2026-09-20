/**
 * Stable "study" document model.
 *
 * The exported JSON is a frozen contract consumed by study tools: every cue
 * is a flat `{ startMs, endMs, lines, words, pinyin? }` object, `words` is
 * always an array, `pinyin` only appears for Chinese (`zh*`) content and
 * `ipa` only for English/Spanish (`en*`/`es*`) content.
 */
import type { SubtitleCue, WordTiming } from '../core';
import { toIpa } from './ipa';
import { toPinyin } from './pinyin';

export interface StudyWord {
  text: string;
  startMs: number;
  endMs: number;
  pinyin?: string;
}

export interface StudyCue {
  startMs: number;
  endMs: number;
  lines: string[];
  words: StudyWord[];
  pinyin?: string;
  ipa?: string;
}

export interface StudyTranslation {
  cues: StudyCue[];
}

export interface StudyDocument {
  version: 1;
  language: string;
  durationMs: number;
  cues: StudyCue[];
  translations: Record<string, StudyTranslation>;
}

export interface BuildStudyDocumentInput {
  language: string;
  durationMs: number;
  cues: SubtitleCue[];
  translations?: Record<string, SubtitleCue[]>;
}

function isChinese(language: string): boolean {
  return language.toLowerCase().startsWith('zh');
}

function hasIpa(language: string): boolean {
  const lower = language.toLowerCase();
  return lower.startsWith('en') || lower.startsWith('es');
}

function buildStudyWord(word: WordTiming, chinese: boolean): StudyWord {
  const result: StudyWord = {
    text: word.text,
    startMs: word.startMs,
    endMs: word.endMs,
  };
  if (chinese) {
    result.pinyin = toPinyin(word.text);
  }
  return result;
}

function buildStudyCue(cue: SubtitleCue, language: string): StudyCue {
  const chinese = isChinese(language);
  const words = (cue.words ?? []).map((word) => buildStudyWord(word, chinese));
  const result: StudyCue = {
    startMs: cue.startMs,
    endMs: cue.endMs,
    lines: [...cue.lines],
    words,
  };
  if (chinese) {
    result.pinyin = toPinyin(cue.lines.join(' '));
  } else if (hasIpa(language)) {
    result.ipa = cue.ipa ?? toIpa(cue.lines.join(' '), language);
  }
  return result;
}

/** Build a deterministic study document from cues and optional translations. */
export function buildStudyDocument(input: BuildStudyDocumentInput): StudyDocument {
  const cues = input.cues.map((cue) => buildStudyCue(cue, input.language));

  const translations: Record<string, StudyTranslation> = {};
  const provided = input.translations ?? {};
  for (const language of Object.keys(provided)) {
    translations[language] = {
      cues: (provided[language] ?? []).map((cue) => buildStudyCue(cue, language)),
    };
  }

  return {
    version: 1,
    language: input.language,
    durationMs: input.durationMs,
    cues,
    translations,
  };
}

/** Serialize a study document as pretty JSON with a trailing newline. */
export function serializeStudy(doc: StudyDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
