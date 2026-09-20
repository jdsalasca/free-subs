import type { TranslationRecord } from '../../core/types';
import { downloadUrl } from '../api';
import { TRANSLATION_OPTIONS, type TranslationTarget } from '../constants';
import { formatTimestamp, subtitlesToPlainText } from '../format';
import { ProgressPanel } from './ProgressPanel';

export type RunPhase = 'idle' | 'processing' | 'done' | 'error';

interface TranslatePanelProps {
  jobId: string;
  /** Detected/selected source language of the finished transcription. */
  sourceLanguage: string;
  target: TranslationTarget;
  phase: RunPhase;
  error: string | null;
  translation: TranslationRecord | null;
  onTargetChange: (target: TranslationTarget) => void;
  onTranslate: () => void;
  /** Show the pinyin line under each translated cue that has one. */
  showPinyin?: boolean;
}

export function TranslatePanel({
  jobId,
  sourceLanguage,
  target,
  phase,
  error,
  translation,
  onTargetChange,
  onTranslate,
  showPinyin = false,
}: TranslatePanelProps) {
  const targetLabel =
    TRANSLATION_OPTIONS.find((option) => option.value === target)?.label ?? target;

  const translatedText =
    translation?.text ??
    (translation?.srt ? subtitlesToPlainText(translation.srt) : '');

  const busy = phase === 'processing';
  const invalidTarget = target === sourceLanguage;

  return (
    <section className="card">
      <h2 className="card-title">
        <span className="step">3</span> Traducir
      </h2>

      <div className="panel-row">
        <label className="field field-grow">
          <span className="field-label">Traducir al idioma</span>
          <select
            data-testid="translate-target"
            className="select"
            value={target}
            onChange={(event) => onTargetChange(event.target.value as TranslationTarget)}
            disabled={busy}
            aria-label="Idioma de destino"
          >
            {TRANSLATION_OPTIONS.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.value === sourceLanguage}
              >
                {option.label}
                {option.value === sourceLanguage ? ' (idioma original)' : ''}
              </option>
            ))}
          </select>
        </label>

        <button
          data-testid="translate-button"
          type="button"
          className="btn btn-primary btn-big btn-grow"
          onClick={onTranslate}
          disabled={busy || invalidTarget}
        >
          {busy ? 'Traduciendo…' : 'Traducir'}
        </button>
      </div>

      {phase === 'processing' && translation ? (
        <div className="panel-block">
          <ProgressPanel
            progress={translation.progress}
            statusTestId="translate-status"
            progressTestId={null}
            label="Progreso de traducción"
          />
        </div>
      ) : null}

      {phase === 'processing' && !translation ? (
        <div className="panel-block">
          <ProgressPanel
            progress={{ stage: 'translating', percent: 0 }}
            statusTestId="translate-status"
            progressTestId={null}
            label="Progreso de traducción"
          />
        </div>
      ) : null}

      {phase === 'error' && error ? (
        <div className="inline-error" role="alert">
          {error}
        </div>
      ) : null}

      {phase === 'done' && translation ? (
        <>
          <div data-testid="translate-done" className="status-done" role="status">
            <CheckIcon />
            Subtítulos en {targetLabel} listos
          </div>

          <div className="panel-block">
            <h3 className="block-title">Traducción</h3>
            <div data-testid="translated-transcript" className="transcript">
              {translatedText}
            </div>
          </div>

          {translation.cues && translation.cues.length > 0 ? (
            <div className="panel-block">
              <h3 className="block-title">Subtítulos traducidos</h3>
              <ol className="cue-list" data-testid="translated-cue-list">
                {translation.cues.map((cue) => (
                  <li className="cue" key={`${cue.index}-${cue.startMs}`}>
                    <span className="cue-time">
                      {formatTimestamp(cue.startMs)} – {formatTimestamp(cue.endMs)}
                    </span>
                    <span className="cue-text">
                      {cue.lines.map((line, lineIndex) => (
                        <span className="cue-line" key={lineIndex}>
                          {line}
                        </span>
                      ))}
                      {showPinyin && cue.pinyin ? (
                        <span className="cue-pinyin" data-testid="pinyin-line">
                          {cue.pinyin}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <div className="result-actions">
            <a
              data-testid="download-translated-srt"
              className="btn btn-primary"
              href={downloadUrl(jobId, 'srt', target)}
              download
            >
              Descargar SRT traducido
            </a>
            <a
              data-testid="download-translated-vtt"
              className="btn btn-download"
              href={downloadUrl(jobId, 'vtt', target)}
              download
            >
              Descargar VTT traducido
            </a>
          </div>
        </>
      ) : null}
    </section>
  );
}

function CheckIcon() {
  return (
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
  );
}
