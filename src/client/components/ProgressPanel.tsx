import type { JobProgress } from '../../core/types';

const STAGE_LABELS: Record<JobProgress['stage'], string> = {
  queued: 'En cola',
  decoding: 'Decodificando audio',
  analyzing: 'Analizando el habla',
  'loading-model': 'Cargando el modelo',
  transcribing: 'Transcribiendo',
  translating: 'Traduciendo',
  exporting: 'Exportando video',
  formatting: 'Formateando subtítulos',
  done: 'Listo',
  error: 'Error',
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

interface ProgressPanelProps {
  progress: JobProgress;
  /** `data-testid` for the status line (default `status`). */
  statusTestId?: string;
  /** `data-testid` for the bar; pass `null` to render the bar without one. */
  progressTestId?: string | null;
  /** Accessible label for the progress bar. */
  label?: string;
}

export function ProgressPanel({
  progress,
  statusTestId = 'status',
  progressTestId = 'progress',
  label = 'Progreso',
}: ProgressPanelProps) {
  const percent = clampPercent(progress.percent);
  const rounded = Math.round(percent);
  const stageLabel = STAGE_LABELS[progress.stage] ?? progress.stage;

  return (
    <div className="progress-panel">
      <div
        data-testid={statusTestId}
        data-stage={progress.stage}
        className="status"
        aria-live="polite"
      >
        <span className="status-stage">{stageLabel}</span>
        <span className="status-percent">{rounded}%</span>
      </div>

      <div
        {...(progressTestId ? { 'data-testid': progressTestId } : {})}
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        aria-label={label}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>

      {progress.message ? <p className="status-message">{progress.message}</p> : null}
    </div>
  );
}
