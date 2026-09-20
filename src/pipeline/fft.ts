/**
 * Minimal iterative radix-2 FFT used by the denoiser and the SNR estimator.
 *
 * The transform is in-place (the caller owns both arrays) and requires the
 * length to be a power of two. `ifft` is the exact inverse and scales by 1/N.
 */

/** Validate the operand pair and return the transform length. */
function transformLength(re: Float64Array, im: Float64Array): number {
  if (re.length !== im.length) {
    throw new Error('FFT requires re and im arrays of equal length.');
  }
  const n = re.length;
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error('FFT length must be a non-zero power of two.');
  }
  return n;
}

/** Swap two entries in a typed array in place. */
function swap(values: Float64Array, a: number, b: number): void {
  const tmp = values[a]!;
  values[a] = values[b]!;
  values[b] = tmp;
}

/**
 * In-place iterative radix-2 decimation-in-time FFT (Cooley–Tukey).
 * Uses on-the-fly twiddle factors to keep rounding error small.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = transformLength(re, im);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      swap(re, i, j);
      swap(im, i, j);
    }
  }

  // Butterfly stages.
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < half; k++) {
        const angle = (-2 * Math.PI * k) / len;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const a = start + k;
        const b = a + half;
        const xr = re[b]!;
        const xi = im[b]!;
        const vr = xr * wr - xi * wi;
        const vi = xr * wi + xi * wr;
        const ur = re[a]!;
        const ui = im[a]!;
        re[a] = ur + vr;
        im[a] = ui + vi;
        re[b] = ur - vr;
        im[b] = ui - vi;
      }
    }
  }
}

/** In-place inverse FFT: conjugate, forward transform, conjugate, scale 1/N. */
export function ifft(re: Float64Array, im: Float64Array): void {
  const n = transformLength(re, im);
  for (let i = 0; i < n; i++) {
    im[i] = -im[i]!;
  }
  fft(re, im);
  for (let i = 0; i < n; i++) {
    re[i] = re[i]! / n;
    im[i] = -im[i]! / n;
  }
}
