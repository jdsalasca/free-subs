/**
 * Local Whisper engine backed by Transformers.js.
 *
 * The heavy `@huggingface/transformers` module is imported lazily so the CLI,
 * the server and the unit tests stay fast (and never download a model unless
 * transcription is actually requested).
 */
import type { ModelId, TranscriptSegment, WordTiming } from '../core';
import type { AsrEngine, AsrOptions, AsrOutput } from './asr';
import { detectLanguageFromText } from './language';

const MODEL_MAP: Record<ModelId, string> = {
  tiny: 'Xenova/whisper-tiny',
  base: 'Xenova/whisper-base',
  small: 'Xenova/whisper-small',
};

const STRONG_PUNCTUATION = /[.!?…。！？]$/;
const SEGMENT_GAP_MS = 700;

type TransformersModule = typeof import('@huggingface/transformers');
type AsrPipeline = import('@huggingface/transformers').AutomaticSpeechRecognitionPipeline;

/** One pipeline per model id, shared across calls in the same process. */
const pipelineCache = new Map<ModelId, Promise<AsrPipeline>>();

async function loadPipeline(model: ModelId): Promise<AsrPipeline> {
  const cached = pipelineCache.get(model);
  if (cached !== undefined) {
    return cached;
  }

  const pending = (async (): Promise<AsrPipeline> => {
    const transformers: TransformersModule = await import('@huggingface/transformers');
    const cacheDir = process.env.FREE_SUBS_CACHE_DIR;
    if (cacheDir !== undefined && cacheDir !== '') {
      transformers.env.cacheDir = cacheDir;
    }
    const modelId = MODEL_MAP[model];
    try {
      return await transformers.pipeline('automatic-speech-recognition', modelId, {
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
      });
    } catch {
      return await transformers.pipeline('automatic-speech-recognition', modelId);
    }
  })();

  pipelineCache.set(model, pending);
  return pending;
}

function toMilliseconds(seconds: number | undefined): number {
  return Math.max(0, Math.round((seconds ?? 0) * 1000));
}

function buildSegment(words: WordTiming[]): TranscriptSegment | undefined {
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }
  return {
    text: words.map((word) => word.text).join(' '),
    startMs: first.startMs,
    endMs: last.endMs,
    words: words.map((word) => ({ ...word })),
  };
}

/** Group word-level chunks into sentence-ish segments. */
function groupWords(chunks: Array<{ text: string; timestamp: [number, number] }>): TranscriptSegment[] {
  const words: WordTiming[] = [];
  for (const chunk of chunks) {
    const text = chunk.text.trim();
    if (text === '') {
      continue;
    }
    const [start, end] = chunk.timestamp;
    words.push({ text, startMs: toMilliseconds(start), endMs: toMilliseconds(end) });
  }

  const segments: TranscriptSegment[] = [];
  let current: WordTiming[] = [];

  const flush = (): void => {
    const segment = buildSegment(current);
    if (segment !== undefined) {
      segments.push(segment);
    }
    current = [];
  };

  for (const word of words) {
    const previous = current[current.length - 1];
    if (previous !== undefined) {
      const gap = word.startMs - previous.endMs;
      if (gap > SEGMENT_GAP_MS || STRONG_PUNCTUATION.test(previous.text)) {
        flush();
      }
    }
    current.push(word);
  }
  flush();

  return segments;
}

/** Map segment-level chunks straight to transcript segments. */
function mapChunks(chunks: Array<{ text: string; timestamp: [number, number] }>): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const chunk of chunks) {
    const text = chunk.text.trim();
    if (text === '') {
      continue;
    }
    const [start, end] = chunk.timestamp;
    segments.push({ text, startMs: toMilliseconds(start), endMs: toMilliseconds(end) });
  }
  return segments;
}

export class TransformersWhisperEngine implements AsrEngine {
  readonly id = 'transformers-whisper';

  async transcribe(audio: Float32Array, sampleRate: number, opts: AsrOptions): Promise<AsrOutput> {
    const model: ModelId = opts.model ?? 'base';
    opts.onProgress?.(5, 'loading-model');
    const pipeline = await loadPipeline(model);

    opts.onProgress?.(30, 'transcribing');
    const language = opts.language !== undefined && opts.language !== 'auto' ? opts.language : undefined;
    const common = {
      language,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    };

    let output: import('@huggingface/transformers').AutomaticSpeechRecognitionOutput;
    let chunks: Array<{ text: string; timestamp: [number, number] }> = [];
    let wordMode = true;

    try {
      output = await pipeline(audio, { ...common, return_timestamps: 'word' });
      chunks = output.chunks ?? [];
    } catch {
      wordMode = false;
      output = await pipeline(audio, { ...common, return_timestamps: true });
      chunks = output.chunks ?? [];
    }

    opts.onProgress?.(80, 'transcribing');

    const segments = wordMode ? groupWords(chunks) : mapChunks(chunks);
    const fullText = output.text ?? segments.map((segment) => segment.text).join(' ');
    const detected = opts.language !== undefined && opts.language !== 'auto'
      ? opts.language
      : detectLanguageFromText(fullText);

    return {
      language: detected,
      segments,
      durationMs: sampleRate > 0 ? (audio.length / sampleRate) * 1000 : 0,
    };
  }
}
