# API contract v2 (frozen)

Base URL: same origin. All JSON unless noted.

## Existing
- `GET /api/health` → `{ status, name, version }`
- `GET /api/models` → `{ models: ['tiny','base','small'], languages: ['auto','es','en','zh'], fonts: string[], defaultStyle: SubtitleExportStyle }`
- `POST /api/jobs?language=&model=&filename=` (raw body = media bytes) → `202 { id }`
- `GET /api/jobs/:id` → `JobRecord` (includes `translations` and `exports` maps when present)
- `GET /api/jobs/:id/download?format=srt|vtt|ass[&lang=es]` → subtitle file
  - `lang` optional: returns that translation when done; 404 if missing/not ready.
  - `ass` uses `DEFAULT_EXPORT_STYLE` and 1920x1080 canvas.

## New — translation
- `POST /api/jobs/:id/translate` JSON `{ "to": "es"|"en"|"zh" }` → `202 { translationId: "<to>" }`
  - 404 unknown job; 409 when job is not done yet; 400 invalid target or target equals source language; 202 re-runs if a previous attempt errored (idempotent when done: returns existing).
  - Job must stay `done`; the translation runs in background and updates `job.translations[to]` with `status`, `progress`, then `srt`, `vtt`, `text`.
- `GET /api/jobs/:id` shows `translations`.

## New — video export (burn-in)
- `POST /api/jobs/:id/export` JSON `{ "style": SubtitleExportStyle }` (partial allowed, merged over `DEFAULT_EXPORT_STYLE`) → `202 { exportId }`
  - 404 unknown job; 409 job not done; 400 no media or invalid style values; 500 with clear message if ffmpeg/libass unavailable.
  - Background: writes ASS next to the media, burns in with ffmpeg, updates `job.exports[exportId]` progress; output `<jobid>-<exportId>.mp4`.
- `GET /api/exports/:exportId` → `ExportRecord` (404 unknown)
- `GET /api/exports/:exportId/download` → `video/mp4` attachment (404 if not done)

## Errors
Always `{ "error": "message" }` with proper status codes. Validation before work starts.
