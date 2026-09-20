/**
 * ffmpeg burn-in exporter.
 *
 * Turns an input video plus an `.ass` subtitle file into a new video with the
 * subtitles rendered by libass. The pure helpers (escaping, argument building,
 * progress parsing) are kept separate from process spawning so they can be
 * unit-tested without invoking ffmpeg.
 */
import { spawn, spawnSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { resolveFfmpeg } from '../pipeline/audio';

export interface FfmpegPlan {
  args: string[];
  outputPath: string;
}

/** Characters that force us to quote the path inside the filtergraph. */
const FILTER_SPECIAL = /[ '",;[\]]/;

/**
 * Escape a filesystem path so it can be embedded in `-vf ass=<value>`.
 *
 * Backslashes become forward slashes, the drive colon is escaped as `\:` and
 * the result is quoted only when it contains whitespace or filtergraph
 * metacharacters.
 *
 * Example: `C:\a b\subs.ass` → `'C\:/a b/subs.ass'`.
 */
export function escapeFilterPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/:/g, '\\:');
  if (FILTER_SPECIAL.test(normalized)) {
    return `'${normalized.replace(/'/g, "\\'")}'`;
  }
  return normalized;
}

/** Build the full ffmpeg argument list for a subtitle burn-in. */
export function buildBurnInArgs(
  inputPath: string,
  assPath: string,
  outputPath: string,
): string[] {
  return [
    '-y',
    '-hide_banner',
    '-i',
    inputPath,
    '-vf',
    `ass=${escapeFilterPath(assPath)}`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

/** Build the ffmpeg argument list for an audio clip extraction (study cards). */
export function buildClipArgs(
  inputPath: string,
  startMs: number,
  endMs: number,
  outputPath: string,
): string[] {
  const start = (startMs / 1000).toFixed(3);
  const duration = ((endMs - startMs) / 1000).toFixed(3);
  return [
    '-y',
    '-hide_banner',
    '-ss',
    start,
    '-i',
    inputPath,
    '-t',
    duration,
    '-vn',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

/**
 * Extract a short audio clip (m4a) from a media file. Used by the study-card
 * endpoint so learners can replay a single line.
 */
export async function exportClip(
  inputPath: string,
  startMs: number,
  endMs: number,
  outputPath: string,
): Promise<void> {
  const ffmpeg = resolveFfmpeg();
  if (ffmpeg === null) {
    throw new Error('ffmpeg was not found. Install it or set FREE_SUBS_FFMPEG to create audio clips.');
  }

  const args = buildClipArgs(resolve(inputPath), startMs, endMs, resolve(outputPath));
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const stderrLines: string[] = [];
    let pending = '';

    const consume = (line: string): void => {
      if (line === '') {
        return;
      }
      stderrLines.push(line);
      if (stderrLines.length > 20) {
        stderrLines.shift();
      }
    };

    child.stderr?.on('data', (chunk: Buffer) => {
      pending += chunk.toString();
      const parts = pending.split(/\r?\n/);
      pending = parts.pop() ?? '';
      for (const line of parts) {
        consume(line);
      }
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to run ffmpeg: ${error.message}`));
    });
    child.on('close', (code) => {
      consume(pending.trim());
      if (code === 0) {
        resolvePromise();
        return;
      }
      const detail = stderrLines.slice(-5).join('\n') || 'no output';
      reject(new Error(`ffmpeg clip failed (exit ${code ?? 'unknown'}): ${detail}`));
    });
  });
}

const TIME_RE = /time=(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/;

/** Parse a `time=HH:MM:SS.cc` ffmpeg progress token into milliseconds. */
export function parseFfmpegTime(line: string): number | null {
  const match = TIME_RE.exec(line);
  if (match === null) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4];
  const millis = fraction === undefined ? 0 : Math.round(Number(`0.${fraction}`) * 1000);

  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

/** Derive an `ffprobe` path from the resolved `ffmpeg` path when possible. */
function resolveFfprobe(ffmpeg: string | null): string {
  if (ffmpeg === null) {
    return 'ffprobe';
  }
  const replaced = ffmpeg.replace(
    /ffmpeg(\.exe)?$/i,
    (_match, ext: string | undefined) => `ffprobe${ext ?? ''}`,
  );
  return replaced === ffmpeg ? 'ffprobe' : replaced;
}

/**
 * Read the duration of a media file with ffprobe. Returns `null` when ffprobe
 * is missing, fails, or reports a value that cannot be parsed.
 */
export async function probeDurationMs(inputPath: string): Promise<number | null> {
  const ffprobe = resolveFfprobe(resolveFfmpeg());
  const args = [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    inputPath,
  ];

  return new Promise<number | null>((resolve) => {
    let child;
    try {
      child = spawn(ffprobe, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }

    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const seconds = Number.parseFloat(stdout.trim());
      resolve(Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null);
    });
  });
}

/** Return `true` when the given ffmpeg binary was built with libass. */
export function ffmpegSupportsAss(ffmpegPath: string): boolean {
  try {
    const result = spawnSync(ffmpegPath, ['-hide_banner', '-filters'], { encoding: 'utf8' });
    if (result.error !== undefined || result.status !== 0) {
      return false;
    }
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    return output.includes(' ass ');
  } catch {
    return false;
  }
}

/**
 * Burn an `.ass` file into `inputPath`, writing the result to `outputPath`.
 *
 * Progress (0..100) is reported from ffmpeg's `time=` output when a total
 * `durationMs` is known. Rejects with the tail of ffmpeg's stderr on failure.
 */
export async function exportVideo(
  inputPath: string,
  assPath: string,
  outputPath: string,
  durationMs: number | null,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const ffmpeg = resolveFfmpeg();
  if (ffmpeg === null) {
    throw new Error(
      'ffmpeg was not found. Install it or set FREE_SUBS_FFMPEG to burn subtitles into a video.',
    );
  }
  if (!ffmpegSupportsAss(ffmpeg)) {
    throw new Error(
      `ffmpeg at "${ffmpeg}" was built without libass, so the ass= filter is unavailable.`,
    );
  }

  // Windows drive letters inside the filtergraph are a well-known escaping
  // minefield (the `:` is re-interpreted as an option separator by some ffmpeg
  // builds). Running ffmpeg with the ASS directory as cwd and referencing the
  // file by name removes the colon entirely and works everywhere. Input and
  // output are absolutised first because the cwd changes.
  const assDir = dirname(assPath);
  const assFile = basename(assPath);
  const plan: FfmpegPlan = {
    args: buildBurnInArgs(resolve(inputPath), assFile, resolve(outputPath)),
    outputPath,
  };

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, plan.args, { cwd: assDir, stdio: ['ignore', 'ignore', 'pipe'] });
    const stderrLines: string[] = [];
    let pending = '';

    const consume = (line: string): void => {
      if (line === '') {
        return;
      }
      stderrLines.push(line);
      if (stderrLines.length > 20) {
        stderrLines.shift();
      }
      if (onProgress !== undefined && durationMs !== null && durationMs > 0) {
        const time = parseFfmpegTime(line);
        if (time !== null) {
          const percent = Math.max(0, Math.min(100, (time / durationMs) * 100));
          onProgress(percent);
        }
      }
    };

    child.stderr?.on('data', (chunk: Buffer) => {
      pending += chunk.toString();
      const parts = pending.split(/\r?\n/);
      pending = parts.pop() ?? '';
      for (const line of parts) {
        consume(line);
      }
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to run ffmpeg: ${error.message}`));
    });
    child.on('close', (code) => {
      consume(pending.trim());
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderrLines.slice(-5).join('\n') || 'no output';
      reject(new Error(`ffmpeg failed (exit ${code ?? 'unknown'}): ${detail}`));
    });
  });
}
