# SPEC — Phonetics: IPA (en/es) + tone-aware pinyin (zh)

You own ONLY:
- `src/pipeline/ipa.ts` (new)
- `src/pipeline/pinyin.ts` (modify: third-tone sandhi)
- `src/pipeline/study.ts` (modify: include `ipa` in study cues)
- `src/pipeline/transcribe.ts` (small additive change: annotate en/es cues with IPA)
- `tests/unit/pipeline/{ipa,sandhi}.test.ts` (new)
- `package.json` / `package-lock.json` (add `cmu-pronouncing-dictionary`)

Do NOT touch `src/core` (`SubtitleCue.ipa?: string` is already added and frozen), `src/server`, `src/cli.ts`, `src/client`, existing tests.

## Research basis (2026)
- English: CMUdict (134k words, ARPAbet) + ARPAbet→IPA mapping with stress marks; first variant for homographs (documented).
- Spanish: near-phonemic orthography → ordered rule-based G2P + stress rules (accent wins; vowel/n/s-final → penultimate, else final).
- Mandarin: pinyin-pro handles 一/不 sandhi; third-tone sandhi is a right-to-left post-pass within prosodic groups.
- Neural G2P / MMS alignment / GOP scoring are NOT usable offline in TS (documented in docs/research later).

## ipa.ts
```ts
export function toIpa(text: string, lang: string): string;            // per-word IPA joined by spaces, punctuation preserved
export function annotateCuesWithIpa(cues: SubtitleCue[], lang: string): SubtitleCue[]; // returns copies with `ipa`
```
Rules:
- `lang` `en*` → CMUdict lookup on the lowercased word (strip punctuation, keep it in output); map ARPAbet→IPA:
  AA→ɑ, AE→æ, AH0→ə, AH1/2→ʌ, AO→ɔ, AW→aʊ, AY→aɪ, EH→ɛ, ER0→ɚ, ER1/2→ɝ, EY→eɪ, IH→ɪ, IY→i, OW→oʊ, OY→ɔɪ, UH→ʊ, UW→u, CH→tʃ, DH→ð, JH→dʒ, NG→ŋ, SH→ʃ, TH→θ, ZH→ʒ, Y→j; stress 1→`ˈ`, 2→`ˌ` placed before the syllable of that vowel (approximate placement before the vowel group is fine).
- `lang` `es*` → rule-based: ordered digraph rules first (`qu→k`, `gu(e|i)→g`, `g(e|i)→x`, `c(e|i)→s`, `z→s`, `ll→ʝ`, `rr→r`, `ch→tʃ`, `ñ→ɲ`, `h→∅`, `v→b`, `y` onset→ʝ / coda→i, `x→ks`), then vowels/consonants; stress: written accent wins, else vowel/n/s-final → penultimate, else final; mark `ˈ` before the stressed vowel.
- Unknown words: return the original word unchanged (no throw), document the fallback.
- Empty input → empty string; punctuation-only tokens stay as-is.

## pinyin.ts — third-tone sandhi
- After the existing conversion, apply a right-to-left pass **within prosodic groups** (split on punctuation and whitespace): in a run of consecutive third-tone syllables, all but the last become second tone.
  - `你好` → `ní hǎo` · `展览馆` → `zhánlánguǎn` · `我很好` → `wó hén hǎo`
- Never apply across punctuation or cue boundaries; do not change 一/不 handling (pinyin-pro already does it).
- Keep the public signature of `toPinyin` unchanged.

## study.ts / transcribe.ts (additive)
- `StudyCue` gains `ipa?: string`; include it for `en*`/`es*` cues and translations.
- `transcribe.ts`: when the language is `en*`/`es*`, annotate final cues with IPA (like the existing zh pinyin step).

## Tests (TDD: red first, ≥ 20)
- ipa en: `hello`→`həˈloʊ`, `world`→`ˈwɝld`, `knight`→`naɪt`, `computer`→`kəmˈpjutɚ`, punctuation preserved, unknown word unchanged, empty input.
- ipa es: `hola`→`ˈola`, `queso`→`ˈkeso`, `guerra`→`ˈgera`, `llave`→`ˈʝaβe` (or your documented rule output), `niño`→`ˈniɲo`, `canción`→`kanˈsjon`, `árbol`→`ˈaɾbol`, punctuation preserved.
- sandhi: the three examples above + no change across punctuation + single third tone unchanged.
- study: en cue gets `ipa`, zh cue gets `pinyin`, `words` still arrays.

## Acceptance
- `npx vitest run tests/unit/pipeline` → green; full suite green.
- `npx tsc --noEmit` clean in your files.
- Report: files, test count, red→green evidence, documented decisions (homographs, allophones), deviations.
