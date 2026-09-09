# Cassette restoration: stationary spectral subtraction, measured (2026-09-08)

*Generated from `data/clips_restored/restore_summary_*.json`, `runs/harvard_restored/test_ce.json` and `runs/harvard_restored/generation_compare.json` by the snippet in the commit that added this file.*

## Question

The Harvard cassettes have a median SNR of 9.5 dB. DeepFilterNet, the pipeline's `clean` stage, was tested clip for clip on 2026-09-03 and rejected as training data: it removed a median 15.55 dB, mostly the 1–3 kHz band, left a waveform correlating 0.41 with the raw clip, and the adapter trained on its output was worse than base on raw audio (4.8705 vs 4.8363). Can the archive-style alternative, a stationary noise profile subtracted with a floor, remove hiss without removing the music?

## Method

`apps/ai-service/scripts/restore_clips.py`: STFT 2048/512; noise PSD = per-bin median over the quietest 15% of frames; Wiener-style gain max(1 − α·N/|X|², floor) smoothed 3×3; iSTFT; −14 LUFS. Nothing is learned, so nothing is hallucinated, and the floor bounds what any cell can lose.

## Strength sweep on 64 held-out test clips (medians)

| α / floor | energy removed dB | 1–3 kHz share raw → out | waveform corr | band SNR dB (raw 4.7) | 95% rolloff Hz (raw 3164) | MERT cosine raw vs out |
| --- | --- | --- | --- | --- | --- | --- |
| 1.0 / 8 dB | 0.77 | 0.0973 → 0.096 | 0.9928 | 8.12 | 2703 | 0.9905 |
| 1.5 / 12 dB | 1.025 | 0.0973 → 0.095 | 0.9878 | 9.585 | 2387 | 0.9826 |
| 2.0 / 18 dB | 1.24 | 0.0973 → 0.0948 | 0.983 | 11.365 | 2219 | 0.9747 |
| 2.5 / 24 dB | 1.415 | 0.0973 → 0.0948 | 0.979 | 12.645 | 2109 | 0.9684 |

DeepFilterNet on the same corpus: 15.55 dB removed, correlation 0.41. The chosen setting for the transfer test is 1.5 / 12 dB.

## Transfer test (the protocol that rejected DeepFilterNet)

Every clip restored, EnCodec tokens, a 1,500-step MusicGen-small LoRA run identical to `harvard_raw`, then held-out test cross-entropy on 128 clips.

| tokens scored | base | raw-trained adapter (1500) | restored-trained adapter (1500) | DeepFilterNet-trained adapter |
| --- | --- | --- | --- | --- |
| restored | 4.6151 | 4.5574 | **4.5305** | – |
| raw (the untouched tapes) | 4.8363 | **4.7585** | 4.7756 | 4.8705 (worse than base) |

The restored-trained adapter beats the base model on the raw tapes by 0.0607 nats, 78% of the raw-trained adapter's gain: the restored corpus is the same music, not an altered one. Training on raw audio remains the better density model of raw audio.

## What the two adapters generate

Same 8 Harvard captions and seeds, 10 s, MusicGen-small (`data/ab_restore_gen/`, pairNNN_base = raw-trained, pairNNN_adapter = restored-trained).

| adapter trained on | band SNR dB | 95% rolloff Hz | PCS | voiced fraction |
| --- | --- | --- | --- | --- |
| raw clips | 4.662 | 3144 | 0.717 | 0.663 |
| restored clips | 11.29 | 1533 | 0.762 | 0.607 |

Reference points: real cassette clips 4.5 dB, real oud home recordings 8.3, base MusicGen 10.4; the large adapter after preference optimisation 19.8 dB at a 9.7 kHz rolloff.

## Reading

Restoration removes the hiss the adapter would otherwise reproduce: generated band SNR rises from cassette level to above the real oud recordings, with melody unchanged. The cost is bandwidth. On these tapes the top band is mostly hiss, the floor trims it, and the adapter learns a corpus whose output rolls off near 1.5 kHz. Two ways to have clean output are now measured: restore the input (costs brightness, keeps diversity) or optimise the output (Stage 5: keeps brightness, costs diversity). A gentler floor (1.0 / 8 dB keeps the rolloff at 2.7 kHz) or a floor that rises with frequency is the next thing to try; combining restored training with preference optimisation is the other. Listening sets: `data/ab_restore_harvard/` (raw vs restored clip), `data/ab_restore_gen/` (what each adapter generates).
