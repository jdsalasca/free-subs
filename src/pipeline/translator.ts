/**
 * Local translation engine for subtitles (ES / EN / ZH).
 *
 * Subtitle cues are translated with Transformers.js OPUS-MT models that run
 * entirely on the local machine — no cloud calls. The heavy
 * `@huggingface/transformers` module is imported lazily so the CLI, the server
 * and the unit tests stay fast and never download a model unless a translation
 * is actually requested.
 *
 * OPUS-MT models are fixed source/target pairs, so Spanish and Mandarin pivot
 * through English. `translationRoute` exposes the ordered chain of languages
 * and `routeModelKeys` the matching model registry keys.
 */
import type { LanguageCode } from '../core';

/** Languages the local OPUS-MT registry can translate between. */
export type TranslationLanguage = Exclude<LanguageCode, 'auto'>;

export interface TranslatorOptions {
  /** Source language (`'es' | 'en' | 'zh'` or any recognized variant). */
  from: string;
  /** Target language (`'es' | 'en' | 'zh'` or any recognized variant). */
  to: string;
  /** Called with a 0..100 percentage while batches are processed. */
  onProgress?: (percent: number) => void;
}

export interface Translator {
  translate(texts: string[], options: TranslatorOptions): Promise<string[]>;
}

/** Model registry key -> Hugging Face model id (verified against Hugging Face). */
const MODEL_REGISTRY: Record<string, string> = {
  'es-en': 'Xenova/opus-mt-es-en',
  'en-es': 'Xenova/opus-mt-en-es',
  'en-zh': 'Xenova/opus-mt-en-zh',
  'zh-en': 'Xenova/opus-mt-zh-en',
};

const SUPPORTED_LANGUAGES: readonly TranslationLanguage[] = ['es', 'en', 'zh'];

/** OPUS-MT models accept small inputs; keep the batches conservative. */
const BATCH_SIZE = 8;
const MAX_NEW_TOKENS = 256;
/** English is the pivot for pairs that have no direct model (es <-> zh). */
const PIVOT_LANGUAGE: TranslationLanguage = 'en';

function isTranslationLanguage(value: string): value is TranslationLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Normalize a language tag to a supported code.
 *
 * Accepts region/script variants (`zh-CN`, `zh-TW`, `zh-Hans`, `en-US`, ...)
 * and ISO 639-2/639-3 codes (`spa`, `eng`, `cmn`, `zho`, `chi`). Anything the
 * registry cannot translate is reported as `'unknown'`.
 */
export function normalizeLanguage(language: string): TranslationLanguage | 'unknown' {
  const code = language.trim().toLowerCase().replace(/_/g, '-');
  if (code === '') {
    return 'unknown';
  }
  if (code === 'zh' || code.startsWith('zh-') || code === 'cmn' || code === 'zho' || code === 'chi') {
    return 'zh';
  }
  if (code === 'es' || code.startsWith('es-') || code === 'spa') {
    return 'es';
  }
  if (code === 'en' || code.startsWith('en-') || code === 'eng') {
    return 'en';
  }
  return 'unknown';
}

function requireLanguage(value: string, role: 'source' | 'target'): TranslationLanguage {
  const normalized = normalizeLanguage(value);
  if (isTranslationLanguage(normalized)) {
    return normalized;
  }
  throw new Error(
    `Unsupported translation ${role} language "${value}". Supported languages: es, en, zh.`,
  );
}

/**
 * Ordered list of language hops needed to go from `from` to `to`.
 * Returns `[]` when both languages are the same.
 */
export function translationRoute(from: string, to: string): string[] {
  const source = requireLanguage(from, 'source');
  const target = requireLanguage(to, 'target');

  if (source === target) {
    return [];
  }
  if (source === PIVOT_LANGUAGE) {
    return [PIVOT_LANGUAGE, target];
  }
  if (target === PIVOT_LANGUAGE) {
    return [source, PIVOT_LANGUAGE];
  }
  return [source, PIVOT_LANGUAGE, target];
}

/**
 * Route expressed as model registry keys, e.g. `['es-en', 'en-zh']` for
 * `es -> zh`. Throws for unsupported language pairs.
 */
export function routeModelKeys(from: string, to: string): string[] {
  const route = translationRoute(from, to);
  const keys: string[] = [];

  for (let index = 0; index < route.length - 1; index += 1) {
    const source = route[index];
    const target = route[index + 1];
    if (source === undefined || target === undefined) {
      continue;
    }
    const key = `${source}-${target}`;
    if (!Object.prototype.hasOwnProperty.call(MODEL_REGISTRY, key)) {
      throw new Error(`No local OPUS-MT model registered for pair "${key}".`);
    }
    keys.push(key);
  }

  return keys;
}

type TransformersModule = typeof import('@huggingface/transformers');
type Text2TextPipeline = import('@huggingface/transformers').Text2TextGenerationPipeline;

/** One pipeline per registry key, shared across calls in the same process. */
const pipelineCache = new Map<string, Promise<Text2TextPipeline>>();

async function loadPipeline(routeKey: string): Promise<Text2TextPipeline> {
  const cached = pipelineCache.get(routeKey);
  if (cached !== undefined) {
    return cached;
  }

  const model = MODEL_REGISTRY[routeKey];
  if (model === undefined) {
    throw new Error(`No local OPUS-MT model registered for pair "${routeKey}".`);
  }

  const pending = (async (): Promise<Text2TextPipeline> => {
    const transformers: TransformersModule = await import('@huggingface/transformers');
    const cacheDir = process.env.FREE_SUBS_CACHE_DIR;
    if (cacheDir !== undefined && cacheDir !== '') {
      transformers.env.cacheDir = cacheDir;
    }
    return transformers.pipeline('text2text-generation', model);
  })();

  pipelineCache.set(routeKey, pending);
  return pending;
}

function generatedText(item: { generated_text?: string }): string {
  return typeof item.generated_text === 'string' ? item.generated_text : '';
}

/** Safe default translator: returns exactly the texts it receives. */
export class NullTranslator implements Translator {
  async translate(texts: string[], _options: TranslatorOptions): Promise<string[]> {
    return texts.slice();
  }
}

export class OpusMtTranslator implements Translator {
  async translate(texts: string[], options: TranslatorOptions): Promise<string[]> {
    if (texts.length === 0) {
      return [];
    }

    const route = translationRoute(options.from, options.to);
    if (route.length <= 1) {
      // Same language: nothing to load, return the inputs untouched.
      options.onProgress?.(100);
      return texts.slice();
    }

    const modelKeys = routeModelKeys(options.from, options.to);
    const batchesPerHop = Math.ceil(texts.length / BATCH_SIZE);
    const totalBatches = batchesPerHop * modelKeys.length;
    let completedBatches = 0;

    let current: string[] = texts.slice();

    for (const modelKey of modelKeys) {
      const pipeline = await loadPipeline(modelKey);
      const next: string[] = [];

      for (let start = 0; start < current.length; start += BATCH_SIZE) {
        const batch = current.slice(start, start + BATCH_SIZE);
        const output = await pipeline(batch, { max_new_tokens: MAX_NEW_TOKENS });
        const translated = output.map((item) => generatedText(item));

        for (let index = 0; index < batch.length; index += 1) {
          const source = batch[index] ?? '';
          const candidate = translated[index];
          const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
          // Empty translations keep the source text so cues never disappear.
          next.push(trimmed === '' ? source : trimmed);
        }

        completedBatches += 1;
        options.onProgress?.(Math.round((completedBatches / totalBatches) * 100));
      }

      current = next;
    }

    return current;
  }
}
