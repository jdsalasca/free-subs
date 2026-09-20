# SPEC — ASS subtitles + video export (burn-in)

You own ONLY these files:
- `src/core/ass.ts` (new)
- `src/server/exporter.ts` (new)
- `tests/unit/core/ass.test.ts` (new)
- `tests/unit/server/exporter.test.ts` (new)
- appending one export line to `src/core/index.ts` (`export * from './ass';`)

Do NOT modify anything else. `src/core/types.ts` is the frozen contract: `SubtitleExportStyle`, `DEFAULT_EXPORT_STYLE`, `SubtitleCue`.

## `src/core/ass.ts`
```ts
export interface AssOptions { width: number; height: number; title?: string; }
export function serializeAss(cues: SubtitleCue[], style: SubtitleExportStyle, options: AssOptions): string;
export function hexToAssColor(hex: string, opacity?: number): string; // "#ffffff" -> "&H00FFFFFF"
```
Rules:
- Output a valid ASS v4.00+ file:
  - `[Script Info]`: `ScriptType: v4.00+`, `PlayResX`, `PlayResY`, `WrapStyle: 0`, `ScaledBorderAndShadow: yes`.
  - `[V4+ Styles]` with the standard `Format:` line and one `Default` style:
    - `Fontname`, `Fontsize`, `Bold` (-1/0), `PrimaryColour`, `OutlineColour`, `BackColour` (background color with alpha), `BorderStyle` (1 = outline+shadow, 3 = opaque box when `style.background`), `Outline`, `Shadow`, `Alignment` (2 bottom, 8 top, 5 middle), `MarginL/MarginR` = 20, `MarginV` = `style.marginV`, `Encoding: 1`.
  - `[Events]` with the standard `Format:` line; one `Dialogue` per cue:
    - Start/End in `H:MM:SS.cc` (centiseconds, zero-padded hours allowed 1+ digits).
    - Multi-line text joined with `\N` (hard break). Escape `{` and `}` (replace with `(` and `)`).
    - `Layer: 0`, `Style: Default`, `MarginL/R: 0`, `MarginV: 0`, `Effect: ` empty.
- `hexToAssColor`: ASS stores `&HAABBGGRR`; alpha 00 = opaque, FF = transparent. `opacity` defaults to 1 (opaque). Invalid hex → throw.
- No trailing spaces on lines; file ends with a final newline.

## `src/server/exporter.ts`
```ts
export interface FfmpegPlan { args: string[]; outputPath: string; }
export function escapeFilterPath(filePath: string): string; // windows-safe for ass= filter
export function buildBurnInArgs(inputPath: string, assPath: string, outputPath: string): string[];
export function parseFfmpegTime(line: string): number | null; // ms from "time=00:00:05.23"
export async function probeDurationMs(inputPath: string): Promise<number | null>; // ffprobe, null on failure
export async function exportVideo(
  inputPath: string,
  assPath: string,
  outputPath: string,
  durationMs: number | null,
  onProgress?: (percent: number) => void,
): Promise<void>;
export function ffmpegSupportsAss(ffmpegPath: string): boolean; // check `-filters` output for " ass "
```
Rules:
- `escapeFilterPath`: convert `\` to `/`, escape `:` as `\:`, wrap in single quotes only if needed; the result must work inside `-vf ass=<value>` on Windows and POSIX. Example: `C:\a b\subs.ass` → `'C\:/a b/subs.ass'`.
- `buildBurnInArgs`: `-y -hide_banner -i <input> -vf ass=<escaped> -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 192k -movflags +faststart <output>`.
- `exportVideo`: spawn the resolved ffmpeg (`resolveFfmpeg` from `../pipeline/audio`), stream stderr, call `onProgress` when `time=` lines parse and `durationMs` is known, reject on non-zero exit with the last stderr lines. Throw a clear error when ffmpeg or libass is missing.
- `probeDurationMs`: `ffprobe -v error -show_entries format=duration -of csv=p=0 <input>`.
- Keep everything testable: unit tests must not spawn real ffmpeg except `ffmpegSupportsAss` (skip when ffmpeg is absent) — test arg building, escaping, time parsing with synthetic strings.

## Tests (TDD: red first)
- `ass.test.ts`: color conversion (white, black, custom + opacity), header contains PlayRes and style fields, alignment mapping for the 3 positions, multi-line `\N` join, brace escaping, centisecond timestamps, empty cues still produce a valid header.
- `exporter.test.ts`: escaping (windows path with spaces and colon, posix path), args contain `-vf ass=` and output last, `parseFfmpegTime` cases (`time=00:00:05.23`, `time=01:02:03.00`, garbage → null), `probeDurationMs` returns null for a missing file, `ffmpegSupportsAss` on the local ffmpeg (skip if unavailable).

## Acceptance
- `npx vitest run tests/unit/core/ass.test.ts tests/unit/server/exporter.test.ts` → green.
- `npx tsc --noEmit` clean in your files.
- Report files, test count, red→green evidence, deviations.
