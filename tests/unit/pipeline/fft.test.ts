import { describe, expect, it } from 'vitest';
import { fft, ifft } from '../../../src/pipeline/fft';

function magnitudes(re: Float64Array, im: Float64Array): Float64Array {
  const out = new Float64Array(re.length);
  for (let i = 0; i < re.length; i++) {
    out[i] = Math.hypot(re[i] ?? 0, im[i] ?? 0);
  }
  return out;
}

describe('fft', () => {
  it('throws for non power-of-two lengths', () => {
    expect(() => fft(new Float64Array(3), new Float64Array(3))).toThrow();
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow();
  });

  it('throws when re and im lengths differ', () => {
    expect(() => fft(new Float64Array(8), new Float64Array(4))).toThrow();
    expect(() => ifft(new Float64Array(8), new Float64Array(4))).toThrow();
  });

  it('transforms an impulse at n=0 into a flat spectrum', () => {
    const n = 16;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    re[0] = 1;
    fft(re, im);
    for (let k = 0; k < n; k++) {
      expect(re[k] ?? 0).toBeCloseTo(1, 10);
      expect(im[k] ?? 0).toBeCloseTo(0, 10);
    }
  });

  it('places a sine wave peak in the expected bin', () => {
    const n = 64;
    const expected = 5;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = Math.sin((2 * Math.PI * expected * i) / n);
    }
    fft(re, im);
    const mag = magnitudes(re, im);
    let peak = 1;
    for (let bin = 2; bin < n / 2; bin++) {
      if ((mag[bin] ?? 0) > (mag[peak] ?? 0)) {
        peak = bin;
      }
    }
    expect(peak).toBe(expected);
  });

  it('round-trips a signal through fft and ifft', () => {
    const n = 32;
    const original = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      original[i] = Math.sin(i * 0.7) + Math.cos(i * 0.3) * 0.5;
    }
    const re = Float64Array.from(original);
    const im = new Float64Array(n);
    fft(re, im);
    ifft(re, im);
    for (let i = 0; i < n; i++) {
      expect(re[i] ?? 0).toBeCloseTo(original[i] ?? 0, 9);
      expect(im[i] ?? 0).toBeCloseTo(0, 9);
    }
  });
});
