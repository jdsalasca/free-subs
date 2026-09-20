/**
 * Transcription orchestration: audio → loudness → speech regions → optional
 * denoise → ASR → post-processing → cues → SRT/VTT.
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
import { estimateSnrDb, spectralDenoise } from './denoise';
import { TransformersWhisperEngine } from './engine-transformers';
import { highPass } from './filters';
import { detectLanguageFromText } from './language';
import { annotateCuesWithIpa } from './ipa';
import { normalizeLoudness } from './loudness';
import { annotateCuesWithPinyin } from './pinyin';
import { normalizeSegments } from './postprocess';
import type { AsrEngine } from './asr';
import { detectSpeechRegions, trimToSpeech } from './vad';
import { isolateCenterChannel } from './vocals';
import { normalizeChineseText } from './zh';

export interface TranscribeOptions {
  language?: LanguageCode;
  model?: ModelId;
  style?: SubtitleStyle;
  engine?: AsrEngine;
  /** Isolate the centre channel (vocals) and high-pass the audio for music. */
  isolateVocals?: boolean;
  onProgress?: (progress: JobProgress) => void;
}

/** SNR below which denoising is attempted (dB). */
const DENOISE_SNR_THRESHOLD_DB = 10;

/** Rumble/bass cutoff applied to the vocal signal before ASR (Hz). */
const VOCAL_HIGHPASS_HZ = 80;

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

/** Force simplified output and CJK spacing on every segment and word. */
function normalizeChineseSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments.map((segment) => {
    if (segment.words !== undefined && segment.words.length > 0) {
      const words = segment.words.map((word) => ({
        ...word,
        text: normalizeChineseText(word.text),
      }));
      return { ...segment, text: words.map((word) => word.text).join(''), words };
    }
    return { ...segment, text: normalizeChineseText(segment.text) };
  });
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
  const audio = await loadAudioFile(
    path,
    opts.isolateVocals === true ? { stereo: true } : undefined,
  );
  report('decoding', 15);

  // In music mode the vocal-isolated (or high-passed mono) signal replaces the
  // raw mixdown for every downstream stage: loudness, VAD, SNR and ASR.
  let source = audio.samples;
  if (opts.isolateVocals === true) {
    const channels = audio.channelData;
    if (channels !== undefined && channels.length >= 2) {
      const left = highPass(channels[0]!, audio.sampleRate, VOCAL_HIGHPASS_HZ);
      const right = highPass(channels[1]!, audio.sampleRate, VOCAL_HIGHPASS_HZ);
      source = isolateCenterChannel(left, right, audio.sampleRate);
    } else {
      source = highPass(audio.samples, audio.sampleRate, VOCAL_HIGHPASS_HZ);
    }
  }

  report('analyzing', 15);
  const normalized = normalizeLoudness(source, audio.sampleRate);
  let regions = detectSpeechRegions(normalized, audio.sampleRate);

  const snrDb = estimateSnrDb(normalized, regions, audio.sampleRate);
  let processed = normalized;
  if (snrDb !== null && snrDb < DENOISE_SNR_THRESHOLD_DB) {
    processed = spectralDenoise(normalized, audio.sampleRate);
    regions = detectSpeechRegions(processed, audio.sampleRate);
  }

  const speech = trimToSpeech(processed, audio.sampleRate);
  // The engine sees the trimmed audio, so post-processing regions must use the
  // same time base (the full-signal regions are only valid when nothing was cut).
  const segmentRegions =
    speech === processed ? regions : detectSpeechRegions(speech, audio.sampleRate);
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

  let segments = normalizeSegments(asr.segments, segmentRegions, language);
  if (language.startsWith('zh')) {
    segments = normalizeChineseSegments(segments);
  }

  const style = opts.style ?? styleForLanguage(language);
  report('formatting', 85);
  let cues = segmentsToCues(segments, style, language);
  if (language.startsWith('zh')) {
    cues = annotateCuesWithPinyin(cues);
  } else if (language.startsWith('en') || language.startsWith('es')) {
    cues = annotateCuesWithIpa(cues, language);
  }
  const srt = serializeSrt(cues);
  const vtt = serializeVtt(cues);
  report('formatting', 95);

  const stats = computeStats(cues, segments, language, audio.durationMs);
  report('done', 100);

  // `filename` is part of the public contract (used by callers for headers).
  void filename;

  return {
    language,
    durationMs: audio.durationMs,
    segments,
    cues,
    srt,
    vtt,
    stats,
  };
}
