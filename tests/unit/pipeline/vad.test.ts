import { describe, expect, it } from 'vitest';
import { detectSpeechRegions, trimToSpeech } from '../../../src/pipeline/vad';

const RATE = 16000;

/** Generate a constant-amplitude sine wave. */
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

describe('detectSpeechRegions', () => {
  it('returns no regions for silence', () => {
    expect(detectSpeechRegions(silence(1), RATE)).toEqual([]);
  });

  it('detects a single speech region for a full sine wave', () => {
    const regions = detectSpeechRegions(sine(1), RATE);
    expect(regions).toHaveLength(1);
    const region = regions[0];
    expect(region).toBeDefined();
    expect(region?.startMs ?? -1).toBeLessThanOrEqual(50);
    expect(region?.endMs ?? -1).toBeGreaterThanOrEqual(950);
  });

  it('trims leading and trailing silence with padding', () => {
    const audio = concat(silence(0.5), sine(1), silence(0.5));
    const regions = detectSpeechRegions(audio, RATE);
    expect(regions).toHaveLength(1);
    const region = regions[0];
    expect(region?.startMs ?? -1).toBeGreaterThan(300);
    expect(region?.startMs ?? -1).toBeLessThan(600);
    expect(region?.endMs ?? -1).toBeGreaterThan(1400);
    expect(region?.endMs ?? -1).toBeLessThan(1700);
  });

  it('drops speech bursts shorter than 300 ms', () => {
    const audio = concat(silence(0.5), sine(0.2), silence(0.5));
    expect(detectSpeechRegions(audio, RATE)).toEqual([]);
  });

  it('keeps two regions separated by a long gap', () => {
    const audio = concat(silence(0.2), sine(0.4), silence(0.5), sine(0.4), silence(0.2));
    const regions = detectSpeechRegions(audio, RATE);
    expect(regions.length).toBe(2);
  });

  it('merges two regions separated by a short gap', () => {
    const audio = concat(silence(0.2), sine(0.4), silence(0.15), sine(0.4), silence(0.2));
    const regions = detectSpeechRegions(audio, RATE);
    expect(regions.length).toBe(1);
  });

  it('returns no regions for empty audio', () => {
    expect(detectSpeechRegions(new Float32Array(0), RATE)).toEqual([]);
  });
});

describe('trimToSpeech', () => {
  it('returns the original samples when there is no speech', () => {
    const audio = silence(1);
    const trimmed = trimToSpeech(audio, RATE);
    expect(trimmed).toBe(audio);
  });

  it('returns the original samples for empty audio', () => {
    const audio = new Float32Array(0);
    expect(trimToSpeech(audio, RATE)).toHaveLength(0);
  });

  it('cuts leading and trailing silence', () => {
    const audio = concat(silence(0.5), sine(1), silence(0.5));
    const trimmed = trimToSpeech(audio, RATE);
    expect(trimmed.length).toBeLessThan(audio.length);
    expect(trimmed.length).toBeGreaterThan(RATE);
  });
});
