# SPEC — `src/client` (React + TypeScript UI)

You own ONLY `src/client/**` (everything inside). Do NOT touch configs, server, core, tests.

Stack: React 19 + Vite (root `src/client`, already configured), plain CSS (no UI libs). Import domain types with `import type { JobRecord, TranscriptionResult, LanguageCode, ModelId } from '../core/types';` (types only, no runtime import).

## Files
- `index.html` — `<div id="root">`, title `Free Subs`, meta viewport, description.
- `main.tsx` — createRoot + render `<App/>`, imports `./styles.css`.
- `api.ts` — `createJob(file: File, opts: { language: LanguageCode; model: ModelId }): Promise<{ id: string }>` (POST `/api/jobs?language=…&model=…&filename=…`, body = raw File), `getJob(id): Promise<JobRecord>` (GET), `downloadUrl(id, format: 'srt'|'vtt'): string`.
- `App.tsx` + small components (Dropzone, Controls, ProgressPanel, ResultPanel) — split files if cleaner, all inside `src/client/`.
- `styles.css` — modern dark theme, responsive, CSS variables, accessible contrast, focus states. No external fonts.

## UX / behavior
1. Dropzone: drag&drop + click to pick. Accept `audio/*,video/*,.wav,.mp3,.mp4,.mkv,.mov,.m4a`. Shows file name + size. `data-testid="dropzone"` and hidden `<input type="file" data-testid="file-input">`.
2. Controls: language `<select data-testid="language-select">` (auto=Auto detect, es=Español, en=English, zh=中文), model `<select data-testid="model-select">` (tiny="Tiny — fastest", base="Base — balanced", small="Small — most accurate"), button `<button data-testid="transcribe-button">Transcribe</button>` (disabled until file chosen).
3. On click: POST, then poll `getJob` every 800 ms. Show stage + percent in `<div data-testid="status">` and a progress bar `data-testid="progress"` (`role="progressbar"`, `aria-valuenow`).
4. When status === 'done': render `<div data-testid="status-done">` (visible ONLY in done state), result panel:
   - `<div data-testid="transcript">` with the full text (join cue lines with spaces/newlines).
   - stats: detected language, duration (mm:ss), cue count, avg/max CPS.
   - cue list: time range + text per cue; when a media file was uploaded, render `<audio controls>`/`<video controls>` with `data-testid="media-player"` and highlight the active cue (`data-testid="active-cue"`) using `timeupdate`.
   - download links: `<a data-testid="download-srt" download href={downloadUrl(id,'srt')}>` and `<a data-testid="download-vtt" …>`, plus a "Copy SRT" button (clipboard).
5. On error: `<div data-testid="error">` with message; allow retry.
6. All UI text in English (short Spanish hint under the title is fine: "Subtítulos gratis, rápidos y locales — sin subir tu archivo a ningún servidor").

## Acceptance
- `npx vite build` succeeds (run it as evidence; do not run `npm run build`).
- `npx tsc --noEmit 2>&1 | Select-String "src/client"` → no errors in your files.
- Report the exact `data-testid` list you implemented (it is an E2E contract).
