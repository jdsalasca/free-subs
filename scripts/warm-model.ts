/**
 * Warm-up script for the local Whisper model.
 *
 * Downloads the model files into the configured cache (FREE_SUBS_CACHE_DIR)
 * and runs a tiny silent inference so the ONNX runtime is fully initialised.
 * Used by the Playwright global setup so E2E tests measure transcription,
 * not first-time model downloads.
 */
import { TransformersWhisperEngine } from '../src/pipeline/engine-transformers';

const SAMPLE_RATE = 16000;
const engine = new TransformersWhisperEngine();
const audio = new Float32Array(Math.round(SAMPLE_RATE * 0.6));

const started = Date.now();
const result = await engine.transcribe(audio, SAMPLE_RATE, {
  language: 'en',
  model: 'tiny',
  onProgress: (percent, stage) => {
    process.stderr.write(`[warmup ${percent}%] ${stage}\n`);
  },
});

process.stdout.write(
  `warmup ok in ${((Date.now() - started) / 1000).toFixed(1)}s (segments: ${result.segments.length})\n`,
);
