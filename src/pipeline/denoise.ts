/**
 * Conservative spectral denoising.
 *
 * Design follows the 2024-2026 Whisper robustness findings: aggressive
 * denoising hurts recognition, so this stage is SNR-gated and dry/wet mixed.
 * A short-time Fourier transform with 75% overlap feeds a decision-directed
 * Wiener filter with a -15 dB gain floor and zero-phase reconstruction.
 */
import { fft, ifft } from './fft';
import type { SpeechRegionLike } from './loudness';

const FFT_SIZE = 1024;
const HOP_SIZE = 256;
const BIN_COUNT = FFT_SIZE / 2 + 1;
const NOISE_WINDOW_SECONDS = 2;
const NOISE_PERCENTILE = 0.1;
const GAIN_FLOOR = 10 ** (-15 / 20);
/** Bias correction: the 10th-percentile power sits well below the mean. */
const NOISE_FLOOR_SCALE = 6;
const DD_ALPHA = 0.98;
const DD_BETA = 0.02;
/** Guard rails: a single spectral spike must not pin the gain at 1 forever. */
const XI_MAX = 1e4;
const GAMMA_MAX = 1e4;
const EPS = 1e-12;
const SILENCE_EPS = 1e-12;
const FLATNESS_FFT = 512;
const FLATNESS_HOP = 256;

/** Periodic Hann window; with hop = N/4 the squared windows sum to 1.5. */
const HANN = (() => {
  const window = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
  }
  return window;
})();

const FLATNESS_HANN = (() => {
  const window = new Float64Array(FLATNESS_FFT);
  for (let i = 0; i < FLATNESS_FFT; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FLATNESS_FFT);
  }
  return window;
})();

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

function hasEnergy(samples: Float32Array): boolean {
  for (const value of samples) {
    if (Math.abs(value) > 1e-9) {
      return true;
    }
  }
  return false;
}

interface SampleInterval {
  start: number;
  end: number;
}

function toIntervals(
  regions: SpeechRegionLike[],
  sampleRate: number,
  length: number,
): SampleInterval[] {
  const intervals: SampleInterval[] = [];
  for (const region of regions) {
    const start = Math.max(0, Math.min(length, Math.round((region.startMs / 1000) * sampleRate)));
    const end = Math.max(0, Math.min(length, Math.round((region.endMs / 1000) * sampleRate)));
    if (end > start) {
      intervals.push({ start, end });
    }
  }
  intervals.sort((a, b) => a.start - b.start);

  const merged: SampleInterval[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/** Short-time frame energies (20 ms frames, 10 ms hop). */
function frameEnergies(samples: Float32Array, sampleRate: number): number[] {
  const frame = Math.max(1, Math.round(0.02 * sampleRate));
  const hop = Math.max(1, Math.round(0.01 * sampleRate));
  const energies: number[] = [];

  for (let start = 0; start + frame <= samples.length; start += hop) {
    let sum = 0;
    for (let i = 0; i < frame; i++) {
      const value = samples[start + i]!;
      sum += value * value;
    }
    energies.push(sum / frame);
  }

  if (energies.length === 0 && samples.length > 0) {
    let sum = 0;
    for (const value of samples) {
      sum += value * value;
    }
    energies.push(sum / samples.length);
  }
  return energies;
}

/** Spectral flatness (geometric/arithmetic mean of averaged power spectra). */
function spectralFlatness(samples: Float32Array): number {
  let logSum = 0;
  let linearSum = 0;
  let count = 0;

  const re = new Float64Array(FLATNESS_FFT);
  const im = new Float64Array(FLATNESS_FFT);
  for (let start = 0; start + FLATNESS_FFT <= samples.length; start += FLATNESS_HOP) {
    for (let i = 0; i < FLATNESS_FFT; i++) {
      re[i] = samples[start + i]! * FLATNESS_HANN[i]!;
      im[i] = 0;
    }
    fft(re, im);
    for (let bin = 1; bin <= FLATNESS_FFT / 2; bin++) {
      const power = re[bin]! * re[bin]! + im[bin]! * im[bin]!;
      logSum += Math.log(power + EPS);
      linearSum += power;
      count++;
    }
  }

  if (count === 0) {
    return 1;
  }
  const meanLog = logSum / count;
  const meanLinear = linearSum / count;
  if (meanLinear <= EPS) {
    return 0;
  }
  return Math.exp(meanLog - Math.log(meanLinear));
}

function wholeSignalSnrDb(samples: Float32Array, sampleRate: number): number | null {
  const energies = frameEnergies(samples, sampleRate);
  if (energies.length === 0) {
    return null;
  }

  const low = percentile(energies, 0.1);
  const high = percentile(energies, 0.9);

  if (low <= SILENCE_EPS) {
    return high <= SILENCE_EPS ? null : 60;
  }
  const dynamicDb = 10 * Math.log10(high / low);
  if (dynamicDb >= 6) {
    // Speech-with-pauses: compare the mean frame energy to the quiet floor.
    let sum = 0;
    for (const energy of energies) {
      sum += energy;
    }
    const mean = sum / energies.length;
    return Math.max(-20, Math.min(60, 10 * Math.log10(Math.max(mean - low, SILENCE_EPS) / low)));
  }

  const flatness = spectralFlatness(samples);
  if (flatness <= 1e-6) {
    return 60;
  }
  return Math.max(0, Math.min(60, -10 * Math.log10(flatness)));
}

/**
 * Estimate the speech-to-noise ratio in dB, or `null` when it cannot be
 * measured (silence, or no noise-only content to compare against).
 */
export function estimateSnrDb(
  samples: Float32Array,
  regions: SpeechRegionLike[],
  sampleRate: number,
): number | null {
  if (samples.length === 0 || sampleRate <= 0 || !hasEnergy(samples)) {
    return null;
  }

  const intervals = toIntervals(regions, sampleRate, samples.length);
  if (intervals.length > 0) {
    let totalSum = 0;
    for (const value of samples) {
      totalSum += value * value;
    }

    let speechSum = 0;
    let speechCount = 0;
    for (const interval of intervals) {
      for (let i = interval.start; i < interval.end; i++) {
        const value = samples[i]!;
        speechSum += value * value;
        speechCount++;
      }
    }

    const noiseCount = samples.length - speechCount;
    if (speechCount > 0 && noiseCount > 0) {
      const speechRms = Math.sqrt(speechSum / speechCount);
      const noiseRms = Math.sqrt(Math.max(0, totalSum - speechSum) / noiseCount);
      if (noiseRms > 1e-7 && speechRms > 0) {
        return 20 * Math.log10(speechRms / noiseRms);
      }
      return null;
    }
  }

  return wholeSignalSnrDb(samples, sampleRate);
}

/** λ for the dry/wet mix: 0 dB → fully denoised, ≥15 dB → untouched. */
function wetMix(snrDb: number | null): number {
  if (snrDb === null || !Number.isFinite(snrDb)) {
    return 0;
  }
  if (snrDb >= 15) {
    return 0;
  }
  if (snrDb <= 0) {
    return 1;
  }
  return (15 - snrDb) / 15;
}

/**
 * Denoise mono audio with a decision-directed Wiener filter. The dry/wet mix
 * is derived from the estimated SNR so clean audio passes through unchanged.
 */
export function spectralDenoise(
  samples: Float32Array,
  sampleRate: number,
  opts: { strength?: number } = {},
): Float32Array {
  const length = samples.length;
  if (length === 0) {
    return new Float32Array(0);
  }
  if (sampleRate <= 0) {
    return Float32Array.from(samples);
  }

  const pad = FFT_SIZE;
  const padded = new Float32Array(length + 2 * pad);
  padded.set(samples, pad);
  const paddedLength = padded.length;
  const frameCount = Math.max(1, Math.floor((paddedLength - FFT_SIZE) / HOP_SIZE) + 1);
  const windowLength = Math.max(1, Math.round((NOISE_WINDOW_SECONDS * sampleRate) / HOP_SIZE));

  const out = new Float64Array(paddedLength);
  const norm = new Float64Array(paddedLength);
  const ring: Float64Array[] = [];
  const xi = new Float64Array(BIN_COUNT);
  const scratch: number[] = [];

  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const power = new Float64Array(BIN_COUNT);
  const noiseFloor = new Float64Array(BIN_COUNT);

  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * HOP_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = padded[start + i]! * HANN[i]!;
      im[i] = 0;
    }
    fft(re, im);

    for (let bin = 0; bin < BIN_COUNT; bin++) {
      power[bin] = re[bin]! * re[bin]! + im[bin]! * im[bin]!;
    }

    let frameTotal = 0;
    for (let bin = 0; bin < BIN_COUNT; bin++) {
      frameTotal += power[bin]!;
    }

    // Zero-energy frames (pure zero padding / digital silence) must not enter
    // the noise-floor history, otherwise a single zero floor pins every gain
    // at 1 via a huge a-posteriori SNR spike.
    if (frameTotal > EPS) {
      ring.push(Float64Array.from(power));
      if (ring.length > windowLength) {
        ring.shift();
      }
    }
    const floorSource = ring.length > 0 ? ring : [power];

    for (let bin = 0; bin < BIN_COUNT; bin++) {
      scratch.length = 0;
      for (const spectrum of floorSource) {
        scratch.push(spectrum[bin]!);
      }
      noiseFloor[bin] = percentile(scratch, NOISE_PERCENTILE) * NOISE_FLOOR_SCALE;
    }

    for (let bin = 0; bin < BIN_COUNT; bin++) {
      const gamma = Math.min(power[bin]! / (noiseFloor[bin]! + EPS), GAMMA_MAX);
      xi[bin] = Math.min(XI_MAX, DD_ALPHA * xi[bin]! + DD_BETA * Math.max(gamma - 1, 0));
      let gain = xi[bin]! / (1 + xi[bin]!);
      if (gain < GAIN_FLOOR) {
        gain = GAIN_FLOOR;
      }
      re[bin] = re[bin]! * gain;
      im[bin] = im[bin]! * gain;
      if (bin > 0 && bin < FFT_SIZE / 2) {
        const mirror = FFT_SIZE - bin;
        re[mirror] = re[mirror]! * gain;
        im[mirror] = im[mirror]! * gain;
      }
    }

    ifft(re, im);

    for (let i = 0; i < FFT_SIZE; i++) {
      out[start + i] = (out[start + i] ?? 0) + re[i]! * HANN[i]!;
      norm[start + i] = (norm[start + i] ?? 0) + HANN[i]! * HANN[i]!;
    }
  }

  const wet = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const weight = norm[pad + i]!;
    wet[i] = weight > 1e-8 ? out[pad + i]! / weight : padded[pad + i]!;
  }

  const strength = opts.strength === undefined ? 1 : Math.max(0, Math.min(1, opts.strength));
  const lambda = wetMix(estimateSnrDb(samples, [], sampleRate)) * strength;
  if (lambda <= 0) {
    return Float32Array.from(samples);
  }

  const result = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    result[i] = (1 - lambda) * samples[i]! + lambda * wet[i]!;
  }
  return result;
}
