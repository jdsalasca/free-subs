import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MEDIA_EXTENSIONS,
  listMediaFiles,
  runBatch,
  type BatchEvent,
  type BatchSummary,
} from '../../../src/pipeline/batch';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'free-subs-batch-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('MEDIA_EXTENSIONS', () => {
  it('lists every supported audio and video extension', () => {
    expect(MEDIA_EXTENSIONS).toEqual([
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
    ]);
  });
});

describe('listMediaFiles', () => {
  it('returns only files with a supported extension', async () => {
    await writeFile(join(dir, 'song.mp3'), '');
    await writeFile(join(dir, 'notes.txt'), '');
    await writeFile(join(dir, 'movie.mkv'), '');
    await writeFile(join(dir, 'cover.png'), '');

    expect(listMediaFiles(dir)).toEqual([join(dir, 'movie.mkv'), join(dir, 'song.mp3')]);
  });

  it('sorts the result by path', async () => {
    for (const name of ['c.mp3', 'a.mp3', 'b.wav']) {
      await writeFile(join(dir, name), '');
    }

    expect(listMediaFiles(dir)).toEqual([
      join(dir, 'a.mp3'),
      join(dir, 'b.wav'),
      join(dir, 'c.mp3'),
    ]);
  });

  it('skips hidden files', async () => {
    await writeFile(join(dir, '.hidden.mp3'), '');
    await writeFile(join(dir, 'visible.mp3'), '');

    expect(listMediaFiles(dir)).toEqual([join(dir, 'visible.mp3')]);
  });

  it('skips directories, even when their name looks like media', async () => {
    await mkdir(join(dir, 'album.mp3'));
    await mkdir(join(dir, 'nested'));
    await writeFile(join(dir, 'nested', 'deep.mp3'), '');
    await writeFile(join(dir, 'real.mp3'), '');

    expect(listMediaFiles(dir)).toEqual([join(dir, 'real.mp3')]);
  });

  it('matches the extension case-insensitively', async () => {
    await writeFile(join(dir, 'LOUD.MP3'), '');
    await writeFile(join(dir, 'quiet.WAV'), '');

    expect(listMediaFiles(dir)).toEqual([join(dir, 'LOUD.MP3'), join(dir, 'quiet.WAV')]);
  });

  it('returns an empty list for a directory without media', async () => {
    await writeFile(join(dir, 'readme.md'), '');

    expect(listMediaFiles(dir)).toEqual([]);
  });
});

describe('runBatch', () => {
  it('processes every file sequentially, in order', async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;

    const summary: BatchSummary = await runBatch(['a', 'b', 'c'], async (file) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(file);
      active -= 1;
    });

    expect(order).toEqual(['a', 'b', 'c']);
    expect(maxActive).toBe(1);
    expect(summary).toEqual({ total: 3, succeeded: 3, failed: 0, errors: [] });
  });

  it('continues after a failing file and counts everything', async () => {
    const processed: string[] = [];

    const summary = await runBatch(['a', 'b', 'c'], async (file) => {
      processed.push(file);
      if (file === 'b') {
        throw new Error('boom');
      }
    });

    expect(processed).toEqual(['a', 'b', 'c']);
    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.errors).toEqual([{ file: 'b', error: 'boom' }]);
  });

  it('emits start/done/error events in order', async () => {
    const events: BatchEvent[] = [];

    await runBatch(
      ['a', 'b'],
      async (file) => {
        if (file === 'b') {
          throw new Error('nope');
        }
      },
      { onEvent: (event) => events.push(event) },
    );

    expect(events).toEqual([
      { type: 'start', file: 'a' },
      { type: 'done', file: 'a' },
      { type: 'start', file: 'b' },
      { type: 'error', file: 'b', error: 'nope' },
    ]);
  });

  it('handles an empty file list without emitting events', async () => {
    const onEvent = vi.fn();

    const summary = await runBatch([], async () => undefined, { onEvent });

    expect(summary).toEqual({ total: 0, succeeded: 0, failed: 0, errors: [] });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('normalizes non-Error failures to a message', async () => {
    const summary = await runBatch(['x'], async () => {
      throw 'plain string';
    });

    expect(summary.failed).toBe(1);
    expect(summary.errors).toEqual([{ file: 'x', error: 'plain string' }]);
  });
});
