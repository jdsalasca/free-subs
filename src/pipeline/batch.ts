/**
 * Sequential batch processing for the CLI.
 *
 * The batch loop lives here (not in `cli.ts`) so it can be unit-tested without
 * spawning a process: `listMediaFiles` discovers the inputs of a directory and
 * `runBatch` drives one file at a time, survives per-file failures and reports
 * a deterministic summary.
 */
import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

/** Audio and video extensions the batch mode knows how to transcribe. */
export const MEDIA_EXTENSIONS: string[] = [
  '.mp3',
  '.wav',
  '.m4a',
  '.flac',
  '.ogg',
  '.opus',
  '.aac',
  '.mp4',
  '.mkv',
  '.mov',
  '.webm',
];

const MEDIA_EXTENSION_SET = new Set(MEDIA_EXTENSIONS);

/**
 * List the top-level media files of `dir` as full paths.
 *
 * Hidden entries (name starting with `.`) are skipped, directories are skipped
 * and only files whose extension is a known media extension (matched
 * case-insensitively) are returned. The result is sorted by path.
 */
export function listMediaFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!MEDIA_EXTENSION_SET.has(extname(entry.name).toLowerCase())) {
      continue;
    }
    files.push(join(dir, entry.name));
  }

  return files.sort();
}

export interface BatchSummary {
  total: number;
  succeeded: number;
  failed: number;
  errors: { file: string; error: string }[];
}

export interface BatchEvent {
  type: 'start' | 'done' | 'error';
  file: string;
  error?: string;
}

export interface RunBatchOptions {
  onEvent?: (event: BatchEvent) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Process `files` one at a time.
 *
 * A failing file is recorded and never aborts the batch; the returned summary
 * always counts every input. `onEvent` receives `start` before each attempt and
 * exactly one of `done` / `error` afterwards.
 */
export async function runBatch(
  files: string[],
  processFile: (file: string) => Promise<void>,
  options: RunBatchOptions = {},
): Promise<BatchSummary> {
  let succeeded = 0;
  let failed = 0;
  const errors: { file: string; error: string }[] = [];

  for (const file of files) {
    options.onEvent?.({ type: 'start', file });
    try {
      await processFile(file);
      succeeded += 1;
      options.onEvent?.({ type: 'done', file });
    } catch (error) {
      failed += 1;
      const message = errorMessage(error);
      errors.push({ file, error: message });
      options.onEvent?.({ type: 'error', file, error: message });
    }
  }

  return { total: files.length, succeeded, failed, errors };
}
