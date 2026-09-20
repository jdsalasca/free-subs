/**
 * ASS (Advanced SubStation Alpha) v4.00+ serializer for burned-in subtitles.
 *
 * Pure and synchronous: it only turns cues + a visual style into the text of a
 * valid `.ass` document. Video muxing lives in `src/server/exporter.ts`.
 */
import type { SubtitleCue, SubtitleExportStyle } from './types';

export interface AssOptions {
  width: number;
  height: number;
  title?: string;
}

/** Standard `[V4+ Styles]` column order. */
const STYLE_FORMAT =
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, ' +
  'BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, ' +
  'BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding';

/** Standard `[Events]` column order. */
const EVENT_FORMAT =
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text';

const POSITION_ALIGNMENT: Record<SubtitleExportStyle['position'], number> = {
  bottom: 2,
  middle: 5,
  top: 8,
};

function clampMillis(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) {
    return 0;
  }
  return Math.floor(ms);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Format milliseconds as an ASS timestamp: `H:MM:SS.cc`. */
function formatAssTimestamp(ms: number): string {
  const totalCs = Math.floor(clampMillis(ms) / 10);
  const centis = totalCs % 100;
  const totalSeconds = Math.floor(totalCs / 100);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${pad2(minutes)}:${pad2(seconds)}.${pad2(centis)}`;
}

function escapeAssText(text: string): string {
  return text.replace(/[{}]/g, (char) => (char === '{' ? '(' : ')'));
}

/**
 * Convert a hex colour (`#rrggbb`, `#rgb`, or the same without `#`) to the
 * ASS `&HAABBGGRR` form. `opacity` is `1` for fully opaque (alpha `00`) and
 * `0` for fully transparent (alpha `FF`).
 */
export function hexToAssColor(hex: string, opacity = 1): string {
  const raw = hex.trim().replace(/^#/, '');

  let red: number;
  let green: number;
  let blue: number;

  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    red = Number.parseInt(raw.charAt(0).repeat(2), 16);
    green = Number.parseInt(raw.charAt(1).repeat(2), 16);
    blue = Number.parseInt(raw.charAt(2).repeat(2), 16);
  } else if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    red = Number.parseInt(raw.slice(0, 2), 16);
    green = Number.parseInt(raw.slice(2, 4), 16);
    blue = Number.parseInt(raw.slice(4, 6), 16);
  } else {
    throw new Error(`Invalid hex colour: "${hex}"`);
  }

  const clampedOpacity = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
  const alpha = Math.round((1 - clampedOpacity) * 255);

  const hex2 = (value: number): string => value.toString(16).toUpperCase().padStart(2, '0');
  return `&H${hex2(alpha)}${hex2(blue)}${hex2(green)}${hex2(red)}`;
}

function styleLine(style: SubtitleExportStyle): string {
  const bold = style.bold ? -1 : 0;
  const borderStyle = style.background ? 3 : 1;
  const alignment = POSITION_ALIGNMENT[style.position];
  const primary = hexToAssColor(style.primaryColor);
  const back = hexToAssColor(style.backgroundColor, style.backgroundOpacity);

  const fields = [
    'Default',
    style.fontFamily,
    String(style.fontSize),
    primary,
    primary,
    hexToAssColor(style.outlineColor),
    back,
    String(bold),
    '0',
    '0',
    '0',
    '100',
    '100',
    '0',
    '0',
    String(borderStyle),
    String(style.outlineWidth),
    String(style.shadow),
    String(alignment),
    '20',
    '20',
    String(style.marginV),
    '1',
  ];

  return `Style: ${fields.join(',')}`;
}

function dialogueLine(cue: SubtitleCue): string {
  const start = formatAssTimestamp(cue.startMs);
  const end = formatAssTimestamp(cue.endMs);
  const text = cue.lines.map(escapeAssText).join('\\N');
  return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
}

/** Serialize cues as a complete ASS v4.00+ document. */
export function serializeAss(
  cues: SubtitleCue[],
  style: SubtitleExportStyle,
  options: AssOptions,
): string {
  const lines: string[] = ['[Script Info]'];
  if (options.title !== undefined && options.title !== '') {
    lines.push(`Title: ${options.title}`);
  }
  lines.push(
    'ScriptType: v4.00+',
    `PlayResX: ${options.width}`,
    `PlayResY: ${options.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    STYLE_FORMAT,
    styleLine(style),
    '',
    '[Events]',
    EVENT_FORMAT,
  );

  for (const cue of cues) {
    lines.push(dialogueLine(cue));
  }

  return `${lines.join('\n')}\n`;
}
