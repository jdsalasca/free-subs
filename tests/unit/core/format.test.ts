import { describe, expect, it } from 'vitest';
import { serializeSrt, serializeVtt } from '../../../src/core/format';
import type { SubtitleCue } from '../../../src/core/types';

const CUES: SubtitleCue[] = [
  { index: 1, startMs: 1000, endMs: 2500, lines: ['Hello world'] },
  { index: 2, startMs: 3000, endMs: 4200, lines: ['Line one', 'Line two'] },
];

const KARAOKE: SubtitleCue[] = [
  {
    index: 1,
    startMs: 0,
    endMs: 2000,
    lines: ['Hello there', 'friend'],
    words: [
      { text: 'Hello', startMs: 0, endMs: 600 },
      { text: 'there', startMs: 600, endMs: 1200 },
      { text: 'friend', startMs: 1200, endMs: 2000 },
    ],
  },
];

describe('serializeSrt', () => {
  it('serializes cues to the exact SRT format', () => {
    const expected =
      '1\n' +
      '00:00:01,000 --> 00:00:02,500\n' +
      'Hello world\n' +
      '\n' +
      '2\n' +
      '00:00:03,000 --> 00:00:04,200\n' +
      'Line one\n' +
      'Line two\n';
    expect(serializeSrt(CUES)).toBe(expected);
  });

  it('ends with exactly one newline and never uses CRLF', () => {
    const srt = serializeSrt(CUES);
    expect(srt.endsWith('\n')).toBe(true);
    expect(srt.endsWith('\n\n')).toBe(false);
    expect(srt.includes('\r')).toBe(false);
  });

  it('returns an empty string for no cues', () => {
    expect(serializeSrt([])).toBe('');
  });
});

describe('serializeVtt', () => {
  it('serializes cues to the exact WebVTT format', () => {
    const expected =
      'WEBVTT\n\n' +
      '00:00:01.000 --> 00:00:02.500\n' +
      'Hello world\n' +
      '\n' +
      '00:00:03.000 --> 00:00:04.200\n' +
      'Line one\n' +
      'Line two\n';
    expect(serializeVtt(CUES)).toBe(expected);
  });

  it('returns just the header for no cues', () => {
    expect(serializeVtt([])).toBe('WEBVTT\n\n');
  });

  it('renders karaoke timestamps before each word when requested', () => {
    const expected =
      'WEBVTT\n\n' +
      '00:00:00.000 --> 00:00:02.000\n' +
      '<00:00:00.000>Hello <00:00:00.600>there\n' +
      '<00:00:01.200>friend\n';
    expect(serializeVtt(KARAOKE, { karaoke: true })).toBe(expected);
  });

  it('ignores karaoke when no words are present', () => {
    expect(serializeVtt(CUES, { karaoke: true })).toBe(serializeVtt(CUES));
  });

  it('does not render karaoke unless explicitly enabled', () => {
    expect(serializeVtt(KARAOKE)).toBe(
      'WEBVTT\n\n' +
        '00:00:00.000 --> 00:00:02.000\n' +
        'Hello there\n' +
        'friend\n',
    );
  });
});
