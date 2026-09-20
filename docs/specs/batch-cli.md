# SPEC — Batch mode (CLI)

You own ONLY:
- `src/pipeline/batch.ts` (new), `src/cli.ts` (modify)
- `tests/unit/pipeline/batch.test.ts` (new)

Do NOT touch `src/core`, `src/server`, `src/client`, other tests.
`src/pipeline/study.ts` (created by a parallel agent) exports:
`buildStudyDocument({language, durationMs, cues, translations})` and `serializeStudy(doc)`.

## batch.ts
```ts
export const MEDIA_EXTENSIONS: string[];   // .mp3 .wav .m4a .flac .ogg .opus .aac .mp4 .mkv .mov .webm
export function listMediaFiles(dir: string): string[];   // top-level, sorted, hidden files skipped
export interface BatchSummary { total: number; succeeded: number; failed: number; errors: { file: string; error: string }[] }
export async function runBatch(
  files: string[],
  processFile: (file: string) => Promise<void>,
  options?: { onEvent?: (event: { type: 'start' | 'done' | 'error'; file: string; error?: string }) => void },
): Promise<BatchSummary>;
```
- Sequential processing; a failing file never aborts the batch; the summary counts everything.

## cli.ts (modify)
- Usage: `free-subs <path> --batch [options]`.
  - `<path>` must be a directory when `--batch` is set (clear error otherwise).
  - New options: `--batch`, `--translate <langs>` (comma-separated, e.g. `es,en,zh`; single language still works),
    existing `-l`, `-m`, `--vocals`, `-o` (output directory for batch), `--format` now accepts `json` too.
  - For each media file: transcribe -> optional translations (use `translateCueTexts` from `../pipeline/translator`
    for context-aware blocks) -> write `<basename>.<format>` next to the input (or in `-o <dir>`).
  - `--format json` writes the study document (`buildStudyDocument` + `serializeStudy`) including all done translations.
  - Progress per file on stderr; per-file result on stdout; final summary (`succeeded/failed`) and exit code 1 when any file failed.
- Single-file mode keeps working exactly as today (including `-f json` writing a study JSON).

## Tests (TDD: red first)
- `listMediaFiles`: filters by extension, sorts, skips hidden and directories.
- `runBatch`: order, summary counts, continues after an error, `onEvent` sequence.
- CLI: keep it thin — the batch logic must live in `batch.ts` so it is testable without spawning.

## Acceptance
- `npx vitest run tests/unit/pipeline/batch.test.ts` → green.
- `npx tsup src/server/index.ts src/cli.ts --format esm --out-dir dist --clean false` succeeds; `node dist/cli.js --help` shows the new flags.
- `npx tsc --noEmit` clean in your files.
- Report: files, test count, red→green evidence, deviations.
