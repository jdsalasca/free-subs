import { describe, expect, it } from 'vitest';
import { commitStablePrefix } from '../../../src/live/session';

/**
 * LocalAgreement-2: only the longest common prefix of two consecutive
 * hypotheses may be committed (Macháček et al., 2023).
 */
describe('commitStablePrefix', () => {
  it('returns an empty string when there is no previous hypothesis', () => {
    expect(commitStablePrefix('', 'hello world')).toBe('');
  });

  it('returns an empty string when the next hypothesis is empty', () => {
    expect(commitStablePrefix('hello world', '')).toBe('');
  });

  it('commits the shorter hypothesis while the text is still growing', () => {
    expect(commitStablePrefix('hello', 'hello world')).toBe('hello');
    expect(commitStablePrefix('hello world', 'hello world again')).toBe('hello world');
  });

  it('stops at the correction point of a mid-way change', () => {
    expect(commitStablePrefix('hello world', 'hello there')).toBe('hello');
    expect(commitStablePrefix('the quick brown fox', 'the quick red fox')).toBe('the quick');
  });

  it('ignores case and edge punctuation while comparing tokens', () => {
    // `next` wins so the committed text keeps the current punctuation/case.
    expect(commitStablePrefix('Hello, world', 'hello world today')).toBe('hello world');
    expect(commitStablePrefix('hello world', 'Hello, World!')).toBe('Hello, World!');
  });

  it('returns an empty string when there is no common prefix', () => {
    expect(commitStablePrefix('apple pie', 'banana split')).toBe('');
  });

  it('returns the whole string when both hypotheses are identical', () => {
    expect(commitStablePrefix('same text here', 'same text here')).toBe('same text here');
  });
});
