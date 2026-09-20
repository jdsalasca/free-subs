import type { JobRecord, LanguageCode, ModelId } from '../core/types';

export interface CreateJobOptions {
  language: LanguageCode;
  model: ModelId;
}

/**
 * Creates a transcription job. The file is sent as the raw request body and
 * the options travel as query parameters, matching the server contract.
 */
export async function createJob(
  file: File,
  opts: CreateJobOptions,
): Promise<{ id: string }> {
  const params = new URLSearchParams({
    language: opts.language,
    model: opts.model,
    filename: file.name,
  });

  const response = await fetch(`/api/jobs?${params.toString()}`, {
    method: 'POST',
    body: file,
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const data = (await response.json()) as { id?: unknown };

  if (!data || typeof data.id !== 'string' || data.id.length === 0) {
    throw new Error('The server did not return a valid job id.');
  }

  return { id: data.id };
}

/** Fetches the current state of a job. */
export async function getJob(id: string): Promise<JobRecord> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`);

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as JobRecord;
}

/** Builds the download URL for the SRT or VTT subtitle track. */
export function downloadUrl(id: string, format: 'srt' | 'vtt'): string {
  return `/api/jobs/${encodeURIComponent(id)}/download?format=${format}`;
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown; message?: unknown };

    if (typeof data.error === 'string' && data.error.length > 0) {
      return data.error;
    }
    if (typeof data.message === 'string' && data.message.length > 0) {
      return data.message;
    }
  } catch {
    // The body was not JSON; fall back to a generic message below.
  }

  return `Request failed (${response.status} ${response.statusText})`.trim();
}
