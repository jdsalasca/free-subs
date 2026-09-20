<div align="center">

# free-subs

**Free, fast, local subtitles in Spanish, English and Mandarin — then translate them and export the video with subtitles burned in.**
No cloud. No accounts. No per-minute fees. Your media never leaves your machine.

[![unit tests](https://img.shields.io/badge/unit%20tests-261%20passing-brightgreen)](#development)
[![e2e](https://img.shields.io/badge/e2e-6%20passing-brightgreen)](#development)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6)](tsconfig.base.json)

![free-subs dark theme](docs/screenshot.png)

<sub>Light theme is included too — it follows your system by default.</sub>

</div>

## Three buttons

1. **Subtítulos** — drop a video/audio file and get high-quality SRT/VTT/ASS subtitles in Spanish, English or Mandarin.
2. **Traducir** — one click to translate the subtitles to any of the three languages, keeping the original timings.
3. **Exportar video** — style the subtitles (font, colors, outline, shadow, position, background box) with a live preview and burn them into an MP4.

Plus: light/dark theme, local-only processing, and a CLI for scripting.

## Quick start

Requirements: **Node 20+**. `ffmpeg` is needed for non-WAV input and for video export (the Gyan "full" build includes libass).

```bash
npm install
npm run build
npm start
# open http://localhost:8787
```

The first transcription downloads the Whisper model (default `base`, ~150 MB) and the first translation downloads an OPUS-MT model (~80 MB) into `.cache/models`. Override with `FREE_SUBS_CACHE_DIR`.

### CLI

```bash
# after npm run build
node dist/cli.js video.mp4 -l es -m base -o subtitulos.srt          # subtitles
node dist/cli.js video.mp4 -l en -t es                              # translate to Spanish
node dist/cli.js video.mp4 -l en -t es --burn salida.mp4            # burn translated subs into video
node dist/cli.js audio.wav -l en -f ass --stdout > subs.ass         # ASS output
```

| Option | Description | Default |
| --- | --- | --- |
| `-l, --language <code>` | `auto`, `es`, `en`, `zh` | `auto` |
| `-m, --model <id>` | `tiny`, `base`, `small` | `base` |
| `-f, --format <fmt>` | `srt`, `vtt`, `ass` | `srt` |
| `-t, --translate <lang>` | translate subtitles (`es`, `en`, `zh`) | — |
| `--burn <output>` | burn subtitles into the video (mp4) | — |
| `-o, --output <path>` | output file | next to the input |
| `--stdout` | print subtitles to stdout | — |

## Models

| Model | Speed | Quality | Best for |
| --- | --- | --- | --- |
| `tiny` | ⚡⚡⚡ | ★★ | quick drafts, CI, low-end machines |
| `base` | ⚡⚡ | ★★★ | everyday subtitles (default) |
| `small` | ⚡ | ★★★★ | difficult audio, accents |

Translation runs fully locally with OPUS-MT models (es↔en, en↔zh; es↔zh pivots through English).

## How it works

```
audio/video ─► decode ─► loudness ─► VAD ─► [denoise if noisy] ─► Whisper ─► post-process ─► cue engine ─► SRT/VTT/ASS
                                                                                              └─► translate ─► OPUS-MT
                                                                                              └─► export ─► ASS + ffmpeg/libass
```

The engineering is grounded in 2024-2026 speech research, adapted to run in pure TypeScript:

| Algorithm | What it does | Basis |
| --- | --- | --- |
| **Adaptive VAD** | RMS + zero-crossing with percentile noise floor, hangover, gap merging; silence is trimmed so Whisper never hallucinates on it | Silero/WebRTC comparisons show VAD is the #1 robustness lever (arXiv:2501.11378) |
| **Hallucination guards** | De-looping repeated n-grams, bag-of-hallucinations filter (EN+ZH), drop word tokens < 50 ms, drop no-speech segments | arXiv:2501.11378, arXiv:2408.16589 (CrisperWhisper) |
| **Timestamp refinement** | Median-filter smoothing, monotonic repair, snapping boundaries to VAD speech edges | Whisper DTW practice; WhisperX (arXiv:2303.00747) |
| **Word-level timestamps** | Whisper cross-attention alignment; proportional character-weighted fallback | HF Whisper DTW |
| **Conservative denoise** | Decision-directed Wiener spectral gating with a −15 dB gain floor and SNR-gated dry/wet mix — clean audio passes through untouched | arXiv:2406.12699 (output alignment); arXiv:2501.11378 found aggressive denoising hurts Whisper |
| **Loudness normalization** | Active-speech RMS to −20 dBFS with a −1 dBFS peak guard | ITU-R BS.1770 / EBU R128 principles |
| **Balanced line breaking** | Dynamic programming minimizes the maximum line length | Broadcast subtitling practice |
| **Reading-speed rules** | CPS caps (17 latin / 9 CJK), min/max durations, overlap and gap fixing | Netflix/BBC subtitle guidelines |
| **CJK typography** | 16 chars/line, kinsoku (no line starting with `、。！？` or ending with `「『（`), simplified-Chinese normalization | Netflix Chinese TTSG, W3C clreq |
| **Safe chunking** | `chunk_length_s: 29` and independent chunks (no cross-chunk conditioning) | transformers.js issue #1357; hallucination research |

## API

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | service status |
| `GET` | `/api/models` | models, languages, fonts and default export style |
| `POST` | `/api/jobs?language=&model=&filename=` | upload media (raw body), returns `{ id }` |
| `GET` | `/api/jobs/:id` | status, progress, result, translations and exports |
| `POST` | `/api/jobs/:id/translate` | `{ "to": "es" }` → starts a local translation |
| `POST` | `/api/jobs/:id/export` | `{ "style": { ... } }` → burns subtitles into an MP4 |
| `GET` | `/api/exports/:exportId` | export status |
| `GET` | `/api/exports/:exportId/download` | download the exported MP4 |
| `GET` | `/api/jobs/:id/download?format=srt\|vtt\|ass[&lang=es]` | download subtitles (original or translated) |

## Development

Built with TDD: **261 unit tests** (Vitest) cover the cue engine, ASS serialization, FFT/denoise, post-processing, audio decoding, VAD, translation routing and the HTTP API; **6 Playwright E2E tests** drive a real browser against the real models — transcribing real TTS speech, translating it, toggling themes and exporting a real MP4 with burned-in subtitles.

```bash
npm test          # unit tests
npm run test:e2e  # end-to-end (builds, warms the model, real transcription/translation/export)
npm run fixtures  # regenerate speech fixtures (Windows TTS; committed for other OSes)
npm run dev       # dev server + Vite HMR
npm run typecheck # strict TypeScript
```

## Roadmap

- [ ] Batch processing / folder watching
- [ ] Subtitle editor (edit text before export)
- [ ] Speaker diarization
- [ ] GPU acceleration
- [ ] More languages for transcription and translation

## Español

**Subtítulos gratis, rápidos y 100% locales en español, inglés y mandarín.** Sin nube, sin cuentas, sin límites: Whisper y los modelos de traducción corren en tu máquina.

- **Botón Subtítulos**: suelta un video y obtén SRT/VTT/ASS con tipografía profesional (líneas balanceadas por programación dinámica, velocidad de lectura, reglas CJK).
- **Botón Traducir**: traduce los subtítulos entre español, inglés y mandarín conservando los tiempos.
- **Botón Exportar video**: elige fuente, colores, contorno, sombra y posición con vista previa en vivo, y quema los subtítulos en un MP4 con ffmpeg/libass.
- **Modo claro/oscuro** automático según tu sistema.

```bash
npm install && npm run build && npm start   # http://localhost:8787
node dist/cli.js video.mp4 -l es -t en --burn salida.mp4
```

## License

MIT © jdsalasca
