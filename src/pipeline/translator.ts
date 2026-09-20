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

/**
 * Context-aware cue translation.
 *
 * Translating cue-by-cue loses the surrounding context (a common complaint for
 * educational content). Instead, consecutive cues are grouped into short
 * blocks, each block is joined and translated as one string, and the result is
 * split back across the original cues so the timings never move.
 */

/** Collapse whitespace and count every remaining code point as one unit. */
function visibleLength(text: string): number {
  return text.replace(/\s+/gu, '').length;
}

/**
 * Group consecutive cue indices into blocks bounded by `maxCues` cues and
 * `maxChars` visible characters. The returned groups are never empty and are
 * always made of consecutive indices that partition `[0, cueTexts.length)`.
 */
export function groupCueBlocks(
  cueTexts: string[],
  options: { maxCues?: number; maxChars?: number } = {},
): number[][] {
  const maxCues = options.maxCues ?? 6;
  const maxChars = options.maxChars ?? 400;
  const groups: number[][] = [];
  let current: number[] = [];
  let currentChars = 0;

  for (let index = 0; index < cueTexts.length; index += 1) {
    const length = visibleLength(cueTexts[index] ?? '');
    const wouldExceedCues = current.length >= maxCues;
    const wouldExceedChars = current.length > 0 && currentChars + length > maxChars;

    if (current.length > 0 && (wouldExceedCues || wouldExceedChars)) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(index);
    currentChars += length;
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

/**
 * Nearest whitespace run to `ideal` that fits inside `[minStart, maxEnd]`.
 * Returning `null` means the caller should cut at an arbitrary character
 * boundary (the normal case for CJK, which has no spaces).
 */
function findWhitespaceCut(
  text: string,
  ideal: number,
  minStart: number,
  maxEnd: number,
): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const pattern = /\s+/gu;
  let match = pattern.exec(text);

  while (match !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (end > maxEnd) {
      break;
    }
    if (start >= minStart) {
      const distance = Math.abs(start - ideal);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { start, end };
      }
    }
    match = pattern.exec(text);
  }

  return best;
}

/**
 * Split `translated` into `parts.length` pieces proportional to each part's
 * visible length. Latin text is split on whitespace when possible; CJK text
 * (no whitespace) may be split at any character boundary. Every returned piece
 * is non-empty and the total content is preserved ignoring whitespace.
 */
export function splitTranslatedText(translated: string, parts: string[]): string[] {
  if (parts.length === 0) {
    return [];
  }
  if (parts.length === 1) {
    return [translated.trim()];
  }

  const text = translated.trim();
  const count = parts.length;
  if (text === '') {
    return parts.map(() => '');
  }

  const weights = parts.map((part) => visibleLength(part));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const effective = totalWeight > 0 ? weights : parts.map(() => 1);
  const effectiveTotal = totalWeight > 0 ? totalWeight : count;

  const pieces: string[] = [];
  let previous = 0;
  let cumulative = 0;

  for (let index = 0; index < count; index += 1) {
    if (index === count - 1) {
      pieces.push(text.slice(previous).trim());
      break;
    }

    cumulative += effective[index] ?? 0;
    const ideal = Math.round((text.length * cumulative) / effectiveTotal);
    const remainingAfter = count - index - 1;
    // Leave at least one character for this piece and for each later piece.
    const lower = previous + 1;
    const upper = Math.max(lower, text.length - remainingAfter);
    const whitespace = findWhitespaceCut(text, ideal, lower, upper);

    let cutStart: number;
    let cutEnd: number;
    if (whitespace !== null && text.slice(previous, whitespace.start).trim() !== '') {
      cutStart = whitespace.start;
      cutEnd = whitespace.end;
    } else {
      const raw = Math.min(Math.max(ideal, lower), upper);
      cutStart = raw;
      cutEnd = raw;
    }

    let piece = text.slice(previous, cutStart).trim();
    if (piece === '') {
      // Fall back to proportional slicing, forcing a non-empty piece.
      const forced = Math.min(Math.max(ideal, lower), upper);
      cutStart = forced;
      cutEnd = forced;
      piece = text.slice(previous, cutStart).trim();
    }

    pieces.push(piece);
    previous = cutEnd;
  }

  return pieces;
}

/**
 * Fallback used when a whole-block translation fails: translate the cues of
 * that block as separate inputs (still one batched call).
 */
async function translateIndividually(
  translator: Translator,
  texts: string[],
  options: TranslatorOptions,
): Promise<string[]> {
  try {
    const translated = await translator.translate(texts.slice(), options);
    return texts.map((text, index) => translated[index] ?? text);
  } catch {
    return texts.slice();
  }
}

/**
 * Translate consecutive cues in context: group them, join each block with a
 * space, translate the blocks, then split the translation back proportionally.
 * If a block translation throws, that block's cues are translated individually.
 * The result always has the same length and order as `cueTexts`.
 */
export async function translateCueTexts(
  translator: Translator,
  cueTexts: string[],
  options: TranslatorOptions,
): Promise<string[]> {
  if (cueTexts.length === 0) {
    return [];
  }

  const groups = groupCueBlocks(cueTexts);
  const results: string[] = [];
  let completedBlocks = 0;

  for (const group of groups) {
    const blockParts = group.map((index) => cueTexts[index] ?? '');
    const blockText = blockParts.join(' ');
    let pieces: string[];

    try {
      const translated = await translator.translate([blockText], {
        ...options,
        onProgress: (percent) => {
          if (options.onProgress === undefined) {
            return;
          }
          const inner = Math.min(Math.max(percent, 0), 100);
          const overall = ((completedBlocks + inner / 100) / groups.length) * 100;
          options.onProgress(Math.round(overall));
        },
      });
      pieces = splitTranslatedText(translated[0] ?? blockText, blockParts);
    } catch {
      pieces = await translateIndividually(translator, blockParts, options);
    }

    for (let index = 0; index < group.length; index += 1) {
      results.push(pieces[index] ?? blockParts[index] ?? '');
    }

    completedBlocks += 1;
    options.onProgress?.(Math.round((completedBlocks / groups.length) * 100));
  }

  return results;
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
