/**
 * Biquad filters used to condition audio before vocal isolation.
 *
 * `highPass` is a 2nd-order Butterworth high-pass built from the RBJ audio EQ
 * cookbook coefficients (Q = 1/√2). It is causal and applied with a direct
 * form I difference equation; zero-phase operation is not required here.
 */

/** Butterworth Q. */
const Q = Math.SQRT1_2;

/**
 * 2nd-order Butterworth high-pass. DC is removed exactly; the passband above
 * the cutoff is left essentially untouched.
 */
export function highPass(
  samples: Float32Array,
  sampleRate: number,
  cutoffHz: number,
): Float32Array {
  if (samples.length === 0) {
    return new Float32Array(0);
  }
  if (sampleRate <= 0 || cutoffHz <= 0 || cutoffHz >= sampleRate / 2) {
    return Float32Array.from(samples);
  }

  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const a0 = 1 + alpha;

  const b0 = (1 + cosw) / 2 / a0;
  const b1 = -(1 + cosw) / a0;
  const b2 = (1 + cosw) / 2 / a0;
  const a1 = (-2 * cosw) / a0;
  const a2 = (1 - alpha) / a0;

  const output = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i] ?? 0;
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    output[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  return output;
}
