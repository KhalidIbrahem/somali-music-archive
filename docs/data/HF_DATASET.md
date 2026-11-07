# The public reference dataset — "QaraamiGen — Somali Music Reference Dataset"

A Hugging Face dataset assembled from this repository by
`apps/ai-service/scripts/build_hf_dataset.py` (tests:
`apps/ai-service/tests/test_build_hf_dataset.py`). Built 2026-11-07 (v0.1,
983 rows, 699 files, 565 MB) into `dist/hf_dataset/` (git-ignored). **Nothing
has been uploaded**: there is no Hugging Face token on this machine and
publishing is Khalid's decision (§4).

## 1. The rights rule (why this dataset is "clean")

Only material the project may redistribute enters the dataset, and the script
enforces it: every source path passes one gate (`assert_readable`) that rejects
anything outside an allow-list and anything matching the deny-list
(`data/raw_incoming`, `data/harvard*`, `data/ahmed*`, `data/sets`,
`data/scale_clips`, `data/clips*`, `data/v3`, `data/v4`, `data/annotation`,
`apps/web/public/audio/`). Model output is accepted only when its file is a
`model_output` / `releasable` entry of `apps/web/public-audio-rights.json`
**and** its adapter's `docs/eval/MODEL_CARD_<adapter>.md` carries
`**Rights class:** \`releasable\``. `MANIFEST.json` records every file's sha256,
source path and the rights evidence. The card leads with what is deliberately
absent: no Harvard Loeb recordings (research-only until the Loeb letter), no
performer source audio (consented for training, not redistribution), no
annotated Somali recordings yet.

## 2. Subsets

| subset | rows | what | licence |
| --- | --- | --- | --- |
| `generated_audio` | 558 MP3 (`gallery/` 472, `generate/` 6, `study/` 80) + `metadata.jsonl` | every QaraamiGen generation already public on the site, with model, adapter, checkpoint, prompt, seed, duration, PCS, voiced ratio, band SNR, the study pair/comparison and loudness | ACE-Step-based adapters CC BY 4.0; MusicGen-based (`oud`, `musicgen_small_base`) CC BY-NC 4.0 (Meta's weights are CC-BY-NC) — per row |
| `synth_bench` + `synth_bench_truth` | 120 WAV + `metadata.jsonl` + `truth.jsonl` + the generator `synth_somali_bench.py` | the Somali-style synthetic transcription benchmark (24 pentatonic melodies × 5 conditions, exact note/tuning ground truth) | CC BY 4.0 |
| `symbolic` | Beerdilaacshe `.ly`, `.midi`, `.pdf`, `.png`, `notes.json` + `metadata.jsonl` | Khalid Ibrahim's engraving of Abdillahi Qarshe's 1950s melody | engraving CC BY 4.0; the melody's copyright status is flagged for the owner |
| `glossary` | 72 rows (`glossary.jsonl`, the fields of `apps/web/lib/learn/glossaryTypes.ts`) | the Somali music reverse dictionary with sources and confidence | CC BY 4.0 |
| `listening` | `trials.jsonl` 232 rows, `summary.jsonl` | every blind listening sitting (set, date, protocol, pair, choice) | CC BY 4.0 |
| `results` | `TABLES.md`, the releasable model cards | evaluation tables and provenance | CC BY 4.0 |

Loading (no script; README `configs` + audiofolder metadata):

```python
from datasets import load_dataset
ds = load_dataset("<namespace>/qaraamigen-somali-music-reference", "glossary")
audio = load_dataset("<namespace>/qaraamigen-somali-music-reference", "generated_audio")
```

## 3. Build and check

```bash
cd ~/Projects/sma-studio-v3            # or the checkout that holds apps/ and docs/
~/ai/musicgen-env/bin/python apps/ai-service/scripts/build_hf_dataset.py \
  --repo-root . --data-root ~/Projects/somali-music-archive \
  --out dist/hf_dataset --copy-audio --repo-id <namespace>/qaraamigen-somali-music-reference
~/ai/musicgen-env/bin/python apps/ai-service/scripts/build_hf_dataset.py \
  --repo-root . --data-root ~/Projects/somali-music-archive --out dist/hf_dataset --check
cd apps/ai-service && ~/ai/musicgen-env/bin/python -m pytest -q tests/test_build_hf_dataset.py
```

`--check` re-reads `MANIFEST.json`, verifies every sha256, every JSONL, every
rights evidence line and the deny-list, prints the per-subset table and exits
non-zero on any failure. Re-run the build after changing the glossary
(`apps/web/lib/learn/glossary.json`), the published clips or a model card.

## 4. Publishing (Khalid)

1. `~/ai/musicgen-env/bin/python -c "from huggingface_hub import login; login()"`
   (or export `HF_TOKEN`) with a **write** token.
2. Push **private** first:
   `… build_hf_dataset.py --repo-root . --data-root ~/Projects/somali-music-archive --out dist/hf_dataset --push --repo-id <namespace>/qaraamigen-somali-music-reference`
   (`--push` runs `--check` first, creates the repo private, uploads the folder).
3. Review the card and the viewer on the Hub; then re-run with `--public`
   (or switch in Settings), mint the DOI in the repo settings, and add the
   citation to `README.md` and `CITATION.cff`.
4. Version changes by tag (`v0.1`, `v0.2`); never rewrite a published version.

## 5. Adding a subset

Add a `build_<subset>()` method that reads only through `assert_readable`,
writes `<subset>/metadata.jsonl` (+ files) via `copy_file` / `add_file`, add a
`configs:` entry in the card template and a row in `SUBSET_TABLE`, and a test
with a tiny fixture under `tests/test_build_hf_dataset.py`.
