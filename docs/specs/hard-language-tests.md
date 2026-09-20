# SPEC — Hard language tests + fixes (TDD, es/en/zh)

You own ONLY:
- `tests/unit/language/**` (new test files)
- Fixes (only where tests fail): `src/core/text.ts`, `src/pipeline/language.ts`, `src/pipeline/pinyin.ts`, `src/pipeline/zh.ts`

Do NOT touch anything else. All existing tests must stay green.

## Workflow
TDD: write the failing tests FIRST, run them (red), fix the code until green. Do not rewrite modules;
make the smallest correct change. Public signatures must not change.

## Required hard cases (minimum)

### 1. Pinyin heteronyms (context-aware) — `src/pipeline/pinyin.ts`
`toPinyin` must resolve polyphonic characters by context:
- 银行 → `yín háng` · 行走 → `xíng zǒu` · 音乐 → `yīn yuè` · 快乐 → `kuài lè` · 长江 → `cháng jiāng` · 长大 → `zhǎng dà`
If `pinyin-pro`'s default misses these, enable its context-aware mode (e.g. `heteronym`/`segment` options) and re-test.

### 2. Mixed scripts (code-switching) — `src/core/text.ts`, `src/pipeline/zh.ts`
- `toPinyin('我用iPhone看电影')` keeps `iPhone` intact.
- `tokenize('我用iPhone看电影', 'zh')` treats the latin run as ONE token.
- `normalizeChineseText('我 用 iPhone 看 电影')` removes spaces between CJK chars but keeps single spaces around latin runs.

### 3. CJK kinsoku wrapping — `src/core/wrap.ts` (test only; fix in text if needed)
- A long Chinese string wraps to ≤ 2 lines of ≤ 16 chars.
- No line starts with `、。！？：；」』）】》` and none ends with `「『（【《`.
- Latin+CJK mixed cue wraps without breaking inside the latin word.

### 4. Sentence splitting (hard punctuation) — `src/core/text.ts`
- es: `'Sr. García llegó. ¿Qué hora es?'` → 2 sentences (no split on `Sr.`); `'Cuesta 3.14 euros. Es todo.'` → 2 (no split on the decimal).
- en: `'Mr. Smith left. Dr. Who?'` → 2 (no split on `Mr.`/`Dr.`).
- zh: `'你好！世界？再见；'` → 3 (CJK terminators are unconditional boundaries).

### 5. Language detection — `src/pipeline/language.ts`
- `detectLanguageFromText('¿Qué hora es?')` → `es` · `'What time is it?'` → `en` · `'现在几点？'` → `zh`
- mixed but Spanish-dominant (`'¿What hora es?'`) → `es` (or a documented rule, tested)
- numbers only (`'123 456'`) → `unknown` · `''` → `unknown`

### 6. Numbers untouched — `src/core/text.ts`
`normalizeForSubtitles` must not mangle `'3.14'`, `'1.234,56'`, `'2026年'`, `'50%'`, `'$1,200'`.

### 7. Visible length — `src/core/text.ts`
`visibleLength('hola')` = 4 · `visibleLength('你好')` = 2 · emoji counts as 1 · combining accents do not add extra chars.

## Acceptance
- `npx vitest run tests/unit/language` → all green (≥ 30 tests).
- Full `npx vitest run` stays green; `npx tsc --noEmit` clean in your files.
- Report: files, test count, red→green evidence per fix, deviations.
