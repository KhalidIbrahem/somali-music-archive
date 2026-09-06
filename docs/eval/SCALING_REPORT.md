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
| large | step 2750 | 4.0750 → **3.9469** | +0.128 [0.104, 0.152] **sig** | 0.355 → **0.683** | 0.872 → 0.785 | `data/ab_large/` |
| melody | _see below_ | | | | | |

**Medium (done 2026-09-05):** every checkpoint beat base (val 4.4584 → 4.3724); best held-out per-song CE at step 2750, improvement **0.102 nats with a 95% CI [0.078, 0.123] that clears zero** — the first *statistically supported* gain in the programme (small's margins were tiny and unclaimed). Trackable melody +26% (0.409 → 0.515), the familiar more-melody pattern. 10.3 s/step, peak 11.3 GB. Large is training next.

**Large (done 2026-09-05):** trained the full 3000 steps (final val 4.3245), best held-out per-song CE again at step 2750. The improvement over base is **0.128 nats, 95% CI [0.104, 0.152]**, which clears zero and is larger than medium's 0.102. Large's adapter reaches the lowest held-out CE in the programme so far, 3.9469, and its base model already starts slightly ahead of medium's (4.0750 vs 4.1011). On the 16-clip A/B, voiced fraction rises from 0.355 to 0.683 (+0.328), close to double the base and well above medium's adapter (0.515). PCS falls further than medium's, from 0.872 to 0.785 (−0.087 vs medium's −0.016). ~16 s/step, peak 16.3 GB.

### Medium vs large

| metric | medium (1.5 B) | large (3.3 B) |
| --- | --- | --- |
| best checkpoint | step 2750 | step 2750 |
| base per-song CE | 4.1011 | 4.0750 |
| adapter per-song CE | 3.9996 | **3.9469** |
| CE improvement (nats) | +0.102 [0.078, 0.123] | **+0.128 [0.104, 0.152]** |
| A/B voiced fraction (base → adapter) | 0.409 → 0.515 (+0.106) | 0.355 → **0.683** (+0.328) |
| A/B PCS (base → adapter) | 0.821 → 0.805 (−0.016) | 0.872 → 0.785 (−0.087) |
| step rate | ~10.3 s/step | ~16 s/step |

Three things hold across the two sizes:

1. **The rigorous metric improves with scale.** Held-out per-song CE gains a
   significant amount at both sizes, and the gain grows from 0.102 to 0.128 nats
   as the model triples in parameters. Both confidence intervals clear zero. The
   large adapter gives the best held-out fit measured to date (3.9469).
2. **The generated output sings much more at the larger size.** The adapter
   roughly doubles the voiced fraction of large's base (0.355 → 0.683), a bigger
   shift than medium's (0.409 → 0.515). The larger model puts more pitched,
   sung material into its samples, which is the qaraami vocal quality the
   objective is after.
3. **The pentatonic conformity cost also grows.** Large's PCS drops 0.087 against
   its base, five times medium's 0.016 drop. The larger model produces more sung
   content but lands off the pentatonic scale more often on individual clips.

So scale buys a cleaner, statistically supported language-model fit and a strong
move toward sung output, at the price of a wider generation-side PCS gap. The
listening test on `data/ab_large/` against `data/ab_medium/` decides whether the
extra voiced content is worth the pentatonic slippage. Both A/B sets use the same
16 captions and seeds, so they are directly comparable by ear. Source audio is
not distributed; the adapters were trained on the held qaraami corpus described
in `docs/data/CORPUS_INVENTORY.md`.

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
