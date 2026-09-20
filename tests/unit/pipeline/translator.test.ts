import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NullTranslator,
  normalizeLanguage,
  routeModelKeys,
  translationRoute,
} from '../../../src/pipeline/translator';

/**
 * The real `@huggingface/transformers` model is never downloaded in unit
 * tests. The dynamic import inside `OpusMtTranslator` is intercepted by this
 * mock so we can drive batching / progress / fallback deterministically.
 */
type PipelineFn = (
  input: string | string[],
  options?: unknown,
) => Promise<Array<{ generated_text: string }>>;

const hf = vi.hoisted(() => {
  const calls: Array<{
    task: string;
    model: string;
    input: string[];
    options?: unknown;
  }> = [];
  const pipeline = vi.fn((task: string, model: string): PipelineFn => {
    return async (input, options) => {
      const list = Array.isArray(input) ? input : [input];
      calls.push({ task, model, input: list, options });
      return list.map((text) => ({ generated_text: `[${text}]` }));
    };
  });
  return { calls, pipeline };
});

vi.mock('@huggingface/transformers', () => ({
  env: {},
  pipeline: hf.pipeline,
}));

/** Fresh module instance so the module-level pipeline cache is empty. */
async function freshTranslator() {
  vi.resetModules();
  const module = await import('../../../src/pipeline/translator');
  return new module.OpusMtTranslator();
}

function echoPipeline(task: string, model: string): PipelineFn {
  return async (input, options) => {
    const list = Array.isArray(input) ? input : [input];
    hf.calls.push({ task, model, input: list, options });
    return list.map((text) => ({ generated_text: `[${text}]` }));
  };
}

beforeEach(() => {
  hf.calls.length = 0;
  hf.pipeline.mockClear();
  hf.pipeline.mockImplementation(echoPipeline);
});

describe('normalizeLanguage', () => {
  it('maps Chinese variants and ISO codes to zh', () => {
    for (const value of ['zh', 'zh-CN', 'zh-TW', 'zh-Hans', 'zh-Hant', 'cmn', 'zho', 'chi']) {
      expect(normalizeLanguage(value)).toBe('zh');
    }
  });

  it('maps Spanish variants and ISO codes to es', () => {
    for (const value of ['es', 'es-ES', 'es-MX', 'spa']) {
      expect(normalizeLanguage(value)).toBe('es');
    }
  });

  it('maps English variants and ISO codes to en', () => {
    for (const value of ['en', 'en-US', 'en-GB', 'eng']) {
      expect(normalizeLanguage(value)).toBe('en');
    }
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(normalizeLanguage('  ZH-cn  ')).toBe('zh');
    expect(normalizeLanguage('SPA')).toBe('es');
    expect(normalizeLanguage('Eng')).toBe('en');
  });

  it('accepts underscore separators', () => {
    expect(normalizeLanguage('zh_CN')).toBe('zh');
    expect(normalizeLanguage('en_US')).toBe('en');
  });

  it('returns unknown for unsupported or missing languages', () => {
    expect(normalizeLanguage('fr')).toBe('unknown');
    expect(normalizeLanguage('de-DE')).toBe('unknown');
    expect(normalizeLanguage('auto')).toBe('unknown');
    expect(normalizeLanguage('')).toBe('unknown');
  });
});

describe('translationRoute', () => {
  it('returns an empty route for the same language', () => {
    expect(translationRoute('es', 'es')).toEqual([]);
    expect(translationRoute('en', 'en')).toEqual([]);
    expect(translationRoute('zh', 'zh')).toEqual([]);
  });

  it('builds a direct route whenever English is one endpoint', () => {
    expect(translationRoute('es', 'en')).toEqual(['es', 'en']);
    expect(translationRoute('en', 'es')).toEqual(['en', 'es']);
    expect(translationRoute('en', 'zh')).toEqual(['en', 'zh']);
    expect(translationRoute('zh', 'en')).toEqual(['zh', 'en']);
  });

  it('pivots es <-> zh through English', () => {
    expect(translationRoute('es', 'zh')).toEqual(['es', 'en', 'zh']);
    expect(translationRoute('zh', 'es')).toEqual(['zh', 'en', 'es']);
  });

  it('normalizes both endpoints before routing', () => {
    expect(translationRoute('zh-CN', 'en')).toEqual(['zh', 'en']);
    expect(translationRoute('spa', 'eng')).toEqual(['es', 'en']);
    expect(translationRoute('cmn', 'es-MX')).toEqual(['zh', 'en', 'es']);
  });

  it('throws for unsupported languages', () => {
    expect(() => translationRoute('fr', 'en')).toThrow(/unsupported/i);
    expect(() => translationRoute('en', 'de')).toThrow(/unsupported/i);
    expect(() => translationRoute('auto', 'en')).toThrow(/unsupported/i);
    expect(() => translationRoute('', 'en')).toThrow(/unsupported/i);
  });
});

describe('routeModelKeys', () => {
  it('maps direct routes to model keys', () => {
    expect(routeModelKeys('es', 'en')).toEqual(['es-en']);
    expect(routeModelKeys('en', 'es')).toEqual(['en-es']);
    expect(routeModelKeys('en', 'zh')).toEqual(['en-zh']);
    expect(routeModelKeys('zh', 'en')).toEqual(['zh-en']);
  });

  it('maps pivoted routes to two model keys', () => {
    expect(routeModelKeys('es', 'zh')).toEqual(['es-en', 'en-zh']);
    expect(routeModelKeys('zh', 'es')).toEqual(['zh-en', 'en-es']);
  });

  it('returns an empty list for the same language', () => {
    expect(routeModelKeys('es', 'es')).toEqual([]);
    expect(routeModelKeys('zh-CN', 'zh-TW')).toEqual([]);
  });

  it('normalizes languages before building keys', () => {
    expect(routeModelKeys('spa', 'cmn')).toEqual(['es-en', 'en-zh']);
    expect(routeModelKeys('eng', 'zh-Hans')).toEqual(['en-zh']);
  });

  it('throws for unsupported pairs', () => {
    expect(() => routeModelKeys('es', 'fr')).toThrow();
    expect(() => routeModelKeys('pt', 'en')).toThrow();
    expect(() => routeModelKeys('auto', 'zh')).toThrow();
  });
});

describe('NullTranslator', () => {
  it('returns the same texts in the same order', async () => {
    const translator = new NullTranslator();
    const texts = ['first', 'second', 'third'];
    const output = await translator.translate(texts, { from: 'es', to: 'zh' });
    expect(output).toEqual(texts);
    expect(output).toHaveLength(texts.length);
  });

  it('returns an empty array for empty input', async () => {
    const translator = new NullTranslator();
    await expect(translator.translate([], { from: 'en', to: 'es' })).resolves.toEqual([]);
  });

  it('does not mutate the caller array', async () => {
    const translator = new NullTranslator();
    const texts = ['a', 'b'];
    const output = await translator.translate(texts, { from: 'en', to: 'es' });
    expect(output).not.toBe(texts);
    expect(texts).toEqual(['a', 'b']);
  });
});

describe('OpusMtTranslator', () => {
  it('returns [] without loading a model for empty input', async () => {
    const translator = await freshTranslator();
    await expect(translator.translate([], { from: 'es', to: 'en' })).resolves.toEqual([]);
    expect(hf.pipeline).not.toHaveBeenCalled();
  });

  it('is a no-op for the same language and never loads a model', async () => {
    const translator = await freshTranslator();
    const output = await translator.translate(['hola', 'mundo'], { from: 'es', to: 'es' });
    expect(output).toEqual(['hola', 'mundo']);
    expect(hf.pipeline).not.toHaveBeenCalled();
  });

  it('translates one hop with the right model, options and order', async () => {
    const translator = await freshTranslator();
    const output = await translator.translate(['uno', 'dos'], { from: 'es', to: 'en' });

    expect(output).toEqual(['[uno]', '[dos]']);
    expect(hf.calls).toHaveLength(1);
    expect(hf.calls[0]?.model).toBe('Xenova/opus-mt-es-en');
    expect(hf.calls[0]?.task).toBe('text2text-generation');
    expect(hf.calls[0]?.options).toEqual({ max_new_tokens: 256 });
  });

  it('runs the pipeline in batches of 8', async () => {
    const translator = await freshTranslator();
    const texts = Array.from({ length: 10 }, (_, index) => `s${index}`);
    const output = await translator.translate(texts, { from: 'es', to: 'en' });

    expect(output).toHaveLength(10);
    expect(hf.calls).toHaveLength(2);
    expect(hf.calls[0]?.input).toHaveLength(8);
    expect(hf.calls[1]?.input).toHaveLength(2);
  });

  it('pivots through English and preserves order across both models', async () => {
    const translator = await freshTranslator();
    const output = await translator.translate(['hola'], { from: 'es', to: 'zh' });

    expect(output).toEqual(['[[hola]]']);
    expect(hf.calls.map((call) => call.model)).toEqual([
      'Xenova/opus-mt-es-en',
      'Xenova/opus-mt-en-zh',
    ]);
  });

  it('trims generated text', async () => {
    const translator = await freshTranslator();
    hf.pipeline.mockImplementation((task, model): PipelineFn => {
      return async (input, options) => {
        const list = Array.isArray(input) ? input : [input];
        hf.calls.push({ task, model, input: list, options });
        return list.map((text) => ({ generated_text: `   [${text}]   ` }));
      };
    });

    await expect(translator.translate(['uno'], { from: 'es', to: 'en' })).resolves.toEqual([
      '[uno]',
    ]);
  });

  it('falls back to the input text when the output is empty', async () => {
    const translator = await freshTranslator();
    hf.pipeline.mockImplementation((task, model): PipelineFn => {
      return async (input, options) => {
        const list = Array.isArray(input) ? input : [input];
        hf.calls.push({ task, model, input: list, options });
        return list.map((text) => ({ generated_text: text === 'B' ? '   ' : `[${text}]` }));
      };
    });

    await expect(translator.translate(['A', 'B', 'C'], { from: 'es', to: 'en' })).resolves.toEqual([
      '[A]',
      'B',
      '[C]',
    ]);
  });

  it('reports progress proportionally across hops and batches', async () => {
    const translator = await freshTranslator();
    const texts = Array.from({ length: 10 }, (_, index) => `s${index}`);
    const percents: number[] = [];

    await translator.translate(texts, {
      from: 'es',
      to: 'en',
      onProgress: (percent) => percents.push(percent),
    });

    // 10 inputs -> two batches, each worth 50%.
    expect(percents).toEqual([50, 100]);
  });

  it('reports progress across a two-hop route', async () => {
    const translator = await freshTranslator();
    const percents: number[] = [];

    await translator.translate(['hola'], {
      from: 'es',
      to: 'zh',
      onProgress: (percent) => percents.push(percent),
    });

    // One batch per hop, two hops -> 50 then 100.
    expect(percents).toEqual([50, 100]);
    expect(percents.at(-1)).toBe(100);
  });

  it('caches one pipeline per model', async () => {
    const translator = await freshTranslator();
    await translator.translate(['a'], { from: 'es', to: 'en' });
    await translator.translate(['b'], { from: 'es', to: 'en' });

    // pipeline() is invoked once per model; the cached callable is reused.
    expect(hf.pipeline).toHaveBeenCalledTimes(1);
    expect(hf.calls).toHaveLength(2);
  });

  it('normalizes languages before selecting models', async () => {
    const translator = await freshTranslator();
    await translator.translate(['hola'], { from: 'spa', to: 'eng' });
    expect(hf.calls[0]?.model).toBe('Xenova/opus-mt-es-en');
  });
});
