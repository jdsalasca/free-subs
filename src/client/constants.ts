import type { LanguageCode, ModelId, SubtitleExportStyle } from '../core/types';

/** A labelled `<option>` value used across the selects. */
export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

/** The three translation targets supported by the API. */
export type TranslationTarget = 'es' | 'en' | 'zh';

export const LANGUAGE_OPTIONS: SelectOption<LanguageCode>[] = [
  { value: 'auto', label: 'Detectar automáticamente' },
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
];

export const MODEL_OPTIONS: SelectOption<ModelId>[] = [
  { value: 'tiny', label: 'Tiny — más rápido' },
  { value: 'base', label: 'Base — equilibrado' },
  { value: 'small', label: 'Small — más preciso' },
];

export const TRANSLATION_OPTIONS: SelectOption<TranslationTarget>[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
];

/**
 * Live-mode language, model and translation choices. The live selects are
 * frozen by `docs/specs/ui-live.md`, so their labels differ slightly from the
 * batch controls above.
 */
export const LIVE_LANGUAGE_OPTIONS: SelectOption<LanguageCode>[] = [
  { value: 'auto', label: 'Detectar automáticamente' },
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
];

export const LIVE_MODEL_OPTIONS: SelectOption<ModelId>[] = [
  { value: 'tiny', label: 'Tiny — rápido (recomendado)' },
  { value: 'base', label: 'Base' },
  { value: 'small', label: 'Small' },
];

/** Live translation target; `none` means "do not translate". */
export type LiveTranslateTarget = 'none' | TranslationTarget;

export const LIVE_TRANSLATE_OPTIONS: SelectOption<LiveTranslateTarget>[] = [
  { value: 'none', label: 'No traducir' },
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
];

export const POSITION_OPTIONS: SelectOption<SubtitleExportStyle['position']>[] = [
  { value: 'bottom', label: 'Abajo' },
  { value: 'middle', label: 'Medio' },
  { value: 'top', label: 'Arriba' },
];

/** Fallback font list when `GET /api/models` does not return `fonts`. */
export const FALLBACK_FONTS: string[] = [
  'Arial',
  'Helvetica',
  'Verdana',
  'Tahoma',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Impact',
];

/**
 * Local mirror of `DEFAULT_EXPORT_STYLE` from `src/core/types.ts`.
 *
 * Core module types are imported with `import type` only, so we keep a small
 * runtime copy here as the fallback until `/api/models` returns `defaultStyle`.
 */
export const FALLBACK_EXPORT_STYLE: SubtitleExportStyle = {
  fontFamily: 'Arial',
  fontSize: 48,
  bold: true,
  primaryColor: '#ffffff',
  outlineColor: '#000000',
  outlineWidth: 2,
  shadow: 1,
  position: 'bottom',
  marginV: 60,
  background: false,
  backgroundColor: '#000000',
  backgroundOpacity: 0.6,
};
