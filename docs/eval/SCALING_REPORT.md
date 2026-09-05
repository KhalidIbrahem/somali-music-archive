# Scaling report — MusicGen small → medium → large (Stage 2/4)

*Live document. Smoke measurements are final; the full-run rows are filled by
the orchestrator (`runs/_tools/orchestrate_scale.sh`) as each stage completes.
All under the fixed-dropout harness (`scale_train.py`), LoRA rank 32 on all
attention + FFN projections, 30 s clips, lr 5e-5, 3000 steps, batch 1.*

## Measured smoke (2026-09-04, oud subset, M5 Max, MPS)

| model | params | LoRA trainable | grad-accum | s/step | peak MPS driver | 3000-step projection | fits 60 GB / 90 GB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| small (15 s, prior) | 0.59 B | 6.3 M | 4 | ~1.0 | 3.2 GB | ~0.5 h | yes / yes |
| **medium** | 1.5 B | 61.3 M | 8 | 19.2 | 11.2 GB | ~16 h | **yes / yes** |
| **medium** | 1.5 B | 61.3 M | 4 | ~9.6 | ~11 GB | ~8 h | yes / yes |
| **large** | 3.3 B | 81.8 M | 4 | 15.1 | 16.3 GB | ~12.6 h | **yes / yes** |

Memory is never the constraint — both sizes sit far under the 60 GB target with
the small-model API (~3 GB) still running. **Wall-clock is the constraint:** at
30 s clips (1500 EnCodec frames, 2× the 15 s runs) each step is 10–20 s. The
orchestrator runs medium then large sequentially at grad-accum 4 (~8 h + ~12.6 h);
functional dropout zeroed on 61 attributes for both (vs 37 on small — deeper
decoder), confirming the harness fix generalises.

## Full-run results (filled as they finish)

| model | best ckpt | per-song test CE base → adapter | 95% CI on improvement | trackable-melody base → adapter | PCS base → adapter | A/B set |
| --- | --- | --- | --- | --- | --- | --- |
| medium | step 2750 | 4.1011 → **3.9996** | +0.102 [0.078, 0.123] **sig** | 0.409 → **0.515** | 0.821 → 0.805 | `data/ab_medium/` |
| large | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | `data/ab_large/` |
| melody | _see below_ | | | | | |

**Medium (done 2026-09-05):** every checkpoint beat base (val 4.4584 → 4.3724); best held-out per-song CE at step 2750, improvement **0.102 nats with a 95% CI [0.078, 0.123] that clears zero** — the first *statistically supported* gain in the programme (small's margins were tiny and unclaimed). Trackable melody +26% (0.409 → 0.515), the familiar more-melody pattern. 10.3 s/step, peak 11.3 GB. Large is training next.

## Melody-conditioned variant (musicgen-melody)

`musicgen-melody` (1.5 B) conditions generation on a reference melody (chroma),
which is where qaraami identity lives. The fine-tune itself is text-conditioned
in `scale_train.py` (the model still learns the corpus); the melody feature is
used at *generation* time by feeding a real held-out qaraami clip's chroma as
the conditioning melody. This variant is scripted and its weights are on disk;
it is queued after large or run on request (`scale_train.py --model
facebook/musicgen-melody`), because a full third 8 h run did not fit alongside
medium + large in the same window. Measured smoke to be added.

## What each size is expected to buy (hypothesis, to be tested)

- **medium/large** have the capacity to model longer-range phrase structure and
  cleaner oud timbre than small; the metric to watch is trackable-melody
  fraction and per-song CE with a CI that clears zero (small's margins were
  real but tiny). The listening A/B (16 clips per model, same seeds/captions)
  is the arbiter, as before.
- The corpus (43 h, ~330 songs) is enough for LoRA on these sizes but not for
  full-model training; see `docs/data/CORPUS_INVENTORY.md`.
