import { describe, expect, it } from 'vitest';
import { estimateSnrDb, spectralDenoise } from '../../../src/pipeline/denoise';

const RATE = 16000;

/** Small deterministic PRNG so the noise is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function whiteNoise(length: number, amplitude: number, random: () => number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = (random() * 2 - 1) * amplitude;
  }
  return out;
}

function sine(seconds: number, freq = 440, amplitude = 0.3): Float32Array {
  const length = Math.round(seconds * RATE);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / RATE);
  }
  return out;
}

/** Speech-like signal: 200 ms tone bursts separated by 200 ms pauses. */
function speechLike(seconds = 2): Float32Array {
  const length = Math.round(seconds * RATE);
  const burst = Math.round(0.2 * RATE);
  const period = Math.round(0.4 * RATE);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    if (i % period < burst) {
      out[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE);
    }
  }
  return out;
}

function add(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  }
  return out;
}

function snrDb(clean: Float32Array, test: Float32Array): number {
  let signal = 0;
  let error = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i] ?? 0;
    const d = (test[i] ?? 0) - c;
    signal += c * c;
    error += d * d;
  }
  return 10 * Math.log10(signal / (error + 1e-20));
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let peak = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    peak = Math.max(peak, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  }
  return peak;
}

describe('estimateSnrDb', () => {
  it('returns null for silence', () => {
    expect(estimateSnrDb(new Float32Array(RATE), [], RATE)).toBeNull();
  });

  it('estimates a positive SNR from speech regions', () => {
    const random = mulberry32(1);
    const clean = new Float32Array(2 * RATE);
    clean.set(sine(0.5, 440, 0.3), 7500); // 0.5 s .. 1.0 s
    const noisy = add(clean, whiteNoise(clean.length, 0.12, random));
    const snr = estimateSnrDb(noisy, [{ startMs: 500, endMs: 1000 }], RATE);
    expect(typeof snr).toBe('number');
    expect(snr ?? -1).toBeGreaterThan(3);
    expect(snr ?? 999).toBeLessThan(30);
  });

  it('falls back to a whole-signal estimate without regions', () => {
    const random = mulberry32(2);
    const noisy = add(speechLike(1), whiteNoise(RATE, 0.05, random));
    const snr = estimateSnrDb(noisy, [], RATE);
    expect(typeof snr).toBe('number');
  });

  it('treats a clean stationary tone as high SNR (or unknown)', () => {
    const snr = estimateSnrDb(sine(1), [], RATE);
    expect(snr === null || snr >= 10).toBe(true);
  });

  it('returns null for empty audio', () => {
    expect(estimateSnrDb(new Float32Array(0), [], RATE)).toBeNull();
  });
});

describe('spectralDenoise', () => {
  it('preserves the input length', () => {
    const random = mulberry32(3);
    const noisy = add(speechLike(1), whiteNoise(RATE, 0.05, random));
    const out = spectralDenoise(noisy, RATE);
    expect(out).toHaveLength(noisy.length);
  });

  it('returns finite samples only', () => {
    const random = mulberry32(4);
    const noisy = add(speechLike(1), whiteNoise(RATE, 0.05, random));
    const out = spectralDenoise(noisy, RATE);
    for (const value of out) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('improves the SNR of a noisy speech-like signal by at least 3 dB', () => {
    const random = mulberry32(5);
    const clean = speechLike(2);
    const noisy = add(clean, whiteNoise(clean.length, 0.2, random));
    const denoised = spectralDenoise(noisy, RATE);
    const before = snrDb(clean, noisy);
    const after = snrDb(clean, denoised);
    expect(after).toBeGreaterThan(before + 3);
  });

  it('passes a near-clean signal through essentially unchanged', () => {
    const random = mulberry32(6);
    const clean = speechLike(2);
    const noisy = add(clean, whiteNoise(clean.length, 0.002, random));
    const denoised = spectralDenoise(noisy, RATE);
    expect(snrDb(clean, denoised)).toBeGreaterThan(snrDb(clean, noisy) - 1);
    expect(maxAbsDiff(noisy, denoised)).toBeLessThan(1e-3);
  });

  it('returns an empty array for empty input', () => {
    expect(spectralDenoise(new Float32Array(0), RATE)).toHaveLength(0);
  });
});
