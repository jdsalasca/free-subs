import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SubtitleCue } from '../../../src/core';
import type { AsrEngine } from '../../../src/pipeline/asr';
import {
  annotateCuesWithPinyin,
  pinyinForWords,
  toPinyin,
} from '../../../src/pipeline/pinyin';
import { transcribeFile } from '../../../src/pipeline/transcribe';

const tempDirs: string[] = [];

function writeTemporaryWav(buffer: Buffer, name = 'tone.wav'): string {
  const dir = mkdtempSync(join(tmpdir(), 'free-subs-pinyin-'));
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

describe('toPinyin', () => {
  it('adds tone marks to Han text', () => {
    expect(toPinyin('你好')).toBe('nǐ hǎo');
  });

  it('matches the spec phrase and normalises fullwidth punctuation', () => {
    expect(toPinyin('你好，世界')).toBe('nǐ hǎo, shì jiè');
  });

  it('preserves punctuation in the output', () => {
    expect(toPinyin('你好，世界。')).toBe('nǐ hǎo, shì jiè。');
  });

  it('returns an empty string for empty input', () => {
    expect(toPinyin('')).toBe('');
  });

  it('leaves non-Chinese words as-is inside mixed text', () => {
    expect(toPinyin('Hello 你好 world')).toBe('Hello nǐ hǎo world');
    expect(toPinyin('Hello')).toBe('Hello');
  });

  it('keeps a single space between syllables when the source is spaced', () => {
    expect(toPinyin('你好 世界')).toBe('nǐ hǎo shì jiè');
  });
});

describe('pinyinForWords', () => {
  it('returns one pinyin string per word, aligned by index', () => {
    expect(pinyinForWords([{ text: '你好' }, { text: '世界' }])).toEqual(['nǐ hǎo', 'shì jiè']);
  });

  it('leaves non-Chinese words untouched', () => {
    expect(pinyinForWords([{ text: 'Hello' }, { text: '世界' }])).toEqual(['Hello', 'shì jiè']);
  });

  it('returns an empty array for no words', () => {
    expect(pinyinForWords([])).toEqual([]);
  });
});

describe('annotateCuesWithPinyin', () => {
  it('returns new cues with cue-level pinyin and does not mutate the input', () => {
    const cues: SubtitleCue[] = [
      {
        index: 1,
        startMs: 0,
        endMs: 1000,
        lines: ['你好', '世界'],
        words: [
          { text: '你好', startMs: 0, endMs: 500 },
          { text: '世界', startMs: 500, endMs: 1000 },
        ],
      },
    ];

    const annotated = annotateCuesWithPinyin(cues);

    expect(annotated).not.toBe(cues);
    expect(annotated[0]).not.toBe(cues[0]);
    expect(annotated[0]?.pinyin).toBe('nǐ hǎo shì jiè');
    // `words` is kept untouched (same reference, no word-level pinyin added here).
    expect(annotated[0]?.words).toBe(cues[0]?.words);
    expect(cues[0]?.pinyin).toBeUndefined();
  });
});

describe('transcribeFile with a Chinese stub engine', () => {
  it('annotates the resulting cues with pinyin', async () => {
    const path = writeTemporaryWav(buildToneWav());
    const engine: AsrEngine = {
      id: 'zh-stub',
      async transcribe() {
        return {
          language: 'zh',
          durationMs: 1200,
          segments: [
            {
              text: '你好世界',
              startMs: 0,
              endMs: 1200,
              words: [
                { text: '你好', startMs: 0, endMs: 600 },
                { text: '世界', startMs: 600, endMs: 1200 },
              ],
            },
          ],
        };
      },
    };

    const result = await transcribeFile(path, 'zh.wav', { engine, language: 'zh' });

    expect(result.language).toBe('zh');
    expect(result.cues.length).toBeGreaterThan(0);
    for (const cue of result.cues) {
      expect(typeof cue.pinyin).toBe('string');
      expect(cue.pinyin).not.toBe('');
    }
    expect(result.cues.some((cue) => cue.pinyin === 'nǐ hǎo shì jiè')).toBe(true);
  });
});
