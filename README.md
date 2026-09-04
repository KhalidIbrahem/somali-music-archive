# QaraamiGen — Somali Music AI Preservation Platform

**The first AI-powered archive of Somali traditional music**, and a study of
whether a generative music model can learn an oral tradition from archival
cassettes without the archive ever leaving its rights holders.
Built by Khalid Ibrahim (Somali-American AI engineer, Minneapolis).

## The five-minute path for a reviewer

1. **What was found (2 min).** Read `docs/eval/EVALUATION.md` (headline table
   and "the story in four steps"). Short form: LoRA-adapting MusicGen-small on
   two Somali corpora looked like a clean negative for two months; it was a
   training-harness defect (the decoder's 37 functional-dropout attributes,
   active in training, absent in evaluation — train loss 9.74 vs eval 4.05 on
   identical weights). With the defect removed, every checkpoint on both
   corpora beats the base model on unseen songs (oud 4.5132 → 4.4785; Harvard
   4.6262 → 4.5501 validation, 4.8363 → 4.7468 test), and the adapters produce
   64–68 % more trackable melody while learning the cassettes' ~25-cent tuning
   drift. Figures: `docs/figures/ft1`–`ft6`.
2. **Hear it (2 min).** With access to the demo (Tailscale, invite only):
   open `http://100.65.5.120:8765/demo`, paste the token, pick an adapter,
   press *Generate both*. Same prompt and seed, base model on the left,
   fine-tuned on the right, pentatonic-conformity score and voiced fraction
   under each. A recorded walkthrough follows `docs/demo/DEMO_SCRIPT.md`.
3. **Check the rights (1 min).** `docs/DATA_PROVENANCE.md`. No recording from
   either corpus is distributed, served, or in git; every model output is
   labelled with the adapter's corpus and a non-distribution line. Model
   cards: `docs/eval/MODEL_CARD_oud.md`, `docs/eval/MODEL_CARD_harvard_raw.md`.

Reproduce a number yourself (needs the non-distributed processed clips on
disk): `scripts/reproduce_oud_smoke.sh` re-runs the training smoke test and
checks the harness invariants and the base validation loss (4.5132).

## What is here

| path | what |
| --- | --- |
| `apps/ai-service/scripts/phase2_train.py` | the fixed LoRA harness (MusicGen-small, precomputed EnCodec tokens, delay-pattern labels) |
| `apps/ai-service/scripts/probe_train_eval_gap.py` | the five-condition probe that diagnosed the defect |
| `apps/ai-service/scripts/pcs.py`, `pentatonic.py` | Pentatonic Conformity Score and tonic/scale detection |
| `apps/ai-service/scripts/eval_report.py` | generates every table and figure in `docs/eval` from `runs/` and `data/` |
| `services/musicgen-api/` | local inference API: model on Apple silicon, adapters hot-swapped, `/generate` `/pcs` `/demo`; `docs/deploy/DEPLOY.md` |
| `runs/` | every fine-tuning run's config, loss curve, held-out CE (weights and audio are not tracked) |
| `data/eval_pcs/` | per-clip PCS results for every scored group |
| `docs/ISMIR_PAPER_DRAFT.md` | the paper; passages superseded by the harness fix carry labelled TODO blocks with proposed replacements |
| `docs/application/` | research-statement fact sheet and the figure list |
| `docs/README-platform.md` | the platform itself: mobile field-recording app, archive, listening room, studio, research API (Next.js, Express, Expo, Python) |

## Environment

Apple-silicon Mac; `~/ai/musicgen-env` (Python 3.11, torch 2.14 with MPS,
transformers 4.57, peft 0.20). `services/musicgen-api/requirements.txt` lists
the inference stack. The web/API/mobile apps have their own toolchain
(`docs/README-platform.md`).

## Rights and governance, in one paragraph

The Harvard corpus (Maryan "Aryette" Omar Ali Collection, AWM Spec Coll 103)
is not rights-cleared for redistribution and written permission from the Loeb
Music Library is outstanding; the oud collection's rights remain with its
unlisted performers. Both were used for research analysis and fine-tuning
only. Cultural labels are assigned by Somali scholars, never predicted. The
platform is invite-only; archival audio is served to members through signed,
expiring URLs. Generated audio is research output and is always labelled as
such. Code license: TBD before public release.

Khalid Ibrahim · Minneapolis, MN
