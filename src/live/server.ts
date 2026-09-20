/**
 * WebSocket endpoint for live streaming subtitles.
 *
 * One `LiveSession` per connection; client JSON is validated in
 * `protocol.ts`, binary frames are decoded to Float32 PCM and forwarded to the
 * session, and every session event is serialized back as a JSON message.
 */
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { AsrEngine } from '../pipeline/asr';
import { TransformersWhisperEngine } from '../pipeline/engine-transformers';
import { OpusMtTranslator, type Translator } from '../pipeline/translator';
import { LIVE_PATH, LIVE_SAMPLE_RATE, parseClientMessage, pcmToFloat32, type LiveServerMessage } from './protocol';
import { LiveSession, type LiveEvents } from './session';

export interface LiveServerDeps {
  engine?: AsrEngine;
  translator?: Translator | null;
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
}

/**
 * Attach the live WebSocket endpoint to an existing HTTP server and return the
 * created `WebSocketServer` (handy for tests and graceful shutdown).
 */
export function attachLiveWebSocket(server: HttpServer, deps: LiveServerDeps = {}): WebSocketServer {
  const wss = new WebSocketServer({ server, path: LIVE_PATH });

  wss.on('connection', (socket: WebSocket) => {
    let session: LiveSession | null = null;

    const send = (message: LiveServerMessage): void => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    };

    const events: LiveEvents = {
      onPartial: (text) => send({ type: 'partial', text }),
      onFinal: (cue) =>
        send({ type: 'final', cueId: cue.id, text: cue.text, startMs: cue.startMs, endMs: cue.endMs }),
      onTranslation: (translation) =>
        send({
          type: 'translation',
          cueId: translation.cueId,
          language: translation.language,
          text: translation.text,
        }),
      onStatus: (state) => send({ type: 'status', state }),
      onError: (message) => send({ type: 'error', message }),
    };

    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        if (session !== null) {
          session.pushAudio(pcmToFloat32(toBuffer(data)), LIVE_SAMPLE_RATE);
        }
        return;
      }

      const parsed = parseClientMessage(toBuffer(data).toString('utf8'));
      if (parsed === null) {
        // A malformed frame (including an invalid `start`) is fatal: report it
        // to the client and drop the connection, like an HTTP 400 would.
        send({ type: 'error', message: 'Invalid live message.' });
        socket.close();
        return;
      }

      if (parsed.type === 'start') {
        if (session !== null) {
          send({ type: 'error', message: 'Live session already started.' });
          return;
        }
        const engine = deps.engine ?? new TransformersWhisperEngine();
        const translator = deps.translator === undefined ? new OpusMtTranslator() : deps.translator;
        session = new LiveSession(engine, translator, events, {
          language: parsed.language,
          model: parsed.model,
          translateTo: parsed.translateTo ?? null,
        });
        send({ type: 'ready' });
        return;
      }

      if (parsed.type === 'flush') {
        if (session !== null) {
          void session.flush();
        }
        return;
      }

      // parsed.type === 'stop'
      const current = session;
      if (current === null) {
        socket.close();
        return;
      }
      void current.stop().finally(() => {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      });
    });

    socket.on('close', () => {
      if (session !== null) {
        void session.stop();
      }
    });

    socket.on('error', () => {
      if (session !== null) {
        void session.stop();
      }
    });
  });

  return wss;
}
