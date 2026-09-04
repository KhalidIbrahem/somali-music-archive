# QaraamiGen — evaluation (fine-tuning MusicGen-small on Somali qaraami)

*Status 2026-09-04. Every number below is generated from the run artifacts in
`runs/` and `data/` by `apps/ai-service/scripts/eval_report.py`; the figures
in `docs/figures/ft*.png` come from the same script. Nothing is hand-typed.*

## Headline

Two LoRA adapters for `facebook/musicgen-small` beat the base model on
held-out, song-level splits:

| adapter | corpus | val CE base → adapter | test CE base → adapter (unseen songs) | best step | listening gate |
| --- | --- | --- | --- | --- | --- |
| `oud` | private oud (kaban) qaraami collection, 28 songs | 4.5132 → **4.4785** | 2.6302 → **2.6092** | 500 / 1000 | **passed** |
| `harvard_raw` | Maryan "Aryette" Omar Ali Collection (Harvard AWM Spec Coll 103), 119 tracks, raw | 4.6262 → **4.5501** | 4.8363 → **4.7468** | 2750 / 3000 | pending |

Every checkpoint of both runs beats base. The margins are small (0.5–3 %),
which is expected for a 6.3 M-parameter adapter on a 593 M model with
15-second clips; the qualitative claim rests on the pentatonic-conformity and
voiced-fraction pattern and, finally, on listening.

## The story in four steps

1. **April 2026 — nothing worked.** A naive full-decoder fine-tune (no
   delay-pattern labels) gave NaN loss; a cloud MusicGen-medium fine-tune
   produced a checkpoint with no held-out metrics. Superseded.
2. **July 2026 — a convincing negative.** Two Harvard runs (lr 1e-4 and 2e-5)
   collapsed from 4.63 to ~6.7–6.8 nats by step 250 and never recovered. PCS
   on their generations looked *better* than base (0.98 vs 0.88) while voiced
   fraction halved (0.20 vs 0.48): conformity of sparse residual pitch. The
   paper draft framed this as "generative adaptation learns the channel, not
   the tradition" (T1, T4).
3. **9 August 2026 — the negative was the harness.** The same collapse on the
   oud collection at lr 1e-5 ruled out the corpus. A probe on identical
   zero-init-LoRA weights measured train-mode loss 9.74 vs eval-mode 4.05 —
   worse than uniform random (7.62) — and zeroing every `nn.Dropout` module
   changed nothing (T5, figure ft2). The HF MusicGen decoder applies dropout
   *functionally* through 37 float attributes that module sweeps miss.
   Optimisation had been fitting a corrupted forward path. Zeroing those
   attributes makes train ≡ eval; the first fixed run beat base at every
   checkpoint (figure ft1, right).
4. **September 2026 — replication on Harvard.** Under the fixed harness the
   Harvard corpus behaves like the oud collection: every checkpoint beats
   base, the curve flattens by ~2,500 steps (T2, figure ft4), and the adapter
   produces 68 % more trackable melody than base (T4, figure ft3). A
   DeepFilterNet-denoised variant is a documented negative control: the
   denoiser removed ~13–15 dB, mostly the 1–3 kHz band, its output correlates
   0.41 with the raw waveform, and the adapter it produced is *worse than
   base on raw audio* (T3, figure ft6).

## How to read PCS

The Pentatonic Conformity Score is the duration-weighted fraction of voiced
frames (torchcrepe-full, 20 ms hop, periodicity ≥ 0.5) within ±50 cents of
the best-fitting anhemitonic-pentatonic set after a per-clip tuning-offset
fit. It must be read together with the **voiced fraction**: a model that
produces less melody can score higher conformity on what little is left
(exactly what the July generations did). On both corpora the adapters roughly
double the voiced fraction — more music, not less — and learn the real
cassettes' ~25-cent tuning offset (base sits near A440). Their conformity is
similar (oud) or lower (Harvard) than base; whether the Harvard drop is
non-pentatonic content or noisier pitch tracks on vocal-plus-tape texture is
a listening question. At n = 8 prompts per group the PCS column is inside
scorer noise (re-scoring identical files under a new torch build moved one
group by 0.04); the voiced-fraction effect is not.

## What is *not* claimed

- No significance tests on n = 8 generation groups; the July table's
  Mann–Whitney values described a different (broken) regime.
- No long-form structure: 10–30 s clips from MusicGen-**small**.
- No claim that the adapters model Somali music at large; each is a model of
  one collection.
- The denoised result says nothing about denoising in general — only that
  this speech enhancer alters this corpus.

## Reproduce

- Tables and figures: `cd apps/ai-service && ~/ai/musicgen-env/bin/python -m scripts.eval_report`
- The oud smoke test from the processed clips, with number checks:
  `scripts/reproduce_oud_smoke.sh` (needs the non-distributed tokens on disk).
- Per-adapter details: `docs/eval/MODEL_CARD_oud.md`, `docs/eval/MODEL_CARD_harvard_raw.md`.
- Rights: `docs/DATA_PROVENANCE.md`. No source audio is distributed; only
  model output is shown anywhere.
## T1 — Every fine-tuning run (MusicGen-small, LoRA r=16 α=32 on decoder q/k/v/out, batch 1×4, cosine, 100 warm-up)

| run | corpus | harness | steps | base val CE | best val CE (step) | last val CE | base test CE | best test CE (step) | s/step | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| July 17 — Harvard, lr 1e-4 | Harvard (raw) | broken (functional dropout active) | 1500 | 4.6262 | 6.6977 (1000) | 6.7069 | 4.8363 | 6.7525 (1000) | 9.57 | 1500 steps; resumed at 1000 after an MPS kill |
| July 18 — Harvard, lr 2e-5 | Harvard (raw) | broken | 250 | 4.6262 | 4.7635 (100) | 6.7883 | — | — (—) | 9.65 | stopped at step 400 (same collapse, delayed) |
| Aug 9 — oud, lr 1e-5 | oud | broken (diagnostic) | 250 | 4.5132 | 4.5244 (100) | 7.2298 | — | — (—) | 9.72 | reproduced the cliff on different data → ruled out the corpus |
| Aug 9 — oud, lr 1e-4, FIXED harness | oud | fixed | 1000 | 4.5132 | 4.4785 (500) | 4.4802 | 2.6302 | 2.6092 (500) | 8.89 | first positive result; best = step 500 (listening gate passed) |
| Sep 3 — Harvard raw, 1500 steps | Harvard (raw) | fixed | 1500 | 4.6262 | 4.5585 (1500) | 4.5585 | 4.8363 | 4.7585 (1500) | 1.21 | every checkpoint beats base |
| Sep 3 — Harvard raw, 3000 steps | Harvard (raw) | fixed | 3000 | 4.6262 | 4.5501 (2750) | 4.5501 | 4.8363 | 4.7468 (2750) | 1.15 | plateau by ~2500; best = step 2750 |
| Sep 3 — Harvard DeepFilterNet-denoised, 1500 steps | Harvard (denoised) | fixed | 1500 | 2.3524 | 2.2780 (1500) | 2.2780 | 2.4852 | 2.4081 (1500) | 1.14 | negative control: adapter does not transfer to raw audio |

April 2026 (pre-repo): a naive full-decoder fine-tune without delay-pattern labels produced NaN loss for ten epochs; a Replicate `sakemin/musicgen-fine-tuner` MusicGen-medium run produced a `trained_model.tar` with no held-out metrics. Both superseded; kept only as history (`Desktop/Model-Training/02 replicate finetune` on the old-Mac archive).

## T2 — Plateau analysis, Harvard raw 3000-step run

| step | val CE | Δ val per 250 | test CE |
| --- | --- | --- | --- |
| 0 (base) | 4.6262 | | 4.8363 |
| 250 | 4.5804 | 0.0458 | 4.7823 |
| 500 | 4.5702 | 0.0102 | 4.7723 |
| 750 | 4.5656 | 0.0046 | 4.7658 |
| 1000 | 4.5610 | 0.0046 | 4.7602 |
| 1250 | 4.5586 | 0.0024 | 4.7575 |
| 1500 | 4.5549 | 0.0037 | 4.7542 |
| 1750 | 4.5539 | 0.0010 | 4.7517 |
| 2000 | 4.5523 | 0.0016 | 4.7494 |
| 2250 | 4.5516 | 0.0007 | 4.7482 |
| 2500 | 4.5503 | 0.0013 | 4.7473 |
| 2750 | 4.5501 | 0.0002 | 4.7468 |
| 3000 | 4.5501 | 0.0000 | 4.7468 |

Val drop per 250 steps: first quarter 0.0202, last quarter 0.0005. Steps 2500/2750/3000 = 4.5503/4.5501/4.5501; test 4.7473/4.7468/4.7468. The extra 1500 steps over the 1500-step run bought 0.0117 test CE.

## T3 — Denoised negative control (DeepFilterNet3, the project's own `clean` stage, clip-for-clip)

Corpus-wide effect of the denoiser: median raw loudness -16.39 LUFS → -29.55 LUFS before re-normalisation (≈15.55 dB removed); waveform correlation raw↔denoised median 0.41 (p10–p90 0.235–0.635). Six-clip spectral check: the 1–3 kHz band fell from ~20–33 % of energy to ~3–11 %. DeepFilterNet is a speech enhancer; on this corpus it removed much of the oud and presence band, not only hiss.

| condition | base val CE | adapter val CE (1500) | base test CE | adapter test CE (1500) |
| --- | --- | --- | --- | --- |
| raw tokens | 4.6262 | 4.5585 | 4.8363 | 4.7585 |
| denoised tokens | 2.3524 | 2.2780 | 2.4852 | 2.4081 |

Cross-check (does an adapter transfer to the other condition's test tokens?):

| adapter → test tokens | test CE | base on those tokens | verdict |
| --- | --- | --- | --- |
| harvard_raw → harvard_denoised (step_1500) | 2.4803 | 2.4852 | better than base |
| harvard_denoised → harvard_raw (step_1500) | 4.8705 | 4.8363 | **worse than base** |

CE is not comparable across conditions (removing hiss lowers token entropy for every model). The denoised adapter is worse than base on raw audio: it specialised to an altered corpus. Denoising with a speech enhancer is a methods caveat, not a training recipe.

## T4 — Pentatonic Conformity Score on the A/B sets (n = 8 prompts per group; directional, no statistics claimed)

| group | n scored | PCS mean | PCS median | voiced fraction | median |tuning| (cents) | caption-tonic match |
| --- | --- | --- | --- | --- | --- | --- |
| oud — base MusicGen | 7 | 0.932 | 0.967 | 0.329 | 4.6 | 0.2857 |
| oud — adapter step 500 | 8 | 0.900 | 0.969 | 0.538 | 25.8 | 0.25 |
| oud — real held-out clips (164) | 164 | 0.914 | 0.969 | 0.435 | 3.6 | 0.561 |
| Harvard — base MusicGen | 8 | 0.869 | 0.912 | 0.395 | 6.4 | 0.0 |
| Harvard — raw adapter step 1500 | 8 | 0.706 | 0.704 | 0.663 | 22.8 | 0.25 |
| Harvard — real test clips (1076) | 1076 | 0.847 | 0.853 | 0.530 | 26.1 | 0.2388 |
| Harvard — base (July, 100 prompts) | 87 | 0.878 | 0.912 | 0.484 | 6.5 | 0.2184 |
| Harvard — July broken-harness ckpt 1000 (100) | 95 | 0.984 | 1.000 | 0.196 | 6.0 | 0.2842 |
| Harvard — July broken-harness ckpt 1500 (100) | 99 | 0.962 | 0.979 | 0.183 | 5.5 | 0.2525 |

Re-scoring the identical oud A/B files under torch 2.14 moved the adapter's PCS from 0.942 (2026-08-09 record) to 0.900: one clip's tuning-offset estimate flipped sign (+28.7 → −23.3 c), changing its mode and its PCS 0.83 → 0.54. Voiced fractions reproduced exactly (0.538 / 0.538). At n = 8, PCS differences of a few hundredths are inside scorer noise; the robust cross-corpus effect is the voiced-fraction gain (oud +64 %, Harvard +68 %) and the learned ~25 c tape tuning offset.

## T5 — The harness defect: train-mode vs eval-mode loss on identical zero-init LoRA weights (4 oud val clips, 2026-09-04 re-run)

| condition | mean token CE |
| --- | --- |
| A. eval mode (what validation measured) | 4.0511 |
| B. train mode, as trained in July/Aug | 9.7356 |
| C. train mode, every `nn.Dropout` module set to p=0 (229 modules) | 9.7337 |
| D. train mode, no gradient checkpointing | 9.7879 |
| E. train mode, text+audio encoders in eval | 9.7525 |
| uniform-random reference ln(2048) | 7.6246 |

Module-level dropout sweeps (C) change nothing: the HF MusicGen decoder applies dropout *functionally* through 37 float attributes (`dropout`, `activation_dropout`, `attention_dropout`) consumed by `F.dropout(..., training=self.training)`. Optimisation fitted a forward path the evaluation never saw — worse than uniform random — and dragged eval loss from 4.5 to 7.2. `phase2_train.zero_functional_dropout()` sets those 37 attributes to 0 at build time; train ≡ eval to four decimals afterwards. July's 'structural negative' is superseded: it was the harness.

