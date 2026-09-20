/**
 * In-memory job store for transcription requests.
 *
 * Jobs are ephemeral: ids are random UUIDs, timestamps are ISO strings, and
 * old entries are purged opportunistically via `cleanupOlderThan` / `prune`.
 */
import { randomUUID } from 'node:crypto';
import type { ExportRecord, JobRecord } from '../core';

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
    return this.prune(maxAgeMs).length;
  }

  /** Like `cleanupOlderThan` but returns the removed records (for file cleanup). */
  prune(maxAgeMs: number): JobRecord[] {
    const cutoff = Date.now() - maxAgeMs;
    const removed: JobRecord[] = [];
    for (const [id, job] of this.jobs) {
      const created = Date.parse(job.createdAt);
      if (Number.isFinite(created) && created < cutoff) {
        this.jobs.delete(id);
        removed.push(job);
      }
    }
    return removed;
  }

  /** Find an export record by id across all jobs. */
  findExport(exportId: string): { job: JobRecord; record: ExportRecord } | undefined {
    for (const job of this.jobs.values()) {
      const record = job.exports?.[exportId];
      if (record !== undefined) {
        return { job, record };
      }
    }
    return undefined;
  }
}
