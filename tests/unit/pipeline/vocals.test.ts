import { describe, expect, it } from 'vitest';
import { fft } from '../../../src/pipeline/fft';
import { isolateCenterChannel, stereoCorrelation } from '../../../src/pipeline/vocals';

const RATE = 16000;

/** Deterministic linear-congruential generator so tests never flake. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function sine(freq: number, sampleRate: number, length: number, amplitude = 1): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

/** Sum of sine partials at the given frequencies with random phases. */
function bandNoise(
  freqs: number[],
  sampleRate: number,
  length: number,
  amplitude: number,
  rand: () => number,
): Float32Array {
  const out = new Float32Array(length);
  for (const freq of freqs) {
    const phase = rand() * 2 * Math.PI;
    for (let i = 0; i < length; i++) {
      out[i] = (out[i] ?? 0) + amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate + phase);
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

function rms(signal: Float32Array): number {
  let sum = 0;
  for (const value of signal) {
    sum += value * value;
  }
  return signal.length === 0 ? 0 : Math.sqrt(sum / signal.length);
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

/**
 * Two decorrelated noise channels built in quadrature (90° phase per partial).
 * The correlation is ~0 while mid and side carry equal power at every bin,
 * which makes the mask attenuation deterministic and measurable.
 */
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

const NOISE_FREQS = [3600, 3700, 3800, 3900, 4000, 4100, 4200, 4300, 4400];

describe('stereoCorrelation', () => {
  it('is approximately 1 for identical channels', () => {
    const left = bandNoise(NOISE_FREQS, RATE, 4096, 0.2, seededRandom(1));
    const right = Float32Array.from(left);
    expect(stereoCorrelation(left, right)).toBeCloseTo(1, 6);
  });

  it('is approximately -1 for inverted channels', () => {
    const left = bandNoise(NOISE_FREQS, RATE, 4096, 0.2, seededRandom(2));
    const right = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) {
      right[i] = -(left[i] ?? 0);
    }
    expect(stereoCorrelation(left, right)).toBeCloseTo(-1, 6);
  });

  it('is approximately 0 for independent noise', () => {
    const left = bandNoise(NOISE_FREQS, RATE, 8192, 0.2, seededRandom(3));
    const right = bandNoise(NOISE_FREQS, RATE, 8192, 0.2, seededRandom(4));
    expect(Math.abs(stereoCorrelation(left, right))).toBeLessThan(0.1);
  });
});

describe('isolateCenterChannel', () => {
  it('returns an empty array for empty input', () => {
    expect(isolateCenterChannel(new Float32Array(0), new Float32Array(0), RATE)).toHaveLength(0);
  });

  it('preserves the input length', () => {
    const left = sine(500, RATE, 3000);
    const right = sine(500, RATE, 3000);
    expect(isolateCenterChannel(left, right, RATE)).toHaveLength(3000);
  });

  it('keeps a perfectly centred signal within 1 dB', () => {
    const length = 16000;
    const signal = add(sine(500, RATE, length, 0.3), sine(1000, RATE, length, 0.2));
    const output = isolateCenterChannel(signal, Float32Array.from(signal), RATE);
    const gainDb = 20 * Math.log10(rms(output) / rms(signal));
    expect(gainDb).toBeGreaterThanOrEqual(-1);
    expect(gainDb).toBeLessThanOrEqual(1);
  });

  it('keeps the centre while attenuating decorrelated side noise', () => {
    const length = 16000;
    const center = add(sine(500, RATE, length, 0.25), sine(1000, RATE, length, 0.2));
    const { left: noiseLeft, right: noiseRight } = quadratureNoise(
      NOISE_FREQS,
      RATE,
      length,
      0.02,
      seededRandom(11),
    );
    const left = add(center, noiseLeft);
    const right = add(center, noiseRight);

    // The side noise really is decorrelated.
    expect(Math.abs(stereoCorrelation(noiseLeft, noiseRight))).toBeLessThan(0.1);

    const side = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      side[i] = ((left[i] ?? 0) - (right[i] ?? 0)) / 2;
    }

    const output = isolateCenterChannel(left, right, RATE);

    const centerRatio =
      bandPower(output, RATE, 400, 1100) / bandPower(center, RATE, 400, 1100);
    expect(centerRatio).toBeGreaterThanOrEqual(0.9);

    const sideDb = 10 * Math.log10(bandPower(output, RATE, 3000, 5000) / bandPower(side, RATE, 3000, 5000));
    expect(sideDb).toBeLessThanOrEqual(-6);
  });

  it('keeps silence silent', () => {
    const output = isolateCenterChannel(new Float32Array(4096), new Float32Array(4096), RATE);
    for (const value of output) {
      expect(Math.abs(value)).toBeLessThan(1e-6);
    }
  });

  it('ignores the unused (extra) samples of the shorter channel', () => {
    const left = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const right = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const output = isolateCenterChannel(left, right, RATE);
    expect(output).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(output[i] ?? Number.NaN).toBeCloseTo(left[i] ?? Number.NaN, 3);
    }
  });
});
