import type { ReactNode } from 'react';
import type { SubtitleExportStyle } from '../../core/types';
import { POSITION_OPTIONS } from '../constants';

interface StyleEditorProps {
  style: SubtitleExportStyle;
  fonts: string[];
  onChange: (patch: Partial<SubtitleExportStyle>) => void;
}

interface FieldProps {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}

function Field({ label, htmlFor, children }: FieldProps) {
  return (
    <div className="style-field">
      <label className="style-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

interface RangeFieldProps {
  label: string;
  testId: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}

function RangeField({
  label,
  testId,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
}: RangeFieldProps) {
  return (
    <Field label={label} htmlFor={testId}>
      <div className="range-row">
        <input
          id={testId}
          data-testid={testId}
          className="range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="range-value">
          {value}
          {suffix}
        </span>
      </div>
    </Field>
  );
}

function ColorField({
  label,
  testId,
  value,
  onChange,
}: {
  label: string;
  testId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} htmlFor={testId}>
      <div className="color-row">
        <input
          id={testId}
          data-testid={testId}
          className="color"
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="color-value">{value.toUpperCase()}</span>
      </div>
    </Field>
  );
}

function CheckField({
  label,
  testId,
  checked,
  onChange,
}: {
  label: string;
  testId: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="check-field" htmlFor={testId}>
      <input
        id={testId}
        data-testid={testId}
        className="check"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function StyleEditor({ style, fonts, onChange }: StyleEditorProps) {
  const fontOptions = Array.from(new Set([style.fontFamily, ...fonts].filter(Boolean)));
  const opacityPercent = Math.round(style.backgroundOpacity * 100);

  return (
    <div className="style-editor">
      <Field label="Tipografía" htmlFor="export-font">
        <select
          id="export-font"
          data-testid="export-font"
          className="select"
          value={style.fontFamily}
          onChange={(event) => onChange({ fontFamily: event.target.value })}
        >
          {fontOptions.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
      </Field>

      <RangeField
        label="Tamaño"
        testId="export-font-size"
        value={style.fontSize}
        min={24}
        max={72}
        suffix=" px"
        onChange={(value) => onChange({ fontSize: value })}
      />

      <Field label="Posición" htmlFor="export-position">
        <select
          id="export-position"
          data-testid="export-position"
          className="select"
          value={style.position}
          onChange={(event) =>
            onChange({ position: event.target.value as SubtitleExportStyle['position'] })
          }
        >
          {POSITION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      <RangeField
        label="Margen vertical"
        testId="export-margin"
        value={style.marginV}
        min={0}
        max={200}
        suffix=" px"
        onChange={(value) => onChange({ marginV: value })}
      />

      <RangeField
        label="Grosor del contorno"
        testId="export-outline-width"
        value={style.outlineWidth}
        min={0}
        max={6}
        suffix=" px"
        onChange={(value) => onChange({ outlineWidth: value })}
      />

      <RangeField
        label="Sombra"
        testId="export-shadow"
        value={style.shadow}
        min={0}
        max={4}
        onChange={(value) => onChange({ shadow: value })}
      />

      <ColorField
        label="Color del texto"
        testId="export-color"
        value={style.primaryColor}
        onChange={(value) => onChange({ primaryColor: value })}
      />

      <ColorField
        label="Color del contorno"
        testId="export-outline-color"
        value={style.outlineColor}
        onChange={(value) => onChange({ outlineColor: value })}
      />

      <ColorField
        label="Color del fondo"
        testId="export-background-color"
        value={style.backgroundColor}
        onChange={(value) => onChange({ backgroundColor: value })}
      />

      <RangeField
        label="Opacidad del fondo"
        testId="export-background-opacity"
        value={opacityPercent}
        min={0}
        max={100}
        suffix="%"
        onChange={(value) => onChange({ backgroundOpacity: value / 100 })}
      />

      <div className="style-toggles">
        <CheckField
          label="Negrita"
          testId="export-bold"
          checked={style.bold}
          onChange={(checked) => onChange({ bold: checked })}
        />
        <CheckField
          label="Fondo"
          testId="export-background"
          checked={style.background}
          onChange={(checked) => onChange({ background: checked })}
        />
      </div>
    </div>
  );
}
