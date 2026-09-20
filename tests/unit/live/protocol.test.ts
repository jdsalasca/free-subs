import { describe, expect, it } from 'vitest';
import {
  isLiveLanguage,
  isLiveModel,
  isLiveTranslationTarget,
  parseClientMessage,
  pcmToFloat32,
} from '../../../src/live/protocol';

describe('parseClientMessage', () => {
  it('parses a valid start message', () => {
    expect(
      parseClientMessage('{"type":"start","language":"es","model":"base","translateTo":"en"}'),
    ).toEqual({ type: 'start', language: 'es', model: 'base', translateTo: 'en' });
  });

  it('defaults translateTo to null when omitted', () => {
    expect(parseClientMessage('{"type":"start","language":"auto","model":"tiny"}')).toEqual({
      type: 'start',
      language: 'auto',
      model: 'tiny',
      translateTo: null,
    });
  });

  it('parses flush and stop messages', () => {
    expect(parseClientMessage('{"type":"flush"}')).toEqual({ type: 'flush' });
    expect(parseClientMessage('{"type":"stop"}')).toEqual({ type: 'stop' });
  });

  it('rejects invalid enum values on start', () => {
    expect(parseClientMessage('{"type":"start","language":"fr","model":"base"}')).toBeNull();
    expect(parseClientMessage('{"type":"start","language":"en","model":"huge"}')).toBeNull();
    expect(
      parseClientMessage('{"type":"start","language":"en","model":"base","translateTo":"de"}'),
    ).toBeNull();
  });

  it('rejects malformed JSON, unknown types and non-objects', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('[1,2,3]')).toBeNull();
    expect(parseClientMessage('{"type":"dance"}')).toBeNull();
    expect(parseClientMessage('null')).toBeNull();
  });
});

describe('protocol guards', () => {
  it('recognizes supported languages, models and translation targets', () => {
    expect(isLiveLanguage('auto')).toBe(true);
    expect(isLiveLanguage('zh')).toBe(true);
    expect(isLiveLanguage('fr')).toBe(false);
    expect(isLiveModel('tiny')).toBe(true);
    expect(isLiveModel('large')).toBe(false);
    expect(isLiveTranslationTarget('en')).toBe(true);
    expect(isLiveTranslationTarget('auto')).toBe(false);
  });
});

describe('pcmToFloat32', () => {
  it('decodes little-endian Float32 PCM', () => {
    const source = new Float32Array([0.5, -0.25, 0.125]);
    const decoded = pcmToFloat32(source.buffer);
    expect(Array.from(decoded)).toEqual([0.5, -0.25, 0.125]);
  });

  it('uses the view byte offset of unaligned buffers', () => {
    const source = new Float32Array([1.5, -2.25]);
    const bytes = new Uint8Array(12);
    bytes.set(new Uint8Array(source.buffer), 4);

    const decoded = pcmToFloat32(bytes.subarray(4, 12));
    expect(Array.from(decoded)).toEqual([1.5, -2.25]);
  });

  it('ignores trailing bytes that do not complete a float', () => {
    const bytes = new Uint8Array([0, 0, 0x80, 0x3f, 9]);
    const decoded = pcmToFloat32(bytes);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toBeCloseTo(1);
  });
});
