/**
 * Shared test doubles and audio helpers for the live engine suite.
 *
 * Everything here is dependency-free: the scripted ASR engine and translator
 * let the session tests run without loading any real model.
 */
import type { AsrEngine, AsrOptions, AsrOutput } from '../../../src/pipeline/asr';
import type { LiveEvents, LiveFinalCue } from '../../../src/live/session';
import type { Translator, TranslatorOptions } from '../../../src/pipeline/translator';

export const LIVE_RATE = 16000;

/** An AsrEngine that replays a fixed script, one entry per call. */
export class ScriptedEngine implements AsrEngine {
  readonly id = 'scripted';
  /** Number of samples received by each `transcribe` call. */
  readonly calls: number[] = [];
  private readonly scripts: Array<string | Error>;
  private index = 0;

  constructor(scripts: Array<string | Error>) {
    this.scripts = scripts.slice();
  }

  async transcribe(audio: Float32Array, sampleRate: number, opts: AsrOptions): Promise<AsrOutput> {
    this.calls.push(audio.length);
    const script =
      this.scripts.length === 0
        ? ''
        : this.scripts[Math.min(this.index, this.scripts.length - 1)] ?? '';
    this.index += 1;

    if (script instanceof Error) {
      throw script;
    }

    const text = script;
    const durationMs = sampleRate > 0 ? (audio.length / sampleRate) * 1000 : 0;
    const language = opts.language !== undefined && opts.language !== 'auto' ? opts.language : 'en';
    return {
      language,
      segments: text === '' ? [] : [{ text, startMs: 0, endMs: durationMs }],
      durationMs,
    };
  }
}

/** A translator that prefixes every text and records its calls. */
export class ScriptedTranslator implements Translator {
  readonly calls: Array<{ texts: string[]; options: TranslatorOptions }> = [];

  constructor(private readonly prefix = '[t]') {}

  async translate(texts: string[], options: TranslatorOptions): Promise<string[]> {
    this.calls.push({ texts: texts.slice(), options });
    return texts.map((text) => `${this.prefix}${text}`);
  }
}

/** A translator that always fails, to exercise the error path. */
export class FailingTranslator implements Translator {
  async translate(): Promise<string[]> {
    throw new Error('translation offline');
  }
}

export interface Recorded {
  partials: string[];
  finals: LiveFinalCue[];
  translations: Array<{ cueId: number; language: string; text: string }>;
  statuses: Array<'listening' | 'transcribing' | 'idle'>;
  errors: string[];
  events: LiveEvents;
}

/** Build a `LiveEvents` object that records every callback invocation. */
export function collectEvents(): Recorded {
  const partials: string[] = [];
  const finals: LiveFinalCue[] = [];
  const translations: Array<{ cueId: number; language: string; text: string }> = [];
  const statuses: Array<'listening' | 'transcribing' | 'idle'> = [];
  const errors: string[] = [];

  return {
    partials,
    finals,
    translations,
    statuses,
    errors,
    events: {
      onPartial: (text) => partials.push(text),
      onFinal: (cue) => finals.push(cue),
      onTranslation: (translation) => translations.push(translation),
      onStatus: (state) => statuses.push(state),
      onError: (message) => errors.push(message),
    },
  };
}

/** Constant-amplitude sine wave. */
export function sine(
  seconds: number,
  amplitude = 0.3,
  freq = 440,
  sampleRate = LIVE_RATE,
): Float32Array {
  const length = Math.round(seconds * sampleRate);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

/** Pure silence. */
export function silence(seconds: number, sampleRate = LIVE_RATE): Float32Array {
  return new Float32Array(Math.round(seconds * sampleRate));
}

/** Let every pending microtask / queued decode settle. */
export function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
