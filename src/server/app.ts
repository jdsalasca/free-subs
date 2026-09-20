/**
 * HTTP API for free-subs.
 *
 * The app only depends on an injected `JobStore`, an optional transcribe
 * function and an optional translator, which makes it trivial to test without
 * loading the real models.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import {
  DEFAULT_EXPORT_STYLE,
  computeCps,
  serializeAss,
  serializeSrt,
  serializeVtt,
  styleForLanguage,
  tokenize,
  wrapLines,
  type ExportRecord,
  type LanguageCode,
  type ModelId,
  type SubtitleCue,
  type SubtitleExportStyle,
  type SubtitleFormat,
  type TranslationRecord,
} from '../core';
import { transcribeFile, type TranscribeOptions } from '../pipeline/transcribe';
import { annotateCuesWithPinyin } from '../pipeline/pinyin';
import { buildStudyDocument, serializeStudy } from '../pipeline/study';
import { OpusMtTranslator, normalizeLanguage, translateCueTexts, type Translator } from '../pipeline/translator';
import { resolveFfmpeg } from '../pipeline/audio';
import { exportClip, exportVideo, ffmpegSupportsAss, probeDurationMs } from './exporter';
import type { JobStore } from './jobs';

const MODELS: ModelId[] = ['tiny', 'base', 'small'];
const LANGUAGES: LanguageCode[] = ['auto', 'es', 'en', 'zh'];
const TRANSLATION_TARGETS = ['es', 'en', 'zh'] as const;
const FORMATS: SubtitleFormat[] = ['srt', 'vtt', 'ass'];
const DOWNLOAD_FORMATS = ['srt', 'vtt', 'ass', 'json'] as const;
type DownloadFormat = (typeof DOWNLOAD_FORMATS)[number];
const FONTS = [
  'Arial',
  'Segoe UI',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Microsoft YaHei',
  'SimHei',
  'Noto Sans',
];
const JOB_TTL_MS = 60 * 60 * 1000;
const EXPORT_WIDTH = 1920;
const EXPORT_HEIGHT = 1080;
const HEX_COLOR = /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i;

type TranslationTarget = (typeof TRANSLATION_TARGETS)[number];

function isModel(value: string): value is ModelId {
  return (MODELS as string[]).includes(value);
}

function isLanguage(value: string): value is LanguageCode {
  return (LANGUAGES as string[]).includes(value);
}

function isFormat(value: string): value is SubtitleFormat {
  return (FORMATS as string[]).includes(value);
}

function isDownloadFormat(value: string): value is DownloadFormat {
  return (DOWNLOAD_FORMATS as readonly string[]).includes(value);
}

function isTranslationTarget(value: string): value is TranslationTarget {
  return (TRANSLATION_TARGETS as readonly string[]).includes(value);
}

/** Extract a single string value from an Express query value. */
function queryValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal server error.';
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function colorOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim() : fallback;
}

/** Merge user input over the default export style, clamping every field. */
function mergeStyle(input: unknown): SubtitleExportStyle {
  const raw = (input !== null && typeof input === 'object' ? input : {}) as Partial<SubtitleExportStyle>;
  const defaults = DEFAULT_EXPORT_STYLE;
  const position =
    raw.position === 'top' || raw.position === 'middle' || raw.position === 'bottom'
      ? raw.position
      : defaults.position;
  const fontFamily =
    typeof raw.fontFamily === 'string' && raw.fontFamily.trim() !== '' && raw.fontFamily.length <= 100
      ? raw.fontFamily.trim()
      : defaults.fontFamily;
  return {
    fontFamily,
    fontSize: clampNumber(raw.fontSize, 12, 160, defaults.fontSize),
    bold: typeof raw.bold === 'boolean' ? raw.bold : defaults.bold,
    primaryColor: colorOr(raw.primaryColor, defaults.primaryColor),
    outlineColor: colorOr(raw.outlineColor, defaults.outlineColor),
    outlineWidth: clampNumber(raw.outlineWidth, 0, 12, defaults.outlineWidth),
    shadow: clampNumber(raw.shadow, 0, 12, defaults.shadow),
    position,
    marginV: clampNumber(raw.marginV, 0, 500, defaults.marginV),
    background: typeof raw.background === 'boolean' ? raw.background : defaults.background,
    backgroundColor: colorOr(raw.backgroundColor, defaults.backgroundColor),
    backgroundOpacity: clampNumber(raw.backgroundOpacity, 0, 1, defaults.backgroundOpacity),
  };
}

/** Rebuild cues with translated text, keeping the original timings. */
function buildTranslatedCues(cues: SubtitleCue[], texts: string[], lang: string): SubtitleCue[] {
  const style = styleForLanguage(lang);
  const translated = cues.map((cue, index) => {
    const text = (texts[index] ?? cue.lines.join(' ')).trim();
    return {
      index: index + 1,
      startMs: cue.startMs,
      endMs: cue.endMs,
      lines: wrapLines(text, style, lang),
    };
  });
  return lang.toLowerCase().startsWith('zh') ? annotateCuesWithPinyin(translated) : translated;
}

/**
 * Locate the built client. tsup emits the server either as `dist/index.js`
 * (spec layout, `./client/`) or as `dist/server/index.js` (nested, `../client/`).
 * A real Vite build contains an `assets/` folder, which keeps dev sources from
 * being served accidentally.
 */
function resolveClientDir(): string | null {
  const candidates = [
    fileURLToPath(new URL('./client/', import.meta.url)),
    fileURLToPath(new URL('../client/', import.meta.url)),
    join(process.cwd(), 'dist', 'client'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'assets'))) {
      return dir;
    }
  }
  return null;
}

export interface AppDeps {
  transcribe?: typeof transcribeFile;
  translator?: Translator;
}

/**
 * Create the Express application. `deps.transcribe` and `deps.translator` can
 * be replaced with stubs in tests; by default they run the real local models.
 */
export function createApp(store: JobStore, deps?: AppDeps): Express {
  const transcribe = deps?.transcribe ?? transcribeFile;
  const translator = deps?.translator ?? new OpusMtTranslator();
  const app = express();

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', name: 'free-subs', version: '0.3.0' });
  });

  app.get('/api/models', (_req: Request, res: Response) => {
    res.json({
      models: MODELS,
      languages: LANGUAGES,
      fonts: FONTS,
      defaultStyle: DEFAULT_EXPORT_STYLE,
    });
  });

  app.post('/api/jobs', express.raw({ type: () => true, limit: '500mb' }), (req: Request, res: Response) => {
    const body: unknown = req.body;
    const filename = basename(queryValue(req.query.filename) ?? 'audio');
    const language = queryValue(req.query.language) ?? 'auto';
    const model = queryValue(req.query.model) ?? 'base';
    const isolateVocals = queryValue(req.query.vocals) === 'true';

    if (!isLanguage(language)) {
      res.status(400).json({ error: `Invalid language "${language}". Use one of: ${LANGUAGES.join(', ')}.` });
      return;
    }
    if (!isModel(model)) {
      res.status(400).json({ error: `Invalid model "${model}". Use one of: ${MODELS.join(', ')}.` });
      return;
    }
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: 'Request body must contain audio data.' });
      return;
    }

    for (const removed of store.prune(JOB_TTL_MS)) {
      if (removed.mediaPath !== undefined) {
        void rm(removed.mediaPath, { force: true }).catch(() => undefined);
      }
    }

    const job = store.create(filename);
    const tempDir = join(tmpdir(), 'free-subs');
    const tempPath = join(tempDir, `${job.id}${extname(filename)}`);
    const options: TranscribeOptions = {
      language,
      model,
      isolateVocals,
      onProgress: (progress) => {
        store.update(job.id, { progress });
      },
    };

    void (async () => {
      try {
        await mkdir(tempDir, { recursive: true });
        await writeFile(tempPath, body);
        store.update(job.id, {
          mediaPath: tempPath,
          status: 'processing',
          progress: { stage: 'decoding', percent: 1 },
        });
        const result = await transcribe(tempPath, filename, options);
        store.update(job.id, { status: 'done', result, progress: { stage: 'done', percent: 100 } });
      } catch (error) {
        store.update(job.id, {
          status: 'error',
          error: errorMessage(error),
          progress: { stage: 'error', percent: 100 },
        });
      }
    })();

    res.status(202).json({ id: job.id });
  });

  app.get('/api/jobs/:id', (req: Request, res: Response) => {
    const job = store.get(queryValue(req.params.id) ?? '');
    if (job === undefined) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    res.json(job);
  });

  /**
   * Edit cue texts (order-based) and regenerate the subtitle payloads.
   * Translations become stale, so they are cleared; rendered exports are kept.
   */
  app.patch('/api/jobs/:id/cues', express.json({ limit: '2mb' }), (req: Request, res: Response) => {
    const job = store.get(queryValue(req.params.id) ?? '');
    if (job === undefined) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    if (job.status !== 'done' || job.result === undefined) {
      res.status(409).json({ error: 'Transcription is not ready yet.' });
      return;
    }

    const incoming = (req.body as { cues?: unknown } | undefined)?.cues;
    const cues = job.result.cues;
    if (!Array.isArray(incoming) || incoming.length !== cues.length) {
      res.status(400).json({ error: `Expected ${cues.length} cues.` });
      return;
    }

    const language = job.result.language;
    const style = styleForLanguage(language);
    const edited: SubtitleCue[] = [];
    for (let i = 0; i < incoming.length; i += 1) {
      const entry = incoming[i] as { text?: unknown } | null | undefined;
      const text = typeof entry?.text === 'string' ? entry.text.replace(/\s+/g, ' ').trim() : '';
      if (text === '' || text.length > 500) {
        res.status(400).json({ error: `Cue ${i + 1} must be between 1 and 500 characters.` });
        return;
      }
      const original = cues[i];
      if (original === undefined) {
        res.status(400).json({ error: `Cue ${i + 1} is missing.` });
        return;
      }
      edited.push({
        index: i + 1,
        startMs: original.startMs,
        endMs: original.endMs,
        lines: wrapLines(text, style, language),
      });
    }

    const cpsValues = edited.map((cue) => computeCps(cue));
    const wordCount = edited.reduce((total, cue) => total + tokenize(cue.lines.join(' '), language).length, 0);
    const maxCps = cpsValues.reduce((max, value) => Math.max(max, value), 0);
    const avgCps = cpsValues.length === 0 ? 0 : cpsValues.reduce((sum, value) => sum + value, 0) / cpsValues.length;
    const result = {
      ...job.result,
      cues: edited,
      srt: serializeSrt(edited),
      vtt: serializeVtt(edited),
      stats: {
        cueCount: edited.length,
        wordCount,
        avgCps: Number(avgCps.toFixed(1)),
        maxCps: Number(maxCps.toFixed(1)),
        durationMs: job.result.durationMs,
      },
    };
    const updated = store.update(job.id, { result, translations: {} });
    res.json(updated);
  });

  app.post('/api/jobs/:id/translate', express.json({ limit: '1mb' }), (req: Request, res: Response) => {
    const job = store.get(queryValue(req.params.id) ?? '');
    if (job === undefined) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    if (job.status !== 'done' || job.result === undefined) {
      res.status(409).json({ error: 'Transcription is not ready yet.' });
      return;
    }

    const requested = (req.body as { to?: unknown } | undefined)?.to;
    if (typeof requested !== 'string' || !isTranslationTarget(requested)) {
      res.status(400).json({ error: `Invalid target language. Use one of: ${TRANSLATION_TARGETS.join(', ')}.` });
      return;
    }
    let source: string;
    try {
      source = normalizeLanguage(job.result.language);
    } catch {
      res.status(400).json({ error: `Cannot translate from "${job.result.language}".` });
      return;
    }
    if (source === requested) {
      res.status(400).json({ error: 'Target language is the same as the source language.' });
      return;
    }

    const existing = job.translations?.[requested];
    if (existing !== undefined && existing.status === 'done') {
      res.status(202).json({ translationId: requested });
      return;
    }
    if (existing !== undefined && existing.status === 'processing') {
      res.status(202).json({ translationId: requested });
      return;
    }

    const updateTranslation = (record: TranslationRecord): void => {
      const current = store.get(job.id);
      store.update(job.id, {
        translations: { ...(current?.translations ?? {}), [requested]: record },
      });
    };

    const result = job.result;
    const initial: TranslationRecord = {
      language: requested,
      status: 'processing',
      progress: { stage: 'translating', percent: 0 },
    };
    updateTranslation(initial);
    res.status(202).json({ translationId: requested });

    void (async () => {
      try {
        const texts = result.cues.map((cue) => cue.lines.join(' '));
        const translated = await translateCueTexts(translator, texts, {
          from: source,
          to: requested,
          onProgress: (percent) => {
            updateTranslation({
              ...initial,
              progress: { stage: 'translating', percent: Math.round(percent) },
            });
          },
        });
        const cues = buildTranslatedCues(result.cues, translated, requested);
        updateTranslation({
          language: requested,
          status: 'done',
          progress: { stage: 'done', percent: 100 },
          cues,
          srt: serializeSrt(cues),
          vtt: serializeVtt(cues),
          text: cues.map((cue) => cue.lines.join(' ')).join(' '),
        });
      } catch (error) {
        updateTranslation({
          ...initial,
          status: 'error',
          error: errorMessage(error),
          progress: { stage: 'error', percent: 100 },
        });
      }
    })();
  });

  app.post('/api/jobs/:id/export', express.json({ limit: '1mb' }), (req: Request, res: Response) => {
    const job = store.get(queryValue(req.params.id) ?? '');
    if (job === undefined) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    if (job.status !== 'done' || job.result === undefined) {
      res.status(409).json({ error: 'Transcription is not ready yet.' });
      return;
    }
    if (job.mediaPath === undefined || !existsSync(job.mediaPath)) {
      res.status(400).json({ error: 'Uploaded media is no longer available.' });
      return;
    }
    const ffmpeg = resolveFfmpeg();
    if (ffmpeg === null || !ffmpegSupportsAss(ffmpeg)) {
      res.status(500).json({ error: 'ffmpeg with libass support is required to export video.' });
      return;
    }

    const style = mergeStyle((req.body as { style?: unknown } | undefined)?.style);
    const exportId = randomUUID();
    const tempDir = join(tmpdir(), 'free-subs');
    const outputPath = join(tempDir, `${job.id}-${exportId}.mp4`);
    const base = parse(job.filename).name || 'subtitles';
    const result = job.result;
    const mediaPath = job.mediaPath;
    const record: ExportRecord = {
      id: exportId,
      status: 'queued',
      progress: { stage: 'exporting', percent: 0 },
      style,
      filename: `${base}.subtitled.mp4`,
    };

    const updateExport = (patch: Partial<ExportRecord>): void => {
      const current = store.get(job.id);
      const previous = current?.exports?.[exportId] ?? record;
      store.update(job.id, {
        exports: { ...(current?.exports ?? {}), [exportId]: { ...previous, ...patch } },
      });
    };

    updateExport({ status: 'processing', progress: { stage: 'exporting', percent: 1 } });
    res.status(202).json({ exportId });

    void (async () => {
      const assPath = join(tempDir, `${job.id}-${exportId}.ass`);
      try {
        await mkdir(tempDir, { recursive: true });
        await writeFile(
          assPath,
          serializeAss(result.cues, style, { width: EXPORT_WIDTH, height: EXPORT_HEIGHT }),
          'utf8',
        );
        const durationMs = (await probeDurationMs(mediaPath)) ?? result.durationMs;
        await exportVideo(mediaPath, assPath, outputPath, durationMs, (percent) => {
          updateExport({ status: 'processing', progress: { stage: 'exporting', percent } });
        });
        updateExport({ status: 'done', progress: { stage: 'done', percent: 100 }, outputPath });
      } catch (error) {
        updateExport({
          status: 'error',
          error: errorMessage(error),
          progress: { stage: 'error', percent: 100 },
        });
      } finally {
        await rm(assPath, { force: true }).catch(() => undefined);
      }
    })();
  });

  app.get('/api/exports/:exportId', (req: Request, res: Response) => {
    const found = store.findExport(queryValue(req.params.exportId) ?? '');
    if (found === undefined) {
      res.status(404).json({ error: 'Export not found.' });
      return;
    }
    res.json(found.record);
  });

  app.get('/api/exports/:exportId/download', (req: Request, res: Response) => {
    const found = store.findExport(queryValue(req.params.exportId) ?? '');
    if (found === undefined) {
      res.status(404).json({ error: 'Export not found.' });
      return;
    }
    const { record } = found;
    if (record.status !== 'done' || record.outputPath === undefined || !existsSync(record.outputPath)) {
      res.status(404).json({ error: 'Exported video is not ready yet.' });
      return;
    }
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${record.filename}"`);
    res.sendFile(record.outputPath, (error) => {
      if (error) {
        res.status(500).json({ error: errorMessage(error) });
      }
    });
  });

  app.get('/api/jobs/:id/download', (req: Request, res: Response) => {
    const format = queryValue(req.query.format) ?? 'srt';
    if (!isDownloadFormat(format)) {
      res.status(400).json({ error: `Invalid format "${format}". Use srt, vtt, ass or json.` });
      return;
    }

    const job = store.get(queryValue(req.params.id) ?? '');
    if (job === undefined) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    if (job.status !== 'done' || job.result === undefined) {
      res.status(404).json({ error: 'Subtitles are not ready yet.' });
      return;
    }

    if (format === 'json') {
      const translations: Record<string, SubtitleCue[]> = {};
      for (const [code, record] of Object.entries(job.translations ?? {})) {
        if (record.status === 'done' && record.cues !== undefined) {
          translations[code] = record.cues;
        }
      }
      const document = buildStudyDocument({
        language: job.result.language,
        durationMs: job.result.durationMs,
        cues: job.result.cues,
        translations,
      });
      const jsonBase = parse(job.filename).name || 'subtitles';
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${jsonBase}.study.json"`);
      res.send(serializeStudy(document));
      return;
    }

    const lang = queryValue(req.query.lang);
    let cues: SubtitleCue[];
    let suffix = '';
    let payload: string;
    if (lang !== undefined) {
      const translation = job.translations?.[lang];
      if (translation === undefined || translation.status !== 'done') {
        res.status(404).json({ error: `Translation "${lang}" is not ready yet.` });
        return;
      }
      cues = translation.cues ?? job.result.cues;
      suffix = `.${lang}`;
      payload =
        format === 'srt'
          ? (translation.srt ?? serializeSrt(cues))
          : format === 'vtt'
            ? (translation.vtt ?? serializeVtt(cues))
            : serializeAss(cues, DEFAULT_EXPORT_STYLE, { width: EXPORT_WIDTH, height: EXPORT_HEIGHT });
    } else {
      cues = job.result.cues;
      payload =
        format === 'srt'
          ? job.result.srt
          : format === 'vtt'
            ? job.result.vtt
            : serializeAss(cues, DEFAULT_EXPORT_STYLE, { width: EXPORT_WIDTH, height: EXPORT_HEIGHT });
    }

    const base = parse(job.filename).name || 'subtitles';
    const contentType =
      format === 'srt' ? 'application/x-subrip; charset=utf-8' : format === 'vtt' ? 'text/vtt; charset=utf-8' : 'text/x-ssa; charset=utf-8';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${base}${suffix}.${format}"`);
    res.send(payload);
  });

  /** Extract a short audio clip for study cards (line-by-line playback). */
  app.get('/api/jobs/:id/clip', (req: Request, res: Response) => {
    const job = store.get(queryValue(req.params.id) ?? '');
    if (job === undefined) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    if (job.status !== 'done' || job.result === undefined) {
      res.status(409).json({ error: 'Transcription is not ready yet.' });
      return;
    }
    const mediaPath = job.mediaPath;
    if (mediaPath === undefined || !existsSync(mediaPath)) {
      res.status(400).json({ error: 'Uploaded media is no longer available.' });
      return;
    }

    const startMs = Number(queryValue(req.query.startMs));
    const endMs = Number(queryValue(req.query.endMs));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
      res.status(400).json({ error: 'Invalid clip range. Use startMs and endMs in milliseconds.' });
      return;
    }
    if (endMs - startMs > 120_000) {
      res.status(400).json({ error: 'Clips are limited to 120 seconds.' });
      return;
    }
    if (endMs > job.result.durationMs + 2_000) {
      res.status(400).json({ error: 'Clip range exceeds the media duration.' });
      return;
    }
    if (resolveFfmpeg() === null) {
      res.status(500).json({ error: 'ffmpeg is required to create audio clips.' });
      return;
    }

    const tempDir = join(tmpdir(), 'free-subs');
    const outputPath = join(tempDir, `${job.id}-clip-${Math.round(startMs)}-${Math.round(endMs)}.m4a`);
    const clipBase = parse(job.filename).name || 'audio';
    void (async () => {
      try {
        await mkdir(tempDir, { recursive: true });
        await exportClip(mediaPath, startMs, endMs, outputPath);
        res.setHeader('Content-Type', 'audio/mp4');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${clipBase}-${Math.round(startMs)}-${Math.round(endMs)}.m4a"`,
        );
        res.sendFile(outputPath, (error) => {
          void rm(outputPath, { force: true }).catch(() => undefined);
          if (error && !res.headersSent) {
            res.status(500).json({ error: errorMessage(error) });
          }
        });
      } catch (error) {
        res.status(500).json({ error: errorMessage(error) });
      }
    })();
  });

  const clientDir = resolveClientDir();
  if (clientDir !== null) {
    app.use(express.static(clientDir));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(join(clientDir, 'index.html'), (error) => {
        if (error) {
          next(error);
        }
      });
    });
  } else {
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.status(404).json({ error: 'Client build not found. Build the client to use the web UI.' });
    });
  }

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: errorMessage(error) });
  });

  return app;
}
