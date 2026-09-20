# SPEC — Context-aware cue translation

You own ONLY:
- `src/pipeline/translator.ts` (additive changes)
- `tests/unit/pipeline/translator-context.test.ts` (new)

Do NOT touch anything else. Keep the existing `translate()` behaviour and all current tests green.

## Why
Cue-by-cue translation loses context (the educational-content complaint). Translate short blocks of
consecutive cues together, then split the translated text back proportionally, keeping the timings.

## API (additive)
```ts
export function groupCueBlocks(cueTexts: string[], options?: { maxCues?: number; maxChars?: number }): number[][];
// default maxCues = 6, maxChars = 400; returns arrays of consecutive indices; never empty groups.

export function splitTranslatedText(translated: string, parts: string[]): string[];
// Splits `translated` into parts.length pieces proportional to each part's visible length
// (CJK chars count 1 each; whitespace collapsed). Prefer whitespace boundaries for latin text,
// any boundary for CJK; every piece must be non-empty (fall back to proportional slicing).
// parts.length === 1 -> [translated.trim()].

export async function translateCueTexts(
  translator: Translator,
  cueTexts: string[],
  options: TranslatorOptions,
): Promise<string[]>;
// group -> join block with ' ' -> translator.translate(blocks) -> splitTranslatedText -> flatten.
// If a block translation throws, fall back to translating that block's cues individually.
// onProgress is forwarded and scaled 0..100 across blocks; result length === cueTexts.length.
```

## Tests (TDD: red first)
- `groupCueBlocks`: empty input; single cue; respects maxCues; respects maxChars; consecutive indices.
- `splitTranslatedText`: single part; two uneven latin parts (split at a whitespace boundary); CJK text (no spaces); every part non-empty; total content preserved (ignoring whitespace).
- `translateCueTexts` with a stub `Translator` (records the texts it receives): blocks are joined; order and length preserved; fallback path when the block call throws; progress reaches 100.

## Acceptance
- `npx vitest run tests/unit/pipeline/translator.test.ts tests/unit/pipeline/translator-context.test.ts` → green.
- `npx tsc --noEmit` clean in your files.
- Report: files, test count, red→green evidence, deviations.
