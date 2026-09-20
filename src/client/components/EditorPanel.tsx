import { useEffect, useMemo, useState } from 'react';
import type { JobRecord, SubtitleCue } from '../../core/types';
import { saveCues } from '../api';
import { errorMessage, formatTimestamp } from '../format';

interface EditorPanelProps {
  jobId: string;
  /** Cues of the finished transcription, in display order. */
  cues: SubtitleCue[];
  /** Called with the updated job after a successful save. */
  onSaved: (job: JobRecord) => void;
}

type EditorStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Mirrors the server normalization so "nothing changed" is detected. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function cueText(cue: SubtitleCue): string {
  return cue.lines.join(' ');
}

/**
 * "Editar subtítulos": one text input per cue plus save/discard actions.
 * Saving PATCHes the job and hands the updated record back to the app.
 */
export function EditorPanel({ jobId, cues, onSaved }: EditorPanelProps) {
  const baseline = useMemo(() => cues.map(cueText), [cues]);
  const [drafts, setDrafts] = useState<string[]>(baseline);
  const [status, setStatus] = useState<EditorStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Re-sync the inputs with the saved text whenever the job changes (a new
  // transcription or a successful save). The status is intentionally kept so
  // the "Guardado ✓" confirmation survives the state refresh.
  useEffect(() => {
    setDrafts(baseline);
  }, [baseline]);

  const dirty = drafts.some(
    (draft, index) => normalize(draft) !== normalize(baseline[index] ?? ''),
  );
  const saving = status === 'saving';

  const handleChange = (index: number, value: string) => {
    setDrafts((current) => current.map((draft, i) => (i === index ? value : draft)));
    setStatus('idle');
    setError(null);
  };

  const handleDiscard = () => {
    setDrafts(baseline);
    setStatus('idle');
    setError(null);
  };

  const handleSave = async () => {
    setStatus('saving');
    setError(null);
    try {
      const updated = await saveCues(jobId, drafts);
      onSaved(updated);
      setStatus('saved');
    } catch (err) {
      setError(errorMessage(err));
      setStatus('error');
    }
  };

  const statusText =
    status === 'saving'
      ? 'Guardando…'
      : status === 'saved'
        ? 'Guardado ✓'
        : status === 'error'
          ? (error ?? 'No se pudieron guardar los cambios.')
          : dirty
            ? 'Hay cambios sin guardar.'
            : '';

  return (
    <section className="card">
      <h2 className="card-title">
        <span className="step" aria-hidden="true">
          ✎
        </span>
        Editar subtítulos
      </h2>

      {cues.length === 0 ? (
        <p className="editor-empty">No hay subtítulos para editar.</p>
      ) : (
        <>
          <p className="editor-hint">
            Corrige el texto de cada subtítulo y guarda los cambios. Las traducciones
            existentes se descartarán.
          </p>

          <ol className="editor-list">
            {cues.map((cue, index) => (
              <li className="cue-field" key={`${cue.index}-${cue.startMs}`}>
                <span className="cue-field-meta" aria-hidden="true">
                  <span className="cue-field-index">{index + 1}</span>
                  <span className="cue-field-time">
                    {formatTimestamp(cue.startMs)} – {formatTimestamp(cue.endMs)}
                  </span>
                </span>
                <input
                  data-testid="cue-input"
                  className="cue-input"
                  type="text"
                  value={drafts[index] ?? ''}
                  onChange={(event) => handleChange(index, event.target.value)}
                  disabled={saving}
                  maxLength={500}
                  aria-label={`Subtítulo ${index + 1}`}
                />
              </li>
            ))}
          </ol>

          <div className="editor-actions">
            <button
              data-testid="save-cues"
              type="button"
              className="btn btn-primary"
              onClick={() => {
                void handleSave();
              }}
              disabled={saving || !dirty}
            >
              Guardar cambios
            </button>
            <button
              data-testid="reset-cues"
              type="button"
              className="btn btn-ghost"
              onClick={handleDiscard}
              disabled={saving || !dirty}
            >
              Descartar
            </button>
          </div>
        </>
      )}

      <div
        data-testid="editor-status"
        className={`editor-status${status === 'error' ? ' is-error' : ''}${
          status === 'saved' ? ' is-saved' : ''
        }`}
        role="status"
        aria-live="polite"
      >
        {statusText}
      </div>
    </section>
  );
}
