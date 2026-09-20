# SPEC — UI v2: three-button product, themes, style editor

You own ONLY `src/client/**`. Rebuild the UI on top of the existing one; keep it clean and modern.

## Product flow (make it obvious, button-driven)
1. **Choose a file** — dropzone (existing testids must keep working).
2. **Subtítulos** — big primary button (label exactly `Subtítulos`). Language + model selects live under a collapsible "Opciones" (defaults visible). Shows progress. When done, render the result (transcript, cues, media player, stats).
3. **Traducir** — after subtitles are done: target select (`Español`, `English`, `中文`) + big button `Traducir`. Shows progress and the translated preview. Downloads: translated SRT/VTT.
4. **Exportar video** — after subtitles are done: style editor + live preview + big button `Exportar video`. Shows progress; when done, a `Descargar video` link.

Downloads (original): **SRT is the primary, prominent button** (most-used format), plus VTT and ASS (secondary).

## Theme (light/dark)
- `<html data-theme="light|dark">`; default = `window.matchMedia('(prefers-color-scheme: dark)')`.
- Toggle button `data-testid="theme-toggle"` (icon sun/moon), persists choice in `localStorage['free-subs-theme']`, and keeps following the system when the user has not chosen explicitly.
- Define all colors as CSS variables for both themes; check contrast.

## Language
UI copy in **Spanish** (button labels exactly as above). Short, simple, no jargon.

## API (contract in docs/specs/api-v2.md)
- Transcribe: `POST /api/jobs?language=&model=&filename=` (raw file body), then poll `GET /api/jobs/:id` every 800 ms.
- Translate: `POST /api/jobs/:id/translate` `{to}` → poll `GET /api/jobs/:id` until `translations[to].status` is `done`/`error`.
- Export: `POST /api/jobs/:id/export` `{style}` → `{exportId}` → poll `GET /api/exports/:exportId` until done.
- Downloads: `/api/jobs/:id/download?format=srt|vtt|ass` and `&lang=<to>` for translated subs; `/api/exports/:exportId/download` for the video.
- `GET /api/models` now also returns `fonts: string[]` and `defaultStyle: SubtitleExportStyle` — use them for the editor (fallback to a small hardcoded list if missing).

## Style editor (export)
Controls (all with the testids below): font family (select from `/api/models` fonts), font size (24–72), bold (checkbox), text color, outline color, outline width (0–6), shadow (0–4), position (`Abajo`/`Medio`/`Arriba`), vertical margin (0–200), background box (checkbox) + background color + opacity (0–100%).

**Live preview**: over the media player (or a 16:9 placeholder), render the first cue text as an overlay div (`data-testid="preview-overlay"`) using the chosen font/size/colors/outline/position so the user sees exactly what they will get. Scale font size for the preview area (e.g. `fontSize * previewWidth / 1920`).

## Frozen testids (E2E contract — do not rename)
Existing: `dropzone`, `file-input`, `language-select`, `model-select`, `transcribe-button`, `status`, `progress`, `status-done`, `transcript`, `media-player`, `active-cue`, `download-srt`, `download-vtt`, `error`, `copy-srt`, `retry-button`.
New: `theme-toggle`, `translate-target`, `translate-button`, `translate-status`, `translate-done`, `translated-transcript`, `download-translated-srt`, `download-translated-vtt`, `download-ass`, `export-font`, `export-font-size`, `export-bold`, `export-color`, `export-outline-color`, `export-outline-width`, `export-shadow`, `export-position`, `export-margin`, `export-background`, `export-background-color`, `export-background-opacity`, `export-button`, `export-status`, `export-done`, `download-video`, `preview-overlay`.

## Acceptance
- `npx vite build` succeeds.
- `npx tsc --noEmit 2>&1 | Select-String "src/client"` → clean.
- Runtime validation with a mocked `/api` (you may write a throwaway script, do not commit it): transcribe flow works; theme toggle flips `data-theme`; translate flow reaches `translate-done`; export flow reaches `export-done`; preview overlay renders.
- Report files, testids, build evidence, deviations.
