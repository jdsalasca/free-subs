# SPEC — Pinyin + stable "study" JSON

You own ONLY:
- `src/pipeline/pinyin.ts` (new), `src/pipeline/study.ts` (new)
- `src/pipeline/transcribe.ts` (small additive change: annotate Chinese cues)
- `tests/unit/pipeline/{pinyin,study}.test.ts` (new)

Do NOT touch `src/core` (the `SubtitleCue.pinyin?: string` field is already added and frozen), `src/server`, `src/cli.ts`, `src/client`, existing tests.

## Dependency
Run `npm install pinyin-pro`. Verify it imports under Node ESM. If it does not, use the `pinyin` package instead and document the choice.

## pinyin.ts
```ts
export function toPinyin(text: string): string;            // tone marks: "你好，世界" -> "nǐ hǎo, shì jiè"
export function pinyinForWords(words: Array<{ text: string }>): string[];   // one pinyin string per word
export function annotateCuesWithPinyin(cues: SubtitleCue[]): SubtitleCue[]; // returns new cues with `pinyin`
```
- Punctuation is preserved in the pinyin output; non-Chinese words are left as-is.
- `annotateCuesWithPinyin` sets `pinyin = toPinyin(cue.lines.join(' '))` on a copy (do not mutate inputs; keep `words` untouched).

## study.ts — STABLE CONTRACT (do not rename fields)
```ts
export interface StudyWord { text: string; startMs: number; endMs: number; pinyin?: string }
export interface StudyCue { startMs: number; endMs: number; lines: string[]; words: StudyWord[]; pinyin?: string }
export interface StudyTranslation { cues: StudyCue[] }
export interface StudyDocument {
  version: 1;
  language: string;
  durationMs: number;
  cues: StudyCue[];
  translations: Record<string, StudyTranslation>;
}
export function buildStudyDocument(input: {
  language: string;
  durationMs: number;
  cues: SubtitleCue[];
  translations?: Record<string, SubtitleCue[]>;
}): StudyDocument;
export function serializeStudy(doc: StudyDocument): string;  // JSON.stringify(doc, null, 2) + "\n"
```
Rules:
- `words` is always an array (empty when the cue has no word timings) — never null/undefined.
- `pinyin` is present (string) only for Chinese cues (language `zh*`) and for Chinese translations; absent otherwise.
- `translations` defaults to `{}`; include every provided language.
- Deterministic key order (build objects explicitly in the documented order).

## transcribe.ts (additive)
- When the resolved language is Chinese (`zh*`), run `annotateCuesWithPinyin` on the final cues so `TranscriptionResult.cues` carry `pinyin`. Everything else stays identical.

## Tests (TDD: red first)
- pinyin: tone marks for a sample phrase; punctuation preserved; empty string; mixed latin+CJK; per-word alignment.
- study: zh document has cue + word pinyin; en document has none; translations included; words always arrays; `JSON.parse(serializeStudy(doc))` round-trips; stable snapshot of the key order.
- transcribe: (if not already covered) a stub-engine zh run produces cues with pinyin.

## Acceptance
- `npx vitest run tests/unit/pipeline` → ALL green.
- `npx tsc --noEmit` clean in your files.
- Report: files, test count, red→green evidence, deviations.
