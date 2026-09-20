import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { attachLiveWebSocket, type LiveServerDeps } from '../../../src/live/server';
import type { LiveServerMessage } from '../../../src/live/protocol';
import { ScriptedEngine, ScriptedTranslator, silence, sine } from './helpers';

interface Harness {
  server: Server;
  client: WebSocket;
  messages: LiveServerMessage[];
}

const harnesses: Harness[] = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness === undefined) continue;
    harness.client.removeAllListeners();
    if (
      harness.client.readyState === WebSocket.OPEN ||
      harness.client.readyState === WebSocket.CONNECTING
    ) {
      harness.client.terminate();
    }
    await new Promise<void>((resolve) => harness.server.close(() => resolve()));
  }
});

async function start(deps: LiveServerDeps = {}): Promise<Harness> {
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  attachLiveWebSocket(server, deps);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('server is not listening');
  }

  const client = new WebSocket(`ws://127.0.0.1:${address.port}/api/live`);
  const messages: LiveServerMessage[] = [];
  client.on('message', (data) => {
    messages.push(JSON.parse(data.toString()) as LiveServerMessage);
  });
  await new Promise<void>((resolve, reject) => {
    client.once('open', () => resolve());
    client.once('error', reject);
  });

  const harness: Harness = { server, client, messages };
  harnesses.push(harness);
  return harness;
}

function sendFrame(harness: Harness, samples: Float32Array): void {
  harness.client.send(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function sendSpeech(harness: Harness, frames = 4): Promise<void> {
  for (let i = 0; i < frames; i += 1) {
    sendFrame(harness, sine(0.5));
    await delay(40);
  }
}

async function sendSilence(harness: Harness, frames = 2): Promise<void> {
  for (let i = 0; i < frames; i += 1) {
    sendFrame(harness, silence(0.5));
    await delay(40);
  }
}

function waitForMessage(
  harness: Harness,
  predicate: (message: LiveServerMessage) => boolean,
  timeout = 5000,
): Promise<LiveServerMessage> {
  return vi.waitFor(
    () => {
      const found = harness.messages.find(predicate);
      if (found === undefined) {
        throw new Error('message not received yet');
      }
      return found;
    },
    { timeout, interval: 25 },
  );
}

describe('attachLiveWebSocket', () => {
  it('streams ready / partial / final over a real socket', async () => {
    const engine = new ScriptedEngine(['hello', 'hello world', 'hello world', 'hello world']);
    const harness = await start({ engine, translator: null });

    harness.client.send(JSON.stringify({ type: 'start', language: 'en', model: 'tiny' }));
    const ready = await waitForMessage(harness, (message) => message.type === 'ready');
    expect(ready).toMatchObject({ type: 'ready' });

    await sendSpeech(harness);
    const partial = await waitForMessage(harness, (message) => message.type === 'partial');
    expect(partial).toMatchObject({ type: 'partial', text: 'hello' });

    await sendSilence(harness);
    const final = await waitForMessage(harness, (message) => message.type === 'final');
    expect(final).toMatchObject({ type: 'final', cueId: 1, text: 'hello world' });
  });

  it('forwards translations after a final', async () => {
    const engine = new ScriptedEngine(['hello world', 'hello world', 'hello world']);
    const translator = new ScriptedTranslator('[es]');
    const harness = await start({ engine, translator });

    harness.client.send(
      JSON.stringify({ type: 'start', language: 'en', model: 'base', translateTo: 'es' }),
    );
    await waitForMessage(harness, (message) => message.type === 'ready');

    await sendSpeech(harness);
    await sendSilence(harness);

    const final = await waitForMessage(harness, (message) => message.type === 'final');
    const translation = await waitForMessage(harness, (message) => message.type === 'translation');
    expect(translation).toMatchObject({
      type: 'translation',
      language: 'es',
      text: '[es]hello world',
    });
    if (final.type === 'final' && translation.type === 'translation') {
      expect(translation.cueId).toBe(final.cueId);
    }
  });

  it('reports an error for an invalid start message', async () => {
    const harness = await start({ engine: new ScriptedEngine(['hello']), translator: null });

    harness.client.send(JSON.stringify({ type: 'start', language: 'fr', model: 'tiny' }));

    const error = await waitForMessage(harness, (message) => message.type === 'error');
    expect(error).toMatchObject({ type: 'error' });
  });

  it('stop finalizes the segment and closes the connection', async () => {
    const engine = new ScriptedEngine(['bye now', 'bye now', 'bye now']);
    const harness = await start({ engine, translator: null });

    harness.client.send(JSON.stringify({ type: 'start', language: 'en', model: 'tiny' }));
    await waitForMessage(harness, (message) => message.type === 'ready');

    await sendSpeech(harness);
    harness.client.send(JSON.stringify({ type: 'stop' }));

    const final = await waitForMessage(harness, (message) => message.type === 'final');
    expect(final).toMatchObject({ type: 'final', cueId: 1 });

    await vi.waitFor(() => expect(harness.client.readyState).toBe(WebSocket.CLOSED), {
      timeout: 5000,
    });
  });

  it('ignores binary frames received before start', async () => {
    const harness = await start({ engine: new ScriptedEngine(['hello']), translator: null });

    sendFrame(harness, sine(0.5));
    await delay(60);

    expect(harness.messages).toEqual([]);

    harness.client.send(JSON.stringify({ type: 'start', language: 'en', model: 'tiny' }));
    await waitForMessage(harness, (message) => message.type === 'ready');
  });
});
