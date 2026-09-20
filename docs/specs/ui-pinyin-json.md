# SPEC — UI: pinyin display + JSON download

You own ONLY `src/client/**`.

## Requirements
1. **"Descargar JSON"** link next to the subtitle downloads: `data-testid="download-json"`,
   href `/api/jobs/:id/download?format=json`, `download` attribute, Spanish label "Descargar JSON (estudio)".
2. **Pinyin display**: a checkbox `data-testid="pinyin-toggle"` labelled "Mostrar pinyin",
   visible when at least one displayed cue (original result or any translation) has a `pinyin` field.
   When enabled, show the pinyin under the cue text in the cue lists (original and translated),
   in a smaller muted line. `SubtitleCue.pinyin?: string` is already in the frozen types.
3. Keep every existing testid and the Spanish copy style; keep the UI simple.

## Acceptance
- `npx vite build` succeeds; `npx tsc --noEmit 2>&1 | Select-String "src/client"` clean.
- Mocked runtime validation (temporary script, do not commit): the JSON link points to `format=json`;
  the pinyin toggle appears when a cue has pinyin and hides/shows the pinyin lines.
- Report: files, evidence, deviations.
