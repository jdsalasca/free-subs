/**
 * Stable "study" document model.
 *
 * The exported JSON is a frozen contract consumed by study tools: every cue
 * is a flat `{ startMs, endMs, lines, words, pinyin? }` object, `words` is
 * always an array, and `pinyin` only appears for Chinese (`zh*`) content.
 */
import type { SubtitleCue, WordTiming } from '../core';
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

function buildStudyCue(cue: SubtitleCue, chinese: boolean): StudyCue {
  const words = (cue.words ?? []).map((word) => buildStudyWord(word, chinese));
  const result: StudyCue = {
    startMs: cue.startMs,
    endMs: cue.endMs,
    lines: [...cue.lines],
    words,
  };
  if (chinese) {
    result.pinyin = toPinyin(cue.lines.join(' '));
  }
  return result;
}

/** Build a deterministic study document from cues and optional translations. */
export function buildStudyDocument(input: BuildStudyDocumentInput): StudyDocument {
  const documentChinese = isChinese(input.language);
  const cues = input.cues.map((cue) => buildStudyCue(cue, documentChinese));

  const translations: Record<string, StudyTranslation> = {};
  const provided = input.translations ?? {};
  for (const language of Object.keys(provided)) {
    const translationChinese = isChinese(language);
    translations[language] = {
      cues: (provided[language] ?? []).map((cue) => buildStudyCue(cue, translationChinese)),
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
