import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AsrEngine } from '../../../src/pipeline/asr';
import { fft } from '../../../src/pipeline/fft';
import { transcribeFile } from '../../../src/pipeline/transcribe';

const tempDirs: string[] = [];
const RATE = 16000;

function writeTemporaryWav(buffer: Buffer, name = 'stereo.wav'): string {
  const dir = mkdtempSync(join(tmpdir(), 'free-subs-transcribe-'));
  tempDirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, buffer);
  return path;
}

/** Build a minimal 16-bit PCM RIFF/WAVE file from interleaved samples. */
function buildWav(options: {
  sampleRate: number;
  channels: number;
  interleaved: number[];
}): Buffer {
  const bytesPerSample = 2;
  const data = Buffer.alloc(options.interleaved.length * bytesPerSample);
  options.interleaved.forEach((sample, index) => {
    const value = Math.max(-32768, Math.min(32767, Math.round(sample * 32768)));
    data.writeInt16LE(value, index * bytesPerSample);
  });

  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(options.channels, 2);
  fmt.writeUInt32LE(options.sampleRate, 4);
  fmt.writeUInt32LE(options.sampleRate * options.channels * bytesPerSample, 8);
  fmt.writeUInt16LE(options.channels * bytesPerSample, 12);
  fmt.writeUInt16LE(16, 14);

  const chunks: Buffer[] = [];
  const fmtKey = Buffer.from('fmt ');
  const fmtSize = Buffer.alloc(4);
  fmtSize.writeUInt32LE(fmt.length, 0);
  chunks.push(fmtKey, fmtSize, fmt);

  const dataKey = Buffer.from('data');
  const dataSize = Buffer.alloc(4);
  dataSize.writeUInt32LE(data.length, 0);
  chunks.push(dataKey, dataSize, data);

  const body = Buffer.concat(chunks);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WAVE', 8, 'ascii');
  return Buffer.concat([riff, body]);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function sine(freq: number, sampleRate: number, length: number, amplitude: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

/** Two decorrelated (quadrature, corr≈0) noise channels with equal per-bin power. */
function quadratureNoise(
  freqs: number[],
  sampleRate: number,
  length: number,
  amplitude: number,
  rand: () => number,
): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (const freq of freqs) {
    const phase = rand() * 2 * Math.PI;
    for (let i = 0; i < length; i++) {
      const angle = (2 * Math.PI * freq * i) / sampleRate + phase;
      left[i] = (left[i] ?? 0) + amplitude * Math.sin(angle);
      right[i] = (right[i] ?? 0) + amplitude * Math.cos(angle);
    }
  }
  return { left, right };
}

/** Hann-windowed power in a frequency band, via a zero-padded FFT. */
function bandPower(signal: Float32Array, sampleRate: number, fLow: number, fHigh: number): number {
  const fftSize = 16384;
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const n = Math.min(signal.length, fftSize);
  for (let i = 0; i < n; i++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, n - 1));
    re[i] = (signal[i] ?? 0) * window;
  }
  fft(re, im);
  const binHz = sampleRate / fftSize;
  let total = 0;
  for (let bin = Math.ceil(fLow / binHz); bin <= Math.floor(fHigh / binHz); bin++) {
    total += (re[bin] ?? 0) ** 2 + (im[bin] ?? 0) ** 2;
  }
  return total;
}

const CENTER_BAND: [number, number] = [200, 1100];
const NOISE_BAND: [number, number] = [3000, 5000];

/** Stereo signal: centred harmonic "speech" plus decorrelated high-band noise. */
function makeStereoSignal(length: number): { interleaved: number[] } {
  const center = new Float32Array(length);
  for (const [freq, amp] of [
    [300, 0.3],
    [600, 0.2],
    [900, 0.15],
  ] as const) {
    const partial = sine(freq, RATE, length, amp);
    for (let i = 0; i < length; i++) {
      center[i] = (center[i] ?? 0) + (partial[i] ?? 0);
    }
  }
  const { left: noiseLeft, right: noiseRight } = quadratureNoise(
    [3600, 3800, 4000, 4200, 4400],
    RATE,
    length,
    0.02,
    seededRandom(101),
  );

  const interleaved: number[] = [];
  for (let i = 0; i < length; i++) {
    const left = Math.max(-1, Math.min(1, (center[i] ?? 0) + (noiseLeft[i] ?? 0)));
    const right = Math.max(-1, Math.min(1, (center[i] ?? 0) + (noiseRight[i] ?? 0)));
    interleaved.push(left, right);
  }
  return { interleaved };
}

function capturingEngine(): { engine: AsrEngine; captured: Float32Array[]; rates: number[] } {
  const captured: Float32Array[] = [];
  const rates: number[] = [];
  const engine: AsrEngine = {
    id: 'capture-stub',
    async transcribe(audio: Float32Array, sampleRate: number) {
      captured.push(Float32Array.from(audio));
      rates.push(sampleRate);
      return {
        language: 'en',
        segments: [],
        durationMs: sampleRate > 0 ? (audio.length / sampleRate) * 1000 : 0,
      };
    },
  };
  return { engine, captured, rates };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('transcribeFile isolateVocals', () => {
  it('feeds mono, finite audio to the engine and attenuates the side noise', async () => {
    const path = writeTemporaryWav(buildWav({ sampleRate: RATE, channels: 2, interleaved: makeStereoSignal(16000).interleaved }));

    const control = capturingEngine();
    await transcribeFile(path, 'x.wav', { engine: control.engine, language: 'en' });

    const isolated = capturingEngine();
    await transcribeFile(path, 'x.wav', {
      engine: isolated.engine,
      isolateVocals: true,
      language: 'en',
    });

    expect(control.captured).toHaveLength(1);
    expect(isolated.captured).toHaveLength(1);
    const plain = control.captured[0];
    const vocals = isolated.captured[0];
    expect(plain).toBeDefined();
    expect(vocals).toBeDefined();
    expect(vocals?.length ?? 0).toBeGreaterThan(0);
    expect(isolated.rates[0]).toBe(RATE);

    for (const value of vocals ?? []) {
      expect(Number.isFinite(value)).toBe(true);
    }

    const plainSignal = plain ?? new Float32Array(0);
    const vocalsSignal = vocals ?? new Float32Array(0);
    const plainRatio =
      bandPower(plainSignal, RATE, NOISE_BAND[0], NOISE_BAND[1]) /
      bandPower(plainSignal, RATE, CENTER_BAND[0], CENTER_BAND[1]);
    const vocalsRatio =
      bandPower(vocalsSignal, RATE, NOISE_BAND[0], NOISE_BAND[1]) /
      bandPower(vocalsSignal, RATE, CENTER_BAND[0], CENTER_BAND[1]);
    const attenuationDb = 10 * Math.log10(vocalsRatio / plainRatio);
    expect(attenuationDb).toBeLessThanOrEqual(-3);
  });

  it('keeps the default path working and returning the usual result shape', async () => {
    const path = writeTemporaryWav(buildWav({ sampleRate: RATE, channels: 2, interleaved: makeStereoSignal(8000).interleaved }));
    const { engine } = capturingEngine();
    const result = await transcribeFile(path, 'x.wav', { engine, language: 'en' });

    expect(result.language).toBe('en');
    expect(result.durationMs).toBeGreaterThan(0);
    expect(Array.isArray(result.segments)).toBe(true);
    expect(Array.isArray(result.cues)).toBe(true);
    expect(typeof result.srt).toBe('string');
    expect(typeof result.vtt).toBe('string');
    expect(result.stats.cueCount).toBe(0);
  });

  it('falls back to a high-passed mono signal for mono files', async () => {
    const mono = makeStereoSignal(8000).interleaved.filter((_, index) => index % 2 === 0);
    const path = writeTemporaryWav(
      buildWav({ sampleRate: RATE, channels: 1, interleaved: mono }),
      'mono.wav',
    );
    const isolated = capturingEngine();
    await transcribeFile(path, 'mono.wav', {
      engine: isolated.engine,
      isolateVocals: true,
      language: 'en',
    });
    expect(isolated.captured[0]?.length ?? 0).toBeGreaterThan(0);
  });
});
