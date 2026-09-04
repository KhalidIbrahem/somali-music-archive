# Model card — `harvard_raw` adapter (QaraamiGen)

**Artifact:** LoRA adapter `runs/harvard_raw_3000/ckpt_step_2750` (PEFT format, 25 MB, ~6.29 M trainable parameters). Not distributed; served locally by `services/musicgen-api`.

## Base model
`facebook/musicgen-small`, unchanged; rank-16 LoRA (α = 32, dropout 0.05) on decoder self- and cross-attention `q/k/v/out` projections (192 sites).

## Training data — described, not distributed
The Maryan "Aryette" Omar Ali Collection (*Somali Songs, 1955–1991*), Archive of World Music, Harvard Loeb Music Library, AWM Spec Coll 103: 119 unique tracks (~24 h) of mid-century Somali cassette recordings, staged locally for research. Processed **raw** (no denoising, no source separation) to 11,386 fifteen-second clips (32 kHz mono, −14 LUFS): train 9,174 · val 1,136 · test 1,076, song-level splits. Captions: genre tag (Qaraami / traditional Somali song), measured tempo, detected pentatonic tonic, *"vintage archival recording"*.

**Rights.** Not rights-cleared for redistribution; written permission from the Loeb Music Library is outstanding. Source audio, clips and tokens never enter git, a bucket, or a public URL; they are not served by the API. Only model output is shown, always labelled. See `docs/DATA_PROVENANCE.md` §1 and its blocking item about the deployed site.

## Training
Fixed harness (functional dropout zeroed), fp32 on Apple MPS (M5 Max), batch 1 × 4, lr 1e-4 cosine, 100 warm-up, AdamW, grad-clip 1.0, 3,000 steps (1.15 s/step median), checkpoints every 250, seed 42. A 1,500-step run with identical settings preceded it (best test CE 4.7585).

## Metrics (held-out, song-level)
| | base | adapter (step 2750) |
| --- | --- | --- |
| validation token CE (64 clips) | 4.6262 | **4.5501** |
| test token CE (128 clips, unseen songs) | 4.8363 | **4.7468** |
| PCS mean, 8 paired prompts (step-1500 adapter) | 0.869 | 0.706 |
| voiced fraction | 0.395 | **0.663** |
| median |tuning offset| | 6.4 c | 22.8 c |

Every checkpoint beat base; the curve flattened by ~2,500 steps (val drop per 250 steps 0.0065 → 0.0005). Real Harvard test clips: PCS 0.847, voiced 0.530, tuning 26.1 c. The adapter produces more trackable melody than the real corpus and learns the cassettes' ~25 c tuning drift, at lower pentatonic conformity than base — whether that is non-pentatonic content or noisier pitch tracks on vocal-plus-tape texture is a listening question. **Listening gate not yet performed** (A/B set: `data/harvard_ab_listening`, eight pairs).

## Related negative control
The same recipe on DeepFilterNet-denoised clips (`runs/harvard_denoised`) improves CE on denoised tokens but is **worse than base on raw audio** (4.8705 vs 4.8363). The denoiser removed ~13 dB, mostly 1–3 kHz; its output correlates 0.41 with the raw waveform. Denoising with a speech enhancer alters the corpus rather than cleaning it.

## Intended use / limitations
Research demonstration and paper material only. Same limits as the oud card (small model, short clips, small CE margins). Additionally: the training material is rights-unverified archival audio — this adapter must not leave the research context until Harvard's written permission exists, and its outputs must always carry the provenance line.
