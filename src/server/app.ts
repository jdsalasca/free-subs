/**
 * HTTP API for free-subs.
 *
 * The app only depends on an injected `JobStore` and an optional transcribe
 * function, which makes it trivial to test without loading the real model.
 */
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { LanguageCode, ModelId } from '../core';
import { transcribeFile, type TranscribeOptions } from '../pipeline/transcribe';
import type { JobStore } from './jobs';

const MODELS: ModelId[] = ['tiny', 'base', 'small'];
const LANGUAGES: LanguageCode[] = ['auto', 'es', 'en', 'zh'];
const JOB_TTL_MS = 60 * 60 * 1000;

function isModel(value: string): value is ModelId {
  return (MODELS as string[]).includes(value);
}

function isLanguage(value: string): value is LanguageCode {
  return (LANGUAGES as string[]).includes(value);
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
}

/**
 * Create the Express application. `deps.transcribe` can be replaced with a
 * stub in tests; by default it runs the real Transformers.js pipeline.
 */
export function createApp(store: JobStore, deps?: AppDeps): Express {
  const transcribe = deps?.transcribe ?? transcribeFile;
  const app = express();

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', name: 'free-subs', version: '0.1.0' });
  });

  app.get('/api/models', (_req: Request, res: Response) => {
    res.json({ models: MODELS, languages: LANGUAGES });
  });

  app.post('/api/jobs', express.raw({ type: () => true, limit: '500mb' }), (req: Request, res: Response) => {
    const body: unknown = req.body;
    const filename = basename(queryValue(req.query.filename) ?? 'audio');
    const language = queryValue(req.query.language) ?? 'auto';
    const model = queryValue(req.query.model) ?? 'base';

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

    store.cleanupOlderThan(JOB_TTL_MS);
    const job = store.create(filename);
    const tempDir = join(tmpdir(), 'free-subs');
    const tempPath = join(tempDir, `${job.id}${extname(filename)}`);
    const options: TranscribeOptions = {
      language,
      model,
      onProgress: (progress) => {
        store.update(job.id, { progress });
      },
    };

    void (async () => {
      try {
        await mkdir(tempDir, { recursive: true });
        await writeFile(tempPath, body);
        store.update(job.id, { status: 'processing', progress: { stage: 'decoding', percent: 1 } });
        const result = await transcribe(tempPath, filename, options);
        store.update(job.id, { status: 'done', result, progress: { stage: 'done', percent: 100 } });
      } catch (error) {
        store.update(job.id, {
          status: 'error',
          error: errorMessage(error),
          progress: { stage: 'error', percent: 100 },
        });
      } finally {
        await rm(tempPath, { force: true }).catch(() => undefined);
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

  app.get('/api/jobs/:id/download', (req: Request, res: Response) => {
    const format = queryValue(req.query.format) ?? 'srt';
    if (format !== 'srt' && format !== 'vtt') {
      res.status(400).json({ error: `Invalid format "${format}". Use srt or vtt.` });
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

    const base = parse(job.filename).name || 'subtitles';
    const payload = format === 'srt' ? job.result.srt : job.result.vtt;
    const contentType =
      format === 'srt' ? 'application/x-subrip; charset=utf-8' : 'text/vtt; charset=utf-8';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${base}.${format}"`);
    res.send(payload);
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
