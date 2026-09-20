import { describe, expect, it } from 'vitest';
import { LiveSession, type LiveSessionOptions } from '../../../src/live/session';
import type { Translator } from '../../../src/pipeline/translator';
import {
  FailingTranslator,
  LIVE_RATE,
  ScriptedEngine,
  ScriptedTranslator,
  collectEvents,
  silence,
  sine,
  tick,
} from './helpers';

function makeSession(
  scripts: Array<string | Error>,
  options: Partial<LiveSessionOptions> = {},
  translator: Translator | null = null,
) {
  const engine = new ScriptedEngine(scripts);
  const recorded = collectEvents();
  const session = new LiveSession(engine, translator, recorded.events, {
    language: 'en',
    model: 'tiny',
    ...options,
  });
  return { engine, recorded, session };
}

describe('LiveSession partial hypotheses', () => {
  it('emits partials only from stable prefixes', async () => {
    const { engine, recorded, session } = makeSession(
      ['hello', 'hello world', 'hello world foo', 'hello world foo'],
      { updateIntervalMs: 500 },
    );

    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();
    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();
    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();

    expect(engine.calls).toHaveLength(3);
    expect(recorded.partials).toEqual(['hello', 'hello world']);
  });

  it('does not re-emit an identical consecutive partial', async () => {
    const { recorded, session } = makeSession(
      ['hello', 'hello', 'hello', 'hello'],
      { updateIntervalMs: 500 },
    );

    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();
    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();
    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();

    expect(recorded.partials).toEqual(['hello']);
    expect(recorded.errors).toEqual([]);
  });

  it('never emits an empty partial', async () => {
    const { recorded, session } = makeSession(
      ['hello', 'hello world'],
      { updateIntervalMs: 500 },
    );

    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();

    expect(recorded.partials).toEqual([]);
  });
});

describe('LiveSession finalization', () => {
  it('emits a final once the silence tail reaches silenceMs', async () => {
    const { recorded, session } = makeSession(
      ['hello world'],
      { updateIntervalMs: 1_000_000, silenceMs: 600 },
    );

    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();
    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();
    session.pushAudio(silence(0.5), LIVE_RATE);
    await tick();
    expect(recorded.finals).toHaveLength(0);
    session.pushAudio(silence(0.5), LIVE_RATE);
    await tick();

    expect(recorded.finals).toHaveLength(1);
    expect(recorded.finals[0]?.text).toBe('hello world');
  });

  it('increments cue ids from 1 and translates each final', async () => {
    const translator = new ScriptedTranslator('[es]');
    const { recorded, session } = makeSession(
      ['one', 'two'],
      { updateIntervalMs: 1_000_000, translateTo: 'es' },
      translator,
    );

    for (const chunk of [sine(0.5), sine(0.5), silence(0.5), silence(0.5)]) {
      session.pushAudio(chunk, LIVE_RATE);
      await tick();
    }
    for (const chunk of [sine(0.5), sine(0.5), silence(0.5), silence(0.5)]) {
      session.pushAudio(chunk, LIVE_RATE);
      await tick();
    }

    expect(recorded.finals.map((cue) => cue.id)).toEqual([1, 2]);
    expect(recorded.finals.map((cue) => cue.text)).toEqual(['one', 'two']);
    expect(recorded.translations.map((entry) => entry.cueId)).toEqual([1, 2]);
    expect(recorded.translations[0]?.language).toBe('es');
    expect(translator.calls).toHaveLength(2);
  });

  it('keeps cue timestamps session-relative and monotonic', async () => {
    const { recorded, session } = makeSession(
      ['first cue', 'second cue'],
      { updateIntervalMs: 1_000_000, silenceMs: 500 },
    );

    for (const chunk of [sine(0.5), sine(0.5), silence(0.5), silence(0.5)]) {
      session.pushAudio(chunk, LIVE_RATE);
      await tick();
    }
    for (const chunk of [sine(0.5), sine(0.5), silence(0.5), silence(0.5)]) {
      session.pushAudio(chunk, LIVE_RATE);
      await tick();
    }

    expect(recorded.finals).toHaveLength(2);
    const [first, second] = recorded.finals;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    expect(first.startMs).toBeLessThan(first.endMs);
    expect(second.endMs).toBeGreaterThan(first.endMs);
    expect(second.startMs).toBeGreaterThanOrEqual(first.endMs);
  });

  it('does not duplicate text across cues after trimming', async () => {
    const { recorded, session } = makeSession(
      ['hello world', 'world today'],
      { updateIntervalMs: 1_000_000 },
    );

    for (const chunk of [sine(0.5), sine(0.5), silence(0.5), silence(0.5)]) {
      session.pushAudio(chunk, LIVE_RATE);
      await tick();
    }
    for (const chunk of [sine(0.5), sine(0.5), silence(0.5), silence(0.5)]) {
      session.pushAudio(chunk, LIVE_RATE);
      await tick();
    }

    expect(recorded.finals.map((cue) => cue.text)).toEqual(['hello world', 'today']);
    expect(recorded.finals[1]?.startMs ?? 0).toBeGreaterThanOrEqual(recorded.finals[0]?.endMs ?? 0);
  });

  it('force-cuts the cue at maxCueMs even during continuous speech', async () => {
    const { recorded, session } = makeSession(
      ['one two'],
      { updateIntervalMs: 1_000_000, maxCueMs: 1000, silenceMs: 600 },
    );

    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();
    expect(recorded.finals).toHaveLength(0);
    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();

    expect(recorded.finals).toHaveLength(1);
    expect(recorded.finals[0]?.text).toBe('one two');
  });
});

describe('LiveSession flush and stop', () => {
  it('flush finalizes the current segment', async () => {
    const { recorded, session } = makeSession(['hello there'], { updateIntervalMs: 1_000_000 });

    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();
    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();
    expect(recorded.finals).toHaveLength(0);

    await session.flush();
    expect(recorded.finals).toHaveLength(1);
    expect(recorded.finals[0]?.text).toBe('hello there');

    await session.flush();
    expect(recorded.finals).toHaveLength(1);
  });

  it('stop finalizes and is idempotent', async () => {
    const { recorded, session } = makeSession(['goodbye now'], { updateIntervalMs: 1_000_000 });

    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();
    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();

    await session.stop();
    await session.stop();

    expect(recorded.finals).toHaveLength(1);
    expect(recorded.finals[0]?.text).toBe('goodbye now');
    expect(recorded.statuses[recorded.statuses.length - 1]).toBe('idle');
  });
});

describe('LiveSession translation', () => {
  it('emits a translation event after the final', async () => {
    const translator = new ScriptedTranslator('[t]');
    const { recorded, session } = makeSession(
      ['hello'],
      { updateIntervalMs: 1_000_000, translateTo: 'es' },
      translator,
    );

    for (const chunk of [sine(0.5), sine(0.5), silence(0.5), silence(0.5)]) {
      session.pushAudio(chunk, LIVE_RATE);
      await tick();
    }

    expect(recorded.finals).toHaveLength(1);
    expect(recorded.translations).toEqual([{ cueId: 1, language: 'es', text: '[t]hello' }]);
    expect(translator.calls[0]?.options.to).toBe('es');
  });

  it('reports translator errors without losing the final cue', async () => {
    const { recorded, session } = makeSession(
      ['hello'],
      { updateIntervalMs: 1_000_000, translateTo: 'es' },
      new FailingTranslator(),
    );

    for (const chunk of [sine(0.5), sine(0.5), silence(0.5), silence(0.5)]) {
      session.pushAudio(chunk, LIVE_RATE);
      await tick();
    }

    expect(recorded.finals).toHaveLength(1);
    expect(recorded.errors).toContain('translation offline');
  });
});

describe('LiveSession resilience', () => {
  it('reports engine errors and keeps the session alive', async () => {
    const { recorded, session } = makeSession(
      [new Error('asr boom'), 'hello world', 'hello world', 'hello world'],
      { updateIntervalMs: 500 },
    );

    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();
    expect(recorded.errors).toContain('asr boom');

    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();
    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();

    expect(recorded.partials).toEqual(['hello world']);
    expect(recorded.errors).toEqual(['asr boom']);
  });

  it('trims the buffer after finalizing (engine sees a shorter buffer)', async () => {
    const { engine, recorded, session } = makeSession(
      ['a', 'a', 'a', 'a', 'a'],
      { updateIntervalMs: 500, silenceMs: 500, maxCueMs: 100_000 },
    );

    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();
    session.pushAudio(silence(0.5), LIVE_RATE);
    await tick();
    session.pushAudio(silence(0.5), LIVE_RATE);
    await tick();
    expect(recorded.finals).toHaveLength(1);

    const finalLength = Math.max(...engine.calls);
    engine.calls.length = 0;

    session.pushAudio(sine(0.5), LIVE_RATE);
    await tick();

    expect(engine.calls.length).toBeGreaterThan(0);
    expect(engine.calls[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(finalLength);
  });

  it('resamples non-16 kHz input before decoding', async () => {
    const { engine, session } = makeSession(['hi', 'hi'], { updateIntervalMs: 1 });

    session.pushAudio(sine(0.5, 0.3, 440, 48_000), 48_000);
    await tick();

    expect(engine.calls[0]).toBe(8000);
  });

  it('emits transcribing / listening status updates', async () => {
    const { recorded, session } = makeSession(['hello'], { updateIntervalMs: 1_000_000 });

    for (const chunk of [sine(0.5), sine(0.5), silence(0.5), silence(0.5)]) {
      session.pushAudio(chunk, LIVE_RATE);
      await tick();
    }

    expect(recorded.statuses).toContain('transcribing');
    expect(recorded.statuses).toContain('listening');
  });

  it('never decodes pure silence', async () => {
    const { engine, recorded, session } = makeSession(['hello'], { updateIntervalMs: 1 });

    session.pushAudio(silence(0.5), LIVE_RATE);
    await tick();
    session.pushAudio(silence(0.5), LIVE_RATE);
    await tick();

    expect(engine.calls).toHaveLength(0);
    expect(recorded.finals).toHaveLength(0);
  });

  it('pushAudio never throws on empty input', async () => {
    const { recorded, session } = makeSession(['hello']);

    expect(() => session.pushAudio(new Float32Array(0), LIVE_RATE)).not.toThrow();
    await tick();

    expect(recorded.errors).toEqual([]);
  });
});
