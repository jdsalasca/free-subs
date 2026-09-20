<div align="center">

# free-subs

**Free, fast, local subtitles in Spanish, English and Mandarin — then translate them, add pinyin, and export the video with subtitles burned in.**
No cloud. No accounts. No per-minute fees. Your media never leaves your machine.

[![unit tests](https://img.shields.io/badge/unit%20tests-348%20passing-brightgreen)](#development)
[![e2e](https://img.shields.io/badge/e2e-11%20passing-brightgreen)](#development)
[![coverage](https://img.shields.io/badge/coverage-81%25%20lines-brightgreen)](#development)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6)](tsconfig.base.json)

![free-subs dark theme](docs/screenshot.png)

</div>

## Demos

| Subtítulos | Traducir | Exportar video |
| --- | --- | --- |
| ![subtitles demo](docs/demo-subtitles.gif) | ![translate demo](docs/demo-translate.gif) | ![export demo](docs/demo-export.gif) |

## Three buttons

1. **Subtítulos** — drop a video/audio file and get high-quality SRT/VTT/ASS/JSON subtitles in Spanish, English or Mandarin (with pinyin for Chinese).
2. **Traducir** — one click to translate to any of the three languages, keeping the original timings (context-aware: cues are translated in blocks).
3. **Exportar video** — style the subtitles with a live preview and burn them into an MP4.

Built for learners and for apps that need a subtitle engine: **study JSON**, **batch mode**, **per-line audio clips**, **pinyin**, light/dark theme, CLI, local-only processing.

## Quick start

Requirements: **Node 20+**. `ffmpeg` is needed for non-WAV input, video export and clips (the Gyan "full" build includes libass).

```bash
npm install
npm run build
npm start
# open http://localhost:8787
```

The first transcription downloads the Whisper model (default `base`, ~150 MB) and the first translation downloads an OPUS-MT model (~80 MB) into `.cache/models`. Override with `FREE_SUBS_CACHE_DIR`.

### CLI

```bash
node dist/cli.js video.mp4 -l es -m base -o subtitulos.srt        # subtitles
node dist/cli.js video.mp4 -l en -t es                            # translate to Spanish
node dist/cli.js video.mp4 -l en -t es --burn salida.mp4          # burn translated subs
node dist/cli.js song.mp3 -l es -m small --vocals -f json         # study JSON (music mode)
node dist/cli.js ./carpeta --batch -f json -t es,en,zh -m small   # batch: one JSON per file
```

| Option | Description | Default |
| --- | --- | --- |
| `-l, --language <code>` | `auto`, `es`, `en`, `zh` | `auto` |
| `-m, --model <id>` | `tiny`, `base`, `small` | `base` |
| `-f, --format <fmt>` | `srt`, `vtt`, `ass`, `json` | `srt` |
| `-t, --translate <langs>` | translate, comma-separated (`es,en,zh`) | — |
| `--vocals` | music mode: isolate the centre channel | — |
| `--burn <output>` | burn subtitles into the video (mp4) | — |
| `--batch` | process every media file in a directory | — |
| `-o, --output <path>` | output file or directory | next to the input |
| `--stdout` | print subtitles to stdout | — |

## Study JSON (stable contract)

`--format json` and `GET /api/jobs/:id/download?format=json` return the same document:

```json
{
  "version": 1,
  "language": "es",
  "durationMs": 12345,
  "cues": [
    {
      "startMs": 0,
      "endMs": 1500,
      "lines": ["Hola mundo"],
      "words": [{ "text": "Hola", "startMs": 0, "endMs": 500 }],
      "pinyin": "nǐ hǎo shì jiè"
    }
  ],
  "translations": {
    "zh": { "cues": [ { "startMs": 0, "endMs": 1500, "lines": ["你好，世界"], "words": [], "pinyin": "nǐ hǎo, shì jiè" } ] }
  }
}
```

- `words` is always an array (empty when there are no word timings).
- `pinyin` appears only for Chinese (`zh*`) cues and Chinese translations.
- `translations` includes every translation that is done.
- SRT/VTT/ASS are unchanged.

**Per-line audio clips:** `GET /api/jobs/:id/clip?startMs=…&endMs=…` → `audio/mp4` (m4a), max 120 s, cut from the uploaded media. Perfect for flashcards with audio.

## Models

| Model | Speed | Quality | Best for |
| --- | --- | --- | --- |
| `tiny` | ⚡⚡⚡ | ★★ | quick drafts, CI, low-end machines |
| `base` | ⚡⚡ | ★★★ | everyday speech (default) |
| `small` | ⚡ | ★★★★ | difficult audio, accents, **music** |

Translation runs fully locally with OPUS-MT models (es↔en, en↔zh; es↔zh pivots through English) and translates cue **blocks** so context is preserved. Chinese output is converted to **simplified** characters (OpenCC) and annotated with **pinyin** (tone marks).

## How it works

```
audio/video ─► decode ─► loudness ─► VAD ─► [music mode] ─► Whisper ─► post-process ─► cue engine ─► SRT/VTT/ASS/JSON
                                                                                        ├─► translate (context blocks) ─► OPUS-MT
                                                                                        └─► export ─► ASS + ffmpeg/libass
```

| Algorithm | What it does | Basis |
| --- | --- | --- |
| Adaptive VAD | RMS + zero-crossing, percentile noise floor, hangover, gap merging | arXiv:2501.11378 |
| Hallucination guards | de-looping, bag-of-hallucinations (EN+ZH), drop tokens < 50 ms | arXiv:2501.11378, arXiv:2408.16589 |
| Timestamp refinement | median smoothing, monotonic repair, snapping to VAD edges | WhisperX, arXiv:2303.00747 |
| Conservative denoise | decision-directed Wiener, −15 dB floor, SNR-gated dry/wet | arXiv:2406.12699, arXiv:2201.06685 |
| Music mode | 80 Hz high-pass + centre-channel extraction (mid/side spectral masking) | center-channel extraction / stereo masking |
| Loudness | active-speech RMS to −20 dBFS, peak guard | ITU-R BS.1770, EBU R128 |
| Balanced wrapping | DP minimizes the longest line | broadcast practice |
| Reading speed | CPS caps (17 latin / 9 CJK), durations, gaps | Netflix TTSG, BBC guidelines |
| CJK typography | 16 chars/line, kinsoku, simplified normalization | W3C clreq, Netflix Chinese TTSG |
| Block translation | consecutive cues translated together, split back proportionally | WMT 2019 subtitling NMT |

## Measured quality (honest numbers)

On a deliberately hard test — a reggaeton track with dense instrumentation — compared against the published lyrics:

| Configuration | WER vs lyrics |
| --- | --- |
| `base` | 65.1% |
| `base --vocals` | 64.5% |
| `small` | 51.5% |
| `small --vocals` | 53.4% |

Takeaways: **model size is the dominant factor for sung audio**; music mode's DSP is measurable (≥ 6.8 dB side-channel attenuation, bass removal) but its ASR benefit depends on the mix. For songs, use `-m small --vocals`; for speech, the defaults are already strong. Lyrics comparison is a harsh metric (official lyrics include backing vocals, ad-libs and repetitions), but it is a useful relative gauge.

## API

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | service status |
| `GET` | `/api/models` | models, languages, fonts, default export style |
| `POST` | `/api/jobs?language=&model=&vocals=&filename=` | upload media (raw body) → `{ id }` |
| `GET` | `/api/jobs/:id` | status, progress, result, translations, exports |
| `PATCH` | `/api/jobs/:id/cues` | edit cue texts (order-based) |
| `POST` | `/api/jobs/:id/translate` | `{ "to": "zh" }` → local translation |
| `POST` | `/api/jobs/:id/export` | `{ "style": { ... } }` → burn subtitles into MP4 |
| `GET` | `/api/jobs/:id/download?format=srt\|vtt\|ass\|json[&lang=es]` | subtitles or study JSON |
| `GET` | `/api/jobs/:id/clip?startMs=&endMs=` | per-line audio clip (m4a) |
| `GET` | `/api/exports/:exportId` · `/download` | export status and MP4 |

## References

The engine adapts published research and broadcast standards:

**Speech recognition & robustness**
- Radford et al., *Robust Speech Recognition via Large-Scale Weak Supervision* (Whisper) — [arXiv:2212.04356](https://arxiv.org/abs/2212.04356)
- Barański et al., *Investigation of Whisper ASR Hallucinations Induced by Non-Speech Audio* (ICASSP 2025) — [arXiv:2501.11378](https://arxiv.org/abs/2501.11378) → VAD, de-loop, bag-of-hallucinations, greedy decoding, denoising null result
- Koenecke et al., *Careless Whisper: Speech-to-Text Hallucination Harms* (FAccT 2024) — [arXiv:2402.08021](https://arxiv.org/abs/2402.08021)
- *CrisperWhisper: Accurate Timestamps on Verbatim Speech Transcriptions* (Interspeech 2024) — [arXiv:2408.16589](https://arxiv.org/abs/2408.16589) → drop < 50 ms tokens
- Bain et al., *WhisperX* (Interspeech 2023) — [arXiv:2303.00747](https://arxiv.org/abs/2303.00747) → VAD + alignment

**Speech enhancement & audio conditioning**
- Delcroix et al., *How Bad Are Artifacts? Analyzing the Impact of Speech Enhancement Errors on ASR* — [arXiv:2201.06685](https://arxiv.org/abs/2201.06685)
- *Bridging the Gap: Integrating Pre-trained Speech Enhancement and Recognition* — [arXiv:2406.12699](https://arxiv.org/abs/2406.12699) → output alignment / dry-wet mixing
- Scalart & Filho, *Speech enhancement based on a priori signal to noise estimation* (ICASSP 1996) → decision-directed Wiener
- Boll, *Suppression of acoustic noise in speech using spectral subtraction* (IEEE TASSP 1979)
- Martin, *Noise power spectral density estimation based on optimal smoothing and minimum statistics* (IEEE TSAP 2001)
- ITU-R BS.1770 / EBU R128 → loudness normalisation principles

**Subtitles, typography & translation**
- Netflix Timed Text Style Guides ([English](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617), [Chinese](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215986007)) → CPS, chars/line, durations
- BBC Subtitle Guidelines — [bbc.co.uk/accessibility](https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/) → reading speed, line breaks
- W3C *Requirements for Chinese Text Layout* (clreq) — [w3.org/TR/clreq](https://www.w3.org/TR/clreq/) → kinsoku rules
- Tiedemann & Thottingal, *OPUS-MT — Building open translation services for the World* (EAMT 2020) → translation models
- *Customizing NMT for Subtitling* (WMT 2019) — [ACL W19-5209](https://aclanthology.org/W19-5209/) → block/context segmentation
- HuggingFace Whisper DTW implementation (`generation_whisper.py`) → median filtering of timestamps
- transformers.js issue [#1357](https://github.com/huggingface/transformers.js/issues/1357) → `chunk_length_s: 29` timestamp fix

**Tooling**: [OpenCC](https://github.com/nk2028/opencc-js) (traditional→simplified), [pinyin-pro](https://github.com/zh-lx/pinyin-pro) (tone-mark pinyin), [Transformers.js](https://github.com/huggingface/transformers.js), [libass](https://github.com/libass/libass) via ffmpeg.

> Note on NLLB-200: it is not enabled by default because published native-speaker evaluations found OPUS-MT more natural for zh↔en and it avoids a ~1 GB download; the translator interface is pluggable, so an NLLB engine can be added without touching the app.

## Development

Built with TDD: **348 unit tests** (Vitest, 81% line coverage on core/pipeline/server) and **11 Playwright E2E tests** that drive a real browser against the real models — transcribing, translating, editing cues, downloading study JSON, serving clips, toggling themes and exporting a real MP4 with burned-in subtitles.

```bash
npm test            # unit tests
npm run test:coverage
npm run test:e2e    # end-to-end (real models, real ffmpeg)
npm run fixtures    # regenerate speech fixtures (Windows TTS)
npm run dev         # dev server + Vite HMR
npm run typecheck
```

## Roadmap

- [ ] Subtitle editor improvements (split/merge cues, per-word fixes)
- [ ] Optional larger model (large-v3-turbo) for maximum quality
- [ ] NLLB-200 direct es↔zh engine (pluggable translator)
- [ ] Folder watching for batch mode
- [ ] Speaker diarization

## Español

**Subtítulos gratis, rápidos y 100% locales en español, inglés y mandarín.** Sin nube, sin cuentas, sin límites.

- **Subtítulos**: SRT/VTT/ASS/JSON con tipografía profesional y **pinyin** para chino.
- **Traducir**: entre español, inglés y mandarín con contexto (bloques de cues), sin nube.
- **Exportar video**: estilos con vista previa en vivo y quemado en MP4.
- **Para apps de estudio**: JSON estable, **modo batch por carpeta** y **clips de audio por línea** (`/clip?startMs&endMs`).
- **Modo música**: aísla la voz del acompañamiento para canciones.
- **Modo claro/oscuro** automático según el sistema.

```bash
npm install && npm run build && npm start   # http://localhost:8787
node dist/cli.js ./carpeta --batch -f json -t es,en,zh
```

## License

MIT © jdsalasca
