# Oud LoRA fine-tune — first positive result (2026-08-09)

MusicGen-small + LoRA, fine-tuned overnight on an M1 MacBook (16 GB) on the
privately shared oud-led qaraami collection. **First fine-tune in this project
to beat the base model on held-out data** — after finding and fixing the defect
that had silently broken every previous attempt.

## The root cause that rewrote July's negative result

All three earlier runs (Harvard corpus at lr 1e-4 and 2e-5; oud data at 1e-5)
showed one signature: validation fine at step 100, collapsed to ~7.2 by step
250. `scripts/probe_train_eval_gap.py` isolated it: **HF MusicGen's decoder
applies functional dropout** (float attributes consumed by
`F.dropout(..., training=self.training)`) that module-level dropout sweeps
miss. Train-mode loss on *identical* zero-init-LoRA weights measured **9.79 vs
4.05 in eval mode** — worse than uniform-random (ln 2048 = 7.62). Optimization
was fitting a corrupted forward path, dragging the real model from 4.5 to 7.2.
Zeroing the 37 attributes makes train ≡ eval to four decimals; the trainer now
does this at build time. July's "noisy-data / structural" interpretation is
superseded: it was the harness.

## Dataset

28 unique songs (byte-deduped from the shared folder) → 1,921 fifteen-second
clips (train 1,512 · val 133 · test 276; song-level splits by sha256), 32 kHz
mono, −14 LUFS, measured-tempo + detected-pentatonic-tonic captions
(`data/oud_captions.jsonl`, card in `data/oud_dataset_card.json`).

## Training (runs/oud_lora_r16_nodrop_20260809)

LoRA r=16 on decoder attention projections (6.29 M trainable / 593 M), lr 1e-4
cosine, batch 1 × accum 4, 1,000 steps, fp32 on MPS, ~9 s/step (~3 h).

**Validation token cross-entropy (64 held-out clips):**

| step | 0 (base) | 100 | 250 | 500 | 750 | 1000 |
|---|---|---|---|---|---|---|
| val CE | 4.5132 | 4.4995 | 4.4875 | **4.4785** | 4.4829 | 4.4802 |

Every checkpoint beats base; best = step 500; mild late-run overfit turn.

**Test-split token CE (128 clips, unseen songs):**
base 2.6302 → **step-500 LoRA 2.6092** → step-1000 2.6181.

## Pentatonic Conformity Score (10 s generations, paired prompts)

| group | n | PCS mean | PCS median | voiced fraction | median \|tuning\| |
|---|---|---|---|---|---|
| real oud test clips | 164 | 0.914 | 0.969 | 0.435 | 3.6 c |
| base MusicGen | 7* | 0.929 | 0.967 | 0.329 | 4.7 c |
| **LoRA step-500** | 8 | **0.942** | **0.978** | **0.538** | 27.4 c |

\* one base generation had too little voiced content to score.

**The July confound is reversed.** In July, LoRA "won" PCS by generating
*less* melody (voiced fraction halved to 0.20 — conformity of sparse residual
pitch). Here the fine-tuned model produces **64 % more trackable melody than
base** (0.538 vs 0.329, above the real-clip level) *and* higher conformity —
the improvement comes from music, not silence. The 27 c tuning drift plausibly
reflects learned ornament/bend texture (July measured ~26 c median offset on
real cassettes) but is an honest open question at this sample size.

## Caveats, stated plainly

- Generation groups are n=8 paired prompts (the test split's distinct
  captions) — directional evidence, not statistics. No significance tests
  quoted at this n.
- 10-second clips from MusicGen-**small**; long-form structure is untested.
- Token CE margins are small (≈0.5–3 %); the qualitative claim rests on the
  voiced-fraction + PCS pattern and, ultimately, on listening.
- **Listening is the arbiter** (July's PCS also looked good until it was
  heard). A/B pairs staged in `data/oud_ab_listening/` —
  `pairNNN_base.wav` vs `pairNNN_finetuned.wav`, prompts in `CAPTIONS.txt`.

## Reproduce

```
python3 -m scripts.oud_prepare --src <folder>
python3 -m scripts.phase1_tokens --captions ../../data/oud_captions.jsonl --tokens-dir ../../data/oud_tokens
python3 -m scripts.phase2_train --run-id <id> --lr 1e-4 --total-steps 1000 \
    --captions ../../data/oud_captions.jsonl --tokens-dir ../../data/oud_tokens
python3 -m scripts.oud_eval --stage ce && python3 -m scripts.oud_eval --stage gen --n 24
python3 -m scripts.phase3_pcs_run --group oud_base|oud_lora500|oud_real
```

Next on the 128 GB machine: MusicGen-medium/large, longer clips, denoised
Harvard corpus rerun under the fixed harness, and melody-conditioned
generation from the platform's own transcriptions.
