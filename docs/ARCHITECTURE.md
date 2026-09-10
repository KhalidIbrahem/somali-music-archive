# Architecture: the research system

This describes the system as it stands. The earlier planning document from the
commercial phase is kept at `docs/archive/ARCHITECTURE.md`; code comments that
cite "ARCHITECTURE.md §N" refer to section numbers in that archived file.

The project is open-source, nonprofit academic research on Somali qaraami. It
has no payments, subscriptions, or tiers. Institutions (universities, cultural
schools) get access to the platform by agreement.

## Pipeline

All research code lives in `apps/ai-service/scripts/` and runs on one Apple
silicon machine. Audio, tokens, and checkpoints stay on local disk and are
never committed.

1. **Inventory.** `corpus_inventory.py` walks each source collection, probes
   duration and format, flags likely vocals and percussive content, and writes
   `data/inventory/<source>.jsonl`. The summary is `docs/data/CORPUS_INVENTORY.md`.
2. **Clip preparation.** `process_harvard.py`, `oud_prepare.py`,
   `phase1_preprocess.py`, and `build_scale_dataset.py` cut source files into
   15 s or 30 s clips at 32 kHz mono, peak- and loudness-normalise them, drop
   near-silent windows, and write a caption per clip in Somali musical terms
   (genre, instruments, tempo, detected pentatonic tonic, era). Splits are
   song-level, 80/10/10 by full-file hash, with a leakage check that fails the
   build if any song lands in two splits. `restore_clips.py` produces the
   spectral-subtraction variants used in the restoration experiment.
3. **Tokenisation.** `phase1_tokens.py` and `scale_tokens.py` encode clips with
   EnCodec at 32 kHz into four codebooks and store them as arrays, with the
   delay-pattern labels MusicGen trains on.
4. **Fine-tuning.** `phase2_train.py` (MusicGen-small) and `scale_train.py`
   (medium, large, melody) train LoRA adapters on the decoder's attention and
   feed-forward projections. The harness sets every functional-dropout
   attribute in the decoder to zero so that training and evaluation see the
   same network; this fix is what turned an apparent negative result into a
   measurable gain. A memory guard aborts a run cleanly before the machine
   would.
5. **Preference optimisation.** `reward_model.py` and `dpo_train.py` (Stage 5)
   push an adapter toward clean oud qaraami using a learned reward over
   generated clips. Results: `docs/eval/PREFERENCE_OPT.md`.
6. **Evaluation.** `scale_eval.py`, `oud_eval.py`, `eval_report.py`, and
   `dpo_report.py` compute the numbers and figures in `docs/eval/`. `pcs.py`
   and `pentatonic.py` implement the Pentatonic Conformity Score.
   `probe_train_eval_gap.py` is the five-condition probe that diagnosed the
   dropout defect.
7. **Generation and listening.** `melody_condition.py` conditions
   musicgen-melody on a real qaraami melody; `ace_step_generate.py` runs the
   zero-shot lyrics-to-song survey; `ab_listen.py` serves a blind listening
   page; `build_demo_page.py` builds the shareable demo page. `transcribe.py`,
   `f0_notes.py`, `beat_grid.py`, and `melody.py` are the transcription side.

## Models

| model | size | adapter | where the numbers are |
| --- | --- | --- | --- |
| MusicGen-small | 0.59 B | oud, harvard_raw, harvard_denoised, harvard_restored | `docs/eval/EVALUATION.md`, `docs/eval/RESTORATION.md` |
| MusicGen-medium | 1.5 B | qaraami_medium_r32 (+ DPO rounds) | `docs/eval/SCALING_REPORT.md`, `docs/eval/PREFERENCE_OPT.md` |
| MusicGen-large | 3.3 B | qaraami_large_r32 (+ DPO round) | same |
| musicgen-melody | 1.5 B | scripted, not trained | `docs/eval/SCALING_REPORT.md` |
| ACE-Step | 3.5 B | zero-shot only | `docs/eval/VOCAL_MODEL_SURVEY.md` |

Weights and adapters are not distributed. Model cards: `docs/eval/MODEL_CARD_*.md`.

## Evaluation

- **Held-out per-song cross-entropy.** The unit is the song, never the clip.
  Base and adapter are scored on the same unseen songs; the improvement is
  reported with a bootstrap 95 % confidence interval over songs, and a result
  counts only if the interval clears zero.
- **Pentatonic Conformity Score (PCS).** Pitch is tracked with CREPE, the
  tonic and scale are detected, and PCS is the fraction of voiced frames that
  sit on the detected pentatonic scale. It is always reported with the voiced
  fraction, because a clip with little pitched content can score high by
  accident.
- **Listening.** Every adapter that reaches a decision goes through a blind
  A/B against its base model on the same captions and seeds. Listening is the
  final arbiter; the metrics rank candidates.

## Storage

| what | where | in git? |
| --- | --- | --- |
| source recordings | local disk and the private bucket, signed expiring URLs | no |
| clips, tokens, generated audio | `data/` | no |
| run configs, loss curves, held-out CE | `runs/` | configs and curves yes; weights and audio no |
| model checkpoints and adapters | `runs/<run>/ckpt_*` | no |
| evaluation tables and figures | `docs/eval/`, `docs/figures/` | yes |
| platform data (users, lessons, comments, organisations) | PostgreSQL | no |
| recordings metadata, search, embeddings | MongoDB | no |
| sessions, rate limits | Redis | no |
| platform audio objects | R2 bucket, UUID keys | no |

The rights position for every source is in `docs/DATA_PROVENANCE.md`.

## Platform

The platform around the research is a monorepo: `apps/api` (Node 22, Express,
Prisma, Zod on every input), `apps/web` (Next.js: archive browser, listening
room, studio, admin), `apps/mobile` (Expo: field recording, archive, lessons,
offline), `apps/ai-service` (FastAPI: transcription, pitch analysis,
embeddings), and shared packages for types, validators, and cultural
constants. Registration is invite-only and archival audio is served to members
through signed, expiring URLs. `services/musicgen-api/` is the local inference
service that hot-swaps adapters and exposes generation and PCS endpoints.

## Environment

`~/ai/musicgen-env` (Python 3.11, torch with MPS, transformers, peft) for the
research scripts; `~/ai/ace-step-env` for the vocal survey. The JavaScript
workspace needs Node 22 (`.nvmrc`). See `SETUP.md` and `docs/README-platform.md`.
