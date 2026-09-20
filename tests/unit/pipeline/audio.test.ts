import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodeWav,
  loadAudioFile,
  resampleLinear,
  resolveFfmpeg,
} from '../../../src/pipeline/audio';

type SampleFormat = 'pcm' | 'float';

/**
 * Encode a single normalized sample into `bits` bits (little-endian) and
 * append it to `bytes`.
 */
function encodeSample(bytes: number[], sample: number, bits: number, format: SampleFormat): void {
  if (format === 'float' && bits === 32) {
    const buffer = Buffer.alloc(4);
    buffer.writeFloatLE(sample, 0);
    bytes.push(buffer[0] ?? 0, buffer[1] ?? 0, buffer[2] ?? 0, buffer[3] ?? 0);
    return;
  }

  if (bits === 8) {
    const value = Math.max(0, Math.min(255, Math.round(sample * 128) + 128));
    bytes.push(value);
    return;
  }

  if (bits === 16) {
    const value = Math.max(-32768, Math.min(32767, Math.round(sample * 32768)));
    const buffer = Buffer.alloc(2);
    buffer.writeInt16LE(value, 0);
    bytes.push(buffer[0] ?? 0, buffer[1] ?? 0);
    return;
  }

  if (bits === 24) {
    const value = Math.max(-8388608, Math.min(8388607, Math.round(sample * 8388608)));
    bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff);
    return;
  }

  if (bits === 32) {
    const value = Math.max(-2147483648, Math.min(2147483647, Math.round(sample * 2147483648)));
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(value, 0);
    bytes.push(buffer[0] ?? 0, buffer[1] ?? 0, buffer[2] ?? 0, buffer[3] ?? 0);
    return;
  }

  throw new Error(`Unsupported test bit depth: ${bits}`);
}

/** Build a minimal RIFF/WAVE file from interleaved normalized samples. */
function buildWav(options: {
  sampleRate: number;
  channels: number;
  bits: number;
  format?: SampleFormat;
  interleaved: number[];
}): Buffer {
  const format: SampleFormat = options.format ?? 'pcm';
  const audioFormat = format === 'float' ? 3 : 1;
  const bytesPerSample = options.bits / 8;
  const data: number[] = [];
  for (const sample of options.interleaved) {
    encodeSample(data, sample, options.bits, format);
  }
  const dataBuffer = Buffer.from(data);

  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(audioFormat, 0);
  fmt.writeUInt16LE(options.channels, 2);
  fmt.writeUInt32LE(options.sampleRate, 4);
  fmt.writeUInt32LE(options.sampleRate * options.channels * bytesPerSample, 8);
  fmt.writeUInt16LE(options.channels * bytesPerSample, 12);
  fmt.writeUInt16LE(options.bits, 14);

  const chunks: Buffer[] = [];
  const key = Buffer.from('fmt ');
  const keySize = Buffer.alloc(4);
  keySize.writeUInt32LE(fmt.length, 0);
  chunks.push(key, keySize, fmt);

  const dataKey = Buffer.from('data');
  const dataSize = Buffer.alloc(4);
  dataSize.writeUInt32LE(dataBuffer.length, 0);
  chunks.push(dataKey, dataSize, dataBuffer);

  const body = Buffer.concat(chunks);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WAVE', 8, 'ascii');

  return Buffer.concat([riff, body]);
}

const FIXTURE = fileURLToPath(new URL('../../e2e/fixtures/hello-en.wav', import.meta.url));

describe('decodeWav', () => {
  it('decodes 16-bit mono PCM and normalizes samples', () => {
    const wav = buildWav({
      sampleRate: 8000,
      channels: 1,
      bits: 16,
      interleaved: [0, 0.25, -0.25, 1],
    });
    const audio = decodeWav(wav);
    expect(audio.sampleRate).toBe(8000);
    expect(audio.channels).toBe(1);
    expect(audio.samples).toHaveLength(4);
    expect(audio.samples[0] ?? Number.NaN).toBeCloseTo(0, 5);
    expect(audio.samples[1] ?? Number.NaN).toBeCloseTo(0.25, 5);
    expect(audio.samples[2] ?? Number.NaN).toBeCloseTo(-0.25, 5);
    expect(audio.durationMs).toBeCloseTo(0.5, 5);
  });

  it('mixes stereo down to mono and keeps the channel count', () => {
    const wav = buildWav({
      sampleRate: 16000,
      channels: 2,
      bits: 16,
      interleaved: [0.5, -0.5, 0.5, 0.5],
    });
    const audio = decodeWav(wav);
    expect(audio.channels).toBe(2);
    expect(audio.samples).toHaveLength(2);
    expect(audio.samples[0] ?? Number.NaN).toBeCloseTo(0, 5);
    expect(audio.samples[1] ?? Number.NaN).toBeCloseTo(0.5, 5);
    expect(audio.durationMs).toBeCloseTo(0.125, 5);
  });

  it('decodes 32-bit float samples exactly', () => {
    const wav = buildWav({
      sampleRate: 44100,
      channels: 1,
      bits: 32,
      format: 'float',
      interleaved: [0.1, -0.999, 0.5],
    });
    const audio = decodeWav(wav);
    expect(audio.samples[0] ?? Number.NaN).toBeCloseTo(0.1, 6);
    expect(audio.samples[1] ?? Number.NaN).toBeCloseTo(-0.999, 6);
    expect(audio.samples[2] ?? Number.NaN).toBeCloseTo(0.5, 6);
  });

  it('decodes 8-bit and 24-bit PCM', () => {
    const eight = decodeWav(
      buildWav({ sampleRate: 8000, channels: 1, bits: 8, interleaved: [0, 0.5, -0.5] }),
    );
    expect(eight.samples[1] ?? Number.NaN).toBeCloseTo(0.5, 5);
    expect(eight.samples[2] ?? Number.NaN).toBeCloseTo(-0.5, 5);

    const twentyFour = decodeWav(
      buildWav({ sampleRate: 8000, channels: 1, bits: 24, interleaved: [0, 0.5, -0.5] }),
    );
    expect(twentyFour.samples[1] ?? Number.NaN).toBeCloseTo(0.5, 5);
    expect(twentyFour.samples[2] ?? Number.NaN).toBeCloseTo(-0.5, 5);
  });

  it('throws on a buffer that is not a WAV file', () => {
    expect(() => decodeWav(Buffer.from('not a wav file at all'))).toThrow();
  });

  it('accepts a Uint8Array as well as a Buffer', () => {
    const wav = buildWav({ sampleRate: 8000, channels: 1, bits: 16, interleaved: [0.5] });
    const audio = decodeWav(new Uint8Array(wav));
    expect(audio.samples[0] ?? Number.NaN).toBeCloseTo(0.5, 5);
  });
});

describe('resampleLinear', () => {
  it('returns the input unchanged when rates are equal', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleLinear(input, 16000, 16000)).toEqual(input);
  });

  it('keeps empty input empty', () => {
    expect(resampleLinear(new Float32Array(0), 8000, 16000)).toHaveLength(0);
  });

  it('interpolates linearly', () => {
    const out = resampleLinear(new Float32Array([0, 1]), 1, 2);
    expect(out).toHaveLength(4);
    expect(out[0] ?? Number.NaN).toBeCloseTo(0, 6);
    expect(out[1] ?? Number.NaN).toBeCloseTo(0.5, 6);
    expect(out[2] ?? Number.NaN).toBeCloseTo(1, 6);
    expect(out[3] ?? Number.NaN).toBeCloseTo(1, 6);
  });

  it('changes the length proportionally', () => {
    const input = new Float32Array(16000);
    expect(resampleLinear(input, 16000, 8000)).toHaveLength(8000);
    expect(resampleLinear(input, 8000, 16000)).toHaveLength(32000);
  });
});

describe('resolveFfmpeg', () => {
  const original = process.env.FREE_SUBS_FFMPEG;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FREE_SUBS_FFMPEG;
    } else {
      process.env.FREE_SUBS_FFMPEG = original;
    }
  });

  it('prefers FREE_SUBS_FFMPEG when the path exists', () => {
    process.env.FREE_SUBS_FFMPEG = process.execPath;
    expect(resolveFfmpeg()).toBe(process.execPath);
  });

  it('ignores a non-existent FREE_SUBS_FFMPEG path', () => {
    process.env.FREE_SUBS_FFMPEG = 'C:/definitely/not/here/ffmpeg';
    expect(resolveFfmpeg()).not.toBe('C:/definitely/not/here/ffmpeg');
  });

  it('returns a string path or null', () => {
    delete process.env.FREE_SUBS_FFMPEG;
    const resolved = resolveFfmpeg();
    expect(resolved === null || typeof resolved === 'string').toBe(true);
  });
});

describe('loadAudioFile', () => {
  it('loads and resamples a WAV fixture to 16 kHz mono', async () => {
    if (!existsSync(FIXTURE)) {
      return;
    }
    const audio = await loadAudioFile(FIXTURE);
    expect(audio.sampleRate).toBe(16000);
    expect(audio.channels).toBeGreaterThanOrEqual(1);
    expect(audio.samples.length).toBeGreaterThan(0);
    expect(audio.durationMs).toBeGreaterThan(0);
  });
});
