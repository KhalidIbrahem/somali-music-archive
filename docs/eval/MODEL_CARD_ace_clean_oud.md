# Model card — `ace_clean_oud` adapter (QaraamiGen, qaraami-v3)

**Rights class:** `releasable` — trained only on isolated oud stems from one performer's own recordings (the `clean_oud` set; the performer consented to training and to publishing outputs, `docs/DATA_PROVENANCE.md` §8); no Harvard, internet or other third-party audio. Its outputs may be published; the source audio and stems may not. Checked by `apps/web/scripts/check-public-audio-rights.mjs`.

**Artifact:** LoRA adapter `runs/v3_ace_xlsft/final` (PEFT format, 336 MB, rank 64, α = 128, dropout 0.05, `q/k/v/o` projections in self- and cross-attention). Not distributed.

## Base model
ACE-Step 1.5 `xl-sft` (4 B DiT), unchanged, run locally on Apple MPS.

## Training data — described, not distributed
`data/v3/clean_oud` (`SET_CARD.md`): the performer's 37 solo-oud recordings and the oud (`other`) stems of 51 of their band mixes, Demucs-separated, cut into 30 s windows and filtered for vocal and drum bleed, silence, trackable melody and pentatonic conformity. 1,362 windows kept: 5.67 unique hours (train 4.17 / val 1.08 / test 0.42), song-level splits (57 / 7 / 5 songs), no leakage. Captions follow template v3 (solo oud, per-clip tempo, tonic and tuning).

## Training
`runs/v3_ace_xlsft/launch.sh`: batch 1 × grad-accum 4, lr 1e-4 cosine, 100 warm-up steps, 12 epochs; finished `rc=0` on 2026-09-29. Only the `final` directory loads as a LoRA in ACE-Step (the epoch directories fail on the "." in their names), so `final` is the served and published checkpoint.

## Metrics (16 held-out captions, 30 s, same seeds on both sides; `runs/v3_ace_xlsft/RESULT.md`)
| | ACE-Step base | + `ace_clean_oud` (final) |
| --- | --- | --- |
| PCS | 0.893 | 0.857 |
| voiced fraction | 0.673 | 0.648 |
| MERT similarity to real oud | 0.906 | 0.920 |

Pairs won by the metric composite: 9/16 vs ACE-Step base, 8/16 vs MusicGen-large SFT, 7/16 vs MusicGen-large DPO — **not clearly better** than any comparator (n = 16, directional). The blind sittings (`data/ab_stage3_acelora_vs_*`) decide; none has been sat yet.

## Intended use and limits
Demonstration clips on the public site, labelled as AI model output, not a recording. Solo oud only (no vocals). Machine metrics are proxies; do not cite them as quality claims without the listening results.
