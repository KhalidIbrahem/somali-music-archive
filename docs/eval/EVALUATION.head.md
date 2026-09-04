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
