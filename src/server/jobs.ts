/**
 * In-memory job store for transcription requests.
 *
 * Jobs are ephemeral: ids are random UUIDs, timestamps are ISO strings, and
 * old entries are purged opportunistically via `cleanupOlderThan`.
 */
import { randomUUID } from 'node:crypto';
import type { JobRecord } from '../core';

export class JobStore {
  private readonly jobs = new Map<string, JobRecord>();

  create(filename: string): JobRecord {
    const job: JobRecord = {
      id: randomUUID(),
      filename,
      status: 'queued',
      progress: { stage: 'queued', percent: 0 },
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  update(id: string, patch: Partial<JobRecord>): JobRecord | undefined {
    const current = this.jobs.get(id);
    if (current === undefined) {
      return undefined;
    }
    const updated: JobRecord = { ...current, ...patch };
    this.jobs.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.jobs.delete(id);
  }

  /** Remove jobs created more than `maxAgeMs` ago; returns how many were removed. */
  cleanupOlderThan(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [id, job] of this.jobs) {
      const created = Date.parse(job.createdAt);
      if (Number.isFinite(created) && created < cutoff) {
        this.jobs.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
