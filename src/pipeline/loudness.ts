/**
 * Loudness normalisation for ASR input.
 *
 * `activeRms` measures the RMS of the speech regions (falling back to the whole
 * signal when no regions are available). `normalizeLoudness` scales the signal
 * so its RMS reaches a target dBFS level while a peak guard keeps the loudest
 * sample below -1 dBFS.
 */

export interface SpeechRegionLike {
  startMs: number;
  endMs: number;
}

/** Peak guard: the loudest output sample must stay at or below -1 dBFS. */
const PEAK_LIMIT = 10 ** (-1 / 20);
const DEFAULT_TARGET_DB = -20;
const SILENCE_EPS = 1e-12;

interface SampleInterval {
  start: number;
  end: number;
}

/** Clamp regions to the signal, drop empties, sort and merge overlaps. */
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

function wholeSignalRms(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const value of samples) {
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

/** RMS of the active speech regions, or the whole signal when none apply. */
export function activeRms(
  samples: Float32Array,
  regions: SpeechRegionLike[],
  sampleRate: number,
): number {
  if (samples.length === 0 || sampleRate <= 0) {
    return 0;
  }

  const intervals = toIntervals(regions, sampleRate, samples.length);
  if (intervals.length === 0) {
    return wholeSignalRms(samples);
  }

  let sum = 0;
  let count = 0;
  for (const interval of intervals) {
    for (let i = interval.start; i < interval.end; i++) {
      const value = samples[i]!;
      sum += value * value;
      count++;
    }
  }

  if (count === 0) {
    return wholeSignalRms(samples);
  }
  return Math.sqrt(sum / count);
}

function peakAbs(samples: Float32Array): number {
  let peak = 0;
  for (const value of samples) {
    peak = Math.max(peak, Math.abs(value));
  }
  return peak;
}

/**
 * Scale mono audio so its RMS reaches `targetDb` dBFS (default -20). A peak
 * guard keeps the result below -1 dBFS. Silent input is returned untouched.
 */
export function normalizeLoudness(
  samples: Float32Array,
  sampleRate: number,
  targetDb = DEFAULT_TARGET_DB,
): Float32Array {
  if (samples.length === 0) {
    return new Float32Array(0);
  }

  const rms = wholeSignalRms(samples);
  if (!(rms > SILENCE_EPS) || sampleRate <= 0) {
    return samples;
  }

  const target = 10 ** (targetDb / 20);
  let gain = target / rms;

  const peak = peakAbs(samples);
  if (peak > 0) {
    const maxGain = PEAK_LIMIT / peak;
    if (gain > maxGain) {
      gain = maxGain;
    }
  }

  if (gain === 1) {
    return samples;
  }

  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i]! * gain;
  }
  return out;
}
