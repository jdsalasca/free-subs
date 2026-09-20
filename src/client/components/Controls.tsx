import type { LanguageCode, ModelId } from '../../core/types';

interface LanguageOption {
  value: LanguageCode;
  label: string;
}

interface ModelOption {
  value: ModelId;
  label: string;
}

const LANGUAGES: LanguageOption[] = [
  { value: 'auto', label: 'Auto detect' },
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
];

const MODELS: ModelOption[] = [
  { value: 'tiny', label: 'Tiny — fastest' },
  { value: 'base', label: 'Base — balanced' },
  { value: 'small', label: 'Small — most accurate' },
];

interface ControlsProps {
  language: LanguageCode;
  model: ModelId;
  /** Disables the submit button (no file selected or a job is running). */
  disabled: boolean;
  /** A transcription is currently in flight. */
  busy: boolean;
  onLanguageChange: (value: LanguageCode) => void;
  onModelChange: (value: ModelId) => void;
  onTranscribe: () => void;
}

export function Controls({
  language,
  model,
  disabled,
  busy,
  onLanguageChange,
  onModelChange,
  onTranscribe,
}: ControlsProps) {
  return (
    <div className="controls">
      <div className="controls-fields">
        <label className="field">
          <span className="field-label">Language</span>
          <select
            data-testid="language-select"
            className="select"
            value={language}
            onChange={(event) => onLanguageChange(event.target.value as LanguageCode)}
            disabled={busy}
          >
            {LANGUAGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Model</span>
          <select
            data-testid="model-select"
            className="select"
            value={model}
            onChange={(event) => onModelChange(event.target.value as ModelId)}
            disabled={busy}
          >
            {MODELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        data-testid="transcribe-button"
        type="button"
        className="btn btn-primary"
        onClick={onTranscribe}
        disabled={disabled}
      >
        Transcribe
      </button>
    </div>
  );
}
