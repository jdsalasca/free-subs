/**
 * ASR engine contracts.
 *
 * Keeping this interface small lets the server and CLI run against the local
 * Transformers.js Whisper engine, or an injected stub in tests.
 */
import type { LanguageCode, ModelId, TranscriptSegment } from '../core';

export interface AsrOptions {
  language?: LanguageCode;
  model?: ModelId;
  onProgress?: (percent: number, stage: string) => void;
}

export interface AsrOutput {
  language: string;
  segments: TranscriptSegment[];
  durationMs: number;
}

export interface AsrEngine {
  id: string;
  transcribe(audio: Float32Array, sampleRate: number, opts: AsrOptions): Promise<AsrOutput>;
}
