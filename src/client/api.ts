import type {
  ExportRecord,
  JobRecord,
  LanguageCode,
  ModelId,
  SubtitleExportStyle,
  SubtitleFormat,
} from '../core/types';
import type { TranslationTarget } from './constants';

export interface CreateJobOptions {
  language: LanguageCode;
  model: ModelId;
  /** Music mode: asks the server to isolate the centre vocal channel. */
  vocals?: boolean;
}

/** Shape of `GET /api/models`; `fonts`/`defaultStyle` may be absent on old servers. */
export interface ModelsResponse {
  models: ModelId[];
  languages: LanguageCode[];
  fonts?: string[];
  defaultStyle?: SubtitleExportStyle;
}

const JSON_HEADERS: HeadersInit = { 'Content-Type': 'application/json' };

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

  if (opts.vocals) {
    params.set('vocals', 'true');
  }

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

/** Fetches available models, languages, fonts and the default export style. */
export async function getModels(): Promise<ModelsResponse> {
  const response = await fetch('/api/models');

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as ModelsResponse;
}

/**
 * Replaces the cue texts of a finished job (order-based) and returns the
 * updated `JobRecord`. The server re-wraps the lines, regenerates SRT/VTT and
 * clears stale translations.
 */
export async function saveCues(id: string, texts: string[]): Promise<JobRecord> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}/cues`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ cues: texts.map((text) => ({ text })) }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as JobRecord;
}

/** Kicks off a translation of an already-finished job. */
export async function translateJob(
  id: string,
  to: TranslationTarget,
): Promise<{ translationId: string }> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}/translate`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ to }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const data = (await response.json()) as { translationId?: unknown };

  if (typeof data.translationId === 'string' && data.translationId.length > 0) {
    return { translationId: data.translationId };
  }

  return { translationId: to };
}

/** Starts a burned-in video export for an already-finished job. */
export async function exportJob(
  id: string,
  style: SubtitleExportStyle,
): Promise<{ exportId: string }> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}/export`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ style }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const data = (await response.json()) as { exportId?: unknown };

  if (typeof data.exportId !== 'string' || data.exportId.length === 0) {
    throw new Error('The server did not return a valid export id.');
  }

  return { exportId: data.exportId };
}

/** Fetches the state of a video export. */
export async function getExport(exportId: string): Promise<ExportRecord> {
  const response = await fetch(`/api/exports/${encodeURIComponent(exportId)}`);

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as ExportRecord;
}

/**
 * Builds a download URL for a subtitle track. Pass `lang` to fetch a
 * translated track (`?format=srt&lang=es`).
 */
export function downloadUrl(
  id: string,
  format: SubtitleFormat,
  lang?: string,
): string {
  const params = new URLSearchParams({ format });

  if (lang !== undefined && lang.length > 0) {
    params.set('lang', lang);
  }

  return `/api/jobs/${encodeURIComponent(id)}/download?${params.toString()}`;
}

/** Builds the download URL for the JSON study document of a finished job. */
export function studyDownloadUrl(id: string): string {
  return `/api/jobs/${encodeURIComponent(id)}/download?format=json`;
}

/** Builds the download URL for a finished burned-in video export. */
export function exportDownloadUrl(exportId: string): string {
  return `/api/exports/${encodeURIComponent(exportId)}/download`;
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
