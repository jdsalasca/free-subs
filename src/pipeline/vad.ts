/**
 * Voice activity detection: energy + zero-crossing based framing.
 *
 * The detector works on 20 ms frames with a 10 ms hop, uses an adaptive RMS
 * threshold, bridges short gaps (hangover) and pads the detected regions so
 * the ASR model never gets an abrupt cut.
 */
export interface SpeechRegion {
  startMs: number;
  endMs: number;
}

const FRAME_MS = 20;
const HOP_MS = 10;
const HANGOVER_MS = 200;
const MIN_SPEECH_MS = 300;
const MERGE_GAP_MS = 300;
const PAD_MS = 100;
const MIN_RMS = 0.005;
const MAX_ZCR = 0.35;

interface FrameStats {
  startMs: number;
  endMs: number;
  rms: number;
  zcr: number;
}

function frameStats(samples: Float32Array, sampleRate: number): FrameStats[] {
  const frameSize = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const hopSize = Math.max(1, Math.round((sampleRate * HOP_MS) / 1000));
  const frames: FrameStats[] = [];

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    let sumSquares = 0;
    let crossings = 0;
    let previous = samples[start] ?? 0;

    for (let i = 0; i < frameSize; i++) {
      const value = samples[start + i] ?? 0;
      sumSquares += value * value;
      if (i > 0 && ((value >= 0 && previous < 0) || (value < 0 && previous >= 0))) {
        crossings++;
      }
      previous = value;
    }

    frames.push({
      startMs: (start / sampleRate) * 1000,
      endMs: ((start + frameSize) / sampleRate) * 1000,
      rms: Math.sqrt(sumSquares / frameSize),
      zcr: crossings / frameSize,
    });
  }

  return frames;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

/** Merge consecutive regions whose gap is at most `maxGapMs`. */
function mergeRegions(regions: SpeechRegion[], maxGapMs: number): SpeechRegion[] {
  const merged: SpeechRegion[] = [];
  for (const region of regions) {
    const last = merged[merged.length - 1];
    if (last !== undefined && region.startMs - last.endMs <= maxGapMs) {
      last.endMs = Math.max(last.endMs, region.endMs);
    } else {
      merged.push({ startMs: region.startMs, endMs: region.endMs });
    }
  }
  return merged;
}

/** Detect speech regions (in milliseconds) inside mono audio. */
export function detectSpeechRegions(samples: Float32Array, sampleRate: number): SpeechRegion[] {
  if (samples.length === 0 || sampleRate <= 0) {
    return [];
  }

  const frames = frameStats(samples, sampleRate);
  if (frames.length === 0) {
    return [];
  }

  const rmsValues = frames.map((frame) => frame.rms);
  const adaptive = percentile(rmsValues, 0.1) * 2.5;
  const peak = rmsValues.reduce((max, value) => Math.max(max, value), 0);
  // The adaptive floor can exceed the signal when a clip is speech from start
  // to finish (p10 is already speech-level); cap it below the peak.
  const threshold = Math.max(MIN_RMS, Math.min(adaptive, peak * 0.5));

  const raw: SpeechRegion[] = [];
  let current: SpeechRegion | undefined;
  for (const frame of frames) {
    const isSpeech = frame.rms > threshold && frame.zcr < MAX_ZCR;
    if (isSpeech) {
      if (current === undefined) {
        current = { startMs: frame.startMs, endMs: frame.endMs };
        raw.push(current);
      } else {
        current.endMs = frame.endMs;
      }
    } else {
      current = undefined;
    }
  }

  // Hangover: bridge short dips so brief pauses do not split a phrase.
  const bridged = mergeRegions(raw, HANGOVER_MS);
  // Drop anything too short to be a real utterance.
  const substantial = bridged.filter((region) => region.endMs - region.startMs >= MIN_SPEECH_MS);
  // Merge regions separated by a short gap.
  const merged = mergeRegions(substantial, MERGE_GAP_MS);

  const durationMs = (samples.length / sampleRate) * 1000;
  return merged.map((region) => ({
    startMs: Math.max(0, region.startMs - PAD_MS),
    endMs: Math.min(durationMs, region.endMs + PAD_MS),
  }));
}

/**
 * Slice audio down to the first and last speech region, with an extra 100 ms
 * of context on each side. Returns the original array when there is no speech.
 */
export function trimToSpeech(samples: Float32Array, sampleRate: number): Float32Array {
  const regions = detectSpeechRegions(samples, sampleRate);
  const first = regions[0];
  const last = regions[regions.length - 1];
  if (first === undefined || last === undefined) {
    return samples;
  }

  const durationMs = (samples.length / sampleRate) * 1000;
  const startMs = Math.max(0, first.startMs - PAD_MS);
  const endMs = Math.min(durationMs, last.endMs + PAD_MS);
  const startSample = Math.max(0, Math.round((startMs / 1000) * sampleRate));
  const endSample = Math.min(samples.length, Math.round((endMs / 1000) * sampleRate));

  if (endSample <= startSample) {
    return samples;
  }
  return samples.slice(startSample, endSample);
}
