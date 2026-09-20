/**
 * Center-channel vocal isolation for music.
 *
 * Vocals are usually mixed dead-centre while the instrumental bed is wider, so
 * a mid/side ratio mask in the STFT domain keeps the centre and attenuates the
 * decorrelated side. The analysis/synthesis uses a Hann window with 75%
 * overlap (N = 1024, hop = 256); the mid channel is re-synthesised with the
 * noisy phase, and the overlap-add is normalised by the squared window sum so
 * an unmodified spectrum reconstructs exactly.
 */
import { fft, ifft } from './fft';

const FFT_SIZE = 1024;
const HOP_SIZE = 256;
const EPS = 1e-12;
const SIDE_WEIGHT = 1.2;
const MASK_FLOOR = 0.08;

/** Periodic Hann window; with hop = N/4 the squared windows sum to 1.5. */
const HANN = (() => {
  const window = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
  }
  return window;
})();

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

/**
 * Pearson correlation of two channels. Returns 1 for identical signals, -1 for
 * inverted ones and ~0 for independent noise. Degenerate (constant) inputs
 * return 1 when identical and 0 otherwise.
 */
export function stereoCorrelation(left: Float32Array, right: Float32Array): number {
  const n = Math.min(left.length, right.length);
  if (n === 0) {
    return 1;
  }

  let sumLeft = 0;
  let sumRight = 0;
  for (let i = 0; i < n; i++) {
    sumLeft += left[i] ?? 0;
    sumRight += right[i] ?? 0;
  }
  const meanLeft = sumLeft / n;
  const meanRight = sumRight / n;

  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  let maxDifference = 0;
  for (let i = 0; i < n; i++) {
    const dl = (left[i] ?? 0) - meanLeft;
    const dr = (right[i] ?? 0) - meanRight;
    covariance += dl * dr;
    varianceLeft += dl * dl;
    varianceRight += dr * dr;
    const difference = Math.abs((left[i] ?? 0) - (right[i] ?? 0));
    if (difference > maxDifference) {
      maxDifference = difference;
    }
  }

  const denominator = Math.sqrt(varianceLeft * varianceRight);
  if (denominator < 1e-12) {
    return maxDifference < 1e-9 ? 1 : 0;
  }
  return clamp(covariance / denominator, -1, 1);
}

/**
 * Isolate the centre channel of a stereo pair with an STFT mid/side ratio mask.
 * The result is mono and has the same length as the shorter input channel.
 */
export function isolateCenterChannel(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): Float32Array {
  const length = Math.min(left.length, right.length);
  if (length === 0) {
    return new Float32Array(0);
  }
  if (sampleRate <= 0) {
    return new Float32Array(length);
  }

  const pad = FFT_SIZE;
  const paddedLength = length + 2 * pad;
  const paddedLeft = new Float32Array(paddedLength);
  const paddedRight = new Float32Array(paddedLength);
  paddedLeft.set(left.subarray(0, length), pad);
  paddedRight.set(right.subarray(0, length), pad);

  const frameCount = Math.max(1, Math.floor((paddedLength - FFT_SIZE) / HOP_SIZE) + 1);
  const output = new Float64Array(paddedLength);
  const norm = new Float64Array(paddedLength);

  const lre = new Float64Array(FFT_SIZE);
  const lim = new Float64Array(FFT_SIZE);
  const rre = new Float64Array(FFT_SIZE);
  const rim = new Float64Array(FFT_SIZE);

  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * HOP_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) {
      lre[i] = paddedLeft[start + i]! * HANN[i]!;
      lim[i] = 0;
      rre[i] = paddedRight[start + i]! * HANN[i]!;
      rim[i] = 0;
    }
    fft(lre, lim);
    fft(rre, rim);

    for (let bin = 0; bin < FFT_SIZE; bin++) {
      const midRe = ((lre[bin] ?? 0) + (rre[bin] ?? 0)) / 2;
      const midIm = ((lim[bin] ?? 0) + (rim[bin] ?? 0)) / 2;
      const sideRe = ((lre[bin] ?? 0) - (rre[bin] ?? 0)) / 2;
      const sideIm = ((lim[bin] ?? 0) - (rim[bin] ?? 0)) / 2;

      const midPower = midRe * midRe + midIm * midIm;
      const sidePower = sideRe * sideRe + sideIm * sideIm;
      const mask = clamp(
        midPower / (midPower + SIDE_WEIGHT * sidePower + EPS),
        MASK_FLOOR,
        1,
      );

      lre[bin] = midRe * mask;
      lim[bin] = midIm * mask;
    }

    ifft(lre, lim);
    for (let i = 0; i < FFT_SIZE; i++) {
      output[start + i] = (output[start + i] ?? 0) + lre[i]! * HANN[i]!;
      norm[start + i] = (norm[start + i] ?? 0) + HANN[i]! * HANN[i]!;
    }
  }

  const result = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const weight = norm[pad + i]!;
    result[i] = weight > 1e-8 ? output[pad + i]! / weight : paddedLeft[pad + i]!;
  }
  return result;
}
