import { describe, expect, it } from 'vitest';
import { splitSentences } from '../../../src/core/text';

describe('splitSentences — hard punctuation (es/en/zh)', () => {
  it('does not split on the Spanish abbreviation Sr.', () => {
    expect(splitSentences('Sr. García llegó. ¿Qué hora es?', 'es')).toEqual([
      'Sr. García llegó.',
      '¿Qué hora es?',
    ]);
  });

  it('does not split on Spanish titles Sra./Dr.', () => {
    expect(splitSentences('La Sra. López y el Dr. Ruiz llegaron. Fin.', 'es')).toEqual([
      'La Sra. López y el Dr. Ruiz llegaron.',
      'Fin.',
    ]);
  });

  it('does not split on the decimal point', () => {
    expect(splitSentences('Cuesta 3.14 euros. Es todo.', 'es')).toEqual([
      'Cuesta 3.14 euros.',
      'Es todo.',
    ]);
  });

  it('does not split on the English abbreviations Mr./Dr.', () => {
    expect(splitSentences('Mr. Smith left. Dr. Who?', 'en')).toEqual([
      'Mr. Smith left.',
      'Dr. Who?',
    ]);
  });

  it('does not split on Mrs./Ms./Prof.', () => {
    expect(splitSentences('Mrs. Jones met Prof. Plum. Ms. Scarlet left.', 'en')).toEqual([
      'Mrs. Jones met Prof. Plum.',
      'Ms. Scarlet left.',
    ]);
  });

  it('treats CJK terminators as unconditional boundaries', () => {
    expect(splitSentences('你好！世界？再见；', 'zh')).toEqual(['你好！', '世界？', '再见；']);
  });
});
