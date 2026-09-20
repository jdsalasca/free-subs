/**
 * High-quality windowed-sinc resampling.
 *
 * The previous linear interpolator aliases when downsampling; this module uses
 * a 32-tap Blackman-windowed sinc with the cutoff placed at
 * `0.45 × min(fromRate, toRate)`, which suppresses the aliasing images while
 * preserving the passband amplitude (the kernel weights are normalised so DC
 * gain is exactly 1).
 */

const TAPS = 32;
const HALF_TAPS = TAPS / 2;
const CUTOFF_RATIO = 0.45;

/** Normalised sinc, `sin(pi x) / (pi x)`. */
function sinc(x: number): number {
  if (x === 0) {
    return 1;
  }
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/** Centred Blackman window over `[-half, half]`, zero outside. */
function blackman(tau: number, half: number): number {
  if (Math.abs(tau) >= half) {
    return 0;
  }
  const x = (Math.PI * tau) / half;
  return 0.42 + 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
}

/**
 * Resample mono audio with a windowed-sinc kernel. Returns the input unchanged
 * when the rates match, and an empty array for empty input.
 */
export function resampleSinc(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (input.length === 0) {
    return new Float32Array(0);
  }
  if (fromRate === toRate || fromRate <= 0 || toRate <= 0) {
    return input;
  }

  const outputLength = Math.round((input.length * toRate) / fromRate);
  if (outputLength <= 0) {
    return new Float32Array(0);
  }

  const cutoffHz = CUTOFF_RATIO * Math.min(fromRate, toRate);
  const fc = cutoffHz / fromRate; // cycles per input sample
  const step = fromRate / toRate; // input samples per output sample
  const last = input.length - 1;
  const output = new Float32Array(outputLength);

  for (let m = 0; m < outputLength; m++) {
    const position = m * step;
    const start = Math.ceil(position - HALF_TAPS);
    const end = Math.floor(position + HALF_TAPS);

    let sum = 0;
    let weight = 0;
    for (let n = start; n <= end; n++) {
      if (n < 0 || n > last) {
        continue;
      }
      const tau = position - n;
      const window = blackman(tau, HALF_TAPS);
      if (window === 0) {
        continue;
      }
      const kernel = 2 * fc * sinc(2 * fc * tau) * window;
      sum += (input[n] ?? 0) * kernel;
      weight += kernel;
    }

    output[m] = weight !== 0 ? sum / weight : 0;
  }

  return output;
}
