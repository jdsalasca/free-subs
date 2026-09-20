import { describe, expect, it } from 'vitest';
import { resolveFfmpeg } from '../../../src/pipeline/audio';
import {
  buildBurnInArgs,
  escapeFilterPath,
  ffmpegSupportsAss,
  parseFfmpegTime,
  probeDurationMs,
} from '../../../src/server/exporter';

describe('escapeFilterPath', () => {
  it('normalizes a Windows path with a colon and spaces for the ass= filter', () => {
    // In source: C:\a b\subs.ass
    expect(escapeFilterPath('C:\\a b\\subs.ass')).toBe("'C\\:/a b/subs.ass'");
  });

  it('escapes the drive colon even without spaces', () => {
    expect(escapeFilterPath('C:\\subs.ass')).toBe('C\\:/subs.ass');
  });

  it('leaves a simple POSIX path untouched', () => {
    expect(escapeFilterPath('/home/user/subs.ass')).toBe('/home/user/subs.ass');
  });

  it('quotes a POSIX path containing spaces', () => {
    expect(escapeFilterPath('/home/user/my subs.ass')).toBe("'/home/user/my subs.ass'");
  });

  it('passes through a bare relative filename', () => {
    expect(escapeFilterPath('subs.ass')).toBe('subs.ass');
  });
});

describe('buildBurnInArgs', () => {
  it('builds the documented ffmpeg argument list with output last', () => {
    const args = buildBurnInArgs('in.mp4', 'C:\\a b\\subs.ass', 'out.mp4');
    expect(args).toEqual([
      '-y',
      '-hide_banner',
      '-i',
      'in.mp4',
      '-vf',
      "ass='C\\:/a b/subs.ass'",
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      'out.mp4',
    ]);
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it('passes the escaped ass filter to -vf', () => {
    const args = buildBurnInArgs('in.mp4', '/home/user/subs.ass', 'out.mp4');
    const index = args.indexOf('-vf');
    expect(index).toBeGreaterThan(-1);
    expect(args[index + 1]).toBe('ass=/home/user/subs.ass');
  });
});

describe('parseFfmpegTime', () => {
  it('parses a plain time= token into milliseconds', () => {
    expect(parseFfmpegTime('time=00:00:05.23')).toBe(5230);
  });

  it('parses time= embedded in a progress line', () => {
    expect(
      parseFfmpegTime('frame=  42 fps=0.0 q=0.0 size=0kB time=00:00:05.23 bitrate=1.0kbits/s'),
    ).toBe(5230);
  });

  it('parses hours, minutes and seconds', () => {
    expect(parseFfmpegTime('time=01:02:03.00')).toBe(3_723_000);
    expect(parseFfmpegTime('time=10:00:00.00')).toBe(36_000_000);
  });

  it('accepts millisecond precision as well', () => {
    expect(parseFfmpegTime('time=00:00:05.234')).toBe(5234);
  });

  it('returns null for N/A and garbage', () => {
    expect(parseFfmpegTime('time=N/A')).toBeNull();
    expect(parseFfmpegTime('not a progress line')).toBeNull();
    expect(parseFfmpegTime('time=-00:00:01.00')).toBeNull();
    expect(parseFfmpegTime('')).toBeNull();
  });
});

describe('probeDurationMs', () => {
  it('returns null when the input file does not exist', async () => {
    await expect(probeDurationMs('C:/definitely/not/here/missing.mp4')).resolves.toBeNull();
  });
});

describe('ffmpegSupportsAss', () => {
  it('returns false for a path that does not exist', () => {
    expect(ffmpegSupportsAss('definitely-not-an-ffmpeg-binary-xyz')).toBe(false);
  });

  it('detects libass in the local ffmpeg build', () => {
    const ffmpeg = resolveFfmpeg();
    if (ffmpeg === null) {
      // No ffmpeg available on this machine: nothing to assert.
      return;
    }
    expect(ffmpegSupportsAss(ffmpeg)).toBe(true);
  });
});
