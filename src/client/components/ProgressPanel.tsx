import type { JobProgress } from '../../core/types';

const STAGE_LABELS: Record<JobProgress['stage'], string> = {
  queued: 'Queued',
  decoding: 'Decoding audio',
  analyzing: 'Analyzing speech',
  'loading-model': 'Loading model',
  transcribing: 'Transcribing',
  formatting: 'Formatting subtitles',
  done: 'Done',
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
}

export function ProgressPanel({ progress }: ProgressPanelProps) {
  const percent = clampPercent(progress.percent);
  const rounded = Math.round(percent);
  const label = STAGE_LABELS[progress.stage] ?? progress.stage;

  return (
    <div className="progress-panel">
      <div
        data-testid="status"
        data-stage={progress.stage}
        className="status"
        aria-live="polite"
      >
        <span className="status-stage">{label}</span>
        <span className="status-percent">{rounded}%</span>
      </div>

      <div
        data-testid="progress"
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        aria-label="Transcription progress"
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>

      {progress.message ? <p className="status-message">{progress.message}</p> : null}
    </div>
  );
}
