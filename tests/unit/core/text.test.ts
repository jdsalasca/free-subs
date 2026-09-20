import { describe, expect, it } from 'vitest';
import { CJK_STYLE, DEFAULT_STYLE } from '../../../src/core/types';
import {
  detectScript,
  isCjkLanguage,
  normalizeForSubtitles,
  normalizeWhitespace,
  splitSentences,
  styleForLanguage,
  tokenize,
  visibleLength,
} from '../../../src/core/text';

describe('isCjkLanguage', () => {
  it('detects Chinese variants', () => {
    expect(isCjkLanguage('zh')).toBe(true);
    expect(isCjkLanguage('zh-CN')).toBe(true);
    expect(isCjkLanguage('ZH-Hans')).toBe(true);
  });

  it('detects Mandarin, Japanese and Korean', () => {
    expect(isCjkLanguage('cmn')).toBe(true);
    expect(isCjkLanguage('ja')).toBe(true);
    expect(isCjkLanguage('ja-JP')).toBe(true);
    expect(isCjkLanguage('ko')).toBe(true);
    expect(isCjkLanguage('KO')).toBe(true);
  });

  it('rejects latin and auto', () => {
    expect(isCjkLanguage('en')).toBe(false);
    expect(isCjkLanguage('es')).toBe(false);
    expect(isCjkLanguage('auto')).toBe(false);
  });
});

describe('styleForLanguage', () => {
  it('returns CJK_STYLE for CJK languages', () => {
    expect(styleForLanguage('zh')).toBe(CJK_STYLE);
    expect(styleForLanguage('ja')).toBe(CJK_STYLE);
  });

  it('returns DEFAULT_STYLE for latin languages', () => {
    expect(styleForLanguage('en')).toBe(DEFAULT_STYLE);
    expect(styleForLanguage('es')).toBe(DEFAULT_STYLE);
    expect(styleForLanguage('auto')).toBe(DEFAULT_STYLE);
  });
});

describe('detectScript', () => {
  it('detects pure latin', () => {
    expect(detectScript('Hello world')).toBe('latin');
  });

  it('detects pure CJK', () => {
    expect(detectScript('你好世界')).toBe('cjk');
  });

  it('detects mixed scripts', () => {
    expect(detectScript('Hello 你好')).toBe('mixed');
  });

  it('treats a tiny minority script as the dominant one', () => {
    expect(detectScript('a你好世界这是中文')).toBe('cjk');
    expect(detectScript('Hello world how are you 你好')).toBe('latin');
  });

  it('defaults to latin when there are no letters', () => {
    expect(detectScript('12345 !!!')).toBe('latin');
  });
});

describe('normalizeWhitespace', () => {
  it('collapses runs and trims', () => {
    expect(normalizeWhitespace('  a   b \n c \t')).toBe('a b c');
  });

  it('returns empty for whitespace only', () => {
    expect(normalizeWhitespace('   ')).toBe('');
  });
});

describe('normalizeForSubtitles', () => {
  it('removes spaces between CJK characters', () => {
    expect(normalizeForSubtitles('你好 世界', 'zh')).toBe('你好世界');
  });

  it('normalizes curly quotes', () => {
    expect(normalizeForSubtitles('“hi” ‘yo’', 'en')).toBe('"hi" \'yo\'');
  });

  it('removes zero-width characters', () => {
    expect(normalizeForSubtitles('he\u200bl\u200clo\u200d', 'en')).toBe('hello');
  });

  it('trims and collapses whitespace', () => {
    expect(normalizeForSubtitles('  hello   world  ', 'en')).toBe('hello world');
  });
});

describe('visibleLength', () => {
  it('counts non-space characters', () => {
    expect(visibleLength('a b c')).toBe(3);
    expect(visibleLength('  ')).toBe(0);
    expect(visibleLength('')).toBe(0);
  });

  it('counts CJK characters individually', () => {
    expect(visibleLength('你好 世界')).toBe(4);
  });
});

describe('splitSentences', () => {
  it('splits English sentences and keeps punctuation', () => {
    expect(splitSentences('Hello world. How are you? I am fine!', 'en')).toEqual([
      'Hello world.',
      'How are you?',
      'I am fine!',
    ]);
  });

  it('splits Spanish sentences including inverted marks', () => {
    expect(splitSentences('¿Cómo estás? ¡Muy bien! Adiós.', 'es')).toEqual([
      '¿Cómo estás?',
      '¡Muy bien!',
      'Adiós.',
    ]);
  });

  it('splits Chinese sentences without spaces', () => {
    expect(splitSentences('今天天气很好。我们去公园吧！', 'zh')).toEqual([
      '今天天气很好。',
      '我们去公园吧！',
    ]);
  });

  it('never splits decimal numbers', () => {
    expect(splitSentences('Pi is 3.14 today. Done.', 'en')).toEqual([
      'Pi is 3.14 today.',
      'Done.',
    ]);
  });

  it('keeps trailing closing quotes attached', () => {
    expect(splitSentences('He said "hi." Then left.', 'en')).toEqual([
      'He said "hi."',
      'Then left.',
    ]);
  });
});

describe('tokenize', () => {
  it('splits latin text on whitespace', () => {
    expect(tokenize('  hello   world  ', 'en')).toEqual(['hello', 'world']);
  });

  it('keeps punctuation attached for latin', () => {
    expect(tokenize('Hello, world!', 'en')).toEqual(['Hello,', 'world!']);
  });

  it('splits every CJK character into its own token', () => {
    expect(tokenize('你好世界', 'zh')).toEqual(['你', '好', '世', '界']);
  });

  it('keeps latin runs as words inside CJK text', () => {
    expect(tokenize('你好 world', 'zh')).toEqual(['你', '好', 'world']);
  });
});
