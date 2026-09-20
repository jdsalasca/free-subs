# SPEC — Subtitle editor + start over (UI)

You own ONLY `src/client/**`.

## Goal
Let end users fix transcription mistakes before translating or exporting.

## Requirements

1. **"Editar subtítulos" section** (inside/next to the result, visible once subtitles are ready):
   - One input per cue, prefilled with the cue text (lines joined with a space): `data-testid="cue-input"` (one per cue, in order).
   - Button **"Guardar cambios"** `data-testid="save-cues"` → `PATCH /api/jobs/:id/cues` with body `{ "cues": [{ "text": "..." }] }` (array in cue order; the server re-wraps and regenerates SRT/VTT, clears stale translations and returns the updated `JobRecord`).
   - Button **"Descartar"** `data-testid="reset-cues"` reverts the inputs to the last saved text.
   - Status line `data-testid="editor-status"`: "Guardando…", "Guardado ✓", or the server error message.
   - After a successful save: update the whole job state from the response (transcript, cue list, stats and downloads reflect the new text; the translate section returns to its initial state because translations were cleared).
   - Disable the save button while saving or when nothing changed.
2. **"Empezar de nuevo"** button `data-testid="start-over"` (visible once a file is selected) → resets the app to its initial state: clears the file, job, results, editor, translate and export panels.
3. Keep every existing testid working. UI copy in Spanish.

## Acceptance
- `npx vite build` succeeds; `npx tsc --noEmit 2>&1 | Select-String "src/client"` clean.
- Runtime validation with a mocked `/api` (temporary script, do not commit): edit a cue → save → transcript and SRT link reflect the new text; invalid/empty edit shows the error in `editor-status`; "Empezar de nuevo" resets everything; all frozen testids still render.
- Report files, full testid list, build evidence, deviations.
