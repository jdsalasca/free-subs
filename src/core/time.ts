/**
 * Timestamp helpers for the subtitle engine (SRT / WebVTT).
 *
 * All values are integer milliseconds. Functions are pure and never mutate
 * their inputs.
 */

interface TimeParts {
  hours: number;
  minutes: number;
  seconds: number;
  millis: number;
}

function clampMillis(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) {
    return 0;
  }
  return Math.floor(ms);
}

function splitMillis(total: number): TimeParts {
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return { hours, minutes, seconds, millis };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Format milliseconds as an SRT timestamp: `HH:MM:SS,mmm`. */
export function formatSrtTimestamp(ms: number): string {
  const { hours, minutes, seconds, millis } = splitMillis(clampMillis(ms));
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

/** Format milliseconds as a WebVTT timestamp: `HH:MM:SS.mmm`. */
export function formatVttTimestamp(ms: number): string {
  const { hours, minutes, seconds, millis } = splitMillis(clampMillis(ms));
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}`;
}

const TIMESTAMP_RE = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/;

/**
 * Parse an SRT (`HH:MM:SS,mmm`) or WebVTT (`HH:MM:SS.mmm`) timestamp.
 * `MM:SS` shorthand without an hours component is accepted as well.
 * Throws a `RangeError` when the string is not a valid timestamp.
 */
export function parseTimestamp(ts: string): number {
  const trimmed = ts.trim();
  const match = TIMESTAMP_RE.exec(trimmed);
  if (match === null) {
    throw new RangeError(`Invalid timestamp: "${ts}"`);
  }

  const hoursPart = match[1];
  const minutesPart = match[2];
  const secondsPart = match[3];
  const millisPart = match[4];

  // The regex guarantees these groups when the overall match succeeded.
  const hours = hoursPart === undefined ? 0 : Number(hoursPart);
  const minutes = Number(minutesPart);
  const seconds = Number(secondsPart);
  const millis = millisPart === undefined ? 0 : Number(millisPart.padEnd(3, '0'));

  if (minutes > 59 || seconds > 59) {
    throw new RangeError(`Invalid timestamp: "${ts}"`);
  }

  return hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + millis;
}
