/**
 * Free Subs — core domain types.
 *
 * These interfaces are the frozen contract between the subtitle engine,
 * the ASR pipeline, the HTTP server and the web client. Keep them stable:
 * every module depends on them.
 */

/** User-facing language selection. `auto` lets Whisper detect it. */
export type LanguageCode = 'auto' | 'es' | 'en' | 'zh';

/** Available local Whisper model sizes (bigger = more accurate, slower). */
export type ModelId = 'tiny' | 'base' | 'small';

export interface WordTiming {
  text: string;
  startMs: number;
  endMs: number;
  /** Optional model confidence in [0, 1] when available. */
  confidence?: number;
}

/** A raw ASR output segment: usually one sentence-ish chunk of speech. */
export interface TranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
  /** Word-level timings when the engine can provide them. */
  words?: WordTiming[];
}

/** A final, display-ready subtitle cue (max 2 lines by default). */
export interface SubtitleCue {
  index: number;
  startMs: number;
  endMs: number;
  lines: string[];
  /** Word timings restricted to this cue, for karaoke output. */
  words?: WordTiming[];
}

/**
 * Typography and timing rules used by the segmentation engine.
 * Defaults follow common broadcast guidelines (BBC/Netflix-style).
 */
export interface SubtitleStyle {
  maxCharsPerLine: number;
  maxLines: number;
  minDurationMs: number;
  maxDurationMs: number;
  /** Maximum characters per second (reading speed). */
  maxCps: number;
  /** Minimum gap enforced between consecutive cues. */
  minGapMs: number;
}

export const DEFAULT_STYLE: SubtitleStyle = {
  maxCharsPerLine: 42,
  maxLines: 2,
  minDurationMs: 1000,
  maxDurationMs: 7000,
  maxCps: 17,
  minGapMs: 80,
};

/** Tighter rules for CJK scripts (Mandarin), where each char is a syllable. */
export const CJK_STYLE: SubtitleStyle = {
  maxCharsPerLine: 16,
  maxLines: 2,
  minDurationMs: 1000,
  maxDurationMs: 7000,
  maxCps: 9,
  minGapMs: 80,
};

export interface SubtitleStats {
  cueCount: number;
  wordCount: number;
  avgCps: number;
  maxCps: number;
  durationMs: number;
}

/** Everything the UI/CLI needs to render or export a transcription. */
export interface TranscriptionResult {
  /** ISO-ish detected/selected language code, e.g. "en", "es", "zh". */
  language: string;
  durationMs: number;
  segments: TranscriptSegment[];
  cues: SubtitleCue[];
  srt: string;
  vtt: string;
  stats: SubtitleStats;
}

/** Available subtitle export formats. SRT is the most widely supported. */
export type SubtitleFormat = 'srt' | 'vtt' | 'ass';

/** Visual style used when burning subtitles into a video (ASS/libass). */
export interface SubtitleExportStyle {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  /** Hex colors, e.g. "#ffffff". */
  primaryColor: string;
  outlineColor: string;
  outlineWidth: number;
  shadow: number;
  position: 'bottom' | 'middle' | 'top';
  /** Vertical margin from the chosen edge, in pixels (relative to a 1080p canvas). */
  marginV: number;
  background: boolean;
  backgroundColor: string;
  /** 0..1 */
  backgroundOpacity: number;
}

export const DEFAULT_EXPORT_STYLE: SubtitleExportStyle = {
  fontFamily: 'Arial',
  fontSize: 48,
  bold: true,
  primaryColor: '#ffffff',
  outlineColor: '#000000',
  outlineWidth: 2,
  shadow: 1,
  position: 'bottom',
  marginV: 60,
  background: false,
  backgroundColor: '#000000',
  backgroundOpacity: 0.6,
};

export interface TranslationRecord {
  language: string;
  status: 'processing' | 'done' | 'error';
  progress: JobProgress;
  /** Translated cues, keeping the original cue timings. */
  cues?: SubtitleCue[];
  /** Translated subtitles, keeping the original cue timings. */
  srt?: string;
  vtt?: string;
  text?: string;
  error?: string;
}

export interface ExportRecord {
  id: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  progress: JobProgress;
  style: SubtitleExportStyle;
  filename: string;
  /** Absolute path of the rendered video once finished. */
  outputPath?: string;
  error?: string;
}

export interface JobProgress {
  stage:
    | 'queued'
    | 'decoding'
    | 'analyzing'
    | 'loading-model'
    | 'transcribing'
    | 'translating'
    | 'exporting'
    | 'formatting'
    | 'done'
    | 'error';
  /** 0..100 */
  percent: number;
  message?: string;
}

export interface JobRecord {
  id: string;
  filename: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  progress: JobProgress;
  createdAt: string;
  /** Path of the uploaded media on disk (kept for video export). */
  mediaPath?: string;
  result?: TranscriptionResult;
  translations?: Record<string, TranslationRecord>;
  exports?: Record<string, ExportRecord>;
  error?: string;
}
