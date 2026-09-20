import type { LanguageCode, ModelId } from '../../core/types';
import { LANGUAGE_OPTIONS, MODEL_OPTIONS } from '../constants';

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

function labelFor<T extends string>(
  options: { value: T; label: string }[],
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
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
  const currentLanguage = labelFor(LANGUAGE_OPTIONS, language);
  const currentModel = labelFor(MODEL_OPTIONS, model);

  return (
    <div className="controls">
      <details className="options" open>
        <summary className="options-summary">
          <span className="options-title">Opciones</span>
          <span className="options-current">
            {currentLanguage} · {currentModel}
          </span>
        </summary>

        <div className="controls-fields">
          <label className="field">
            <span className="field-label">Idioma del audio</span>
            <select
              data-testid="language-select"
              className="select"
              value={language}
              onChange={(event) => onLanguageChange(event.target.value as LanguageCode)}
              disabled={busy}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Modelo</span>
            <select
              data-testid="model-select"
              className="select"
              value={model}
              onChange={(event) => onModelChange(event.target.value as ModelId)}
              disabled={busy}
            >
              {MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <button
        data-testid="transcribe-button"
        type="button"
        className="btn btn-primary btn-big"
        onClick={onTranscribe}
        disabled={disabled}
      >
        Subtítulos
      </button>
    </div>
  );
}
