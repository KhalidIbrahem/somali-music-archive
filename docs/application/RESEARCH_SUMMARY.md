# Research summary (raw material, 2026-09-11)

Source of every number: `docs/eval/SCALING_REPORT.md` (generation) and
`docs/eval/TRANSCRIPTION_POOL_REPORT.md` (transcription). Nothing below is a
claim beyond those two files. This is material for a statement of purpose,
not the statement.

## 1. What was built

**Generation.** A LoRA fine-tuning harness for MusicGen in three sizes: small
(0.59 B parameters), medium (1.5 B), large (3.3 B). Rank 32 on all attention
and feed-forward projections; 30-second clips (1500 EnCodec frames); learning
rate 5e-5; 3000 steps; batch 1; gradient accumulation 4. The harness sets the
decoder's functional-dropout attributes to zero during training: 37 attributes
on small, 61 on medium and large. Trainable parameters: 6.3 M (small), 61.3 M
(medium), 81.8 M (large). One machine (Apple M5 Max, MPS); the medium and large
runs executed one after the other under an orchestrator. Corpus: 43 h,
about 330 songs, of Somali qaraami held on the machine; source audio is not
distributed. Per model, a 16-clip A/B set generated from the same 16 captions
and seeds. A melody-conditioned variant (musicgen-melody, 1.5 B) is scripted;
it has not been run.

**Transcription.** A pipeline that, for one recording, estimates the tonic and
the mode (one of the five rotations of the anhemitonic pentatonic set), then
places each scale degree at the weighted median of the recording's own pitches
within 60 cents of the 12-TET template after removing the recording's tuning
offset; a degree holding under 2 percent of the pitch mass is left at its
template position and counted as not refined. It reports the pentatonic
conformity score (PCS) of the kept notes, the number of notes, and the number
of notes kept off the scale and marked. Pitch tracking with CREPE on the CPU,
source separation with Demucs on the GPU. Run over a pool of 103 files: by
content hash, 28 oud recordings across 40 files and 63 band recordings with
vocals, 91 recordings in total; the oud recordings in full (4.1 h of audio),
the band recordings as 90-second excerpts (94 min transcribed of 2.9 h).
Pipeline time 4.5 h; 0 failures. Six mechanical warning signs are computed per
recording: PCS below 0.85; under 20 notes per minute; over 15 percent of notes
kept off-scale; voice stem voiced under 15 percent of the time; tonic
ambiguous; a degree too sparse to refine.

## 2. What was measured

**Generation, per model size.** Held-out per-song test cross-entropy (CE) of
the base model and of the adapter on the same unseen songs, the song as the
unit, the improvement given with a 95 percent bootstrap confidence interval
over songs. Validation CE per checkpoint. On the 16-clip A/B: voiced fraction
(share of frames with a trackable pitch) and PCS, base against adapter. Step
time and peak MPS memory.

**Transcription, over the 91 recordings.** Counts of tonic (12 pitch classes)
and mode (5); the score ratio of the highest-scoring reading with a different tonic to
the winning reading, and the count with ratio at or above 0.95 ("tonic
ambiguous"); for each template interval above the tonic, the deviation of the
refined degree from 12-TET in cents (n, mean, sd, median, IQR, range) and the
count not refined; the tuning offset from A440; PCS by source and by staff;
the voice stem's voiced fraction; kept notes per minute; the share of kept
notes marked off-scale; the count of recordings with warning signs.

## 3. Results

**Generation**

| | medium (1.5 B) | large (3.3 B) |
| --- | --- | --- |
| checkpoint with the lowest held-out CE | step 2750 | step 2750 |
| validation CE, base → adapter | 4.4584 → 4.3724 | final 4.3245 |
| per-song test CE, base → adapter | 4.1011 → 3.9996 | 4.0750 → 3.9469 |
| CE improvement, 95% CI | +0.102 [0.078, 0.123] | +0.128 [0.104, 0.152] |
| A/B voiced fraction, base → adapter | 0.409 → 0.515 | 0.355 → 0.683 |
| A/B PCS, base → adapter | 0.821 → 0.805 | 0.872 → 0.785 |
| step time | 10.3 s | 16 s |
| peak MPS memory | 11.3 GB | 16.3 GB |

Both confidence intervals exclude zero. Every medium checkpoint scored below
the base model on validation CE. The improvement in test CE is 0.102 nats at
1.5 B and 0.128 nats at 3.3 B. Voiced fraction rises by 0.106 at medium and
0.328 at large. PCS falls by 0.016 at medium and 0.087 at large.

**Transcription pool: tonic and mode (91 recordings)**

Tonic counts, all / band / oud: C 7/0/7, C# 9/6/3, D 15/10/5, D# 9/9/0,
E 5/3/2, F 14/14/0, F# 2/2/0, G 4/3/1, G# 1/1/0, A 10/3/7, A# 13/12/1,
B 2/0/2. Mode counts: mode 0 (0/200/400/700/900 cents) 44; mode 1
(0/200/500/700/1000) 9; mode 2 (0/300/500/800/1000) 17; mode 3
(0/200/500/700/900) 8; mode 4 (0/300/500/700/1000) 13. Tonic ambiguous
(runner-up ratio at or above 0.95): 10 of 91 (11 percent). Runner-up ratio:
mean 0.752, sd 0.172, median 0.784, IQR 0.626 to 0.891, range 0.284 to 0.994.

**Transcription pool: degree positions relative to 12-TET (cents)**

| interval above tonic | n | mean | sd | median | IQR | range | not refined |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 200 | 56 | +0.2 | 16.9 | −3.2 | −9.5 to +5.6 | −34.2 to +52.9 | 5 |
| 300 | 29 | +2.1 | 21.2 | +2.3 | −2.6 to +11.9 | −49.7 to +47.0 | 1 |
| 400 | 44 | −6.9 | 17.2 | −6.4 | −22.1 to +2.7 | −41.4 to +34.3 | 0 |
| 500 | 43 | −0.7 | 20.7 | 0.0 | −10.5 to +8.5 | −56.7 to +50.7 | 4 |
| 700 | 72 | +1.1 | 17.3 | +1.0 | −10.0 to +12.3 | −35.7 to +41.3 | 2 |
| 800 | 16 | +2.7 | 25.6 | +10.4 | −16.2 to +23.1 | −53.6 to +36.9 | 1 |
| 900 | 51 | −0.5 | 16.3 | −0.9 | −10.3 to +8.2 | −43.8 to +32.7 | 1 |
| 1000 | 37 | +9.8 | 20.9 | +4.9 | −1.5 to +22.9 | −45.6 to +57.9 | 2 |

Tuning offset from A440 across the 91 recordings: mean +0.3 cents, sd 22.0,
median −0.1, IQR −11.1 to +11.4, range −49.7 to +49.2.

**Transcription pool: conformity and density**

- PCS of kept notes, all 91: mean 0.783, sd 0.147, median 0.773, IQR 0.665 to
  0.934, range 0.511 to 0.995.
- PCS, oud (28): mean 0.931, median 0.964, IQR 0.916 to 0.992, range 0.662 to 0.995.
- PCS, band (63): mean 0.717, median 0.717, IQR 0.635 to 0.813, range 0.511 to 0.985.
- Band recordings by staff: voice mean 0.688, median 0.702, range 0.315 to
  0.953; oud staff of the same recordings mean 0.760, median 0.742, range 0.443
  to 0.996.
- Voice stem voiced fraction (63): mean 0.47, median 0.49, IQR 0.35 to 0.56,
  range 0.15 to 0.75.
- Kept notes per minute (91): mean 115.4, median 115.8, IQR 67.3 to 152.7,
  range 22.7 to 271.3.
- Share of kept notes marked off-scale (91): mean 25.7 percent, median 29.2,
  IQR 6.7 to 39.1, range 0.7 to 52.3.
- Recordings with at least one warning sign: 69 of 91; with two or more: 58.

## 4. What is open

- The listening test on the large A/B set against the medium A/B set has not
  been done; the scaling report names it as the arbiter between the higher
  voiced fraction and the lower PCS at 3.3 B.
- The melody-conditioned run (musicgen-melody) is scripted and unmeasured.
- No transcription in the pool has been corrected by ear. The pool report
  states its figures as properties of the automatic transcriptions, not of the
  music; the five items chosen for annotation are listed in
  `docs/eval/TRANSCRIPTION_STATUS.md`.
- 10 of 91 recordings have an ambiguous tonic; 16 degree positions across the
  eight intervals were not refined for lack of pitch mass; 69 of 91 recordings
  carry at least one warning sign, 58 of them two or more, most of them band
  excerpts.
- The band recordings entered the pool as 90-second excerpts from the start of
  each file, not in full.
- Source audio is not distributed; the adapters were trained on the held
  corpus; the transcription packs stay off the repository.
