import type { Server } from 'node:http';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobRecord, TranscriptionResult } from '../../../src/core/types';
import { createApp } from '../../../src/server/app';
import { JobStore } from '../../../src/server/jobs';
import type { TranscribeOptions } from '../../../src/pipeline/transcribe';

const SRT = '1\n00:00:00,000 --> 00:00:01,000\nHello world\n';
const VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello world\n';

interface TranscribeCall {
  path: string;
  filename: string;
  opts?: TranscribeOptions;
}

function makeResult(): TranscriptionResult {
  return {
    language: 'en',
    durationMs: 1000,
    segments: [{ text: 'Hello world', startMs: 0, endMs: 1000 }],
    cues: [{ index: 1, startMs: 0, endMs: 1000, lines: ['Hello world'] }],
    srt: SRT,
    vtt: VTT,
    stats: { cueCount: 1, wordCount: 2, avgCps: 11, maxCps: 11, durationMs: 1000 },
  };
}

async function listen(app: Express): Promise<{ server: Server; base: string }> {
  const server = await new Promise<Server>((resolve) => {
    const created = app.listen(0, () => resolve(created));
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { server, base: `http://127.0.0.1:${port}` };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function terminalJob(base: string, id: string): Promise<JobRecord> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/api/jobs/${id}`);
    const job = (await response.json()) as JobRecord;
    if (job.status === 'done' || job.status === 'error') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for job ${id}`);
}

async function createJob(
  base: string,
  query: string,
  body: Buffer | Uint8Array = Buffer.from('audio-bytes'),
): Promise<Response> {
  return fetch(`${base}/api/jobs?${query}`, {
    method: 'POST',
    body: body as unknown as BodyInit,
  });
}

describe('createApp', () => {
  let store: JobStore;
  let server: Server;
  let base: string;
  let calls: TranscribeCall[];

  beforeEach(async () => {
    store = new JobStore();
    calls = [];
    const app = createApp(store, {
      transcribe: async (path, filename, opts) => {
        calls.push({ path, filename, opts });
        return makeResult();
      },
    });
    const started = await listen(app);
    server = started.server;
    base = started.base;
  });

  afterEach(async () => {
    await close(server);
  });

  it('reports health', async () => {
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      name: 'free-subs',
      version: '0.2.0',
    });
  });

  it('lists the available models, languages, fonts and default style', async () => {
    const response = await fetch(`${base}/api/models`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      models: string[];
      languages: string[];
      fonts: string[];
      defaultStyle: { fontFamily: string; fontSize: number };
    };
    expect(body.models).toEqual(['tiny', 'base', 'small']);
    expect(body.languages).toEqual(['auto', 'es', 'en', 'zh']);
    expect(body.fonts.length).toBeGreaterThan(0);
    expect(body.defaultStyle.fontSize).toBeGreaterThan(0);
  });

  it('rejects an invalid model', async () => {
    const response = await createJob(base, 'model=large&filename=a.wav');
    expect(response.status).toBe(400);
  });

  it('rejects an invalid language', async () => {
    const response = await createJob(base, 'language=fr&filename=a.wav');
    expect(response.status).toBe(400);
  });

  it('rejects an empty body', async () => {
    const response = await createJob(base, 'language=en&model=base&filename=a.wav', Buffer.alloc(0));
    expect(response.status).toBe(400);
  });

  it('creates a job, runs it and exposes the result', async () => {
    const response = await createJob(base, 'language=en&model=base&filename=clip.wav');
    expect(response.status).toBe(202);
    const created = (await response.json()) as { id: string };
    expect(typeof created.id).toBe('string');

    const job = await terminalJob(base, created.id);
    expect(job.status).toBe('done');
    expect(job.result?.srt).toBe(SRT);
    expect(job.filename).toBe('clip.wav');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.filename).toBe('clip.wav');
    expect(calls[0]?.opts?.language).toBe('en');
    expect(calls[0]?.opts?.model).toBe('base');
  });

  it('defaults language and model when they are omitted', async () => {
    const response = await createJob(base, 'filename=clip.wav');
    expect(response.status).toBe(202);
    const created = (await response.json()) as { id: string };
    await terminalJob(base, created.id);
    expect(calls[0]?.opts?.language).toBe('auto');
    expect(calls[0]?.opts?.model).toBe('base');
  });

  it('sanitizes the filename', async () => {
    const response = await createJob(
      base,
      `filename=${encodeURIComponent('../../evil.wav')}`,
    );
    const created = (await response.json()) as { id: string };
    const job = await terminalJob(base, created.id);
    expect(job.filename).toBe('evil.wav');
  });

  it('downloads SRT and VTT with the right headers', async () => {
    const response = await createJob(base, 'language=en&model=base&filename=movie.wav');
    const created = (await response.json()) as { id: string };
    await terminalJob(base, created.id);

    const srt = await fetch(`${base}/api/jobs/${created.id}/download?format=srt`);
    expect(srt.status).toBe(200);
    expect(srt.headers.get('content-type')).toContain('application/x-subrip');
    expect(srt.headers.get('content-disposition')).toContain('movie.srt');
    expect(await srt.text()).toBe(SRT);

    const vtt = await fetch(`${base}/api/jobs/${created.id}/download?format=vtt`);
    expect(vtt.status).toBe(200);
    expect(vtt.headers.get('content-type')).toContain('text/vtt');
    expect(vtt.headers.get('content-disposition')).toContain('movie.vtt');
    expect(await vtt.text()).toBe(VTT);
  });

  it('rejects an invalid download format', async () => {
    const response = await createJob(base, 'language=en&model=base&filename=movie.wav');
    const created = (await response.json()) as { id: string };
    await terminalJob(base, created.id);

    const invalid = await fetch(`${base}/api/jobs/${created.id}/download?format=txt`);
    expect(invalid.status).toBe(400);
  });

  it('returns 404 for unknown jobs and unfinished downloads', async () => {
    const unknown = await fetch(`${base}/api/jobs/does-not-exist`);
    expect(unknown.status).toBe(404);

    const pending = store.create('pending.wav');
    const download = await fetch(`${base}/api/jobs/${pending.id}/download?format=srt`);
    expect(download.status).toBe(404);
  });

  it('returns 404 JSON for unknown API routes', async () => {
    const response = await fetch(`${base}/api/nope`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('marks the job as failed when transcription throws', async () => {
    const failing = createApp(new JobStore(), {
      transcribe: async () => {
        throw new Error('boom');
      },
    });
    const started = await listen(failing);
    try {
      const response = await createJob(
        started.base,
        'language=en&model=base&filename=bad.wav',
      );
      const created = (await response.json()) as { id: string };
      const job = await terminalJob(started.base, created.id);
      expect(job.status).toBe('error');
      expect(job.error).toContain('boom');
    } finally {
      await close(started.server);
    }
  });
});
