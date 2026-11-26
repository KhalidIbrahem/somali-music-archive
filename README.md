# QaraamiGen

Somali qaraami is an oud-led song tradition passed on by ear, with almost no
written scores and a five-note scale that is not tuned like a piano. QaraamiGen
is the computation to study it: transcription that writes a recording out as
sheet music with its measured scale, music-generation models fine-tuned on
Somali recordings, and an evaluation that reports what listeners hear next to
what the loss says. Everything a reviewer needs opens in a browser with no
login and no setup.

**Start here: https://www.qaraamigen.com/portfolio** (ten minutes)

|         | link                                                 | what you get                                                                                                              |
| ------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Demo    | [/transcribe](https://www.qaraamigen.com/transcribe) | a recording to sheet music in your browser: one click on a sample, or your own file or microphone; MusicXML, MIDI, PDF    |
| Scores  | [/scores](https://www.qaraamigen.com/scores)         | three automatic transcriptions with playback, PCS, and the tuning findings in plain words                                 |
| Results | [/results](https://www.qaraamigen.com/results)       | one figure, one table                                                                                                     |

Built by Khalid Ibrahim, Minneapolis. Dedicated to Ahmed Ali Egal, whose
intonation anchors the analysis.

## Results

Every number is written by a script from the run files in this repository
(`apps/ai-service/scripts/results_summary_build.py`,
`transcription_showcase_build.py`).

**Generation.** Fine-tuned models predict unseen Somali songs better than the
models they start from, and the gain grows with model size.

| model                                | held-out gain, nats (95 % interval) | unseen songs |
| ------------------------------------ | ----------------------------------- | ------------ |
| MusicGen-medium + LoRA               | +0.102 [0.078, 0.123]               | 27           |
| MusicGen-large + LoRA                | +0.128 [0.104, 0.152]               | 27           |
| MusicGen-medium + LoRA, whole corpus | +0.076 [0.069, 0.084]               | 64           |

The ear is a harder judge: in blind paired tests one listener mostly answered
"neither", and only the large model was preferred clearly. Both results are on
[/results](https://www.qaraamigen.com/results). A study with Somali musicians
is open at [/study](https://www.qaraamigen.com/study).

**Transcription.** 91 recordings transcribed automatically, none failed.

| source           | recordings | PCS, median | notes off the scale |
| ---------------- | ---------- | ----------- | ------------------- |
| solo oud (kaban) | 28         | 0.96        | 5 %                 |
| band with voice  | 63         | 0.74        | 35 %                |

PCS (pentatonic conformity score) is the share of the melody that lands on the
recording's own five-note scale. On the public vocadito benchmark the browser
transcriber reaches a note F1 of 0.69 against 0.74 between two human
annotators, 93 % of human agreement (`docs/eval/QORMADA_EVAL.md`). Across the
pool the minor seventh sits about 8 cents sharp of piano tuning on both solo
oud and band recordings. No Somali recording has been corrected by ear yet.

**The finding behind the fine-tuning.** For two months LoRA fine-tuning of
MusicGen looked like a clean negative result. The cause was a defect in the
`transformers` MusicGen implementation: the hub configs turn on dropout that
the released checkpoints were never trained with, so training optimises a path
that generation never uses (train loss 9.74 against eval loss 4.05 on identical
weights). With it removed, every checkpoint beats its base
(`docs/eval/EVALUATION.md`).

## Run it

Node 22. This starts the public site locally, with the same pages as above:

```bash
git clone https://github.com/KhalidIbrahem/somali-music-archive.git
cd somali-music-archive
npm install
NEXT_PUBLIC_AI_SERVICE_MODE=off npm run dev --workspace @sma/web
```

Then open http://127.0.0.1:3000/portfolio. Training, evaluation and live
generation need an Apple-silicon Mac, a Python 3.11 environment with torch,
transformers and peft, and the recordings, which are not distributed
(`docs/GENERATION_SETUP.md`, `services/musicgen-api/`).

## Open source

- [huggingface/transformers #49094](https://github.com/huggingface/transformers/issues/49094):
  MusicGen hub configs set decoder dropout to 0.1 although the checkpoints were
  trained with 0; `train()` doubles the loss and silently breaks fine-tuning.
- [huggingface/transformers #49095](https://github.com/huggingface/transformers/issues/49095):
  `forward(labels=...)` raises on every released MusicGen checkpoint.

Each has a one-minute reproducer, and both still reproduce on the main branch
as of 2026-11-21 (`docs/oss/UPSTREAM_STATUS.md`,
`docs/oss/musicgen_main_check.py`). The fix used here is
`zero_functional_dropout()` in `apps/ai-service/scripts/scale_train.py`.

Datasets and a demo Space are on Hugging Face:
[khalidibra/qaraamigen](https://huggingface.co/spaces/khalidibra/qaraamigen).

## What is in the repository

| path                                                        | what                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `apps/web/`                                                 | the public site: transcriber, listening pages, scores, results, studio (Next.js)    |
| `apps/web/lib/qormada/`                                     | the in-browser transcription pipeline: pitch, scale fit, rhythm, MusicXML           |
| `apps/ai-service/scripts/phase2_train.py`, `scale_train.py` | the fixed LoRA harness (MusicGen small, medium, large)                              |
| `apps/ai-service/scripts/pcs.py`, `pentatonic.py`           | Pentatonic Conformity Score and tonic/scale detection                               |
| `apps/ai-service/scripts/eval_report.py`, `scale_eval.py`   | the tables and figures in `docs/eval` from `runs/` and `data/`                      |
| `docs/eval/`                                                | evaluation, scaling report, transcription pool report, restoration, model cards     |
| `services/musicgen-api/`                                    | local inference API: adapters hot-swapped, `/generate`, `/pcs`                      |
| `runs/`                                                     | every fine-tuning run's config, loss curve and held-out results (no weights, audio) |
| `docs/ARCHITECTURE.md`, `docs/README-platform.md`           | the research system and the platform (web, API, mobile)                             |

## Rights

No archival recording is distributed, served publicly, or in git. The Harvard
collection (Maryan "Aryette" Omar Ali Collection, AWM Spec Coll 103) is not
cleared for redistribution, and models trained on it are reported as numbers
only. Every clip on the site is AI model output or synthesised audio that
passes the build-time check in
`apps/web/scripts/check-public-audio-rights.mjs`. Details:
`docs/DATA_PROVENANCE.md`; model cards: `docs/eval/MODEL_CARD_*.md`.

## License and citation

Code: Apache License 2.0 (`LICENSE`). The license covers the code only, not
recordings, weights or generated audio.

```bibtex
@software{ibrahim_qaraamigen_2026,
  author  = {Ibrahim, Khalid},
  title   = {QaraamiGen: computational ethnomusicology tools for Somali qaraami music},
  year    = {2026},
  version = {0.1.0},
  url     = {https://github.com/KhalidIbrahem/somali-music-archive}
}
```

`CITATION.cff` carries the same record.

Khalid Ibrahim · Minneapolis, MN
