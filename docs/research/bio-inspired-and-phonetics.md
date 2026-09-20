# Research notes — bio-inspired acoustics, streaming subtitles and phonetics

This document records the research behind the algorithms shipped in `free-subs` (2023–2026 sources).
It also records what we deliberately did **not** build, and why.

## 1. The bat question — honest verdict

**There is no system that translates bat echolocation (or bat vocalizations) into human language**, and no
demonstrated bat grammar. Echolocation is a *perception* system (delay/angle ranging), not a linguistic
code; "translating bats" headlines are metaphor. No bat-biosonar signal processing is used in any speech
or subtitle pipeline. See: [Bat biosonar model (SCAT)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7888678),
[bat echolocation bionics review 2025](https://link.springer.com/article/10.1186/s12983-025-00573-3).

What *does* exist, and is genuinely bat-like (active acoustic sensing):

| System | What it does | Ceiling |
| --- | --- | --- |
| [EchoSpeech (CHI 2023)](https://dl.acm.org/doi/fullHtml/10.1145/3544548.3580801) | Sonar on eyeglasses reads silent speech | ~31 commands, ~5% cross-session WER |
| [SottoVoce (CHI 2019)](https://dl.acm.org/doi/fullHtml/10.1145/3290605.3300376) | Ultrasound under the chin → synthesized speech | Proof of concept |
| IR-UWB / FMCW radar SSI | Contactless lip/jaw sensing | 81–91% on small vocabularies |
| [mmWave-Whisper (2024)](https://arxiv.org/html/2410.17457) · [mmSpeech (2025)](https://arxiv.org/html/2511.06205v1) | Earpiece/wall vibrations → audio → ASR | 44.7% word accuracy / 34.2 WER |
| sEMG silent speech + LLM (2024) | Non-invasive open-vocabulary SSI | <15% WER (electrodes, not acoustics) |

Google Soli is 60 GHz radar for gestures/vital signs — **not** speech
([Soli](https://research.google/blog/soli-radar-based-perception-and-interaction-in-pixel-4)).

**Decision:** we do not ship a bat-inspired feature; there is no science to ship. We invest in what is
measurable: VAD robustness, streaming policies, and phonetics.

## 2. Bio-inspired ASR — why we skipped it

- **Gammatone/cochlear filterbanks**: JS implementations exist, and 2024 work shows robustness gains
  ([DoGSpec, arXiv:2409.16399](https://arxiv.org/html/2409.16399v1)), but **every production ASR model
  (Whisper, wav2vec2, MMS) consumes log-mel features**. No model consumes gammatone.
- **Spiking neural networks**: strong results ([IML-Spikeformer, arXiv:2507.07396](https://arxiv.org/abs/2507.07396):
  6.0% WER AiShell-1) but PyTorch/neuromorphic only; no JS runtime.
- **Auditory attention decoding (EEG)**: hardware-bound, lab protocols, irrelevant to subtitles.

## 3. Streaming subtitles — what we implemented

The live engine (`src/live/`) follows the strongest CPU-feasible design from the literature:

- **LocalAgreement-2** ([Macháček et al., IJCNLP-AACL 2023, arXiv:2307.14743](https://arxiv.org/abs/2307.14743)):
  only the longest common prefix of two consecutive hypotheses is committed. Latency ≈ 2 × min-chunk + compute.
- **min-chunk 1.0 s**, VAD end-of-speech 0.6 s, force-cut at 7 s (Netflix timing rules), ASR window ≤ 15 s,
  hard cap 29 s (transformers.js [issue #1357](https://github.com/huggingface/transformers.js/issues/1357)).
- **Translate finals only** (WhisperLiveKit `--translate-on-complete` pattern): full-sentence context,
  append-only output, OPUS-MT adds ~30–150 ms per sentence on CPU.
- **True streaming (Simul-Whisper/AlignAtt, [arXiv:2406.10052](https://arxiv.org/abs/2406.10052))** requires
  decoder cross-attention access that ONNX/transformers.js does not expose → documented as future work.

Acceptance targets: partials ≤ 3.5 s behind speech; final cue → translation ≤ ~300 ms.

## 4. Phonetics — what we implemented

- **English IPA**: [CMUdict](https://github.com/cmusphinx/cmudict) (134k words) + ARPAbet→IPA mapping with
  stress marks. Homographs use the first variant (documented).
- **Spanish IPA**: rule-based G2P (near-phonemic orthography) with ordered digraph rules, tap/trill and
  spirantization allophones, and stress rules (accent wins; vowel/n/s-final → penultimate, else final).
  Reference: [Spanish allophony](https://www.staff.ncl.ac.uk/i.e.mackenzie/allophonr.htm),
  [ipa-dict](https://github.com/open-dict-data/ipa-dict).
- **Mandarin**: [pinyin-pro](https://github.com/zh-lx/pinyin-pro) (一/不 sandhi built in) + our right-to-left
  **third-tone sandhi** pass within prosodic groups: `你好 → ní hǎo`, `展览馆 → zhán lán guǎn`.
- **Not usable offline in TS** (documented, not built): neural G2P
  ([SoundChoice, arXiv:2207.13703](https://arxiv.org/abs/2207.13703)), MMS forced alignment
  ([arXiv:2305.13516](https://arxiv.org/abs/2305.13516), Python), GOP pronunciation scoring
  (no offline JS implementation exists).

## 5. Core references (algorithms shipped)

- Whisper — [arXiv:2212.04356](https://arxiv.org/abs/2212.04356)
- Whisper hallucinations & VAD/deloop/BoH — [arXiv:2501.11378](https://arxiv.org/abs/2501.11378) (ICASSP 2025)
- Careless Whisper — [arXiv:2402.08021](https://arxiv.org/abs/2402.08021)
- CrisperWhisper (drop <50 ms tokens) — [arXiv:2408.16589](https://arxiv.org/abs/2408.16589)
- WhisperX (VAD + alignment) — [arXiv:2303.00747](https://arxiv.org/abs/2303.00747)
- Speech-enhancement artifacts harm ASR — [arXiv:2201.06685](https://arxiv.org/abs/2201.06685)
- Output alignment / dry-wet mixing — [arXiv:2406.12699](https://arxiv.org/abs/2406.12699)
- OPUS-MT — [EAMT 2020](https://aclanthology.org/2020.eamt-1.21/)
- Subtitling NMT (block segmentation) — [WMT 2019](https://aclanthology.org/W19-5209/)
- Netflix TTSG · BBC subtitle guidelines · W3C clreq (typography rules)
