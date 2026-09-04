# Stage 3 survey — open-weight lyrics-to-song models (2026-09-04, verified live)

The scaled MusicGen work (Stage 2) generates instrumental qaraami: oud, drums,
and vocal-*like* texture, but not sung Somali lyrics. Qaraami identity lives in
the sung line, so vocal song generation needs a lyrics-to-song model. This
surveys the open-weight options available now, for the 128 GB M5 Max, under a
license compatible with research use. Weights and generation stay on this
machine; nothing is uploaded.

## Candidates (all Apache-2.0)

| model | params | arch | license | Mac/MPS | fine-tune / LoRA | vocals from lyrics | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **ACE-Step** | 3.5B | LM planner + diffusion renderer (DCAE + linear transformer) | Apache 2.0 | **Yes** — documented macOS path (`--bf16 false`), published M2 Max benchmark (RTF 2.27×, i.e. faster than real time) | **Yes** — `TRAIN_INSTRUCTION.md`, LoRA training, ships a "RapMachine" LoRA and a "Lyric2Vocal" LoRA | Yes (Lyric2Vocal LoRA) | Smallest of the three, fastest on Mac, most controllable; strongest fit |
| DiffRhythm (‑full / v2) | ~DiT ≈ 2.2 GB | latent diffusion, block flow matching | Apache 2.0 | Likely (torch/diffusers) — not benchmarked on Mac in docs | code + DiT weights open; fine-tune support not clearly documented | Yes, full-length (~4 min) | Very fast synthesis; weaker long-range structure; lyric-faithfulness lower than ACE-Step |
| YuE (s1-7B) | 7B (two-stage) | LM-only autoregressive over codec tokens | Apache 2.0 | **Unconfirmed** — no MPS support stated; AR 7B on MPS would be slow | fine-tune scripts exist (community) | Yes, best lyric alignment | Most capable for lyric alignment, but heaviest and slowest; MPS unverified |

Sources: ACE-Step (arXiv 2506.00045; github.com/ace-step/ACE-Step),
DiffRhythm (github.com/ASLP-lab/DiffRhythm; HF ASLP-lab/DiffRhythm-full),
YuE (github.com/multimodal-art-projection/YuE; HF m-a-p/YuE-s1-7B-anneal-en-*).

## Ranking for this machine and this use

1. **ACE-Step** — Apache 2.0, Mac-native with a real M2 Max benchmark, LoRA
   fine-tuning with a documented path, an existing lyrics-to-vocal LoRA, and
   3.5B fits with enormous headroom in 128 GB. Best feasibility *and* the only
   one with both Mac support and fine-tuning confirmed from primary docs.
2. **DiffRhythm** — smallest and fastest, Apache 2.0, full-length with vocals;
   good for quick zero-shot samples, but fine-tuning support and Mac
   performance are unverified, and control/lyric-faithfulness is lower.
3. **YuE** — best lyric alignment on paper, but 7B autoregressive with no
   stated MPS support; would be the slowest to run and to fine-tune here.

## Plan for the top candidate (ACE-Step) — Stage 3 next steps

Deferred until the Stage 2 medium run is launched (they share the GPU; the
memory guard keeps total wired memory < 90 GB). Steps, none of which train yet:

1. `uv venv --python 3.11 ~/ai/ace-step-env`; install ACE-Step from its repo
   into that env (its own dependency tree, isolated from `~/ai/musicgen-env`).
2. Download the 3.5B weights to the HF cache.
3. Generate three zero-shot samples from Somali lyrics in `data/lyrics/`
   (placeholder qaraami verse if the folder is empty), on the documented macOS
   path (`--bf16 false`), to `data/ace_step_zeroshot/`.
4. Report: does it produce intelligible sung Somali, what does it get wrong
   (phonology, melody), and is LoRA fine-tuning on our corpus realistic given
   the corpus hours (Stage 1) and the model's data format.

**Rights note:** fine-tuning ACE-Step on the qaraami corpus would put sung
archival material into a vocal model. The same rules apply: research only,
nothing uploaded, every output labelled, and the Harvard-derived portion stays
inside the research context until the Loeb letter clears. The corpus-hours
question (Stage 1) decides whether a vocal fine-tune is even worth attempting.
