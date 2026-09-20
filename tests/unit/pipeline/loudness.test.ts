import { describe, expect, it } from 'vitest';
import { activeRms, normalizeLoudness } from '../../../src/pipeline/loudness';

const RATE = 16000;
const PEAK_LIMIT = 10 ** (-1 / 20);
const TARGET_LINEAR = 10 ** (-20 / 20);

function sine(seconds: number, freq = 440, amplitude = 0.3, sampleRate = RATE): Float32Array {
  const length = Math.round(seconds * sampleRate);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

function silence(seconds: number, sampleRate = RATE): Float32Array {
  return new Float32Array(Math.round(seconds * sampleRate));
}

function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const value of samples) {
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

describe('activeRms', () => {
  it('measures RMS over the supplied regions', () => {
    const audio = concat(silence(1), sine(1, 440, 0.3), silence(1));
    const regions = [{ startMs: 1000, endMs: 2000 }];
    expect(activeRms(audio, regions, RATE)).toBeCloseTo(0.3 / Math.SQRT2, 2);
  });

  it('falls back to whole-signal RMS when no regions are given', () => {
    const audio = concat(sine(0.5, 440, 0.4), silence(0.5));
    expect(activeRms(audio, [], RATE)).toBeCloseTo(rms(audio), 6);
  });

  it('falls back to whole-signal RMS when regions miss the audio', () => {
    const audio = sine(1, 440, 0.3);
    expect(activeRms(audio, [{ startMs: 5000, endMs: 6000 }], RATE)).toBeCloseTo(
      0.3 / Math.SQRT2,
      2,
    );
  });

  it('returns 0 for empty audio', () => {
    expect(activeRms(new Float32Array(0), [], RATE)).toBe(0);
  });
});

describe('normalizeLoudness', () => {
  it('applies gain so the signal RMS reaches the -20 dBFS target', () => {
    const audio = sine(0.5, 440, 0.01);
    const out = normalizeLoudness(audio, RATE);
    expect(out).toHaveLength(audio.length);
    expect(rms(out)).toBeCloseTo(TARGET_LINEAR, 2);
  });

  it('honours a custom target level', () => {
    const audio = sine(0.5, 440, 0.01);
    const out = normalizeLoudness(audio, RATE, -6);
    expect(rms(out)).toBeCloseTo(10 ** (-6 / 20), 2);
  });

  it('never lets the peak clip past -1 dBFS', () => {
    const audio = new Float32Array(16000);
    audio[8000] = 0.5;
    const out = normalizeLoudness(audio, RATE);
    let peak = 0;
    for (const value of out) {
      peak = Math.max(peak, Math.abs(value));
    }
    expect(peak).toBeLessThanOrEqual(PEAK_LIMIT + 1e-6);
  });

  it('leaves silence unchanged', () => {
    const audio = silence(0.25);
    const out = normalizeLoudness(audio, RATE);
    expect(out).toHaveLength(audio.length);
    for (const value of out) {
      expect(value).toBe(0);
    }
  });

  it('returns empty audio for empty input', () => {
    expect(normalizeLoudness(new Float32Array(0), RATE)).toHaveLength(0);
  });
});
