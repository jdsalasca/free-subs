import { useCallback, useEffect, useRef, useState } from 'react';
import type { LanguageCode, ModelId } from '../../core/types';
import {
  LIVE_LANGUAGE_OPTIONS,
  LIVE_MODEL_OPTIONS,
  LIVE_TRANSLATE_OPTIONS,
  type LiveTranslateTarget,
} from '../constants';

/**
 * Live mode: mic → streaming subtitles + translation.
 *
 * The wire protocol is frozen by `docs/specs/live-engine.md`:
 *   client → `{type:'start',language,model,translateTo}`, binary Float32 PCM
 *            16 kHz frames (~0.5 s) and `{type:'stop'}`.
 *   server → ready | partial | final | translation | status | error.
 *
 * The AudioWorklet is registered from an inline Blob module so no extra file
 * has to be added to the Vite build.
 */

/** Processor name registered by the inline worklet module. */
const PROCESSOR_NAME = 'free-subs-pcm-recorder';

/**
 * Inline AudioWorklet module. It accumulates the mono input into ~0.5 s
 * little-endian Float32 chunks and transfers each chunk to the main thread,
 * which forwards it as a binary WebSocket frame.
 */
const WORKLET_SOURCE = `
class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = Math.max(1, Math.round(sampleRate * 0.5));
    this.buffer = new Float32Array(this.chunkSize);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }
    const channel = input[0];
    if (!channel) {
      return true;
    }
    for (let i = 0; i < channel.length; i += 1) {
      this.buffer[this.offset] = channel[i];
      this.offset += 1;
      if (this.offset >= this.chunkSize) {
        const frame = this.buffer.slice(0);
        this.port.postMessage(frame, [frame.buffer]);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('${PROCESSOR_NAME}', PcmRecorderProcessor);
`;

/** Upper bound for the rolling transcript so a long session cannot grow forever. */
const MAX_LINES = 400;

const STATUS_IDLE = 'Inactivo';
const STATUS_LISTENING = 'Escuchando…';
const STATUS_TRANSCRIBING = 'Transcribiendo…';

const UNSUPPORTED_MESSAGE =
  'El modo en vivo necesita un navegador compatible y una conexión segura (HTTPS o localhost).';

function stateLabel(state: unknown): string | null {
  switch (state) {
    case 'listening':
      return STATUS_LISTENING;
    case 'transcribing':
      return STATUS_TRANSCRIBING;
    case 'idle':
      return STATUS_IDLE;
    default:
      return null;
  }
}

function appendCapped(previous: string[], value: string): string[] {
  const next = [...previous, value];
  return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
}

function micErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Permiso de micrófono denegado. Habilita el acceso al micrófono en tu navegador e inténtalo de nuevo.';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'No se encontró ningún micrófono en tu equipo.';
      case 'NotReadableError':
      case 'TrackStartError':
        return 'Tu micrófono está en uso por otra aplicación.';
      default:
        break;
    }
    if (error.message.length > 0) {
      return error.message;
    }
  }
  return 'No se pudo iniciar el micrófono. Revisa los permisos e inténtalo de nuevo.';
}

export function LivePanel() {
  const [language, setLanguage] = useState<LanguageCode>('auto');
  const [model, setModel] = useState<ModelId>('tiny');
  const [translate, setTranslate] = useState<LiveTranslateTarget>('none');

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>(STATUS_IDLE);
  const [error, setError] = useState<string | null>(null);
  const [finals, setFinals] = useState<string[]>([]);
  const [partial, setPartial] = useState('');
  const [translations, setTranslations] = useState<string[]>([]);

  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const errorRef = useRef<string | null>(null);
  /** In-flight start guard; bumped by `cleanup` so an aborted start releases nothing. */
  const sessionRef = useRef(0);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const showError = useCallback((message: string) => {
    errorRef.current = message;
    if (mountedRef.current) {
      setError(message);
      setStatus(message);
    }
  }, []);

  /** Releases every audio/socket resource. Never touches React state. */
  const cleanup = useCallback(async () => {
    sessionRef.current += 1;

    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stop' }));
        }
      } catch {
        // The socket may already be closing.
      }
      try {
        ws.close();
      } catch {
        // Ignore.
      }
    }

    const node = nodeRef.current;
    nodeRef.current = null;
    if (node) {
      node.port.onmessage = null;
      try {
        node.disconnect();
      } catch {
        // Ignore.
      }
    }

    const source = sourceRef.current;
    sourceRef.current = null;
    if (source) {
      try {
        source.disconnect();
      } catch {
        // Ignore.
      }
    }

    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore.
        }
      }
    }

    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx) {
      try {
        await ctx.close();
      } catch {
        // Ignore.
      }
    }
  }, []);

  const handleMessage = useCallback(
    (raw: unknown) => {
      if (typeof raw !== 'string') {
        return;
      }

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!data || typeof data !== 'object') {
        return;
      }

      const type = typeof data.type === 'string' ? data.type : '';
      const text = typeof data.text === 'string' ? data.text : '';

      switch (type) {
        case 'ready':
          setStatus(STATUS_LISTENING);
          break;

        case 'partial':
          if (text.length > 0) {
            setPartial(text);
            setStatus(STATUS_TRANSCRIBING);
          }
          break;

        case 'final': {
          const value = text.trim();
          if (value.length > 0) {
            setFinals((prev) => appendCapped(prev, value));
          }
          setPartial('');
          setStatus(STATUS_LISTENING);
          break;
        }

        case 'translation': {
          const value = text.trim();
          if (value.length > 0) {
            setTranslations((prev) => appendCapped(prev, value));
          }
          break;
        }

        case 'status': {
          const label = stateLabel(data.state);
          if (label) {
            setStatus(label);
          }
          break;
        }

        case 'error': {
          const message =
            typeof data.message === 'string' && data.message.length > 0
              ? data.message
              : 'Se produjo un error en el modo en vivo.';
          errorRef.current = message;
          void cleanup();
          runningRef.current = false;
          if (mountedRef.current) {
            setRunning(false);
            setError(message);
            setStatus(message);
            setPartial('');
          }
          break;
        }

        default:
          break;
      }
    },
    [cleanup],
  );

  const start = useCallback(async () => {
    if (runningRef.current) {
      return;
    }

    runningRef.current = true;
    errorRef.current = null;
    setRunning(true);
    setError(null);
    setFinals([]);
    setTranslations([]);
    setPartial('');
    setStatus(STATUS_LISTENING);

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      runningRef.current = false;
      setRunning(false);
      showError(UNSUPPORTED_MESSAGE);
      return;
    }

    const token = ++sessionRef.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (sessionRef.current !== token) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }
      streamRef.current = stream;

      const AudioContextCtor = window.AudioContext;
      if (typeof AudioContextCtor !== 'function') {
        throw new Error(UNSUPPORTED_MESSAGE);
      }

      // Ask for 16 kHz so frames can be forwarded without resampling.
      const ctx = new AudioContextCtor({ sampleRate: 16000 });
      ctxRef.current = ctx;

      if (!ctx.audioWorklet) {
        throw new Error(UNSUPPORTED_MESSAGE);
      }

      const moduleUrl = URL.createObjectURL(
        new Blob([WORKLET_SOURCE], { type: 'application/javascript' }),
      );
      try {
        await ctx.audioWorklet.addModule(moduleUrl);
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
      if (sessionRef.current !== token) {
        await cleanup();
        return;
      }

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const node = new AudioWorkletNode(ctx, PROCESSOR_NAME);
      nodeRef.current = node;
      source.connect(node);
      // Outputs are left unwritten (silent) but the node must feed the graph
      // so `process()` keeps being called.
      node.connect(ctx.destination);

      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(event.data.buffer as ArrayBuffer);
        }
      };

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${wsProtocol}//${window.location.host}/api/live`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        try {
          ws.send(
            JSON.stringify({
              type: 'start',
              language,
              model,
              translateTo: translate === 'none' ? null : translate,
            }),
          );
        } catch {
          // Ignore: `onerror`/`onclose` handle the failure.
        }
      };

      ws.onmessage = (event: MessageEvent<unknown>) => {
        handleMessage(event.data);
      };

      ws.onerror = () => {
        if (wsRef.current === ws) {
          showError('No se pudo conectar con el servicio en vivo.');
        }
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) {
          return;
        }
        void cleanup();
        runningRef.current = false;
        if (mountedRef.current) {
          setRunning(false);
          setPartial('');
          if (errorRef.current === null) {
            setStatus(STATUS_IDLE);
          }
        }
      };
    } catch (err) {
      if (sessionRef.current !== token) {
        return;
      }
      await cleanup();
      runningRef.current = false;
      if (mountedRef.current) {
        setRunning(false);
        showError(micErrorMessage(err));
      }
    }
  }, [language, model, translate, cleanup, handleMessage, showError]);

  const stop = useCallback(async () => {
    runningRef.current = false;
    if (mountedRef.current) {
      setRunning(false);
      setPartial('');
    }
    await cleanup();
    if (mountedRef.current) {
      setStatus(STATUS_IDLE);
    }
  }, [cleanup]);

  // Full cleanup on unmount (and a no-op in StrictMode's first unmount).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void cleanup();
    };
  }, [cleanup]);

  // Keep the newest line in view.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [finals, partial]);

  return (
    <section className="card live-card">
      <h2 className="card-title">
        <span className={`live-dot${running ? ' is-live' : ''}`} aria-hidden="true" />
        En vivo (beta)
      </h2>

      <p className="live-hint">
        Habla por el micrófono y verás los subtítulos al instante.
      </p>

      <div className="controls-fields live-fields">
        <label className="field">
          <span className="field-label">Idioma del audio</span>
          <select
            data-testid="live-language"
            className="select"
            value={language}
            onChange={(event) => setLanguage(event.target.value as LanguageCode)}
            disabled={running}
          >
            {LIVE_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Modelo</span>
          <select
            data-testid="live-model"
            className="select"
            value={model}
            onChange={(event) => setModel(event.target.value as ModelId)}
            disabled={running}
          >
            {LIVE_MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Traducir a</span>
          <select
            data-testid="live-translate"
            className="select"
            value={translate}
            onChange={(event) => setTranslate(event.target.value as LiveTranslateTarget)}
            disabled={running}
          >
            {LIVE_TRANSLATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="live-actions">
        <button
          data-testid="live-start"
          type="button"
          className="btn btn-primary"
          onClick={() => {
            void start();
          }}
          disabled={running}
        >
          Iniciar en vivo
        </button>
        <button
          data-testid="live-stop"
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            void stop();
          }}
          disabled={!running}
        >
          Detener
        </button>
      </div>

      <div data-testid="live-status" className="live-status" role="status" aria-live="polite">
        {status}
      </div>

      {error ? (
        <div className="inline-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="panel-block">
        <h3 className="block-title">Transcripción en vivo</h3>
        <div data-testid="live-transcript" ref={transcriptRef} className="transcript live-transcript">
          {finals.map((line, index) => (
            <span className="live-line" key={`final-${index}`}>
              {line}
            </span>
          ))}
          {partial ? (
            <span data-testid="live-partial" className="live-partial">
              {partial}
            </span>
          ) : null}
        </div>
      </div>

      <div className="panel-block">
        <h3 className="block-title">Traducción en vivo</h3>
        <div data-testid="live-translation" className="transcript live-translation">
          {translations.map((line, index) => (
            <span className="live-line" key={`translation-${index}`}>
              {line}
            </span>
          ))}
        </div>
      </div>

      <p className="live-note">Latencia típica 2–3 s. Todo se procesa en tu equipo.</p>
    </section>
  );
}
