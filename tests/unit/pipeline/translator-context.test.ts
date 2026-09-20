import { describe, expect, it } from 'vitest';
import type { Translator, TranslatorOptions } from '../../../src/pipeline/translator';
import {
  groupCueBlocks,
  splitTranslatedText,
  translateCueTexts,
} from '../../../src/pipeline/translator';

/** Strip every whitespace character so content can be compared ignoring spacing. */
function compact(text: string): string {
  return text.replace(/\s+/gu, '');
}

describe('groupCueBlocks', () => {
  it('returns no groups for empty input', () => {
    expect(groupCueBlocks([])).toEqual([]);
  });

  it('puts a single cue in a single group', () => {
    expect(groupCueBlocks(['only'])).toEqual([[0]]);
  });

  it('returns consecutive indices for short input', () => {
    expect(groupCueBlocks(['a', 'b', 'c'])).toEqual([[0, 1, 2]]);
  });

  it('respects maxCues', () => {
    const cues = Array.from({ length: 7 }, (_, index) => `c${index}`);
    expect(groupCueBlocks(cues, { maxCues: 3 })).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
  });

  it('defaults to at most 6 cues per group', () => {
    const cues = Array.from({ length: 8 }, (_, index) => `c${index}`);
    expect(groupCueBlocks(cues)).toEqual([
      [0, 1, 2, 3, 4, 5],
      [6, 7],
    ]);
  });

  it('respects maxChars', () => {
    // 4 + 4 = 8 fits in 9, adding the 2-char cue would reach 10.
    expect(groupCueBlocks(['aaaa', 'bbbb', 'cc'], { maxChars: 9 })).toEqual([[0, 1], [2]]);
  });

  it('uses a 400 character budget by default', () => {
    const long = 'a'.repeat(200);
    expect(groupCueBlocks([long, long, long])).toEqual([
      [0, 1],
      [2],
    ]);
  });

  it('keeps a single oversized cue in its own group', () => {
    expect(groupCueBlocks(['x'.repeat(500)], { maxChars: 400 })).toEqual([[0]]);
  });

  it('never emits an empty group', () => {
    const groups = groupCueBlocks(['a', '', 'b', 'c'], { maxCues: 2 });
    expect(groups.every((group) => group.length > 0)).toBe(true);
  });
});

describe('splitTranslatedText', () => {
  it('returns a single trimmed piece for one part', () => {
    expect(splitTranslatedText('  hola mundo  ', ['origen'])).toEqual(['hola mundo']);
  });

  it('splits uneven latin parts at a whitespace boundary', () => {
    const pieces = splitTranslatedText('one two three four', ['a', 'bbb']);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toBe('one');
    expect(pieces[1]).toBe('two three four');
  });

  it('splits CJK text that has no spaces', () => {
    const translated = '你好世界你好世界';
    const pieces = splitTranslatedText(translated, ['你', '你好']);
    expect(pieces).toHaveLength(2);
    expect(pieces.every((piece) => piece.length > 0)).toBe(true);
    expect(compact(pieces.join(''))).toBe(compact(translated));
  });

  it('keeps every piece non-empty when parts outnumber characters', () => {
    const translated = 'abcdef';
    const pieces = splitTranslatedText(translated, ['a', 'b', 'c', 'd', 'e', 'f']);
    expect(pieces).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(pieces.every((piece) => piece.length > 0)).toBe(true);
  });

  it('preserves the total content ignoring whitespace', () => {
    const translated = 'the quick brown fox jumps over the lazy dog';
    const parts = ['the quick', 'brown fox jumps', 'over the lazy dog'];
    const pieces = splitTranslatedText(translated, parts);
    expect(pieces).toHaveLength(parts.length);
    expect(compact(pieces.join(''))).toBe(compact(translated));
    expect(pieces.every((piece) => piece.trim().length > 0)).toBe(true);
  });

  it('returns [] when there are no parts', () => {
    expect(splitTranslatedText('anything', [])).toEqual([]);
  });
});

describe('translateCueTexts', () => {
  it('joins each block, translates it, splits it back and preserves order', async () => {
    const calls: string[][] = [];
    const translator: Translator = {
      async translate(texts, options) {
        calls.push(texts.slice());
        options.onProgress?.(100);
        return texts.map((text) => text.split(' ').reverse().join(' '));
      },
    };

    const output = await translateCueTexts(translator, ['a', 'b', 'c'], {
      from: 'en',
      to: 'es',
    });

    expect(calls).toEqual([['a b c']]);
    expect(output).toEqual(['c', 'b', 'a']);
  });

  it('keeps the result length and order across multiple blocks', async () => {
    const translator: Translator = {
      async translate(texts, options) {
        options.onProgress?.(100);
        return texts.map((text) => text.split(' ').reverse().join(' '));
      },
    };
    const cues = Array.from({ length: 7 }, (_, index) => `s${index}`);

    const output = await translateCueTexts(translator, cues, { from: 'en', to: 'es' });

    expect(output).toHaveLength(cues.length);
    expect(output).toEqual(['s5', 's4', 's3', 's2', 's1', 's0', 's6']);
  });

  it('falls back to the individual cues when a block translation throws', async () => {
    const calls: string[][] = [];
    const translator: Translator = {
      async translate(texts) {
        calls.push(texts.slice());
        if (texts.length === 1 && (texts[0] ?? '').includes(' ')) {
          throw new Error('block failed');
        }
        return texts.map((text) => `[${text}]`);
      },
    };

    const output = await translateCueTexts(translator, ['hello', 'world'], {
      from: 'en',
      to: 'es',
    });

    expect(calls).toEqual([['hello world'], ['hello', 'world']]);
    expect(output).toEqual(['[hello]', '[world]']);
  });

  it('scales progress to 100 across blocks', async () => {
    const percents: number[] = [];
    const translator: Translator = {
      async translate(texts, options: TranslatorOptions) {
        options.onProgress?.(50);
        options.onProgress?.(100);
        return texts.slice();
      },
    };
    const cues = Array.from({ length: 7 }, (_, index) => `c${index}`);

    await translateCueTexts(translator, cues, {
      from: 'en',
      to: 'es',
      onProgress: (percent) => percents.push(percent),
    });

    expect(percents.length).toBeGreaterThan(0);
    expect(percents.every((percent) => percent >= 0 && percent <= 100)).toBe(true);
    expect(percents.at(-1)).toBe(100);
  });

  it('returns [] for empty input', async () => {
    const translator: Translator = {
      async translate(texts) {
        return texts.slice();
      },
    };
    await expect(translateCueTexts(translator, [], { from: 'en', to: 'es' })).resolves.toEqual([]);
  });
});
