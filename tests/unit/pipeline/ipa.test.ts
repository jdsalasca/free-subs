import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SubtitleCue } from '../../../src/core';
import type { AsrEngine } from '../../../src/pipeline/asr';
import { annotateCuesWithIpa, toIpa } from '../../../src/pipeline/ipa';
import { transcribeFile } from '../../../src/pipeline/transcribe';

const tempDirs: string[] = [];

function writeTemporaryWav(buffer: Buffer, name = 'tone.wav'): string {
  const dir = mkdtempSync(join(tmpdir(), 'free-subs-ipa-'));
  tempDirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, buffer);
  return path;
}

/** Minimal 16-bit PCM RIFF/WAVE, mono, containing a 440 Hz tone. */
function buildToneWav(sampleRate = 16000, durationMs = 1200): Buffer {
  const length = Math.round((sampleRate * durationMs) / 1000);
  const data = Buffer.alloc(length * 2);
  for (let i = 0; i < length; i++) {
    const value = Math.round(0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 32767);
    data.writeInt16LE(value, i * 2);
  }

  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * 2, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);

  const fmtKey = Buffer.from('fmt ');
  const fmtSize = Buffer.alloc(4);
  fmtSize.writeUInt32LE(fmt.length, 0);
  const dataKey = Buffer.from('data');
  const dataSize = Buffer.alloc(4);
  dataSize.writeUInt32LE(data.length, 0);

  const body = Buffer.concat([fmtKey, fmtSize, fmt, dataKey, dataSize, data]);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WAVE', 8, 'ascii');
  return Buffer.concat([riff, body]);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('toIpa — English (CMUdict)', () => {
  it('maps a single word with primary stress', () => {
    expect(toIpa('hello', 'en')).toBe('həˈloʊ');
  });

  it('places primary stress before the onset of a word-initial syllable', () => {
    expect(toIpa('world', 'en')).toBe('ˈwɝld');
  });

  it('keeps the stress mark on a monosyllable', () => {
    // Spec literal was `naɪt`; the documented rule (stress mark before the
    // stressed syllable, as in `world`) yields `ˈnaɪt`.
    expect(toIpa('knight', 'en')).toBe('ˈnaɪt');
  });

  it('maps a multi-syllable word with an alveolar rhotic', () => {
    expect(toIpa('computer', 'en')).toBe('kəmˈpjutɚ');
  });

  it('renders secondary stress with a lowered mark', () => {
    expect(toIpa('tomato', 'en')).toBe('təˈmeɪˌtoʊ');
  });

  it('preserves punctuation and spacing between words', () => {
    expect(toIpa('Hello, world!', 'en')).toBe('həˈloʊ, ˈwɝld!');
  });

  it('accepts any en* language tag', () => {
    expect(toIpa('Hello', 'en-US')).toBe('həˈloʊ');
  });

  it('uses the first CMUdict variant for homographs (documented)', () => {
    // CMUdict first entry for "read" is R EH1 D (past); the R IY1 D variant is ignored.
    expect(toIpa('read', 'en')).toBe('ˈɹɛd');
  });

  it('returns an unknown word unchanged (no throw)', () => {
    expect(toIpa('zzzqx', 'en')).toBe('zzzqx');
  });

  it('keeps punctuation-only tokens unchanged', () => {
    expect(toIpa('...', 'en')).toBe('...');
  });

  it('returns an empty string for empty input', () => {
    expect(toIpa('', 'en')).toBe('');
  });
});

describe('toIpa — Spanish (rule-based G2P)', () => {
  it('drops the silent h and stresses the penultimate syllable', () => {
    expect(toIpa('hola', 'es')).toBe('ˈola');
  });

  it('maps the qu digraph to k', () => {
    expect(toIpa('queso', 'es')).toBe('ˈkeso');
  });

  it('maps the intervocalic gu digraph to g and rr to a trill', () => {
    expect(toIpa('guerra', 'es')).toBe('ˈgera');
  });

  it('maps ll to ʝ and spirantises intervocalic b', () => {
    expect(toIpa('llave', 'es')).toBe('ˈʝaβe');
  });

  it('maps ñ to ɲ', () => {
    expect(toIpa('niño', 'es')).toBe('ˈniɲo');
  });

  it('honours a written accent over the penultimate rule', () => {
    expect(toIpa('canción', 'es')).toBe('kanˈsjon');
  });

  it('marks the accented initial vowel', () => {
    expect(toIpa('árbol', 'es')).toBe('ˈaɾbol');
  });

  it('maps x to ks', () => {
    expect(toIpa('éxito', 'es')).toBe('ˈeksito');
  });

  it('treats y as an onset glide and as a coda', () => {
    expect(toIpa('yo', 'es')).toBe('ˈʝo');
    expect(toIpa('rey', 'es')).toBe('ˈrei');
  });

  it('preserves punctuation and spacing between words', () => {
    expect(toIpa('Hola, mundo.', 'es')).toBe('ˈola, ˈmundo.');
  });

  it('accepts any es* language tag', () => {
    expect(toIpa('hola', 'es-MX')).toBe('ˈola');
  });

  it('returns an empty string for empty input', () => {
    expect(toIpa('', 'es')).toBe('');
  });
});

describe('toIpa — unsupported languages', () => {
  it('returns the original text unchanged', () => {
    expect(toIpa('你好', 'zh')).toBe('你好');
  });
});

describe('annotateCuesWithIpa', () => {
  it('returns new cues with cue-level ipa and does not mutate the input', () => {
    const cues: SubtitleCue[] = [
      {
        index: 1,
        startMs: 0,
        endMs: 1000,
        lines: ['Hello', 'world'],
        words: [
          { text: 'Hello', startMs: 0, endMs: 500 },
          { text: 'world', startMs: 500, endMs: 1000 },
        ],
      },
    ];

    const annotated = annotateCuesWithIpa(cues, 'en');

    expect(annotated).not.toBe(cues);
    expect(annotated[0]).not.toBe(cues[0]);
    expect(annotated[0]?.ipa).toBe('həˈloʊ ˈwɝld');
    expect(annotated[0]?.words).toBe(cues[0]?.words);
    expect(cues[0]?.ipa).toBeUndefined();
  });

  it('annotates Spanish cues', () => {
    const cues: SubtitleCue[] = [{ index: 1, startMs: 0, endMs: 1000, lines: ['hola'] }];
    expect(annotateCuesWithIpa(cues, 'es')[0]?.ipa).toBe('ˈola');
  });
});

describe('transcribeFile with an English stub engine', () => {
  it('annotates the resulting cues with IPA', async () => {
    const path = writeTemporaryWav(buildToneWav());
    const engine: AsrEngine = {
      id: 'en-stub',
      async transcribe() {
        return {
          language: 'en',
          durationMs: 1200,
          segments: [
            {
              text: 'Hello world',
              startMs: 0,
              endMs: 1200,
              words: [
                { text: 'Hello', startMs: 0, endMs: 600 },
                { text: 'world', startMs: 600, endMs: 1200 },
              ],
            },
          ],
        };
      },
    };

    const result = await transcribeFile(path, 'en.wav', { engine, language: 'en' });

    expect(result.language).toBe('en');
    expect(result.cues.length).toBeGreaterThan(0);
    for (const cue of result.cues) {
      expect(typeof cue.ipa).toBe('string');
      expect(cue.ipa).not.toBe('');
    }
    expect(result.cues.some((cue) => cue.ipa === 'həˈloʊ ˈwɝld')).toBe(true);
  });
});
