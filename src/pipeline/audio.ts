/**
 * Audio decoding and resampling for the ASR pipeline.
 *
 * WAV files are parsed in-process (PCM int 8/16/24/32 and float32, any
 * channel count mixed down to mono). Anything else is handed to ffmpeg and
 * decoded to raw 16 kHz mono float32.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname } from 'node:path';
import { resampleSinc } from './resample';

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  durationMs: number;
  channels: number;
  /** Per-channel samples, only populated when the caller asks for stereo. */
  channelData?: Float32Array[];
}

export interface LoadAudioOptions {
  /** Decode and expose the individual channels (default false). */
  stereo?: boolean;
}

const TARGET_SAMPLE_RATE = 16000;

interface WavFormat {
  format: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

function asBuffer(buf: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Read the `fmt ` and `data` chunks of a RIFF/WAVE file. */
function parseWav(buffer: Buffer): { format: WavFormat; data: Buffer } {
  if (buffer.length < 12) {
    throw new Error('Invalid WAV file: too small to contain a RIFF header.');
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Invalid WAV file: missing RIFF/WAVE signature.');
  }

  let foundFormat: WavFormat | undefined;
  let data: Buffer | undefined;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ' && size >= 16 && body + 16 <= buffer.length) {
      const format = buffer.readUInt16LE(body);
      const channels = buffer.readUInt16LE(body + 2);
      const sampleRate = buffer.readUInt32LE(body + 4);
      const bitsPerSample = buffer.readUInt16LE(body + 14);
      // WAVE_FORMAT_EXTENSIBLE stores the real format in the first two bytes
      // of the sub-format GUID (offset 24 within the fmt chunk).
      const effective = format === 0xfffe && size >= 40 ? buffer.readUInt16LE(body + 24) : format;
      foundFormat = { format: effective, channels, sampleRate, bitsPerSample };
    } else if (id === 'data') {
      data = buffer.subarray(body, Math.min(body + size, buffer.length));
    }

    offset = body + size + (size % 2);
  }

  if (foundFormat === undefined) {
    throw new Error('Invalid WAV file: missing "fmt " chunk.');
  }
  if (data === undefined) {
    throw new Error('Invalid WAV file: missing "data" chunk.');
  }
  return { format: foundFormat, data };
}

function readSample(data: Buffer, offset: number, format: WavFormat): number {
  const { bitsPerSample, format: audioFormat } = format;

  if (bitsPerSample === 8) {
    return ((data[offset] ?? 128) - 128) / 128;
  }
  if (bitsPerSample === 16) {
    return data.readInt16LE(offset) / 32768;
  }
  if (bitsPerSample === 24) {
    return data.readIntLE(offset, 3) / 8388608;
  }
  if (bitsPerSample === 32) {
    return audioFormat === 3 ? data.readFloatLE(offset) : data.readInt32LE(offset) / 2147483648;
  }
  throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}.`);
}

/** Decode an in-memory WAV file, mixing any channel count down to mono. */
export function decodeWav(buf: Buffer | Uint8Array): DecodedAudio {
  const buffer = asBuffer(buf);
  const { format, data } = parseWav(buffer);

  if (format.format !== 1 && format.format !== 3) {
    throw new Error(`Unsupported WAV encoding (format ${format.format}); expected PCM or float.`);
  }
  if (format.channels < 1) {
    throw new Error('Invalid WAV file: channel count must be at least 1.');
  }

  const bytesPerSample = format.bitsPerSample / 8;
  if (!Number.isInteger(bytesPerSample) || bytesPerSample <= 0) {
    throw new Error(`Invalid WAV file: bad bit depth ${format.bitsPerSample}.`);
  }

  const frameSize = bytesPerSample * format.channels;
  const frameCount = Math.floor(data.length / frameSize);
  const samples = new Float32Array(frameCount);
  const channelData: Float32Array[] = [];
  for (let channel = 0; channel < format.channels; channel++) {
    channelData.push(new Float32Array(frameCount));
  }

  for (let frame = 0; frame < frameCount; frame++) {
    const base = frame * frameSize;
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel++) {
      const value = readSample(data, base + channel * bytesPerSample, format);
      channelData[channel]![frame] = value;
      sum += value;
    }
    samples[frame] = sum / format.channels;
  }

  const sampleRate = format.sampleRate > 0 ? format.sampleRate : TARGET_SAMPLE_RATE;
  const durationMs = (samples.length / sampleRate) * 1000;

  return { samples, sampleRate, durationMs, channels: format.channels, channelData };
}

/** Resample mono audio with linear interpolation. */
export function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (samples.length === 0) {
    return new Float32Array(0);
  }
  if (fromRate === toRate || fromRate <= 0 || toRate <= 0) {
    return samples;
  }

  const outputLength = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const output = new Float32Array(outputLength);
  const ratio = fromRate / toRate;
  const lastIndex = samples.length - 1;

  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = samples[index] ?? samples[lastIndex] ?? 0;
    const b = samples[index + 1] ?? a;
    output[i] = a + (b - a) * fraction;
  }

  return output;
}

function executableExists(candidate: string): boolean {
  try {
    return existsSync(candidate);
  } catch {
    return false;
  }
}

function resolveFfmpegStatic(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const loaded: unknown = require('ffmpeg-static');
    if (typeof loaded === 'string' && loaded !== '' && executableExists(loaded)) {
      return loaded;
    }
    if (
      loaded !== null &&
      typeof loaded === 'object' &&
      'default' in loaded &&
      typeof (loaded as { default?: unknown }).default === 'string'
    ) {
      const fallback = (loaded as { default: string }).default;
      if (fallback !== '' && executableExists(fallback)) {
        return fallback;
      }
    }
  } catch {
    // ffmpeg-static is an optional dependency; ignore when it is absent.
  }
  return null;
}

/** Find a usable ffmpeg executable: env override → ffmpeg-static → PATH. */
export function resolveFfmpeg(): string | null {
  const fromEnv = process.env.FREE_SUBS_FFMPEG;
  if (fromEnv !== undefined && fromEnv !== '' && executableExists(fromEnv)) {
    return fromEnv;
  }

  const bundled = resolveFfmpegStatic();
  if (bundled !== null) {
    return bundled;
  }

  try {
    const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    if (probe.error === undefined && probe.status === 0) {
      return 'ffmpeg';
    }
  } catch {
    // Not on PATH.
  }

  return null;
}

function toFloat32(buffer: Buffer): Float32Array {
  const usable = buffer.length - (buffer.length % 4);
  const aligned = new ArrayBuffer(usable);
  new Uint8Array(aligned).set(buffer.subarray(0, usable));
  return new Float32Array(aligned);
}

async function decodeWithFfmpeg(
  path: string,
  ffmpeg: string,
  stereo: boolean,
): Promise<DecodedAudio> {
  const channels = stereo ? 2 : 1;
  const args = [
    '-v',
    'error',
    '-i',
    path,
    '-f',
    'f32le',
    '-ac',
    String(channels),
    '-ar',
    String(TARGET_SAMPLE_RATE),
    'pipe:1',
  ];

  const chunks = await new Promise<Buffer[]>((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => reject(new Error(`Failed to run ffmpeg: ${error.message}`)));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(`ffmpeg failed (exit ${code ?? 'unknown'}): ${detail || 'no output'}`));
      }
    });
  });

  const interleaved = toFloat32(Buffer.concat(chunks));
  if (!stereo) {
    return {
      samples: interleaved,
      sampleRate: TARGET_SAMPLE_RATE,
      durationMs: (interleaved.length / TARGET_SAMPLE_RATE) * 1000,
      channels: 1,
    };
  }

  const frameCount = Math.floor(interleaved.length / 2);
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame++) {
    const l = interleaved[frame * 2] ?? 0;
    const r = interleaved[frame * 2 + 1] ?? 0;
    left[frame] = l;
    right[frame] = r;
    samples[frame] = (l + r) / 2;
  }

  return {
    samples,
    sampleRate: TARGET_SAMPLE_RATE,
    durationMs: (frameCount / TARGET_SAMPLE_RATE) * 1000,
    channels: 2,
    channelData: [left, right],
  };
}

/**
 * Load an audio file. WAV files are decoded directly; every other format is
 * transcoded through ffmpeg to 16 kHz float32 (mono by default). Pass
 * `{ stereo: true }` to also receive the individual channels in `channelData`.
 */
export async function loadAudioFile(
  path: string,
  options: LoadAudioOptions = {},
): Promise<DecodedAudio> {
  const stereo = options.stereo === true;

  if (extname(path).toLowerCase() === '.wav') {
    const buffer = await readFile(path);
    const decoded = decodeWav(buffer);
    const samples = resampleSinc(decoded.samples, decoded.sampleRate, TARGET_SAMPLE_RATE);
    const result: DecodedAudio = {
      samples,
      sampleRate: TARGET_SAMPLE_RATE,
      durationMs: (samples.length / TARGET_SAMPLE_RATE) * 1000,
      channels: decoded.channels,
    };
    if (stereo && decoded.channelData !== undefined) {
      result.channelData = decoded.channelData.map((channel) =>
        resampleSinc(channel, decoded.sampleRate, TARGET_SAMPLE_RATE),
      );
    }
    return result;
  }

  const ffmpeg = resolveFfmpeg();
  if (ffmpeg === null) {
    throw new Error(
      'ffmpeg was not found. Install it, set FREE_SUBS_FFMPEG, or install ffmpeg-static to decode non-WAV audio.',
    );
  }

  return decodeWithFfmpeg(path, ffmpeg, stereo);
}
