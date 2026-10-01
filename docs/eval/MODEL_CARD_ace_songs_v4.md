# Model card — `ace_songs_v4` adapter (QaraamiGen, qaraami-v4)

**Rights class:** `releasable` — trained only on one performer's own songs (the v4 song set; the performer consented to training and to publishing outputs, `docs/DATA_PROVENANCE.md` §8); no Harvard, internet or other third-party audio, third-party-suspect sources skipped. Its outputs may be published; the source audio, stems, clips and transcripts may not. Checked by `apps/web/scripts/check-public-audio-rights.mjs`.

**Artifact:** LoRA adapter `runs/v4_ace_songs_r256/final` and per-epoch checkpoints `runs/v4_ace_songs_r256/checkpoints/epoch_N_*` (dot-free links in `ckpt_links/`), rank 256, α = 512, 1.3 GB. Not distributed.

## Base model
ACE-Step 1.5 `xl-sft` (4 B DiT), unchanged, run locally on Apple MPS in fp32.

## Training data — described, not distributed
`runs/v4/STAGE_B_SET_CARD.md`: full mixes from the performer's own recordings cut into 60 s windows (hop 30 s), 48 kHz stereo, −14 LUFS. 412 songs kept of 425; 3,749 clips, 62.46 clip-hours (≈ 31.2 h unique audio); train 351 / val 33 / test 28 songs, song-level splits. Training used every second window (non-overlapping 60 s). Lyrics are **machine transcripts** (Whisper large-v3, Somali prompt, on Demucs vocal stems), not ground truth; vocal windows without transcript lines were dropped. Captions: genre phrase, `male vocal, Somali lyrics` or `instrumental passage, no vocals`, instruments, tempo, tonic; the performer's name is left out of captions.

## Training
`runs/v4/STAGE_C.md`: batch 1 × grad-accum 4, lr 1e-4 cosine, 100 warm-up steps, q/k/v/o in both attentions, dropout 0.05, 6 epochs, checkpoint every epoch. Finished `rc=0`; last epoch `Epoch 6/6 … Loss: 0.6882` (`runs/v4_ace_songs_r256/train.log`). Train loss is reported only; checkpoints are chosen by PCS / voiced / MERT similarity to real songs on 16 held-out lyric prompts (seeds 3000 + i, 60 s), not by loss.

## Evaluation
Per-checkpoint scoring, the two blind sets (`data/ab_stageC_v4_vs_v3final/`, `data/ab_stageC_v4_vs_acebase/`) and the best-of-32 showcase (Stage D) are produced by `runs/v4/overnight.sh`; as of 2026-09-30 only the epoch-1 clips existed (the GPU stages wait for mains power). Fill this section from `runs/v4/STAGE_C.md` / `STAGE_D.md` once they are written. No listening result yet.

## Intended use and limits
Demonstration songs on the public site, labelled AI model output, not a recording. Generated vocals sing machine-transcribed lyrics from held-out songs of the same performer, so they can echo the performer's words; do not present them as the performer's own. Metrics are proxies; only blind listening decides quality.
