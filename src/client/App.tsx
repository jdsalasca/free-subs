import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ExportRecord,
  JobRecord,
  LanguageCode,
  ModelId,
  SubtitleExportStyle,
  TranslationRecord,
} from '../core/types';
import {
  createJob,
  exportJob,
  getExport,
  getJob,
  getModels,
  translateJob,
} from './api';
import {
  FALLBACK_EXPORT_STYLE,
  FALLBACK_FONTS,
  TRANSLATION_OPTIONS,
  type TranslationTarget,
} from './constants';
import { Controls } from './components/Controls';
import { Dropzone } from './components/Dropzone';
import { ExportPanel } from './components/ExportPanel';
import { ProgressPanel } from './components/ProgressPanel';
import { ResultPanel } from './components/ResultPanel';
import { ThemeToggle } from './components/ThemeToggle';
import { TranslatePanel, type RunPhase } from './components/TranslatePanel';
import { errorMessage } from './format';
import { useTheme } from './theme';

type Phase = 'idle' | 'processing' | 'done' | 'error';

const POLL_INTERVAL_MS = 800;

function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) {
    return true;
  }
  if (file.type.startsWith('audio/')) {
    return false;
  }
  return /\.(mp4|mkv|mov|webm|avi|m4v)$/i.test(file.name);
}

export default function App() {
  const { theme, toggle } = useTheme();

  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<LanguageCode>('auto');
  const [model, setModel] = useState<ModelId>('base');

  const [phase, setPhase] = useState<Phase>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [fonts, setFonts] = useState<string[]>(FALLBACK_FONTS);
  const [exportStyle, setExportStyle] = useState<SubtitleExportStyle>(FALLBACK_EXPORT_STYLE);

  const [target, setTarget] = useState<TranslationTarget>('es');
  const [translatePhase, setTranslatePhase] = useState<RunPhase>('idle');
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translation, setTranslation] = useState<TranslationRecord | null>(null);

  const [exportPhase, setExportPhase] = useState<RunPhase>('idle');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportRecord, setExportRecord] = useState<ExportRecord | null>(null);
  const [exportId, setExportId] = useState<string | null>(null);

  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  const busy = phase === 'processing';
  const ready = phase === 'done' && job?.result !== undefined;

  // Object URL for the uploaded media, shared by the player and the preview.
  useEffect(() => {
    if (!file) {
      setMediaUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setMediaUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // Fonts + default style for the export editor (fallbacks when absent).
  useEffect(() => {
    let cancelled = false;
    getModels()
      .then((data) => {
        if (cancelled) {
          return;
        }
        if (Array.isArray(data.fonts) && data.fonts.length > 0) {
          setFonts(data.fonts);
        }
        if (data.defaultStyle) {
          setExportStyle({ ...FALLBACK_EXPORT_STYLE, ...data.defaultStyle });
        }
      })
      .catch(() => {
        // Keep the hardcoded fallbacks.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Never leave the translation target equal to the detected source language.
  useEffect(() => {
    if (phase !== 'done') {
      return;
    }
    const detected = job?.result?.language;
    if (!detected) {
      return;
    }
    setTarget((current) => {
      if (current !== detected) {
        return current;
      }
      const fallback = TRANSLATION_OPTIONS.find((option) => option.value !== detected);
      return fallback ? fallback.value : current;
    });
  }, [phase, job?.result?.language]);

  const resetRun = useCallback(() => {
    setTranslation(null);
    setTranslatePhase('idle');
    setTranslateError(null);
    setExportRecord(null);
    setExportPhase('idle');
    setExportError(null);
    setExportId(null);
  }, []);

  const handleFile = useCallback(
    (next: File) => {
      setFile(next);
      setPhase('idle');
      setJobId(null);
      setJob(null);
      setError(null);
      resetRun();
    },
    [resetRun],
  );

  const start = useCallback(async () => {
    if (!file) {
      return;
    }

    setPhase('processing');
    setError(null);
    setJob(null);
    setJobId(null);
    resetRun();

    try {
      const { id } = await createJob(file, { language, model });
      setJobId(id);
    } catch (err) {
      setError(errorMessage(err));
      setPhase('error');
    }
  }, [file, language, model, resetRun]);

  // Poll the transcription job every 800 ms.
  useEffect(() => {
    if (!jobId || phase !== 'processing') {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const record = await getJob(jobId);
        if (cancelled) {
          return;
        }

        setJob(record);

        if (record.status === 'done') {
          setPhase('done');
          return;
        }

        if (record.status === 'error') {
          setError(record.error ?? 'La transcripción falló.');
          setPhase('error');
          return;
        }

        timer = window.setTimeout(() => {
          void tick();
        }, POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(errorMessage(err));
        setPhase('error');
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [jobId, phase]);

  const startTranslate = useCallback(async () => {
    if (!jobId) {
      return;
    }
    setTranslatePhase('processing');
    setTranslateError(null);
    setTranslation(null);

    try {
      await translateJob(jobId, target);
    } catch (err) {
      setTranslateError(errorMessage(err));
      setTranslatePhase('error');
    }
  }, [jobId, target]);

  // Poll the job until the requested translation is done/error.
  useEffect(() => {
    if (!jobId || translatePhase !== 'processing') {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const record = await getJob(jobId);
        if (cancelled) {
          return;
        }

        const current = record.translations?.[target];
        if (current) {
          setTranslation(current);
        }

        if (current?.status === 'done') {
          setTranslatePhase('done');
          return;
        }

        if (current?.status === 'error') {
          setTranslateError(current.error ?? 'La traducción falló.');
          setTranslatePhase('error');
          return;
        }

        timer = window.setTimeout(() => {
          void tick();
        }, POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setTranslateError(errorMessage(err));
        setTranslatePhase('error');
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [jobId, target, translatePhase]);

  const startExport = useCallback(async () => {
    if (!jobId) {
      return;
    }
    setExportPhase('processing');
    setExportError(null);
    setExportRecord(null);
    setExportId(null);

    try {
      const { exportId: id } = await exportJob(jobId, exportStyle);
      setExportId(id);
    } catch (err) {
      setExportError(errorMessage(err));
      setExportPhase('error');
    }
  }, [jobId, exportStyle]);

  // Poll the export record until done/error.
  useEffect(() => {
    if (!exportId || exportPhase !== 'processing') {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const record = await getExport(exportId);
        if (cancelled) {
          return;
        }

        setExportRecord(record);

        if (record.status === 'done') {
          setExportPhase('done');
          return;
        }

        if (record.status === 'error') {
          setExportError(record.error ?? 'La exportación falló.');
          setExportPhase('error');
          return;
        }

        timer = window.setTimeout(() => {
          void tick();
        }, POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setExportError(errorMessage(err));
        setExportPhase('error');
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [exportId, exportPhase]);

  const handleStyleChange = useCallback((patch: Partial<SubtitleExportStyle>) => {
    setExportStyle((current) => ({ ...current, ...patch }));
  }, []);

  const handleStartOver = useCallback(() => {
    setPhase('idle');
    setJobId(null);
    setJob(null);
    setError(null);
    resetRun();
  }, [resetRun]);

  const previewText = useMemo(() => {
    const cue = job?.result?.cues?.[0];
    if (cue && cue.lines.length > 0) {
      return cue.lines.join('\n');
    }
    const segment = job?.result?.segments?.[0];
    if (segment && segment.text.length > 0) {
      return segment.text;
    }
    return 'Ejemplo de subtítulo';
  }, [job]);

  const showProgress = phase === 'processing' || phase === 'done';

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand-row">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                focusable="false"
              >
                <rect x="3" y="5" width="18" height="14" rx="3" />
                <path d="M7 10h10M7 14h6" />
              </svg>
            </span>
            <h1 className="brand-title">Free Subs</h1>
          </div>
          <ThemeToggle theme={theme} onToggle={toggle} />
        </div>
        <p className="brand-tagline">
          Subtítulos gratis, rápidos y locales — sin subir tu archivo a ningún servidor
        </p>
      </header>

      <main className="app-main">
        <section className="card">
          <h2 className="card-title">
            <span className="step">1</span> Elige un archivo
          </h2>
          <Dropzone file={file} onFile={handleFile} disabled={busy} />
        </section>

        <section className="card">
          <h2 className="card-title">
            <span className="step">2</span> Subtítulos
          </h2>
          <Controls
            language={language}
            model={model}
            busy={busy}
            disabled={!file || busy}
            onLanguageChange={setLanguage}
            onModelChange={setModel}
            onTranscribe={() => {
              void start();
            }}
          />

          {showProgress ? (
            <div className="panel-block">
              <ProgressPanel
                progress={job?.progress ?? { stage: 'queued', percent: 0 }}
              />
              {phase === 'done' ? (
                <div data-testid="status-done" className="status-done" role="status">
                  <span className="status-done-icon" aria-hidden="true">
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      focusable="false"
                    >
                      <path d="m5 12 5 5L20 7" />
                    </svg>
                  </span>
                  ¡Subtítulos listos!
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {phase === 'error' && error ? (
          <section className="card card-error">
            <h2 className="card-title">
              <span className="step">!</span> Algo salió mal
            </h2>
            <div data-testid="error" className="error-box" role="alert">
              {error}
            </div>
            <div className="error-actions">
              <button
                data-testid="retry-button"
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  void start();
                }}
                disabled={!file || busy}
              >
                Reintentar
              </button>
              <button type="button" className="btn btn-ghost" onClick={handleStartOver}>
                Empezar de nuevo
              </button>
            </div>
          </section>
        ) : null}

        {ready && job ? (
          <section className="card">
            <h2 className="card-title">
              <span className="step">✓</span> Resultado
            </h2>
            <ResultPanel
              job={job}
              mediaUrl={mediaUrl}
              isVideo={file ? isVideoFile(file) : false}
            />
          </section>
        ) : null}

        {ready && job && jobId ? (
          <TranslatePanel
            jobId={jobId}
            sourceLanguage={job.result?.language ?? ''}
            target={target}
            phase={translatePhase}
            error={translateError}
            translation={translation}
            onTargetChange={setTarget}
            onTranslate={() => {
              void startTranslate();
            }}
          />
        ) : null}

        {ready && job ? (
          <ExportPanel
            style={exportStyle}
            fonts={fonts}
            previewText={previewText}
            mediaUrl={mediaUrl}
            isVideo={file ? isVideoFile(file) : false}
            phase={exportPhase}
            error={exportError}
            exportRecord={exportRecord}
            onStyleChange={handleStyleChange}
            onExport={() => {
              void startExport();
            }}
          />
        ) : null}
      </main>

      <footer className="app-footer">
        <p>Se ejecuta por completo en tu equipo. Sin subidas, sin cuenta, sin rastreo.</p>
      </footer>
    </div>
  );
}
