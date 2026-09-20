import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadAudioFile } from '../../../src/pipeline/audio';

const tempDirs: string[] = [];

function writeTemporaryWav(buffer: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'free-subs-stereo-'));
  tempDirs.push(dir);
  const path = join(dir, 'stereo.wav');
  writeFileSync(path, buffer);
  return path;
}

/** Build a minimal 16-bit PCM RIFF/WAVE file from interleaved samples. */
function buildWav(options: {
  sampleRate: number;
  channels: number;
  interleaved: number[];
}): Buffer {
  const bytesPerSample = 2;
  const data = Buffer.alloc(options.interleaved.length * bytesPerSample);
  options.interleaved.forEach((sample, index) => {
    const value = Math.max(-32768, Math.min(32767, Math.round(sample * 32768)));
    data.writeInt16LE(value, index * bytesPerSample);
  });

  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(options.channels, 2);
  fmt.writeUInt32LE(options.sampleRate, 4);
  fmt.writeUInt32LE(options.sampleRate * options.channels * bytesPerSample, 8);
  fmt.writeUInt16LE(options.channels * bytesPerSample, 12);
  fmt.writeUInt16LE(16, 14);

  const chunks: Buffer[] = [];
  const fmtKey = Buffer.from('fmt ');
  const fmtSize = Buffer.alloc(4);
  fmtSize.writeUInt32LE(fmt.length, 0);
  chunks.push(fmtKey, fmtSize, fmt);

  const dataKey = Buffer.from('data');
  const dataSize = Buffer.alloc(4);
  dataSize.writeUInt32LE(data.length, 0);
  chunks.push(dataKey, dataSize, data);

  const body = Buffer.concat(chunks);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WAVE', 8, 'ascii');

  return Buffer.concat([riff, body]);
}

function interleave(left: number[], right: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < left.length; i++) {
    out.push(left[i] ?? 0, right[i] ?? 0);
  }
  return out;
}

const LEFT = [0.5, -0.25, 0.75, -0.5, 0.125, -0.875, 0.0, 0.25];
const RIGHT = [-0.5, 0.25, 0.25, 0.5, -0.125, 0.875, 0.0, -0.25];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('loadAudioFile stereo', () => {
  it('exposes per-channel data when stereo is requested', async () => {
    const path = writeTemporaryWav(
      buildWav({ sampleRate: 16000, channels: 2, interleaved: interleave(LEFT, RIGHT) }),
    );

    const audio = await loadAudioFile(path, { stereo: true });
    expect(audio.sampleRate).toBe(16000);
    expect(audio.channels).toBe(2);
    expect(audio.channelData).toHaveLength(2);

    const [left, right] = audio.channelData ?? [];
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(left).toHaveLength(LEFT.length);
    expect(right).toHaveLength(RIGHT.length);

    for (let i = 0; i < LEFT.length; i++) {
      expect(left?.[i] ?? Number.NaN).toBeCloseTo(LEFT[i] ?? Number.NaN, 4);
      expect(right?.[i] ?? Number.NaN).toBeCloseTo(RIGHT[i] ?? Number.NaN, 4);
    }

    // The channels really differ, so this is not a mono file in disguise.
    expect(left?.[0]).not.toBeCloseTo(right?.[0] ?? Number.NaN, 4);

    // The mono mixdown is the average of the two channels.
    for (let i = 0; i < LEFT.length; i++) {
      const average = ((LEFT[i] ?? 0) + (RIGHT[i] ?? 0)) / 2;
      expect(audio.samples[i] ?? Number.NaN).toBeCloseTo(average, 4);
    }
  });

  it('still works without options and does not expose channel data', async () => {
    const path = writeTemporaryWav(
      buildWav({ sampleRate: 16000, channels: 2, interleaved: interleave(LEFT, RIGHT) }),
    );

    const audio = await loadAudioFile(path);
    expect(audio.sampleRate).toBe(16000);
    expect(audio.channels).toBe(2);
    expect(audio.channelData).toBeUndefined();
    for (let i = 0; i < LEFT.length; i++) {
      const average = ((LEFT[i] ?? 0) + (RIGHT[i] ?? 0)) / 2;
      expect(audio.samples[i] ?? Number.NaN).toBeCloseTo(average, 4);
    }
  });

  it('resamples each stereo channel to 16 kHz', async () => {
    const left = [0.5, -0.25, 0.75, -0.5];
    const right = [-0.5, 0.25, 0.25, 0.5];
    const path = writeTemporaryWav(
      buildWav({ sampleRate: 8000, channels: 2, interleaved: interleave(left, right) }),
    );

    const audio = await loadAudioFile(path, { stereo: true });
    expect(audio.sampleRate).toBe(16000);
    expect(audio.samples).toHaveLength(8);
    expect(audio.channelData?.[0]).toHaveLength(8);
    expect(audio.channelData?.[1]).toHaveLength(8);
  });
});
