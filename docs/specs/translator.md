# SPEC — Local translation engine (ES / EN / ZH)

You own ONLY these files:
- `src/pipeline/translator.ts` (new)
- `tests/unit/pipeline/translator.test.ts` (new)

Do NOT modify anything else. Import types from `../core`.

## Goal
Translate subtitle cues locally (no cloud) using Transformers.js OPUS-MT models, keeping original timings.

## API
```ts
export interface TranslatorOptions {
  from: string;              // 'es' | 'en' | 'zh' (detected or selected)
  to: string;                // 'es' | 'en' | 'zh'
  onProgress?: (percent: number) => void;
}

export interface Translator {
  translate(texts: string[], options: TranslatorOptions): Promise<string[]>;
}

/** Ordered list of language hops needed to go from `from` to `to` ([] when equal). */
export function translationRoute(from: string, to: string): string[];

/** Route as model keys, e.g. ['es-en','en-zh'] for es -> zh. Throws for unsupported languages. */
export function routeModelKeys(from: string, to: string): string[];

export class OpusMtTranslator implements Translator { ... }
```

## Model registry (verified against Hugging Face)
```
es-en: Xenova/opus-mt-es-en
en-es: Xenova/opus-mt-en-es
en-zh: Xenova/opus-mt-en-zh
zh-en: Xenova/opus-mt-zh-en
```
- es↔zh pivots through English (`es -> en -> zh`), so `translationRoute('es','zh')` = `['es','en','zh']`.
- Same language → no-op (returns inputs unchanged, no model loaded).
- Unknown language → throw `Error` with a clear message.
- Language normalization: accept `zh-CN`, `zh-TW`, `cmn`, `zh-Hans` etc. → `zh`; `spa` → `es`; `eng` → `en`.

## Engine
- Lazy dynamic import of `@huggingface/transformers` (same pattern as `engine-transformers.ts`).
- One `text2text-generation` pipeline cached per model key (module-level Map of Promises).
- `translate(texts, options)`:
  - Empty array → `[]` fast path.
  - For each hop: run the pipeline in batches of 8 with `{ max_new_tokens: 256 }`; collect outputs in order; call `onProgress` proportionally (0..100 across all hops and batches).
  - Preserve input order and length; trim outputs; if an output is empty, fall back to the input text.
  - `source_lang`/`target_lang` options are NOT used (OPUS-MT models are fixed-pair).
- Also export `class NullTranslator implements Translator` that returns texts unchanged (useful for tests and as a safe default).

## Tests (TDD: red first)
- `translationRoute`: same language → `[]`; es→en → `['es','en']`; es→zh → `['es','en','zh']`; zh→es → `['zh','en','es']`; unsupported → throws.
- `routeModelKeys`: correct keys per route; throws for unsupported pairs.
- Language normalization (zh-CN → zh, spa → es...).
- `NullTranslator` returns identical arrays (same length/order).
- Do NOT call the real model in unit tests. If you want an integration smoke test, gate it behind `process.env.FREE_SUBS_TRANSLATE_SMOKE === '1'`.

## Acceptance
- `npx vitest run tests/unit/pipeline/translator.test.ts` → green.
- `npx tsc --noEmit` clean in your files.
- Report files, tests, red→green evidence, deviations.
