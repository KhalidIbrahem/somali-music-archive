# QaraamiGen

An open-source computational ethnomusicology project on Somali qaraami, the
oud-led song tradition recorded on cassette between the 1950s and the 1990s.
It is nonprofit academic research with three goals: a transcription benchmark
for Somali music, generation models fine-tuned on archival recordings, and a
pentatonic conformance metric for judging whether generated or transcribed
material stays inside the tradition's scale system. The recordings themselves
are never distributed. The code, the method, and the measurements are.
Built by Khalid Ibrahim, Minneapolis.
Dedicated to Ahmed Ali Egal, whose intonation anchors the analysis.

## The five-minute path for a reviewer

1. **What was found (2 min).** Read `docs/eval/EVALUATION.md` (headline table
   and "the story in four steps"). Short form: LoRA-adapting MusicGen-small on
   two Somali corpora looked like a clean negative for two months; it was a
   training-harness defect (the decoder's 37 functional-dropout attributes,
   active in training, absent in evaluation, gave train loss 9.74 against eval
   4.05 on identical weights). With the defect removed, every checkpoint on
   both corpora beats the base model on unseen songs (oud 4.5132 → 4.4785;
   Harvard 4.6262 → 4.5501 validation, 4.8363 → 4.7468 test), and the adapters
   produce 64 to 68 % more trackable melody while learning the cassettes'
   ~25-cent tuning drift. Scaling to medium and large gives statistically
   supported gains of 0.102 and 0.128 nats on held-out songs
   (`docs/eval/SCALING_REPORT.md`). Figures: `docs/figures/ft1` to `ft7`.
2. **Hear it (2 min).** With access to the demo (Tailscale, invite only):
   open `http://100.65.5.120:8765/demo`, paste the token, pick an adapter,
   press *Generate both*. Same prompt and seed, base model on the left,
   fine-tuned on the right, pentatonic-conformity score and voiced fraction
   under each. A recorded walkthrough follows `docs/demo/DEMO_SCRIPT.md`.
3. **Check the rights (1 min).** `docs/DATA_PROVENANCE.md`. No recording from
   any corpus is distributed, served publicly, or in git; every model output is
   labelled with the adapter's corpus and a non-distribution line. Model
   cards: `docs/eval/MODEL_CARD_oud.md`, `docs/eval/MODEL_CARD_harvard_raw.md`.

Reproduce a number yourself (needs the non-distributed processed clips on
disk): `scripts/reproduce_oud_smoke.sh` re-runs the training smoke test and
checks the harness invariants and the base validation loss (4.5132).

## What is here

| path | what |
| --- | --- |
| `docs/ARCHITECTURE.md` | the research system: pipeline, models, evaluation rules, storage |
| `docs/data/CORPUS_INVENTORY.md` | the 43-hour corpus, source by source, with rights tiers |
| `apps/ai-service/scripts/phase2_train.py`, `scale_train.py` | the fixed LoRA harness (MusicGen small, medium, large; precomputed EnCodec tokens, delay-pattern labels) |
| `apps/ai-service/scripts/probe_train_eval_gap.py` | the five-condition probe that diagnosed the defect |
| `apps/ai-service/scripts/pcs.py`, `pentatonic.py` | Pentatonic Conformity Score and tonic/scale detection |
| `apps/ai-service/scripts/eval_report.py`, `scale_eval.py` | every table and figure in `docs/eval` from `runs/` and `data/` |
| `docs/eval/` | evaluation, scaling report, preference optimisation, cassette restoration, vocal-model survey, model cards |
| `services/musicgen-api/` | local inference API: model on Apple silicon, adapters hot-swapped, `/generate` `/pcs` `/demo`; `docs/deploy/DEPLOY.md` |
| `runs/` | every fine-tuning run's config, loss curve, held-out CE (weights and audio are not tracked) |
| `docs/ISMIR_PAPER_DRAFT.md` | the paper; passages superseded by the harness fix carry labelled TODO blocks with proposed replacements |
| `docs/application/` | research-statement fact sheet, figure list, project record |
| `docs/README-platform.md` | the platform itself: mobile field-recording app, archive, listening room, studio, research API (Next.js, Express, Expo, Python) |

## Environment

Apple-silicon Mac; `~/ai/musicgen-env` (Python 3.11, torch with MPS,
transformers, peft). `services/musicgen-api/requirements.txt` lists the
inference stack. The web, API, and mobile apps need Node 22 (`.nvmrc`) and
have their own toolchain (`docs/README-platform.md`).

## Rights and governance, in one paragraph

The Harvard corpus (Maryan "Aryette" Omar Ali Collection, AWM Spec Coll 103)
is not rights-cleared for redistribution and written permission from the Loeb
Music Library is outstanding; the oud collection's rights remain with its
unlisted performers; the cassette imports found on the project's own archive
are of mixed and partly unknown provenance. All were used for research
analysis and fine-tuning only. Cultural labels are assigned by Somali
scholars, never predicted. The platform is invite-only; archival audio is
served to members through signed, expiring URLs. Institutions get access by
agreement. Generated audio is research output and is always labelled as such.

## License and citation

The code is licensed under the Apache License 2.0 (`LICENSE`). The license
covers the code only: the recordings, the trained weights, and generated audio
are outside it and are not distributed. To cite the project, use
`CITATION.cff`.

Khalid Ibrahim · Minneapolis, MN
