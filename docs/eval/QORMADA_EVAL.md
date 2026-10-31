# Qormada transcription accuracy

Measured 2026-10-31 on the code `/transcribe` runs in the browser (`apps/web/lib/qormada`),
driven from the command line by `apps/web/scripts/qormada-eval/transcribe.ts` and scored with
mir_eval by `apps/ai-service/scripts/eval_qormada.py`. This page is written by
`apps/ai-service/scripts/qormada_eval_report.py` from the result files; no number is typed by hand.
Means over tracks with bootstrap 95 % CIs (10,000 resamples, seed 0).

Metrics: **note F1 (COnP)**, a note counts when its onset is within 50 ms and its pitch within
50 cents of an annotated note; **COnPOff** also needs the offset; **RPA** is the share of voiced
reference frames whose pitch is within 50 cents.

## 1. Real singers: vocadito (40 recordings, 29 singers, 7 languages, two annotators)

Bittner et al. 2021, arXiv:2110.05580, CC BY 4.0. Solo voice. The two annotators scored against
each other give the human agreement ceiling; systems are scored against each annotator and averaged.

| system                                  | note F1 (COnP)       | COnPOff F1           | onset F1             | RPA                  | low voices (n = 14) note F1 / RPA |
| --------------------------------------- | -------------------- | -------------------- | -------------------- | -------------------- | --------------------------------- |
| two human annotators                    | 0.740 [0.712, 0.768] | 0.642 [0.602, 0.680] | 0.817 [0.796, 0.837] |                      |                                   |
| **Qormada v2 (this page)**              | 0.687 [0.657, 0.717] | 0.531 [0.491, 0.572] | 0.753 [0.725, 0.781] | 0.936 [0.918, 0.951] | 0.704 / 0.922                     |
| release 2026-10-29 (always high-passed) | 0.667 [0.634, 0.699] | 0.508 [0.468, 0.547] | 0.733 [0.702, 0.765] | 0.896 [0.870, 0.919] | 0.658 / 0.828                     |
| no melody mode (Pitch tab)              | 0.688 [0.659, 0.718] | 0.533 [0.494, 0.572] | 0.747 [0.720, 0.775] | 0.934 [0.917, 0.950] | 0.705 / 0.922                     |

Qormada v2 reaches **93% of the agreement between two human annotators** (note F1).
Against the 2026-10-29 release, paired over the 40 tracks: note F1 +0.020
[+0.010, +0.033] (23 tracks better, 7 worse),
RPA +0.040 [+0.026, +0.056].

## 2. Somali-style synthetic set (24 melodies x 5 conditions = 120 files, exact ground truth)

`apps/ai-service/scripts/synth_somali_bench.py`, seed 2026. Each melody uses one of the five rotations
of the anhemitonic pentatonic set (the qaraami/heello scale family), a global tuning offset drawn from
±40 cents of A440 and a per-note deviation (sd 12 cents), played as a plucked string (oud register) or a
voice-like tone (low or high register), 70–140 BPM. Conditions: clean; + bass line (3 dB under the melody);

- bass and drums; + noise at 20 dB SNR; full mix (bass, drums, reverb, noise). All audio is synthesised.
  The extra columns are what a Somali-music transcriber has to get right: the recording's tuning offset,
  the scale, and each note's own deviation in cents.

| system             | note F1 (COnP)       | RPA                  | tuning offset error (cents) | scale identified | median note cents error |
| ------------------ | -------------------- | -------------------- | --------------------------- | ---------------- | ----------------------- |
| **Qormada v2**     | 0.820 [0.784, 0.854] | 0.845 [0.819, 0.870] | 2.007 [1.746, 2.274]        | 93.3%            | 2.1                     |
| release 2026-10-29 | 0.821 [0.784, 0.855] | 0.842 [0.816, 0.867] | 2.017 [1.753, 2.287]        | 93.3%            | 2.1                     |
| no melody mode     | 0.468 [0.407, 0.533] | 0.547 [0.481, 0.613] | 2.599 [2.294, 2.910]        | 77.5%            | 2.6                     |

By condition and register (Qormada v2 / no melody mode, note F1):

| group                 | n   | Qormada v2 | no melody mode | scale identified (v2) |
| --------------------- | --- | ---------- | -------------- | --------------------- |
| condition: clean      | 24  | 0.993      | 0.876          | 91.7%                 |
| condition: bass       | 24  | 0.767      | 0.267          | 95.8%                 |
| condition: bass_drums | 24  | 0.687      | 0.163          | 95.8%                 |
| condition: noise      | 24  | 0.991      | 0.875          | 91.7%                 |
| condition: full_mix   | 24  | 0.661      | 0.159          | 91.7%                 |
| register: oud         | 40  | 0.825      | 0.499          | 100.0%                |
| register: voice_low   | 40  | 0.796      | 0.451          | 80.0%                 |
| register: voice_high  | 40  | 0.837      | 0.454          | 100.0%                |

Melody mode against none, paired over 120 files: note F1 +0.352 [+0.308, +0.394].
v2 against the release: -0.001 [-0.002, -0.000] (unchanged on mixes by design).

## What changed in v2, and how it was chosen

The release always high-passed the audio at 150 Hz and tracked from 100 Hz, which keeps the tracker off
a bass line but cuts a low singer's fundamental (vocadito low voices: RPA 0.83 against 0.92 without it).
v2 tracks both the high-passed and the direct signal and keeps the direct track only when the two agree
(at least 90 % of frames voiced in both within 50 cents) and the direct track hears at least as many
voiced frames. Lower fixed cut-offs (high-pass / pitch floor 120/85, 100/75 and 90/65 Hz; results in
`data/eval_qormada/sweep/`) were tried first and lost more on mixes than they gained on solo voices.
The rule and its two thresholds
were chosen after looking at both sets, so the vocadito gain is not a held-out result; a new annotated
set is the honest test.

## Speed

14 ms of analysis per second of audio (Node on this Mac; both tracks), so a 3-minute song
takes a few seconds. Browser timing on a phone is not measured here.

## Limits

- vocadito is solo voice; it says nothing about instruments or mixes. The synthetic set does, but
  synthetic plucks and voices are cleaner than real recordings, so its numbers are an upper bound.
- No annotated Somali recording exists yet. The five packs in `data/annotation/` are ready for a
  musician to correct; that is the next and most important test.
- Offsets are hard for every transcriber (COnPOff); sheet-music use depends mostly on onsets and pitch.
- n = 40 and n = 120; CIs are over tracks, not over singers.
