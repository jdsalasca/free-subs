# SPEC — Music mode: vocal isolation + high-quality audio conditioning

You own ONLY these files:
- `src/pipeline/resample.ts` (new), `src/pipeline/vocals.ts` (new), `src/pipeline/filters.ts` (new)
- `src/pipeline/audio.ts` (modify), `src/pipeline/transcribe.ts` (modify)
- `tests/unit/pipeline/{resample,vocals,filters,audio-stereo,transcribe}.test.ts` (new)

Do NOT touch `src/core`, `src/server`, `src/cli.ts`, `src/client`, existing tests.

## Why
Songs are the hardest input: strong bass, stereo-panned music and centered vocals mixed together.
The goal is a measurable extraction improvement on music:
1. **Center-channel vocal isolation** (vocals are usually mixed in the centre; music is wider).
2. **High-pass filtering** (remove bass/rumble that masks speech).
3. **High-quality resampling** (the current linear interpolation aliases; use windowed-sinc).

## Modules (TDD: tests first, red → green)

### resample.ts
```ts
export function resampleSinc(input: Float32Array, fromRate: number, toRate: number): Float32Array;
```
- Windowed-sinc (Blackman or Kaiser) with 32 taps, cutoff at 0.45 × min(fromRate, toRate).
- Identity when rates are equal; output length `Math.round(input.length * toRate / fromRate)`.
- Tests: identity; 44.1 kHz 1 kHz sine → 16 kHz still peaks at 1 kHz (FFT check); length; no NaN; silence stays silent.

### filters.ts
```ts
export function highPass(samples: Float32Array, sampleRate: number, cutoffHz: number): Float32Array;
```
- 2nd-order Butterworth high-pass as a biquad (RBJ cookbook coefficients), zero-phase not required.
- Tests: DC removed (mean ≈ 0); 1 kHz sine passes (≥ −1.5 dB); 50 Hz strongly attenuated (≤ −6 dB); length preserved; empty input.

### vocals.ts
```ts
export function isolateCenterChannel(left: Float32Array, right: Float32Array, sampleRate: number): Float32Array;
export function stereoCorrelation(left: Float32Array, right: Float32Array): number;
```
- STFT (N=1024, hop=256, Hann) on both channels; per bin/frame:
  - `mid = (L + R) / 2`, `side = (L − R) / 2`
  - `mask = |mid|² / (|mid|² + 1.2·|side|² + ε)`, clamped to `[0.08, 1]`
  - vocal = iSTFT of `mid · mask` (zero-phase, overlap-add, keep the noisy phase).
- Tests: identical L/R (perfectly centred) → output ≈ input (±1 dB); centre tone + decorrelated side noise → centre kept (≥ 90% energy) and side attenuated (≥ 6 dB); silence → silence; length preserved; correlation ≈ 1 for identical, ≈ 0 for independent noise.

### audio.ts (modify, additive)
- `DecodedAudio` gains `channelData?: Float32Array[]`.
- `loadAudioFile(path: string, options?: { stereo?: boolean })`:
  - WAV: decode all channels (keep existing mono `samples` mixdown); when `stereo: true`, expose per-channel arrays.
  - ffmpeg: `-ac 2` when `stereo: true` (interleaved f32le → de-interleave); otherwise unchanged (`-ac 1`).
  - Existing callers and the `samples`/`sampleRate`/`channels` fields must keep working unchanged.
- Use `resampleSinc` for the 16 kHz conversion (keep `resampleLinear` exported for compatibility).
- Tests: build a small stereo WAV in `os.tmpdir()` (16-bit, 2 channels), assert `channelData` has 2 arrays with different content, mono mixdown is the average, and `loadAudioFile(path)` without options still works.

### transcribe.ts (modify)
- `TranscribeOptions` gains `isolateVocals?: boolean` (default false).
- When `isolateVocals` is true:
  - load with `{ stereo: true }`;
  - if two channels exist: `highPass` each at 80 Hz → `isolateCenterChannel` → use the result as the mono signal for ASR (and for VAD/SNR);
  - otherwise fall back to the mono signal with `highPass` at 80 Hz.
- When false: behaviour must stay byte-identical to today (same pipeline order, same stages).
- Tests: synthesize a stereo WAV (centre speech-like tone + decorrelated noise), call `transcribeFile(path, 'x.wav', { engine: stub, isolateVocals: true, language: 'en' })` with a stub engine that captures the received audio; assert the captured signal is mono, finite, length > 0, and that the side-noise component is attenuated compared to the plain mixdown (measure energy in the noise band or overall RMS difference with a control run).

## Acceptance
- `npx vitest run tests/unit/pipeline` → ALL green (existing + new).
- `npx tsc --noEmit` clean in your files.
- Report: files, test count, red→green evidence, measured attenuation values from the tests, deviations.
