import { describe, expect, it } from 'vitest';
import { visibleLength } from '../../../src/core/text';

describe('visibleLength — grapheme aware', () => {
  it('counts latin letters without spaces', () => {
    expect(visibleLength('hola')).toBe(4);
    expect(visibleLength('hola mundo')).toBe(9);
  });

  it('counts CJK characters individually', () => {
    expect(visibleLength('你好')).toBe(2);
    expect(visibleLength('你好 世界')).toBe(4);
  });

  it('counts an emoji as a single character', () => {
    expect(visibleLength('😀')).toBe(1);
    expect(visibleLength('a😀b')).toBe(3);
  });

  it('does not add extra characters for combining accents', () => {
    expect(visibleLength('cafe\u0301')).toBe(4);
    expect(visibleLength('n\u0303')).toBe(1);
  });

  it('counts a ZWJ emoji sequence as a single character', () => {
    // Built from escapes so the zero-width joiners survive any file encoding.
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    expect(visibleLength(family)).toBe(1);
  });
});
