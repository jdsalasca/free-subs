# API v3 — study JSON + clips (frozen contract)

## Download (extended)
```
GET /api/jobs/:id/download?format=srt|vtt|ass|json[&lang=es]
```
- `json` returns the **stable study document** (`Content-Type: application/json; charset=utf-8`,
  filename `<base>.study.json`):

```json
{
  "version": 1,
  "language": "es",
  "durationMs": 12345,
  "cues": [
    { "startMs": 0, "endMs": 1500, "lines": ["Hola mundo"], "words": [{ "text": "Hola", "startMs": 0, "endMs": 500 }], "pinyin": "nǐ hǎo shì jiè" }
  ],
  "translations": {
    "zh": { "cues": [ { "startMs": 0, "endMs": 1500, "lines": ["你好，世界"], "words": [], "pinyin": "nǐ hǎo, shì jiè" } ] }
  }
}
```
- `words` is always an array (empty when there are no word timings).
- `pinyin` is present only for Chinese (`zh*`) cues and Chinese translations.
- `translations` includes every translation that is done (may be `{}`).
- SRT/VTT/ASS behaviour is unchanged; `lang` selects a done translation.

## Clip (new)
```
GET /api/jobs/:id/clip?startMs=<int>&endMs=<int>
```
- `200` → `audio/mp4` (m4a) clip cut from the uploaded media with ffmpeg (max 120 s per request).
- `400` invalid range / missing media / clip longer than 120 s / beyond the media duration.
- `404` unknown job · `409` transcription not ready · `500` ffmpeg missing or failed.

## Batch (CLI)
```
node dist/cli.js <folder> --batch --format json [--translate es,en,zh] [--vocals] [-m small] [-o outdir]
```
- Writes one `<basename>.json` study document per media file (plus `<basename>.<lang>.<format>` when a
  subtitle format is used with `--translate`).
- Continues after per-file errors and exits with code 1 if any file failed.
