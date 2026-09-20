/**
 * Unit tests for the v3 endpoints: study JSON download, context translation
 * and clip validation.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SubtitleCue, TranscriptionResult } from '../../../src/core';
import { createApp } from '../../../src/server/app';
import { JobStore } from '../../../src/server/jobs';
import type { Translator, TranslatorOptions } from '../../../src/pipeline/translator';

function buildResult(): TranscriptionResult {
  const cues: SubtitleCue[] = [
    { index: 1, startMs: 500, endMs: 1800, lines: ['Hello world.'] },
    { index: 2, startMs: 2000, endMs: 4200, lines: ['This is a test.'] },
  ];
  return {
    language: 'en',
    durationMs: 5000,
    segments: [
      { text: 'Hello world.', startMs: 500, endMs: 1800 },
      { text: 'This is a test.', startMs: 2000, endMs: 4200 },
    ],
    cues,
    srt: '1\n00:00:00,500 --> 00:00:01,800\nHello world.\n\n2\n00:00:02,000 --> 00:00:04,200\nThis is a test.\n',
    vtt: 'WEBVTT\n\n00:00:00.500 --> 00:00:01.800\nHello world.\n\n00:00:02.000 --> 00:00:04.200\nThis is a test.\n',
    stats: { cueCount: 2, wordCount: 6, avgCps: 8, maxCps: 8.5, durationMs: 5000 },
  };
}

class RecordingTranslator implements Translator {
  readonly calls: string[][] = [];

  async translate(texts: string[], _options: TranslatorOptions): Promise<string[]> {
    this.calls.push([...texts]);
    return texts.map((text) => `ES ${text}`);
  }
}

class ChineseTranslator implements Translator {
  async translate(texts: string[], _options: TranslatorOptions): Promise<string[]> {
    return texts.map(() => '你好，世界。');
  }
}

describe('study JSON and clips', () => {
  let server: Server;
  let base: string;
  let store: JobStore;
  let mediaDir: string;

  beforeEach(async () => {
    store = new JobStore();
    const app = createApp(store);
    server = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
    mediaDir = await mkdtemp(join(tmpdir(), 'free-subs-test-'));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(mediaDir, { recursive: true, force: true });
  });

  async function createDoneJob(withMedia = false): Promise<string> {
    const job = store.create('sample.wav');
    let mediaPath: string | undefined;
    if (withMedia) {
      mediaPath = join(mediaDir, 'sample.wav');
      await writeFile(mediaPath, Buffer.from('RIFF....WAVE'));
    }
    store.update(job.id, {
      status: 'done',
      result: buildResult(),
      ...(mediaPath === undefined ? {} : { mediaPath }),
    });
    return job.id;
  }

  it('returns the study document with translations and pinyin', async () => {
    const id = await createDoneJob();
    store.update(id, {
      translations: {
        zh: {
          language: 'zh',
          status: 'done',
          progress: { stage: 'done', percent: 100 },
          cues: [
            { index: 1, startMs: 500, endMs: 1800, lines: ['你好世界'] },
            { index: 2, startMs: 2000, endMs: 4200, lines: ['这是一个测试'] },
          ],
        },
      },
    });

    const response = await fetch(`${base}/api/jobs/${id}/download?format=json`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const doc = (await response.json()) as {
      version: number;
      language: string;
      durationMs: number;
      cues: { lines: string[]; words: unknown[] }[];
      translations: Record<string, { cues: { pinyin?: string }[] }>;
    };
    expect(doc.version).toBe(1);
    expect(doc.language).toBe('en');
    expect(doc.durationMs).toBe(5000);
    expect(doc.cues).toHaveLength(2);
    expect(Array.isArray(doc.cues[0]?.words)).toBe(true);
    expect(doc.translations.zh?.cues[0]?.pinyin).toContain('ní');
  });

  it('returns an empty translations map when nothing is translated', async () => {
    const id = await createDoneJob();
    const response = await fetch(`${base}/api/jobs/${id}/download?format=json`);
    const doc = (await response.json()) as { translations: Record<string, unknown> };
    expect(doc.translations).toEqual({});
  });

  it('rejects an unknown download format', async () => {
    const id = await createDoneJob();
    const response = await fetch(`${base}/api/jobs/${id}/download?format=xyz`);
    expect(response.status).toBe(400);
  });

  it('translates cue blocks with context and keeps the cue count', async () => {
    const id = await createDoneJob();
    const translator = new RecordingTranslator();
    const app = createApp(store, { translator });
    const translatorServer = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
    const translatorBase = `http://127.0.0.1:${(translatorServer.address() as AddressInfo).port}`;
    try {
      const response = await fetch(`${translatorBase}/api/jobs/${id}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'es' }),
      });
      expect(response.status).toBe(202);
      for (let i = 0; i < 50; i += 1) {
        const job = (await (await fetch(`${translatorBase}/api/jobs/${id}`)).json()) as {
          translations?: Record<string, { status: string; cues?: unknown[] }>;
        };
        if (job.translations?.es?.status === 'done') {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // Two short cues fit one block, so the translator is called once with both joined.
      expect(translator.calls).toHaveLength(1);
      expect(translator.calls[0]).toHaveLength(1);
      expect(translator.calls[0]?.[0]).toContain('Hello world.');
      expect(translator.calls[0]?.[0]).toContain('This is a test.');
      const job = (await (await fetch(`${translatorBase}/api/jobs/${id}`)).json()) as {
        translations: Record<string, { cues: { lines: string[] }[]; srt: string }>;
      };
      expect(job.translations.es?.cues).toHaveLength(2);
      expect(job.translations.es?.srt).toContain('ES');
    } finally {
      await new Promise<void>((resolve) => translatorServer.close(() => resolve()));
    }
  });

  it('annotates Chinese translations with pinyin', async () => {
    const id = await createDoneJob();
    const app = createApp(store, { translator: new ChineseTranslator() });
    const zhServer = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
    const zhBase = `http://127.0.0.1:${(zhServer.address() as AddressInfo).port}`;
    try {
      await fetch(`${zhBase}/api/jobs/${id}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'zh' }),
      });
      for (let i = 0; i < 50; i += 1) {
        const job = (await (await fetch(`${zhBase}/api/jobs/${id}`)).json()) as {
          translations?: Record<string, { status: string; cues?: { pinyin?: string }[] }>;
        };
        if (job.translations?.zh?.status === 'done') {
          expect(job.translations.zh.cues?.[0]?.pinyin).toContain('ní');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('translation did not finish');
    } finally {
      await new Promise<void>((resolve) => zhServer.close(() => resolve()));
    }
  });

  it('validates clip ranges, job state and media availability', async () => {
    const unknown = await fetch(`${base}/api/jobs/nope/clip?startMs=0&endMs=1000`);
    expect(unknown.status).toBe(404);

    const queued = store.create('queued.wav');
    const notReady = await fetch(`${base}/api/jobs/${queued.id}/clip?startMs=0&endMs=1000`);
    expect(notReady.status).toBe(409);

    const noMedia = await createDoneJob(false);
    const missing = await fetch(`${base}/api/jobs/${noMedia}/clip?startMs=0&endMs=1000`);
    expect(missing.status).toBe(400);

    const id = await createDoneJob(true);
    const badRange = await fetch(`${base}/api/jobs/${id}/clip?startMs=500&endMs=500`);
    expect(badRange.status).toBe(400);
    const negative = await fetch(`${base}/api/jobs/${id}/clip?startMs=-1&endMs=500`);
    expect(negative.status).toBe(400);
    const tooLong = await fetch(`${base}/api/jobs/${id}/clip?startMs=0&endMs=200000`);
    expect(tooLong.status).toBe(400);
    const beyond = await fetch(`${base}/api/jobs/${id}/clip?startMs=0&endMs=9000`);
    expect(beyond.status).toBe(400);
  });
});
