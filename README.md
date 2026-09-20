<div align="center">

# free-subs

**Free, fast, local subtitles in Spanish, English and Mandarin.**
Your audio never leaves your machine — no cloud, no accounts, no per-minute fees.

[![unit tests](https://img.shields.io/badge/unit%20tests-140%20passing-brightgreen)](#development)
[![e2e](https://img.shields.io/badge/e2e-3%20passing-brightgreen)](#development)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6)](tsconfig.base.json)

</div>

![free-subs web UI transcribing a file](docs/screenshot.png)

## Why free-subs?

- **100% local.** Whisper runs on your CPU through Transformers.js / ONNX Runtime. Nothing is uploaded anywhere.
- **Free forever.** No API keys, no subscriptions, no character limits.
- **Spanish, English and Mandarin**, with automatic language detection.
- **Broadcast-grade output.** The cue engine applies real typography rules: balanced two-line cues, reading-speed limits (CPS), minimum durations, sentence-aware breaks and CJK-specific wrapping.
- **Web UI and CLI.** Drag & drop a file, or script it.

## Quick start

Requirements: **Node 20+**. `ffmpeg` is optional — only needed for non-WAV input (WAV works out of the box).

```bash
npm install
npm run build
npm start
# open http://localhost:8787
```

The first transcription downloads the Whisper model (default `base`, ~150 MB) into `.cache/models`.
Point it elsewhere with `FREE_SUBS_CACHE_DIR`, or pick a smaller model in the UI.

### CLI

```bash
# after npm run build
node dist/cli.js video.mp4 -l es -m base -o subtitulos.srt
node dist/cli.js audio.wav -l en -f vtt --stdout > subs.vtt
```

| Option | Description | Default |
| --- | --- | --- |
| `-l, --language <code>` | `auto`, `es`, `en`, `zh` | `auto` |
| `-m, --model <id>` | `tiny`, `base`, `small` | `base` |
| `-f, --format <fmt>` | `srt`, `vtt` | `srt` |
| `-o, --output <path>` | output file | next to the input |
| `--stdout` | print subtitles to stdout | — |

## Models

| Model | Speed | Quality | Best for |
| --- | --- | --- | --- |
| `tiny` | ⚡⚡⚡ | ★★ | quick drafts, CI, low-end machines |
| `base` | ⚡⚡ | ★★★ | everyday subtitles (default) |
| `small` | ⚡ | ★★★★ | difficult audio, accents |

## How it works

```
audio/video ──► decode ──► VAD ──► Whisper (word timestamps) ──► cue engine ──► SRT / VTT
```

The interesting part is the **cue engine** (`src/core`), which turns raw ASR output into subtitles people can actually read:

1. **Adaptive VAD** — RMS + zero-crossing rate with a percentile noise floor, hangover and gap merging. Silence is trimmed so Whisper never hallucinates on it.
2. **Word-level timestamps** — Whisper cross-attention alignment; when a model can't provide them, timings are distributed proportionally by character weight.
3. **Sentence-aware chunking** — cues break at sentence boundaries when they fit, and at capacity limits when they don't.
4. **Balanced line breaking** — dynamic programming minimizes the maximum line length, so you never get a 6-word line followed by a 2-word line.
5. **Reading-speed guardrails** — configurable CPS caps (17 for latin scripts, 9 for CJK), minimum/maximum durations, overlap and gap fixing.
6. **CJK typography** — Mandarin uses 16 chars/line, no spaces, and kinsoku rules (lines never start with `、。！？` or end with `「『（`).

## API

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | service status |
| `GET` | `/api/models` | available models and languages |
| `POST` | `/api/jobs?language=&model=&filename=` | upload media (raw body), returns `{ id }` |
| `GET` | `/api/jobs/:id` | job status, progress and result |
| `GET` | `/api/jobs/:id/download?format=srt\|vtt` | download subtitles |

## Development

Built with TDD: **140 unit tests** (Vitest) cover the cue engine, audio decoding, VAD, language detection and the HTTP API; **3 Playwright E2E tests** drive a real browser against the real model, transcribing real TTS speech and downloading real SRT/VTT files.

```bash
npm test          # unit tests
npm run test:e2e  # end-to-end (builds, warms the model, real transcription)
npm run fixtures  # regenerate speech fixtures (Windows TTS; committed for other OSes)
npm run dev       # dev server + Vite HMR
npm run typecheck # strict TypeScript
```

## Roadmap

- [ ] Translation to more languages
- [ ] Batch processing / folder watching
- [ ] Burned-in subtitles (ffmpeg)
- [ ] Speaker diarization
- [ ] GPU acceleration

## Español

**Subtítulos gratis, rápidos y 100% locales en español, inglés y mandarín.** Sin nube, sin cuentas, sin límites: Whisper corre en tu máquina. La interfaz aplica reglas reales de tipografía (líneas balanceadas por programación dinámica, velocidad de lectura máxima, cortes por frase, reglas CJK) y exporta SRT/VTT. Interfaz web + CLI.

```bash
npm install && npm run build && npm start   # http://localhost:8787
node dist/cli.js video.mp4 -l es -m base
```

## License

MIT © jdsalasca
