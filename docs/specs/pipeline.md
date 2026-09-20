# SPEC — `src/pipeline` + `src/server` + `src/cli.ts` (ASR pipeline & app, TDD)

You own ONLY these files:
- `src/pipeline/audio.ts`, `src/pipeline/vad.ts`, `src/pipeline/language.ts`, `src/pipeline/asr.ts`, `src/pipeline/engine-transformers.ts`, `src/pipeline/transcribe.ts`
- `src/server/jobs.ts`, `src/server/app.ts`, `src/server/index.ts`
- `src/cli.ts`
- `tests/unit/pipeline/*.test.ts`

NEVER edit `src/core/*` (another agent owns it; signatures are frozen), configs, client, or e2e.

## Dependencies already installed
`express` (v4), `@huggingface/transformers` (v3), `commander`. ffmpeg is on PATH (also support `FREE_SUBS_FFMPEG` env).

## Interfaces (frozen)
```ts
// audio.ts
export interface DecodedAudio { samples: Float32Array; sampleRate: number; durationMs: number; channels: number; }
export function decodeWav(buf: Buffer | Uint8Array): DecodedAudio;
export function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array;
export async function loadAudioFile(path: string): Promise<DecodedAudio>; // WAV direct; else ffmpeg → f32le 16k mono
export function resolveFfmpeg(): string | null;
// vad.ts
export interface SpeechRegion { startMs: number; endMs: number; }
export function detectSpeechRegions(samples: Float32Array, sampleRate: number): SpeechRegion[];
export function trimToSpeech(samples: Float32Array, sampleRate: number): Float32Array;
// language.ts
export function detectLanguageFromText(text: string): string; // 'es' | 'en' | 'zh' | 'unknown'
// asr.ts
export interface AsrOptions { language?: LanguageCode; model?: ModelId; onProgress?: (percent: number, stage: string) => void; }
export interface AsrOutput { language: string; segments: TranscriptSegment[]; durationMs: number; }
export interface AsrEngine { id: string; transcribe(audio: Float32Array, sampleRate: number, opts: AsrOptions): Promise<AsrOutput>; }
// transcribe.ts
export interface TranscribeOptions { language?: LanguageCode; model?: ModelId; style?: SubtitleStyle; engine?: AsrEngine; onProgress?: (progress: JobProgress) => void; }
export async function transcribeFile(path: string, filename: string, opts?: TranscribeOptions): Promise<TranscriptionResult>;
```
Import core functions from `../core` (implemented in parallel; signatures in `docs/specs/core.md`).

## audio.ts rules
- `decodeWav`: parse RIFF; support PCM int 8/16/24/32 and float32; any channels → mono mixdown in `samples`; keep original `channels` count; `sampleRate` from header; `durationMs = samples.length / sampleRate * 1000`.
- `resampleLinear`: linear interpolation, identity when equal rates, empty stays empty.
- `resolveFfmpeg`: `process.env.FREE_SUBS_FFMPEG` if it exists → else `ffmpeg-static` if importable (optional dep) → else `ffmpeg` on PATH → else null.
- `loadAudioFile`: `.wav` → read + decodeWav + resample to 16000 (mono already). Other extensions → spawn ffmpeg: `-v error -i <path> -f f32le -ac 1 -ar 16000 pipe:1`, collect stdout as Float32Array. Throw a clear Error if ffmpeg missing.

## vad.ts rules
Frame 20 ms, hop 10 ms. RMS + zero-crossing rate. Adaptive threshold = max(0.005, p10(RMS) * 2.5). Speech frame = rms > threshold && zcr < 0.35. Hangover 200 ms; drop speech < 300 ms; merge gaps < 300 ms; pad 100 ms; clamp to audio bounds. No speech → `[]`; `trimToSpeech` returns original samples when no regions, else slices first.start−100 ms … last.end+100 ms.

## language.ts rules
- Any CJK chars present → `'zh'`.
- Else stopword scoring: es (`el,la,los,las,de,que,y,en,un,una,es,por,con,para,no,se,del,al`) vs en (`the,of,and,to,in,is,it,you,that,he,was,for,on,are,as,with,his,they`). Word-boundary, case-insensitive; higher count wins; tie or 0 hits → `'unknown'`.

## engine-transformers.ts
- Model map: `tiny → 'Xenova/whisper-tiny'`, `base → 'Xenova/whisper-base'`, `small → 'Xenova/whisper-small'`.
- Cache one pipeline per model id (module-level Map). Create with `pipeline('automatic-speech-recognition', model, { dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' } })`; if that throws, retry without `dtype`.
- `transcribe(audio, sampleRate, opts)`:
  - `onProgress(5, 'loading-model')` before pipeline creation, `onProgress(30, 'transcribing')` before inference.
  - Call with `{ language: opts.language !== 'auto' ? opts.language : undefined, task: 'transcribe', return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 }`.
  - If word-timestamps mode throws, retry with `return_timestamps: true` (segment chunks).
  - Word mode: output chunks are words → group into segments: new segment when gap > 700 ms OR previous word ends with strong punctuation (`.!?…。！？`); each segment gets `words` (trimmed) and start/end from its words.
  - Segment mode: map chunks directly to `TranscriptSegment` (no `words`).
  - `language`: if `opts.language !== 'auto'` use it; else `detectLanguageFromText(fullText)`.
  - Report progress by chunks processed when available (optional), else approximate 30→80.
- Export `class TransformersWhisperEngine implements AsrEngine { id = 'transformers-whisper'; }`.

## transcribe.ts
Orchestrate with `onProgress` stages: decoding 5–15, analyzing 15–25, loading-model 25–40, transcribing 40–85, formatting 85–95, done 100.
1. `loadAudioFile(path)`; 2. `trimToSpeech`; 3. engine (default `new TransformersWhisperEngine()`); 4. resolve language (`opts.language` if not auto, else engine output); 5. `style = opts.style ?? styleForLanguage(lang)`; 6. `cues = segmentsToCues(engine.segments, style, lang)`; 7. `srt`/`vtt`; 8. stats: cueCount, wordCount (from segments words or token count), avgCps, maxCps, durationMs.

## server/jobs.ts
In-memory `JobStore`: `create(filename): JobRecord`, `get(id)`, `update(id, patch)`, `delete(id)`, `cleanupOlderThan(ms)`; `crypto.randomUUID()` ids; ISO createdAt. No intervals needed (call cleanup opportunistically).

## server/app.ts
`export function createApp(store: JobStore, deps?: { transcribe?: typeof transcribeFile }): express.Express`
- `GET /api/health` → `{ status: 'ok', name: 'free-subs', version: '0.1.0' }`
- `GET /api/models` → `{ models: ['tiny','base','small'], languages: ['auto','es','en','zh'] }`
- `POST /api/jobs?language=&model=&filename=` with raw body (`express.raw({ type: () => true, limit: '500mb' })`): validate model/language in allowed lists and body non-empty (400); sanitize filename with `path.basename`; write buffer to `os.tmpdir()/free-subs/<id><ext>`; create job; respond `202 { id }`; run `transcribeFile` in background updating store progress; on success store `result` + status done; on error status error + message; always delete temp file.
- `GET /api/jobs/:id` → JobRecord (404 unknown).
- `GET /api/jobs/:id/download?format=srt|vtt` → 400 invalid, 404 unknown/not done; headers: SRT `application/x-subrip; charset=utf-8`, VTT `text/vtt; charset=utf-8`, `Content-Disposition: attachment; filename="<basename>.<ext>"`.
- Static: if `dist/client` exists (resolve via `fileURLToPath(new URL('./client/', import.meta.url))`) serve it + SPA fallback for non-`/api` GETs; else respond 404 JSON hint.
- JSON error middleware.

## server/index.ts
Wire store + app, listen `process.env.PORT ?? 8787`, log `Free Subs running at http://localhost:<port>`, handle SIGINT gracefully.

## cli.ts
`#!/usr/bin/env node` + commander: `free-subs <file>`, options `-l/--language` (auto|es|en|zh, default auto), `-m/--model` (tiny|base|small, default base), `-f/--format` (srt|vtt, default srt), `-o/--output <path>`, `--stdout`. Progress to stderr (`[42%] transcribing`). Writes file (default `<input basename>.<format>`) and prints summary (language, cues, duration). Exit code 1 on error with clear message.

## Tests (TDD — write first, red, then green)
`tests/unit/pipeline/`: audio.test.ts (in-memory WAV builders: 16-bit mono, 16-bit stereo, float32; decode values; resample; resolveFfmpeg; loadAudioFile on `tests/e2e/fixtures/hello-en.wav` when it exists — else skip), vad.test.ts (sine vs silence), language.test.ts (es/en/zh/unknown), jobs.test.ts (CRUD), app.test.ts (start on port 0 with a STUB transcribe that returns a fixed TranscriptionResult; test health, models, 400s, job lifecycle, download headers/content).
Do NOT call the real model in unit tests.

## Acceptance
- `npx vitest run tests/unit/pipeline` → all pass.
- `npx tsup src/server/index.ts src/cli.ts --format esm --out-dir dist --clean false` succeeds.
- `node dist/cli.js --help` prints usage.
- `npx tsc --noEmit` has no errors in your files.
