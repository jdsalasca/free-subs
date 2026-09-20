import { describe, expect, it } from 'vitest';
import { hexToAssColor, serializeAss } from '../../../src/core/ass';
import type { SubtitleCue, SubtitleExportStyle } from '../../../src/core/types';
import { DEFAULT_EXPORT_STYLE } from '../../../src/core/types';

const OPTIONS = { width: 1920, height: 1080, title: 'Demo' };

function styleLine(ass: string): string {
  const line = ass.split('\n').find((entry) => entry.startsWith('Style: '));
  if (line === undefined) {
    throw new Error('No Style line found in ASS output.');
  }
  return line;
}

function dialogueLines(ass: string): string[] {
  return ass.split('\n').filter((entry) => entry.startsWith('Dialogue: '));
}

describe('hexToAssColor', () => {
  it('converts white to a fully opaque ASS colour', () => {
    expect(hexToAssColor('#ffffff')).toBe('&H00FFFFFF');
  });

  it('converts black to a fully opaque ASS colour', () => {
    expect(hexToAssColor('#000000')).toBe('&H00000000');
  });

  it('reorders RGB into BBGGRR', () => {
    expect(hexToAssColor('#ff0000')).toBe('&H000000FF');
    expect(hexToAssColor('#00ff00')).toBe('&H0000FF00');
    expect(hexToAssColor('#0000ff')).toBe('&H00FF0000');
  });

  it('maps opacity 0 to a transparent alpha', () => {
    expect(hexToAssColor('#ffffff', 0)).toBe('&HFFFFFFFF');
  });

  it('maps partial opacity to the inverted ASS alpha channel', () => {
    // (1 - 0.6) * 255 = 102 -> 0x66
    expect(hexToAssColor('#000000', 0.6)).toBe('&H66000000');
  });

  it('accepts a hex string without the leading hash and is case-insensitive', () => {
    expect(hexToAssColor('ffffff')).toBe('&H00FFFFFF');
    expect(hexToAssColor('#ABCDEF', 1)).toBe('&H00EFCDAB');
  });

  it('throws on an invalid hex colour', () => {
    expect(() => hexToAssColor('nope')).toThrow();
    expect(() => hexToAssColor('#12345')).toThrow();
    expect(() => hexToAssColor('')).toThrow();
  });
});

describe('serializeAss', () => {
  it('serializes a complete ASS v4.00+ document', () => {
    const cues: SubtitleCue[] = [
      { index: 1, startMs: 1000, endMs: 2500, lines: ['Hello world'] },
    ];
    const expected =
      '[Script Info]\n' +
      'Title: Demo\n' +
      'ScriptType: v4.00+\n' +
      'PlayResX: 1920\n' +
      'PlayResY: 1080\n' +
      'WrapStyle: 0\n' +
      'ScaledBorderAndShadow: yes\n' +
      '\n' +
      '[V4+ Styles]\n' +
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n' +
      'Style: Default,Arial,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H66000000,-1,0,0,0,100,100,0,0,1,2,1,2,20,20,60,1\n' +
      '\n' +
      '[Events]\n' +
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
      'Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,Hello world\n';
    expect(serializeAss(cues, DEFAULT_EXPORT_STYLE, OPTIONS)).toBe(expected);
  });

  it('writes the required Script Info keys', () => {
    const ass = serializeAss([], DEFAULT_EXPORT_STYLE, OPTIONS);
    expect(ass).toContain('ScriptType: v4.00+');
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain('PlayResY: 1080');
    expect(ass).toContain('WrapStyle: 0');
    expect(ass).toContain('ScaledBorderAndShadow: yes');
  });

  it('omits the Title line when no title is provided', () => {
    const ass = serializeAss([], DEFAULT_EXPORT_STYLE, { width: 1280, height: 720 });
    expect(ass).not.toContain('Title: ');
    expect(ass).toContain('PlayResX: 1280');
    expect(ass).toContain('PlayResY: 720');
  });

  it('maps the three vertical positions to ASS alignments', () => {
    const bottom = serializeAss([], { ...DEFAULT_EXPORT_STYLE, position: 'bottom' }, OPTIONS);
    const middle = serializeAss([], { ...DEFAULT_EXPORT_STYLE, position: 'middle' }, OPTIONS);
    const top = serializeAss([], { ...DEFAULT_EXPORT_STYLE, position: 'top' }, OPTIONS);
    expect(styleLine(bottom)).toContain(',1,2,1,2,20,20,60,1');
    expect(styleLine(middle)).toContain(',1,2,1,5,20,20,60,1');
    expect(styleLine(top)).toContain(',1,2,1,8,20,20,60,1');
  });

  it('uses BorderStyle 3 with the background colour when background is enabled', () => {
    const style: SubtitleExportStyle = {
      ...DEFAULT_EXPORT_STYLE,
      background: true,
      backgroundColor: '#000000',
      backgroundOpacity: 0.6,
    };
    const line = styleLine(serializeAss([], style, OPTIONS));
    expect(line).toContain(',&H66000000,');
    expect(line).toContain(',3,2,1,2,20,20,60,1');
  });

  it('reflects the custom style fields', () => {
    const style: SubtitleExportStyle = {
      fontFamily: 'Roboto',
      fontSize: 36,
      bold: false,
      primaryColor: '#ff0000',
      outlineColor: '#00ff00',
      outlineWidth: 3,
      shadow: 2,
      position: 'top',
      marginV: 30,
      background: false,
      backgroundColor: '#000000',
      backgroundOpacity: 0.6,
    };
    const line = styleLine(serializeAss([], style, OPTIONS));
    expect(line).toBe(
      'Style: Default,Roboto,36,&H000000FF,&H000000FF,&H0000FF00,&H66000000,0,0,0,0,100,100,0,0,1,3,2,8,20,20,30,1',
    );
  });

  it('joins multi-line cue text with a hard break', () => {
    const cues: SubtitleCue[] = [
      { index: 1, startMs: 0, endMs: 1000, lines: ['Line one', 'Line two'] },
    ];
    const [dialogue] = dialogueLines(serializeAss(cues, DEFAULT_EXPORT_STYLE, OPTIONS));
    expect(dialogue).toContain('Line one\\NLine two');
  });

  it('escapes braces in cue text', () => {
    const cues: SubtitleCue[] = [
      { index: 1, startMs: 0, endMs: 1000, lines: ['{\\i1}styled{reset}'] },
    ];
    const [dialogue] = dialogueLines(serializeAss(cues, DEFAULT_EXPORT_STYLE, OPTIONS));
    expect(dialogue).toContain('(\\i1)styled(reset)');
    expect(dialogue).not.toContain('{');
    expect(dialogue).not.toContain('}');
  });

  it('formats timestamps in H:MM:SS.cc with centiseconds', () => {
    const cues: SubtitleCue[] = [
      { index: 1, startMs: 5000, endMs: 5230, lines: ['a'] },
      { index: 2, startMs: 3723000, endMs: 3723450, lines: ['b'] },
      { index: 3, startMs: 36000000, endMs: 36000010, lines: ['c'] },
    ];
    const lines = dialogueLines(serializeAss(cues, DEFAULT_EXPORT_STYLE, OPTIONS));
    expect(lines[0]).toContain('0:00:05.00,0:00:05.23');
    expect(lines[1]).toContain('1:02:03.00,1:02:03.45');
    expect(lines[2]).toContain('10:00:00.00,10:00:00.01');
  });

  it('produces a valid header with no Dialogue lines for empty cues', () => {
    const ass = serializeAss([], DEFAULT_EXPORT_STYLE, OPTIONS);
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('[Events]');
    expect(ass).toContain(
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    );
    expect(dialogueLines(ass)).toHaveLength(0);
  });

  it('has no trailing spaces and ends with exactly one newline', () => {
    const cues: SubtitleCue[] = [
      { index: 1, startMs: 0, endMs: 1000, lines: ['Hello'] },
    ];
    const ass = serializeAss(cues, DEFAULT_EXPORT_STYLE, OPTIONS);
    expect(ass.endsWith('\n')).toBe(true);
    expect(ass.endsWith('\n\n')).toBe(false);
    expect(ass.includes('\r')).toBe(false);
    for (const line of ass.split('\n')) {
      expect(line).toBe(line.replace(/[ \t]+$/, ''));
    }
  });
});
