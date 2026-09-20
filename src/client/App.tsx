import { useCallback, useEffect, useState } from 'react';
import type { JobRecord, LanguageCode, ModelId } from '../core/types';
import { createJob, getJob } from './api';
import { Controls } from './components/Controls';
import { Dropzone } from './components/Dropzone';
import { ProgressPanel } from './components/ProgressPanel';
import { ResultPanel } from './components/ResultPanel';
import { errorMessage } from './format';

type Phase = 'idle' | 'processing' | 'done' | 'error';

const POLL_INTERVAL_MS = 800;

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<LanguageCode>('auto');
  const [model, setModel] = useState<ModelId>('base');
  const [phase, setPhase] = useState<Phase>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = phase === 'processing';

  const handleFile = useCallback((next: File) => {
    setFile(next);
    setPhase('idle');
    setJobId(null);
    setJob(null);
    setError(null);
  }, []);

  const start = useCallback(async () => {
    if (!file) {
      return;
    }

    setPhase('processing');
    setError(null);
    setJob(null);
    setJobId(null);

    try {
      const { id } = await createJob(file, { language, model });
      setJobId(id);
    } catch (err) {
      setError(errorMessage(err));
      setPhase('error');
    }
  }, [file, language, model]);

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
          setError(record.error ?? 'Transcription failed.');
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

  const handleStartOver = useCallback(() => {
    setPhase('idle');
    setJobId(null);
    setJob(null);
    setError(null);
  }, []);

  const showProgress = phase === 'processing' || phase === 'done';

  return (
    <div className="app">
      <header className="app-header">
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
        <p className="brand-tagline">
          Subtítulos gratis, rápidos y locales — sin subir tu archivo a ningún servidor
        </p>
      </header>

      <main className="app-main">
        <section className="card card-file">
          <h2 className="card-title">
            <span className="step">1</span> Choose a file
          </h2>
          <Dropzone file={file} onFile={handleFile} disabled={busy} />
        </section>

        <section className="card card-config">
          <h2 className="card-title">
            <span className="step">2</span> Configure
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
        </section>

        {showProgress ? (
          <section className="card card-progress">
            <h2 className="card-title">
              <span className="step">3</span> Progress
            </h2>
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
                Transcription complete
              </div>
            ) : null}
          </section>
        ) : null}

        {phase === 'error' && error ? (
          <section className="card card-error">
            <h2 className="card-title">
              <span className="step">!</span> Something went wrong
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
                Retry
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleStartOver}
              >
                Start over
              </button>
            </div>
          </section>
        ) : null}

        {phase === 'done' && job?.result ? (
          <section className="card card-result">
            <h2 className="card-title">
              <span className="step">4</span> Result
            </h2>
            <ResultPanel job={job} file={file} />
          </section>
        ) : null}
      </main>

      <footer className="app-footer">
        <p>Runs entirely on your machine. No upload, no account, no tracking.</p>
      </footer>
    </div>
  );
}
