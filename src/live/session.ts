/**
 * Live streaming session: pseudo-streaming ASR with LocalAgreement-2 partials.
 *
 * The session keeps only the current segment's audio, re-decodes a bounded
 * window on a timer, commits the longest common prefix of two consecutive
 * hypotheses (Macháček et al., 2023), and finalizes on silence, on a hard cue
 * cap or on demand. Finals are translated one sentence at a time so the output
 * stays append-only and cheap on CPU.
 */
import type { LanguageCode, ModelId } from '../core';
import { normalizeWhitespace } from '../core';
import type { AsrEngine } from '../pipeline/asr';
import { resampleSinc } from '../pipeline/resample';
import { normalizeLanguage, type Translator } from '../pipeline/translator';
import { detectSpeechRegions } from '../pipeline/vad';
import { LIVE_SAMPLE_RATE } from './protocol';

export interface LiveFinalCue {
  id: number;
  text: string;
  startMs: number;
  endMs: number;
}

export interface LiveEvents {
  onPartial: (text: string) => void;
  onFinal: (cue: LiveFinalCue) => void;
  onTranslation: (translation: { cueId: number; language: string; text: string }) => void;
  onStatus?: (state: 'listening' | 'transcribing' | 'idle') => void;
  onError?: (message: string) => void;
}

export interface LiveSessionOptions {
  language: LanguageCode;
  model: ModelId;
  translateTo?: string | null;
  /** Minimum time between two partial decodes (default 1000 ms). */
  updateIntervalMs?: number;
  /** Hard cap for one cue / segment (default 7000 ms). */
  maxCueMs?: number;
  /** Silence tail that finalizes the segment (default 600 ms). */
  silenceMs?: number;
}

type LiveState = 'listening' | 'transcribing' | 'idle';

const DEFAULT_UPDATE_INTERVAL_MS = 1000;
const DEFAULT_MAX_CUE_MS = 7000;
const DEFAULT_SILENCE_MS = 600;
/** ASR window for partial decodes (whisper_streaming default). */
const PARTIAL_WINDOW_MS = 15_000;
/** Hard ASR window cap for final decodes. */
const FINAL_WINDOW_MS = 29_000;
/** Audio kept after a final so the next segment has acoustic context. */
const TAIL_KEEP_MS = 200;
const TOKEN_EDGE_PUNCTUATION_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

interface TextToken {
  value: string;
  start: number;
  end: number;
}

function textTokens(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  const pattern = /\S+/g;
  let match = pattern.exec(text);
  while (match !== null) {
    tokens.push({ value: match[0], start: match.index, end: match.index + match[0].length });
    match = pattern.exec(text);
  }
  return tokens;
}

/** Lower-case and strip edge punctuation so tokens compare language-agnostically. */
function normalizeToken(value: string): string {
  return value.toLowerCase().replace(TOKEN_EDGE_PUNCTUATION_RE, '');
}

/**
 * Longest common prefix of two hypotheses, preserving the punctuation and case
 * of `next`. Empty when either side is empty or nothing matches.
 */
export function commitStablePrefix(previous: string, next: string): string {
  const before = textTokens(previous);
  const after = textTokens(next);
  if (before.length === 0 || after.length === 0) {
    return '';
  }

  const limit = Math.min(before.length, after.length);
  let count = 0;
  while (count < limit) {
    if (normalizeToken(before[count]!.value) !== normalizeToken(after[count]!.value)) {
      break;
    }
    count += 1;
  }

  if (count === 0) {
    return '';
  }
  const last = after[count - 1]!;
  return next.slice(0, last.end).trim();
}

/**
 * Remove from `next` any overlap with the previous final text, so a segment
 * that still contains the previous segment's acoustic tail never duplicates
 * words across cues.
 */
function stripOverlap(previous: string, next: string): string {
  const before = textTokens(previous);
  const after = textTokens(next);
  if (after.length === 0) {
    return '';
  }
  if (before.length === 0) {
    return normalizeWhitespace(next);
  }

  const limit = Math.min(before.length, after.length);
  for (let overlap = limit; overlap >= 1; overlap -= 1) {
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      const left = before[before.length - overlap + index]!;
      const right = after[index]!;
      if (normalizeToken(left.value) !== normalizeToken(right.value)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      const boundary = after[overlap - 1]!;
      return next.slice(boundary.end).trim();
    }
  }

  return normalizeWhitespace(next);
}

function joinSegments(segments: Array<{ text: string }>): string {
  return normalizeWhitespace(segments.map((segment) => segment.text).join(' '));
}

export class LiveSession {
  private readonly engine: AsrEngine;
  private readonly translator: Translator | null;
  private readonly events: LiveEvents;
  private readonly language: LanguageCode;
  private readonly model: ModelId;
  private readonly translateTo: string | null;
  private readonly updateIntervalMs: number;
  private readonly maxCueMs: number;
  private readonly silenceMs: number;

  /** Current segment audio, always the most recent `buffer.length` samples. */
  private buffer = new Float32Array(0);
  /** Session-relative time of the newest sample, in milliseconds. */
  private consumedMs = 0;
  private lastUpdateMs = 0;
  private segmentStartMs: number | null = null;
  private segmentFloorMs = 0;
  private previousHypothesis = '';
  private lastPartial = '';
  private lastFinalText = '';
  private detectedLanguage = '';
  private cueId = 0;
  private busy = false;
  private pendingPartial = false;
  private pendingFinalMs: number | null = null;
  private stopped = false;
  private stopping = false;
  private state: LiveState = 'idle';
  private queue: Promise<void> = Promise.resolve();

  constructor(
    engine: AsrEngine,
    translator: Translator | null,
    events: LiveEvents,
    options: LiveSessionOptions,
  ) {
    this.engine = engine;
    this.translator = translator;
    this.events = events;
    this.language = options.language;
    this.model = options.model;
    this.translateTo = options.translateTo ?? null;
    this.updateIntervalMs = options.updateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS;
    this.maxCueMs = options.maxCueMs ?? DEFAULT_MAX_CUE_MS;
    this.silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS;
  }

  /** Feed one mono PCM chunk. Never throws; failures are reported via `onError`. */
  pushAudio(samples: Float32Array, sampleRate: number): void {
    try {
      if (this.stopped || this.stopping || samples.length === 0) {
        return;
      }
      const pcm =
        sampleRate === LIVE_SAMPLE_RATE
          ? samples
          : resampleSinc(samples, sampleRate, LIVE_SAMPLE_RATE);
      if (pcm.length === 0) {
        return;
      }
      this.append(pcm);
      this.evaluate();
    } catch (error) {
      this.reportError(error);
    }
  }

  /** Force-finalize the current segment (the session keeps listening). */
  async flush(): Promise<void> {
    if (this.stopped) {
      return;
    }

    const task = this.queue
      .then(async () => {
        this.pendingFinalMs = null;
        this.pendingPartial = false;
        if (this.buffer.length === 0) {
          this.resetSegment(this.consumedMs);
          return;
        }
        const regions = detectSpeechRegions(this.buffer, LIVE_SAMPLE_RATE);
        if (regions.length === 0) {
          this.resetSegment(this.consumedMs);
          return;
        }
        this.ensureSegmentStart(regions[0]!);
        const last = regions[regions.length - 1]!;
        await this.runFinal(this.bufferStartMs() + last.endMs);
      })
      .catch((error) => this.reportError(error));

    this.queue = task;
    await task;
  }

  /** Finalize and mark the session idle. Safe to call more than once. */
  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.stopping) {
      await this.queue.catch(() => undefined);
      return;
    }

    this.stopping = true;
    try {
      await this.flush();
    } finally {
      this.stopped = true;
      this.stopping = false;
      this.setState('idle');
    }
  }

  private append(pcm: Float32Array): void {
    const merged = new Float32Array(this.buffer.length + pcm.length);
    merged.set(this.buffer, 0);
    merged.set(pcm, this.buffer.length);
    this.buffer = merged;
    this.consumedMs += (pcm.length / LIVE_SAMPLE_RATE) * 1000;
  }

  private bufferMs(): number {
    return (this.buffer.length / LIVE_SAMPLE_RATE) * 1000;
  }

  private bufferStartMs(): number {
    return this.consumedMs - this.bufferMs();
  }

  private ensureSegmentStart(firstRegion: { startMs: number }): void {
    if (this.segmentStartMs === null) {
      this.segmentStartMs = Math.max(
        this.bufferStartMs() + firstRegion.startMs,
        this.segmentFloorMs,
      );
    }
  }

  /** Decide what to do after a chunk: finalize, decode partially or wait. */
  private evaluate(): void {
    const durationMs = this.bufferMs();
    if (durationMs <= 0) {
      return;
    }

    const regions = detectSpeechRegions(this.buffer, LIVE_SAMPLE_RATE);
    if (regions.length === 0) {
      // No speech yet: drop accumulated leading silence instead of decoding it.
      if (durationMs > this.silenceMs) {
        this.trimTail(TAIL_KEEP_MS);
      }
      return;
    }

    const last = regions[regions.length - 1]!;
    this.ensureSegmentStart(regions[0]!);
    const speechEndMs = this.bufferStartMs() + last.endMs;
    const silenceTailMs = durationMs - last.endMs;

    if (durationMs >= this.maxCueMs || silenceTailMs >= this.silenceMs) {
      this.requestFinal(speechEndMs);
      return;
    }

    if (this.consumedMs - this.lastUpdateMs >= this.updateIntervalMs) {
      if (this.busy) {
        this.pendingPartial = true;
      } else {
        this.lastUpdateMs = this.consumedMs;
        this.schedulePartial();
      }
    }
  }

  private requestFinal(speechEndMs: number): void {
    this.pendingFinalMs = speechEndMs;
    this.pendingPartial = false;
    if (!this.busy) {
      this.scheduleFinal();
    }
  }

  /** Serialize one partial decode; coalesces overlapping updates. */
  private schedulePartial(): void {
    if (this.stopped || this.stopping) {
      return;
    }
    this.busy = true;
    this.queue = this.queue.then(async () => {
      try {
        await this.runPartial();
      } catch (error) {
        this.reportError(error);
      } finally {
        this.busy = false;
        this.afterDecode();
      }
    });
  }

  private scheduleFinal(): void {
    const speechEndMs = this.pendingFinalMs;
    if (speechEndMs === null || this.stopped || this.stopping) {
      return;
    }
    this.pendingFinalMs = null;
    this.busy = true;
    this.queue = this.queue.then(async () => {
      try {
        await this.runFinal(speechEndMs);
      } catch (error) {
        this.reportError(error);
      } finally {
        this.busy = false;
        this.afterDecode();
      }
    });
  }

  private afterDecode(): void {
    if (this.stopped || this.stopping) {
      return;
    }
    if (this.pendingFinalMs !== null) {
      this.scheduleFinal();
      return;
    }
    if (this.pendingPartial) {
      this.pendingPartial = false;
      this.lastUpdateMs = this.consumedMs;
      this.schedulePartial();
    }
  }

  private async runPartial(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }
    const window = this.window(PARTIAL_WINDOW_MS);
    this.setState('transcribing');
    const output = await this.engine.transcribe(window.audio, LIVE_SAMPLE_RATE, {
      language: this.language,
      model: this.model,
    });
    if (output.language !== '') {
      this.detectedLanguage = output.language;
    }

    const hypothesis = joinSegments(output.segments);
    const stable = commitStablePrefix(this.previousHypothesis, hypothesis);
    this.previousHypothesis = hypothesis;

    if (stable !== '' && stable !== this.lastPartial) {
      this.lastPartial = stable;
      this.events.onPartial(stable);
    }
    this.setState('listening');
  }

  private async runFinal(speechEndMs: number): Promise<void> {
    if (this.buffer.length === 0) {
      this.resetSegment(speechEndMs);
      return;
    }

    const window = this.window(FINAL_WINDOW_MS);
    this.setState('transcribing');
    const output = await this.engine.transcribe(window.audio, LIVE_SAMPLE_RATE, {
      language: this.language,
      model: this.model,
    });
    if (output.language !== '') {
      this.detectedLanguage = output.language;
    }

    const raw = joinSegments(output.segments);
    const text = stripOverlap(this.lastFinalText, raw);
    const startMs = Math.max(0, Math.round(this.segmentStartMs ?? window.windowStartMs));
    const endMs = Math.max(startMs, Math.round(speechEndMs));

    if (text !== '') {
      this.cueId += 1;
      const cue: LiveFinalCue = { id: this.cueId, text, startMs, endMs };
      this.lastFinalText = raw;
      this.events.onFinal(cue);
      await this.translateFinal(cue);
    } else if (raw !== '') {
      this.lastFinalText = raw;
    }

    this.trimTail(TAIL_KEEP_MS);
    this.resetSegment(endMs);
    this.setState('listening');
  }

  private async translateFinal(cue: LiveFinalCue): Promise<void> {
    const target = this.translateTo;
    if (this.translator === null || target === null || target === '') {
      return;
    }

    let from: string = this.language;
    if (this.language === 'auto') {
      const detected = normalizeLanguage(this.detectedLanguage);
      from = detected === 'unknown' ? 'en' : detected;
    }

    try {
      const translated = await this.translator.translate([cue.text], { from, to: target });
      const text = normalizeWhitespace(translated[0] ?? '');
      if (text !== '') {
        this.events.onTranslation({ cueId: cue.id, language: target, text });
      }
    } catch (error) {
      this.reportError(error);
    }
  }

  private window(maxMs: number): { audio: Float32Array; windowStartMs: number } {
    const maxSamples = Math.floor((maxMs / 1000) * LIVE_SAMPLE_RATE);
    if (this.buffer.length <= maxSamples) {
      return { audio: this.buffer, windowStartMs: this.bufferStartMs() };
    }
    return {
      audio: this.buffer.slice(this.buffer.length - maxSamples),
      windowStartMs: this.consumedMs - maxMs,
    };
  }

  private trimTail(keepMs: number): void {
    const keep = Math.max(0, Math.round((keepMs / 1000) * LIVE_SAMPLE_RATE));
    if (this.buffer.length > keep) {
      this.buffer = this.buffer.slice(this.buffer.length - keep);
    }
  }

  private resetSegment(endMs: number): void {
    this.previousHypothesis = '';
    this.lastPartial = '';
    this.segmentStartMs = null;
    if (Number.isFinite(endMs)) {
      this.segmentFloorMs = Math.max(this.segmentFloorMs, endMs);
    }
  }

  private setState(state: LiveState): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    this.events.onStatus?.(state);
  }

  private reportError(error: unknown): void {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Live session error.';
    this.events.onError?.(message);
  }
}
