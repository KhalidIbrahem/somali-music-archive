# Somali music corpus inventory (Stage 1, 2026-09-04)

Every Somali music audio source found on this Mac, the external SSD, and the M1
(`khalid-m1-server`, read-only over Tailscale). Measured by
`apps/ai-service/scripts/corpus_inventory.py` (ffprobe duration/rate/channels;
Silero VAD vocal estimate; librosa HPSS percussive ratio). Per-file records in
`data/inventory/<source>.jsonl`; aggregates in `data/inventory/summary.json`.
Nothing was uploaded; the oud source was copied M1→this Mac (both Khalid's
devices) to allow 30 s clipping.

## The number that decides everything

**43.1 hours** of Somali qaraami audio exist across all devices, **all of it
usable for research** under the rules (training on held audio is permitted),
and **0 hours cleared for any public artifact** (Harvard permission
outstanding; the oud and band material is held by its performers/holders).

| split | hours | note |
| --- | --- | --- |
| total | **43.14** | 342 files, 330 unique by content |
| rights-cleared for public use | **0.00** | nothing may leave the research context yet |
| research-usable (held) | **43.14** | all of it |
| vocals-likely (VAD) | 5.83 | **floor, not truth** — see caveat |
| instrumental-likely (VAD) | 28.45 | overcounts: the VAD misses sung melisma |
| uncertain (VAD) | 8.86 | |

**Vocals caveat (important).** The vocal split uses Silero *speech* VAD.
Sung Somali (long vowels, melisma, ornament) triggers a speech detector far
less than talking does, so these numbers *undercount* singing badly — the oud
qaraami reads as 0.00 h "vocals" although those tracks are sung. Read the
split as "how speech-like the vocal is," not "has vocals." The true position:
**most of the 43 h is sung qaraami**; only a minority is purely instrumental
(oud/drum passages). A singing-specific detector would move most of the
"instrumental" and "uncertain" hours into "vocal." This matters for Stage 3
(vocal models): there is enough sung material to *attempt* a vocal fine-tune,
but not the tens of hours of clean, aligned lyric-audio pairs a from-scratch
lyrics-to-song model would want.

## By source

| source | files | unique | hours | rights | SR / ch | perc. ratio | character |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `harvard_raw` | 105 | 105 | 22.64 | **NOT cleared** — Harvard Loeb (AWM Spec Coll 103); letter outstanding | 44.1k / stereo | 0.149 | mid-century ensemble songs (vocals), low percussion; trained the `harvard_raw` adapter |
| `oud_ilkacase` | 40 | **28** | 5.41 | private — Ilkacase Qays; performers held; not redistributed | 44.1k / stereo | 0.342 | oud (kaban)-led qaraami with hand-drums; dedups to the 28 songs behind the `oud` adapter |
| `band_qaraami` | 197 | 197 | 15.09 | unknown/mixed — GarageBand/Logic imports; some artist-named (archival), some "No Effects" takes | 44.1k / mono+stereo | 0.282 | the new material: sung qaraami with oud and drums, richer vocal content |
| **total** | 342 | 330 | **43.14** | all research-only, none public | 44.1k | | |

`band_qaraami` is the find of this inventory: 197 unique-by-content qaraami
recordings inside 49 `.band` projects on the SSD (deduplicated from 508
candidate paths across mirrored GarageBand/Logic/multi-agent copies). It
roughly doubles the non-Harvard qaraami and carries the most vocal content.

## What was ruled out (not Somali qaraami source audio)

- `Desktop/MIT PHD/cuud/*.wav` — model-generated / synthesised oud melodies
  (from `music_generator_base.py`), not recordings. Excluded.
- Logic/GarageBand factory sample libraries (Alchemy, Ultrabeat, Salamander
  piano, orchestral) — Western instrument samples. Excluded by the Somali-name
  and location filter.
- `data/clips*`, `data/eval_gen`, `runs/*/samples`, `services/musicgen-api/outputs`
  — the project's own processed clips and generated outputs. Not source.
- M1 `qaraamigen_musicgen_dataset` (×3) and `tune_synthesis/samples` — already
  the segmented Harvard set and synthesis experiments; the raw Harvard MP3s are
  the canonical source and are inventoried above.

## For Stage 2 / Stage 3

- **Instrumental scaling (Stage 2):** all three groups feed the 30 s dataset
  with Somali captions (genre/instrument/era/artist tags). Song-level splits
  by content hash; the oud's 28 songs and Harvard's 105 tracks and the band's
  197 give ~330 songs — enough for LoRA on a 1.5–3.3 B model, not for
  full-model training.
- **Vocal songs (Stage 3):** ~5.8 h VAD-vocal (floor) up to most of 43 h sung;
  enough to try an ACE-Step LoRA, far short of what a from-scratch vocal model
  needs. The corpus-hours answer for the application: **you have ~43 h of
  Somali qaraami for research, ~0 h cleared for public release, and to go
  meaningfully further you need either the Harvard letter (unlocks 22 h) or
  new consented recordings — instrumental hours are adequate for adapters,
  clean vocal-with-aligned-lyrics hours are the real scarcity.**

Regenerate: `python -m scripts.corpus_inventory --sources <sources.json> --out data/inventory --no-crepe`.
