/**
 * Frozen wire protocol for the live streaming endpoint (`GET /api/live`).
 *
 * Client -> server: JSON control messages and little-endian Float32 PCM
 * binary frames (16 kHz, mono). Server -> client: JSON events. This module is
 * the single source of truth for the message shapes and their validation.
 */
import type { LanguageCode, ModelId } from '../core';

/** Upgrade path of the live WebSocket endpoint. */
export const LIVE_PATH = '/api/live';
/** Sample rate the client must send and the engine consumes. */
export const LIVE_SAMPLE_RATE = 16000;

export const LIVE_LANGUAGES: readonly LanguageCode[] = ['auto', 'es', 'en', 'zh'];
export const LIVE_MODELS: readonly ModelId[] = ['tiny', 'base', 'small'];
export const LIVE_TRANSLATION_TARGETS = ['es', 'en', 'zh'] as const;

export type LiveTranslationTarget = (typeof LIVE_TRANSLATION_TARGETS)[number];

export interface LiveStartMessage {
  type: 'start';
  language: LanguageCode;
  model: ModelId;
  translateTo?: LiveTranslationTarget | null;
}

export interface LiveFlushMessage {
  type: 'flush';
}

export interface LiveStopMessage {
  type: 'stop';
}

export type LiveClientMessage = LiveStartMessage | LiveFlushMessage | LiveStopMessage;

export interface LiveReadyMessage {
  type: 'ready';
}

export interface LivePartialMessage {
  type: 'partial';
  text: string;
}

export interface LiveFinalMessage {
  type: 'final';
  cueId: number;
  text: string;
  startMs: number;
  endMs: number;
}

export interface LiveTranslationMessage {
  type: 'translation';
  cueId: number;
  language: string;
  text: string;
}

export type LiveState = 'listening' | 'transcribing' | 'idle';

export interface LiveStatusMessage {
  type: 'status';
  state: LiveState;
}

export interface LiveErrorMessage {
  type: 'error';
  message: string;
}

export type LiveServerMessage =
  | LiveReadyMessage
  | LivePartialMessage
  | LiveFinalMessage
  | LiveTranslationMessage
  | LiveStatusMessage
  | LiveErrorMessage;

export function isLiveLanguage(value: unknown): value is LanguageCode {
  return typeof value === 'string' && (LIVE_LANGUAGES as readonly string[]).includes(value);
}

export function isLiveModel(value: unknown): value is ModelId {
  return typeof value === 'string' && (LIVE_MODELS as readonly string[]).includes(value);
}

export function isLiveTranslationTarget(value: unknown): value is LiveTranslationTarget {
  return typeof value === 'string' && (LIVE_TRANSLATION_TARGETS as readonly string[]).includes(value);
}

/**
 * Parse and validate a client JSON message. Returns `null` for malformed JSON,
 * unknown message types and invalid enum values (the caller answers with an
 * `error` message).
 */
export function parseClientMessage(raw: string): LiveClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const type = (value as { type?: unknown }).type;
  if (type === 'flush') {
    return { type: 'flush' };
  }
  if (type === 'stop') {
    return { type: 'stop' };
  }
  if (type !== 'start') {
    return null;
  }

  const start = value as { language?: unknown; model?: unknown; translateTo?: unknown };
  if (!isLiveLanguage(start.language) || !isLiveModel(start.model)) {
    return null;
  }

  let translateTo: LiveTranslationTarget | null;
  if (start.translateTo === undefined || start.translateTo === null) {
    translateTo = null;
  } else if (isLiveTranslationTarget(start.translateTo)) {
    translateTo = start.translateTo;
  } else {
    return null;
  }

  return { type: 'start', language: start.language, model: start.model, translateTo };
}

/**
 * Decode a binary frame into Float32 samples. The wire format is
 * little-endian Float32 PCM; trailing bytes that do not complete a float are
 * ignored so a truncated frame never throws.
 */
export function pcmToFloat32(data: ArrayBuffer | ArrayBufferView): Float32Array {
  const view =
    data instanceof ArrayBuffer
      ? new DataView(data)
      : new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = Math.floor(view.byteLength / 4);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    samples[index] = view.getFloat32(index * 4, true);
  }
  return samples;
}
