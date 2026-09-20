/**
 * Transcription orchestration: audio → speech regions → ASR → cues → SRT/VTT.
 */
import {
  computeCps,
  segmentsToCues,
  serializeSrt,
  serializeVtt,
  styleForLanguage,
  tokenize,
  type JobProgress,
  type LanguageCode,
  type ModelId,
  type SubtitleCue,
  type SubtitleStats,
  type SubtitleStyle,
  type TranscriptSegment,
  type TranscriptionResult,
} from '../core';
import { loadAudioFile } from './audio';
import { TransformersWhisperEngine } from './engine-transformers';
import { detectLanguageFromText } from './language';
import type { AsrEngine } from './asr';
import { trimToSpeech } from './vad';

export interface TranscribeOptions {
  language?: LanguageCode;
  model?: ModelId;
  style?: SubtitleStyle;
  engine?: AsrEngine;
  onProgress?: (progress: JobProgress) => void;
}

function countWords(segments: TranscriptSegment[], language: string): number {
  let words = 0;
  for (const segment of segments) {
    if (segment.words !== undefined && segment.words.length > 0) {
      words += segment.words.length;
    } else {
      words += tokenize(segment.text, language).length;
    }
  }
  return words;
}

function computeStats(
  cues: SubtitleCue[],
  segments: TranscriptSegment[],
  language: string,
  durationMs: number,
): SubtitleStats {
  if (cues.length === 0) {
    return { cueCount: 0, wordCount: countWords(segments, language), avgCps: 0, maxCps: 0, durationMs };
  }

  let totalCps = 0;
  let maxCps = 0;
  for (const cue of cues) {
    const cps = computeCps(cue);
    totalCps += cps;
    if (cps > maxCps) {
      maxCps = cps;
    }
  }

  return {
    cueCount: cues.length,
    wordCount: countWords(segments, language),
    avgCps: totalCps / cues.length,
    maxCps,
    durationMs,
  };
}

/** Transcribe an audio file end-to-end and return subtitles plus statistics. */
export async function transcribeFile(
  path: string,
  filename: string,
  opts: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const report = (stage: JobProgress['stage'], percent: number): void => {
    opts.onProgress?.({ stage, percent });
  };

  report('decoding', 5);
  const audio = await loadAudioFile(path);
  report('decoding', 15);

  report('analyzing', 15);
  const speech = trimToSpeech(audio.samples, audio.sampleRate);
  report('analyzing', 25);

  const engine = opts.engine ?? new TransformersWhisperEngine();
  const requested: LanguageCode = opts.language ?? 'auto';

  const asr = await engine.transcribe(speech, audio.sampleRate, {
    language: requested,
    model: opts.model,
    onProgress: (percent, stage) => {
      const clamped = Math.max(0, Math.min(100, percent));
      const mapped = Math.round(25 + (clamped / 100) * 60);
      report(stage === 'loading-model' ? 'loading-model' : 'transcribing', mapped);
    },
  });

  const joined = asr.segments.map((segment) => segment.text).join(' ');
  const language =
    requested !== 'auto'
      ? requested
      : asr.language !== '' && asr.language !== 'unknown'
        ? asr.language
        : detectLanguageFromText(joined);

  const style = opts.style ?? styleForLanguage(language);
  report('formatting', 85);
  const cues = segmentsToCues(asr.segments, style, language);
  const srt = serializeSrt(cues);
  const vtt = serializeVtt(cues);
  report('formatting', 95);

  const stats = computeStats(cues, asr.segments, language, audio.durationMs);
  report('done', 100);

  // `filename` is part of the public contract (used by callers for headers).
  void filename;

  return {
    language,
    durationMs: audio.durationMs,
    segments: asr.segments,
    cues,
    srt,
    vtt,
    stats,
  };
}
