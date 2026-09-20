# SPEC — Live engine: streaming subtitles + real-time translation

You own ONLY:
- `src/live/protocol.ts`, `src/live/session.ts`, `src/live/server.ts` (new)
- `src/server/index.ts` (modify: attach the WebSocket endpoint)
- `tests/unit/live/**` (new)
- `package.json` / `package-lock.json` (add `ws` + `@types/ws`)

Do NOT touch `src/core`, `src/pipeline`, `src/cli.ts`, `src/client`, other tests.

## Research basis (2023-2026) — implement exactly this
- **LocalAgreement-2** (Macháček et al., IJCNLP-AACL 2023, arXiv:2307.14743): commit only the longest
  common prefix of two consecutive hypotheses over a growing buffer; latency ≈ 2 × min-chunk + compute.
- **min-chunk 1.0 s** (whisper_streaming default), ASR window ≤ 15 s, hard cap 29 s.
- **VAD segmentation**: end-of-speech at 0.5–0.7 s silence; force-cut cues at 6–7 s (Netflix timing rules).
- **Translate finals only** (WhisperLiveKit `--translate-on-complete` pattern): full-sentence context,
  stable append-only output, cheap on CPU (OPUS-MT int8 ≈ 30–150 ms/sentence).
- Pseudo-streaming (periodic re-decode of a bounded window) is the only feasible policy with ONNX.

## Protocol (frozen)
WebSocket `GET /api/live` (binary frames allowed).

Client → Server:
- `{"type":"start","language":"auto|es|en|zh","model":"tiny|base|small","translateTo":"es|en|zh"|null}`
- binary frames: little-endian **Float32Array PCM, 16 kHz, mono** (~0.5 s each)
- `{"type":"flush"}` — force finalize the current segment
- `{"type":"stop"}`

Server → Client:
- `{"type":"ready"}`
- `{"type":"partial","text":"..."}`
- `{"type":"final","cueId":1,"text":"...","startMs":0,"endMs":2500}`
- `{"type":"translation","cueId":1,"language":"zh","text":"..."}`
- `{"type":"status","state":"listening|transcribing|idle"}`
- `{"type":"error","message":"..."}`

## `src/live/session.ts`
```ts
export interface LiveFinalCue { id: number; text: string; startMs: number; endMs: number }
export interface LiveEvents {
  onPartial: (text: string) => void;
  onFinal: (cue: LiveFinalCue) => void;
  onTranslation: (t: { cueId: number; language: string; text: string }) => void;
  onStatus?: (state: 'listening' | 'transcribing' | 'idle') => void;
  onError?: (message: string) => void;
}
export interface LiveSessionOptions {
  language: LanguageCode;
  model: ModelId;
  translateTo?: string | null;
  updateIntervalMs?: number; // default 1000
  maxCueMs?: number;         // default 7000
  silenceMs?: number;        // default 600
}
export class LiveSession {
  constructor(engine: AsrEngine, translator: Translator | null, events: LiveEvents, options: LiveSessionOptions);
  pushAudio(samples: Float32Array, sampleRate: number): void;  // never throws
  flush(): Promise<void>;
  stop(): Promise<void>;
}
export function commitStablePrefix(previous: string, next: string): string;
```
Rules:
- Resample incoming audio to 16 kHz with `resampleSinc` when needed; keep only the current segment's
  audio (trim after finalize, keeping a 200 ms tail).
- On each push: recompute speech regions with `detectSpeechRegions`; while speech is active and
  `now - lastUpdate >= updateIntervalMs` (and no decode in flight), decode the segment buffer
  (cap 15 s: take the tail and shift `startMs` accordingly).
- Emit `partial` = `commitStablePrefix(previousHypothesis, hypothesis)`; never emit an empty or
  identical consecutive partial.
- Finalize when the silence tail ≥ `silenceMs`, or the segment reaches `maxCueMs`, or on `flush()`:
  run one final decode, emit `final` (skip if identical to the previous final), then translate the
  final text if a translator + `translateTo` are configured (emit `translation`; errors → `onError`).
- Cue ids increment from 1; timestamps are session-relative and monotonic; **no text duplication
  across cues** (assert in tests).
- One ASR call at a time; coalesce updates; `pushAudio` must never throw (report via `onError`).

## `src/live/server.ts`
```ts
export interface LiveServerDeps { engine?: AsrEngine; translator?: Translator | null }
export function attachLiveWebSocket(server: http.Server, deps?: LiveServerDeps): WebSocketServer;
```
- Parse `start` (validate enums; 400-equivalent → `error` + close), route binary frames into the session,
  forward events as JSON, `stop` → finalize + close; one session per connection; cleanup on disconnect.
- `src/server/index.ts`: build `const server = http.createServer(app)` and call
  `attachLiveWebSocket(server)` before `server.listen(PORT)`.

## Tests (TDD: red first, ≥ 25)
- `commitStablePrefix`: empty previous; growing; mid-way correction; punctuation/case normalization;
  no common prefix; identical strings.
- `LiveSession` with a `ScriptedEngine` (queued hypotheses) + `ScriptedTranslator`:
  partials come only from stable prefixes; identical partial not re-emitted; final on silence;
  cue ids increment; timestamps monotonic; no cross-cue duplication; force cut at `maxCueMs`;
  `flush` and `stop` finalize (stop idempotent); translation event after final; engine error →
  `onError` and the session continues; buffer trim (engine receives a shorter buffer after finalize).
- `attachLiveWebSocket` integration: connect a real `ws` client to an ephemeral server with the stub
  engine, send `start` + synthetic PCM, assert `ready`/`partial`/`final` messages; invalid `start` → `error`.

## Acceptance
- `npx vitest run tests/unit/live` → green (≥ 25 tests).
- `npx vitest run` stays green; `npx tsc --noEmit` clean in your files.
- `npx tsup src/server/index.ts src/cli.ts --format esm --out-dir dist --clean false` succeeds.
- Report: files, test count, red→green evidence, deviations.
