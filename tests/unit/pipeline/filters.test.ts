import { describe, expect, it } from 'vitest';
import { highPass } from '../../../src/pipeline/filters';

/** Generate a pure sine of the given amplitude. */
function sine(freq: number, sampleRate: number, length: number, amplitude = 1): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

function rms(signal: Float32Array, start = 0, end = signal.length): number {
  let sum = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    const value = signal[i] ?? 0;
    sum += value * value;
    count++;
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

function mean(signal: Float32Array, start = 0, end = signal.length): number {
  let sum = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    sum += signal[i] ?? 0;
    count++;
  }
  return count === 0 ? 0 : sum / count;
}

const RATE = 16000;
const CUTOFF = 80;

describe('highPass', () => {
  it('returns an empty array for empty input', () => {
    expect(highPass(new Float32Array(0), RATE, CUTOFF)).toHaveLength(0);
  });

  it('preserves the input length', () => {
    expect(highPass(new Float32Array(1234), RATE, CUTOFF)).toHaveLength(1234);
  });

  it('removes DC offset', () => {
    const dc = new Float32Array(16000).fill(1);
    const output = highPass(dc, RATE, CUTOFF);
    expect(Math.abs(mean(output))).toBeLessThan(0.01);
    // Ignore the start-up transient: the settled signal must be centred.
    expect(Math.abs(mean(output, 2000))).toBeLessThan(1e-3);
  });

  it('passes a 1 kHz tone with at most 1.5 dB of loss', () => {
    const input = sine(1000, RATE, 16000, 0.5);
    const output = highPass(input, RATE, CUTOFF);
    const gainDb = 20 * Math.log10(rms(output, 4000) / rms(input, 4000));
    expect(gainDb).toBeGreaterThanOrEqual(-1.5);
  });

  it('strongly attenuates a 50 Hz tone (at least 6 dB)', () => {
    const input = sine(50, RATE, 16000, 0.5);
    const output = highPass(input, RATE, CUTOFF);
    const gainDb = 20 * Math.log10(rms(output, 4000) / rms(input, 4000));
    expect(gainDb).toBeLessThanOrEqual(-6);
  });
});
