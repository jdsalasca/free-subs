# SPEC — UI: live mode (mic → live subtitles + translation)

You own ONLY `src/client/**`.

## Card "En vivo (beta)"
Visible under the subtitles card, before the result. Spanish copy, simple for end users.

Controls (frozen testids):
- `live-start` button "Iniciar en vivo" · `live-stop` button "Detener" (disabled until started)
- `live-language` select (Detectar automáticamente / Español / English / 中文)
- `live-model` select (Tiny — rápido (recomendado) / Base / Small)
- `live-translate` select (No traducir / Español / English / 中文)
- `live-status` status line: "Inactivo" · "Escuchando…" · "Transcribiendo…" · error message
- `live-transcript` live transcript area: finalized text (normal) + current partial (muted/italic)
- `live-translation` translated finals area (one line per cue)
- A small hint: "Latencia típica 2–3 s. Todo se procesa en tu equipo."

## Behaviour
- On start: `getUserMedia({ audio: true })`, `AudioContext({ sampleRate: 16000 })`, an AudioWorklet
  registered from an inline Blob module (do not add files to the Vite build), accumulate ~0.5 s
  frames and send them as binary WebSocket frames to `/api/live` (derive ws/wss from `location`).
- Send `{"type":"start", language, model, translateTo}` first; render `ready`, `partial`, `final`,
  `translation`, `status` and `error` messages.
- Finalized cues append to `live-transcript` (keep a rolling list, newest last); partials update a
  muted tail line and never get appended as finals.
- On stop: send `{"type":"stop"}`, close the socket, stop tracks, close the AudioContext, status
  "Inactivo". Clean everything up on unmount. Handle mic-permission denial with a clear Spanish error.
- Keep every existing testid working.

## Acceptance
- `npx vite build` succeeds; `npx tsc --noEmit 2>&1 | Select-String "src/client"` clean.
- Mocked validation (temporary script, do not commit): a fake WebSocket server emits ready/partial/
  final/translation; the UI shows them correctly and stop cleans up.
- Report: files, testids, evidence, deviations.
