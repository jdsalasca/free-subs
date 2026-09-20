import { describe, expect, it } from 'vitest';
import { fft } from '../../../src/pipeline/fft';
import { resampleSinc } from '../../../src/pipeline/resample';

/** Generate a pure sine of the given amplitude. */
function sine(freq: number, sampleRate: number, length: number, amplitude = 1): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

/** Dominant frequency (Hz) of a signal, via a zero-padded power-of-two FFT. */
function peakFrequency(signal: Float32Array, sampleRate: number, fftSize: number): number {
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const n = Math.min(signal.length, fftSize);
  for (let i = 0; i < n; i++) {
    re[i] = signal[i] ?? 0;
  }
  fft(re, im);

  let peakBin = 1;
  let best = -1;
  for (let bin = 1; bin < fftSize / 2; bin++) {
    const power = (re[bin] ?? 0) ** 2 + (im[bin] ?? 0) ** 2;
    if (power > best) {
      best = power;
      peakBin = bin;
    }
  }
  return (peakBin * sampleRate) / fftSize;
}

describe('resampleSinc', () => {
  it('is the identity when the rates are equal', () => {
    const input = new Float32Array([0.1, -0.2, 0.3, 0.4]);
    expect(resampleSinc(input, 16000, 16000)).toEqual(input);
  });

  it('returns an empty array for empty input', () => {
    expect(resampleSinc(new Float32Array(0), 44100, 16000)).toHaveLength(0);
  });

  it('changes the length to round(input.length * toRate / fromRate)', () => {
    expect(resampleSinc(new Float32Array(1000), 8000, 16000)).toHaveLength(2000);
    expect(resampleSinc(new Float32Array(1000), 16000, 8000)).toHaveLength(500);
    expect(resampleSinc(new Float32Array(4410), 44100, 16000)).toHaveLength(1600);
  });

  it('keeps a 1 kHz tone at 1 kHz when resampling 44.1 kHz to 16 kHz', () => {
    const input = sine(1000, 44100, 4410);
    const output = resampleSinc(input, 44100, 16000);
    expect(output).toHaveLength(1600);
    expect(peakFrequency(output, 16000, 2048)).toBeCloseTo(1000, -1);
  });

  it('produces only finite samples', () => {
    const output = resampleSinc(sine(440, 44100, 4410, 0.8), 44100, 16000);
    for (const value of output) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('keeps silence silent', () => {
    const output = resampleSinc(new Float32Array(1000), 8000, 16000);
    for (const value of output) {
      expect(Math.abs(value)).toBeLessThan(1e-9);
    }
  });
});
