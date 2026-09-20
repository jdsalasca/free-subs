import { describe, expect, it } from 'vitest';
import {
  formatSrtTimestamp,
  formatVttTimestamp,
  parseTimestamp,
} from '../../../src/core/time';

describe('formatSrtTimestamp', () => {
  it('formats zero', () => {
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000');
  });

  it('formats single milliseconds', () => {
    expect(formatSrtTimestamp(1)).toBe('00:00:00,001');
  });

  it('formats 999ms', () => {
    expect(formatSrtTimestamp(999)).toBe('00:00:00,999');
  });

  it('formats exactly one second', () => {
    expect(formatSrtTimestamp(1000)).toBe('00:00:01,000');
  });

  it('formats 3661234ms', () => {
    expect(formatSrtTimestamp(3661234)).toBe('01:01:01,234');
  });

  it('formats exactly one hour', () => {
    expect(formatSrtTimestamp(3600000)).toBe('01:00:00,000');
  });

  it('clamps negative values to zero', () => {
    expect(formatSrtTimestamp(-500)).toBe('00:00:00,000');
  });
});

describe('formatVttTimestamp', () => {
  it('formats 0 with a dot separator', () => {
    expect(formatVttTimestamp(0)).toBe('00:00:00.000');
  });

  it('formats 3661234ms with a dot separator', () => {
    expect(formatVttTimestamp(3661234)).toBe('01:01:01.234');
  });
});

describe('parseTimestamp', () => {
  it('parses a comma-separated SRT timestamp', () => {
    expect(parseTimestamp('01:01:01,234')).toBe(3661234);
  });

  it('parses a dot-separated VTT timestamp', () => {
    expect(parseTimestamp('01:01:01.234')).toBe(3661234);
  });

  it('parses zero', () => {
    expect(parseTimestamp('00:00:00,000')).toBe(0);
  });

  it('parses a short MM:SS.mmm timestamp', () => {
    expect(parseTimestamp('01:02.500')).toBe(62500);
  });

  it('throws on a non-timestamp string', () => {
    expect(() => parseTimestamp('not a timestamp')).toThrow();
  });

  it('throws on out-of-range seconds', () => {
    expect(() => parseTimestamp('00:00:99,000')).toThrow();
  });

  it('round-trips SRT timestamps', () => {
    for (const ms of [0, 1, 999, 1000, 59999, 3600000, 3661234]) {
      expect(parseTimestamp(formatSrtTimestamp(ms))).toBe(ms);
    }
  });

  it('round-trips VTT timestamps', () => {
    for (const ms of [0, 1, 999, 1000, 59999, 3600000, 3661234]) {
      expect(parseTimestamp(formatVttTimestamp(ms))).toBe(ms);
    }
  });
});
