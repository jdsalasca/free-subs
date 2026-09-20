# SPEC — Algorithms v2: acoustic robustness + Mandarin + post-processing

You own ONLY these files:
- `src/pipeline/fft.ts`, `src/pipeline/loudness.ts`, `src/pipeline/denoise.ts`, `src/pipeline/postprocess.ts`, `src/pipeline/zh.ts` (new)
- `src/pipeline/engine-transformers.ts`, `src/pipeline/transcribe.ts` (modify)
- `tests/unit/pipeline/{fft,loudness,denoise,postprocess,zh}.test.ts` (new)

You may run `npm install opencc-js` (adds the dependency). Do NOT touch anything else
(`src/core`, `src/server`, `src/cli.ts`, `src/client`, existing tests).

## Research basis (2024-2026) — implement exactly this subset
- arXiv:2501.11378 (ICASSP'25): VAD + de-loop + BoH removal is the single biggest hallucination/WER lever. Aggressive denoising did NOT help Whisper → conservative, SNR-gated, dry/wet mixing. Greedy decoding (beam 1) minimizes hallucinations.
- arXiv:2408.16589 (CrisperWhisper): drop word tokens with duration < 50 ms.
- HuggingFace Whisper DTW: median filter on timestamps (width 5-7), clamp movement.
- transformers.js bug #1357: use `chunk_length_s: 29` (30 breaks timestamps).
- Mandarin: force simplified output, Chinese BoH list, strip spaces between CJK chars.

## Modules (TDD: tests first, red → green)

### fft.ts
```ts
export function fft(re: Float64Array, im: Float64Array): void;   // in-place iterative radix-2
export function ifft(re: Float64Array, im: Float64Array): void;  // inverse, scales by 1/N
```
Tests: round-trip accuracy, impulse, sine peak lands in the right bin, power-of-two guard (throws otherwise).

### loudness.ts
```ts
export interface SpeechRegionLike { startMs: number; endMs: number; }
export function activeRms(samples: Float32Array, regions: SpeechRegionLike[], sampleRate: number): number;
export function normalizeLoudness(samples: Float32Array, sampleRate: number, targetDb?: number): Float32Array;
```
- Active-speech RMS normalized to `targetDb` (default -20 dBFS); peak guard at -1 dBFS; silent input returned unchanged.
Tests: gain applied, peak never clips, silence no-op, empty regions fallback to whole-signal RMS.

### denoise.ts
```ts
export function estimateSnrDb(samples: Float32Array, regions: SpeechRegionLike[], sampleRate: number): number | null;
export function spectralDenoise(samples: Float32Array, sampleRate: number, opts?: { strength?: number }): Float32Array;
```
- STFT: N=1024, hop=256, Hann, 75% overlap.
- Per-bin noise floor: 10th percentile over a 2 s ring buffer.
- Decision-directed Wiener: ξ = 0.98·ξ_prev + 0.02·max(γ−1,0), G = ξ/(1+ξ); gain floor −15 dB; zero-phase (keep noisy phase); overlap-add.
- **Dry/wet λ from SNR**: λ=0 when SNR ≥ 15 dB, λ=1 when SNR ≤ 0 dB, linear between. Clean audio must come out (nearly) unchanged.
Tests: length preserved, no NaN/Inf, tone+noise improves segmental SNR by ≥3 dB, near-clean tone (SNR>20) passes through with <1 dB difference.

### postprocess.ts
```ts
export function deLoopText(text: string): string;                       // collapse (.{2,20}?)\1{3,}
export function isHallucinationText(text: string): boolean;            // BoH en+zh, n-gram loops, single-token loops
export function dropMicroWords(words: WordTiming[], minMs?: number): WordTiming[];   // default 50 ms
export function smoothTimings(words: WordTiming[], window?: number, maxDeltaMs?: number): WordTiming[]; // median 5, clamp 120 ms, monotonic
export function snapToRegions(segments: TranscriptSegment[], regions: SpeechRegionLike[], toleranceMs?: number): TranscriptSegment[];
export function normalizeSegments(segments: TranscriptSegment[], regions: SpeechRegionLike[], lang: string): TranscriptSegment[];
```
- BoH en: "thank you for watching", "thanks for watching", "subtitles by", "amara.org", "subscribe", "please subscribe"...
- BoH zh: 谢谢观看 / 感谢观看 / 感谢收看 / 请订阅 / 訂閱頻道 / 字幕由 / 字幕組...
- `snapToRegions`: when a word/segment boundary is within ±250 ms of a speech region edge, snap it; never move a boundary into a ≥300 ms silence; keep monotonicity.
- `normalizeSegments` = drop micro words → smooth → snap → drop hallucination segments → rebuild (segments without words: de-loop text, drop hallucinations).
Tests: each function incl. edge cases (empty arrays, all-hallucination, no regions).

### zh.ts
```ts
export function normalizeChineseText(text: string): string;  // OpenCC t2s + strip spaces between CJK + fullwidth normalization
export function isChineseHallucination(text: string): boolean;
```
- Use `opencc-js`: read the package to confirm the API (`Converter({ from: 't', to: 'cn' })`); if the package cannot be imported in Node ESM, implement a documented minimal t2s fallback for common characters and keep the same API.
Tests: 繁體→简体 sample, spaces removed between CJK, fullwidth digits/punct normalized, BoH detection.

### engine-transformers.ts (modify)
- `chunk_length_s: 29`, `stride_length_s: 5`.
- First attempt passes extra decoding options: `{ condition_on_previous_text: false, no_speech_threshold: 0.4, temperature: [0, 0.2, 0.4, 0.6, 0.8, 1.0] }`; if the call throws, retry without them (keep the existing word→segment fallback chain).
- Keep greedy decoding (no beam search).

### transcribe.ts (modify)
New order: `loadAudioFile` → `normalizeLoudness` → `detectSpeechRegions` → if `estimateSnrDb` < 10 dB then `spectralDenoise` (and recompute regions) → engine.transcribe → `normalizeSegments(segments, regions, lang)` → if lang is zh, apply `normalizeChineseText` to segment texts/words → build cues. Keep the progress stages and result shape identical.

## Acceptance
- `npx vitest run tests/unit/pipeline` → ALL green (existing + new).
- `npx tsc --noEmit` clean in your files.
- Existing tests (audio, vad, language, jobs, app, translator) must keep passing.
- Report: files, test count, red→green evidence, deviations.
