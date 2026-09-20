import { describe, expect, it } from 'vitest';
import { JobStore } from '../../../src/server/jobs';

describe('JobStore', () => {
  it('creates a queued job with a unique id and ISO timestamp', () => {
    const store = new JobStore();
    const job = store.create('movie.wav');
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(job.filename).toBe('movie.wav');
    expect(job.status).toBe('queued');
    expect(job.progress).toEqual({ stage: 'queued', percent: 0 });
    expect(new Date(job.createdAt).toISOString()).toBe(job.createdAt);

    const other = store.create('other.wav');
    expect(other.id).not.toBe(job.id);
  });

  it('gets a stored job and returns undefined for unknown ids', () => {
    const store = new JobStore();
    const job = store.create('a.wav');
    expect(store.get(job.id)).toBe(job);
    expect(store.get('missing')).toBeUndefined();
  });

  it('updates a job by merging the patch', () => {
    const store = new JobStore();
    const job = store.create('a.wav');
    const updated = store.update(job.id, {
      status: 'processing',
      progress: { stage: 'decoding', percent: 10 },
    });
    expect(updated?.status).toBe('processing');
    expect(updated?.progress.percent).toBe(10);
    expect(updated?.filename).toBe('a.wav');
    expect(store.get(job.id)?.progress.stage).toBe('decoding');
  });

  it('returns undefined when updating an unknown job', () => {
    const store = new JobStore();
    expect(store.update('missing', { status: 'done' })).toBeUndefined();
  });

  it('deletes jobs', () => {
    const store = new JobStore();
    const job = store.create('a.wav');
    expect(store.delete(job.id)).toBe(true);
    expect(store.get(job.id)).toBeUndefined();
    expect(store.delete(job.id)).toBe(false);
  });

  it('cleans up jobs older than the given age', () => {
    const store = new JobStore();
    const old = store.create('old.wav');
    const fresh = store.create('fresh.wav');
    store.update(old.id, { createdAt: new Date(Date.now() - 60_000).toISOString() });

    const removed = store.cleanupOlderThan(30_000);
    expect(removed).toBe(1);
    expect(store.get(old.id)).toBeUndefined();
    expect(store.get(fresh.id)).toBeDefined();
  });
});
