/**
 * Unit tests for the cue editor endpoint (PATCH /api/jobs/:id/cues).
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TranscriptionResult } from '../../../src/core';
import { createApp } from '../../../src/server/app';
import { JobStore } from '../../../src/server/jobs';
import type { transcribeFile } from '../../../src/pipeline/transcribe';

function buildResult(): TranscriptionResult {
  const cues = [
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

describe('cue editor endpoint', () => {
  let server: Server;
  let base: string;
  let store: JobStore;

  beforeEach(async () => {
    store = new JobStore();
    const stub = (async () => buildResult()) as unknown as typeof transcribeFile;
    const app = createApp(store, { transcribe: stub });
    server = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function createDoneJob(): Promise<string> {
    const created = await fetch(`${base}/api/jobs?language=en&model=tiny&filename=a.wav`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('RIFF....WAVE'),
    });
    expect(created.status).toBe(202);
    const { id } = (await created.json()) as { id: string };
    for (let i = 0; i < 50; i += 1) {
      const job = (await (await fetch(`${base}/api/jobs/${id}`)).json()) as { status: string };
      if (job.status === 'done') {
        return id;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('job did not finish');
  }

  it('updates cue text, regenerates SRT/VTT and recomputes stats', async () => {
    const id = await createDoneJob();
    const response = await fetch(`${base}/api/jobs/${id}/cues`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cues: [{ text: 'Hola mundo editado.' }, { text: 'Esta es una prueba.' }] }),
    });
    expect(response.status).toBe(200);
    const job = (await response.json()) as {
      result: { cues: { lines: string[] }[]; srt: string; vtt: string; stats: { wordCount: number } };
    };
    expect(job.result.cues[0]?.lines.join(' ')).toBe('Hola mundo editado.');
    expect(job.result.srt).toContain('Hola mundo editado.');
    expect(job.result.vtt).toContain('Hola mundo editado.');
    expect(job.result.stats.wordCount).toBeGreaterThan(0);
  });

  it('clears stale translations after an edit', async () => {
    const id = await createDoneJob();
    store.update(id, {
      translations: {
        es: { language: 'es', status: 'done', progress: { stage: 'done', percent: 100 }, srt: 'x', vtt: 'x' },
      },
    });
    const response = await fetch(`${base}/api/jobs/${id}/cues`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cues: [{ text: 'One.' }, { text: 'Two.' }] }),
    });
    expect(response.status).toBe(200);
    const job = (await response.json()) as { translations?: Record<string, unknown> };
    expect(job.translations).toEqual({});
  });

  it('rejects a wrong cue count, empty text and oversized text', async () => {
    const id = await createDoneJob();
    const wrongCount = await fetch(`${base}/api/jobs/${id}/cues`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cues: [{ text: 'Only one.' }] }),
    });
    expect(wrongCount.status).toBe(400);

    const empty = await fetch(`${base}/api/jobs/${id}/cues`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cues: [{ text: '   ' }, { text: 'Two.' }] }),
    });
    expect(empty.status).toBe(400);

    const oversized = await fetch(`${base}/api/jobs/${id}/cues`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cues: [{ text: 'a'.repeat(501) }, { text: 'Two.' }] }),
    });
    expect(oversized.status).toBe(400);
  });

  it('returns 404 for unknown jobs and 409 before the job is done', async () => {
    const missing = await fetch(`${base}/api/jobs/does-not-exist/cues`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cues: [] }),
    });
    expect(missing.status).toBe(404);

    const queued = store.create('queued.wav');
    expect(queued.status).toBe('queued');
    const response = await fetch(`${base}/api/jobs/${queued.id}/cues`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cues: [{ text: 'One.' }] }),
    });
    expect(response.status).toBe(409);
  });
});
