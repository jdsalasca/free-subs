# SPEC — `src/core` (subtitle engine, pure functions, TDD)

You own ONLY these files:
- `src/core/time.ts`, `src/core/text.ts`, `src/core/wrap.ts`, `src/core/segment.ts`, `src/core/format.ts`, `src/core/index.ts`
- `tests/unit/core/*.test.ts`

NEVER edit `src/core/types.ts` (frozen contract), configs, or anything outside your ownership.

## Workflow (TDD is mandatory)
1. For each module: write the test file FIRST, run it, see it FAIL (red).
2. Implement the module, run again until GREEN.
3. Final evidence: `npx vitest run tests/unit/core` (all green) and `npx tsc --noEmit 2>&1 | Select-String "src/core|tests/unit/core"` (no output = no type errors in your scope).
4. Report: files created, test count, red→green evidence, deviations.

TypeScript is strict with `noUncheckedIndexedAccess` (array access returns `T | undefined`). No `any`. No external deps. ESM, extensionless relative imports (`./types`).

## time.ts
```ts
export function formatSrtTimestamp(ms: number): string; // "HH:MM:SS,mmm", negatives → "00:00:00,000"
export function formatVttTimestamp(ms: number): string; // "HH:MM:SS.mmm"
export function parseTimestamp(ts: string): number;     // accepts both separators; throws on invalid
```
Tests: 0, 1, 999, 1000, 3661234 ("01:01:01,234"), 3600000, negative, round-trip parse.

## text.ts
```ts
export function isCjkLanguage(lang: string): boolean;      // zh*, cmn, ja*, ko* (case-insensitive prefix)
export function styleForLanguage(lang: string): SubtitleStyle; // CJK_STYLE or DEFAULT_STYLE
export function detectScript(text: string): 'latin' | 'cjk' | 'mixed';
export function normalizeWhitespace(text: string): string;  // collapse runs, trim
export function normalizeForSubtitles(text: string, lang: string): string;
export function visibleLength(text: string): number;        // non-space chars
export function splitSentences(text: string, lang: string): string[];
export function tokenize(text: string, lang: string): string[]; // latin: words; CJK: one token per char
```
Rules:
- `detectScript`: count CJK chars (`\u4e00-\u9fff\u3400-\u4dbf`) and latin letters. cjk>0 && latin>0 → mixed unless one side <15% of total → dominant side.
- `normalizeForSubtitles`: trim, collapse whitespace; remove spaces between CJK chars; normalize `“”‘’` → `"'`; remove zero-width chars.
- `splitSentences`: split after `[.!?…。！？；;]` (plus trailing closing quotes/brackets) when followed by space/end. Never split on decimal numbers ("3.14"). Keep punctuation attached.
- `tokenize` latin: split on whitespace; CJK: every CJK char is a token, latin runs stay words.
Tests: scripts (en/es/zh), CJK space removal, quote normalization, decimals not split, sentences en/es/zh, tokens.

## wrap.ts
```ts
export function wrapLines(text: string, style: SubtitleStyle, lang: string): string[];
```
- Latin: if text fits in 1 line → 1 line. Else distribute words across ≤ `style.maxLines` lines with a DP that minimizes the maximum line length (balanced lines), each line ≤ `maxCharsPerLine` when possible.
- A single word longer than the limit is allowed to overflow (never break words).
- Never return more than `maxLines` lines; if text cannot fit, keep balanced DP and let the last line overflow minimally.
- CJK: break between chars; never start a line with closing punctuation `、。，！？：；」』）】》`; never end a line with opening `「『（【《`; never return more than `maxLines`.
Tests: 1 line, 2 balanced lines, single long word, CJK punctuation rules, empty string → `[]`.

## segment.ts
```ts
export function distributeWords(text: string, startMs: number, endMs: number, lang: string): WordTiming[];
export function chunkWordsByCapacity(words: WordTiming[], style: SubtitleStyle, lang: string): WordTiming[][];
export function segmentsToCues(segments: TranscriptSegment[], style: SubtitleStyle, lang: string): SubtitleCue[];
export function mergeShortCues(cues: SubtitleCue[], style: SubtitleStyle, lang: string): SubtitleCue[];
export function fixOverlaps(cues: SubtitleCue[], minGapMs: number): SubtitleCue[];
export function computeCps(cue: SubtitleCue): number; // visible chars / seconds, 0 if duration<=0
export function reindex(cues: SubtitleCue[]): SubtitleCue[];
```
Rules:
- `distributeWords`: weight per token = `visibleLength(token)` (min 1). Duration split proportionally; timings monotonic; first starts at startMs, last ends exactly at endMs; equal zero-length if `endMs <= startMs`.
- `chunkWordsByCapacity`: max total = `maxCharsPerLine * maxLines`; accumulate words while they fit (join with a space for latin, no space for CJK). Close a chunk EARLY when it already ends with strong punctuation (`.!?…。！？`) and its length ≥ 25% of max total. A chunk always contains ≥1 word.
- `segmentsToCues`: normalize text; use `segment.words` if present else `distributeWords`; chunk; per chunk build cue with word timings sliced from that chunk; `lines = wrapLines(text, style, lang)`; then `mergeShortCues` → `fixOverlaps(cues, style.minGapMs)` → `reindex`.
- `mergeShortCues`: cue with duration < `minDurationMs`:
  1. try merge with NEXT if combined duration ≤ `maxDurationMs` and combined text fits capacity → merged cue (keep words of both).
  2. else merge with PREVIOUS under same limits.
  3. else extend `endMs` toward `minDurationMs`, capped by `nextStart - minGapMs` and `startMs + maxDurationMs`.
- `fixOverlaps`: clamp previous end to `next.startMs - minGapMs`; drop cues where `endMs <= startMs` after clamping; keep order.
- `computeCps`: total visible chars of all lines / duration seconds.
Tests (minimum): distribution sum/monotonicity/CJK; capacity splitting + early punctuation close; end-to-end segmentsToCues with synthetic words; merge short into next and into previous; extension cap; overlap fixing + dropping; reindex; cps math.

## format.ts
```ts
export function serializeSrt(cues: SubtitleCue[]): string;
export function serializeVtt(cues: SubtitleCue[], opts?: { karaoke?: boolean }): string;
```
- SRT: `index\nHH:MM:SS,mmm --> HH:MM:SS,mmm\nline1\nline2\n\n` blocks joined by `\n\n`, file ends with exactly one `\n`. CRLF not used.
- VTT: header `WEBVTT\n\n`, no cue ids, `HH:MM:SS.mmm --> HH:MM:SS.mmm`, same line rules. Karaoke mode (only when `opts.karaoke` and cue.words present): inline `<HH:MM:SS.mmm>` before each word on each line, words of a line joined with spaces.
Tests: exact-string SRT/VTT for a 2-cue fixture; karaoke output; empty cues → SRT `""`, VTT `"WEBVTT\n\n"`.

## index.ts
Re-export everything from time/text/wrap/segment/format (types re-exported too).

## Acceptance
- `npx vitest run tests/unit/core` → all pass, ≥ 45 tests.
- `npx tsc --noEmit` shows no errors in `src/core` or `tests/unit/core`.
