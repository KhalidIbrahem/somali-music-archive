"""Turn token shards into a Hugging Face dataset: Parquet, dataset card, checksums.

Reads shard_*.npy + shard_*.jsonl from `synth_token_corpus.py` and verify.json from
`verify_token_corpus.py`. Every number in the card is computed here. Needs numpy and pyarrow.

    uv run --no-project --with numpy --with pyarrow python -m scripts.assemble_token_corpus \
        --shards ../../dist/token_corpus --out ../../dist/hf_tokens --repo-id <namespace>/<name>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np

CONDITIONS = ("clean", "bass", "bass_drums", "noise", "full_mix")
SPLITS = ("train", "validation", "test")
CODEBOOKS, FRAMES, CODEBOOK_SIZE = 4, 850, 2048
CLIP_SECONDS = 17
ROWS_PER_FILE = 10000
SEED = 20261108


def split_for(item: int, seed: int = SEED) -> str:
    """80/10/10 by melody, so the five renderings of one melody never cross splits."""
    h = int(hashlib.sha256(f"{seed}:{item}".encode()).hexdigest()[:8], 16) % 100
    return "train" if h < 80 else "validation" if h < 90 else "test"


def load_shards(shards: Path):
    paths = sorted(shards.glob("shard_*.npy"))
    if not paths:
        raise SystemExit(f"no shards in {shards}")
    for p in paths:
        metas = [json.loads(line) for line in p.with_suffix(".jsonl").read_text(encoding="utf-8").splitlines()]
        codes = np.load(p)
        if codes.shape != (len(metas) * len(CONDITIONS), CODEBOOKS, FRAMES):
            raise SystemExit(f"{p.name}: shape {codes.shape} does not match {len(metas)} melodies")
        if codes.min() < 0 or codes.max() >= CODEBOOK_SIZE:
            raise SystemExit(f"{p.name}: code outside 0..{CODEBOOK_SIZE - 1}")
        yield metas, codes


def _schemas():
    import pyarrow as pa

    common = [("item", pa.int32()), ("register", pa.string()), ("tonic", pa.int8()), ("scale_pcs", pa.list_(pa.int8())),
              ("bpm", pa.float32()), ("offset_cents", pa.float32()), ("length_sec", pa.float32())]
    clip = pa.schema([("id", pa.string()), ("condition", pa.string()), *common,
                      ("codes", pa.list_(pa.list_(pa.int16(), FRAMES), CODEBOOKS))])
    note = pa.struct([("onset", pa.float64()), ("offset", pa.float64()), ("midi", pa.int16()), ("cents", pa.float64())])
    melody = pa.schema([("id", pa.string()), *common, ("notes", pa.list_(note))])
    return clip, melody


def _common(m: dict) -> dict:
    return {k: m[k] for k in ("item", "register", "tonic", "scale_pcs", "bpm", "offset_cents", "length_sec")}


class PartWriter:
    """Writes one split of one config to data/<config>/<split>-NNNNN-of-MMMMM.parquet."""

    def __init__(self, out: Path, config: str, split: str, total_rows: int, schema) -> None:
        self.out, self.config, self.split, self.schema = out / "data" / config, config, split, schema
        self.parts = max(1, (total_rows + ROWS_PER_FILE - 1) // ROWS_PER_FILE)
        self.part, self.rows, self.writer = 0, 0, None
        self.out.mkdir(parents=True, exist_ok=True)

    def write(self, table) -> None:
        import pyarrow.parquet as pq

        if self.writer is None or self.rows >= ROWS_PER_FILE:
            self.close()
            name = f"{self.split}-{self.part:05d}-of-{self.parts:05d}.parquet"
            self.writer = pq.ParquetWriter(self.out / name, self.schema, compression="zstd", compression_level=9)
            self.part, self.rows = self.part + 1, 0
        self.writer.write_table(table)
        self.rows += table.num_rows

    def close(self) -> None:
        if self.writer is not None:
            self.writer.close()
            self.writer = None


def assemble(shards: Path, out: Path, repo_id: str, scripts_dir: Path) -> dict:
    import pyarrow as pa

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    clip_schema, melody_schema = _schemas()
    counts = dict.fromkeys(SPLITS, 0)
    for metas, _ in load_shards(shards):
        for m in metas:
            counts[split_for(m["item"])] += 1
    w_clip = {s: PartWriter(out, "encodec_32khz", s, counts[s] * len(CONDITIONS), clip_schema) for s in SPLITS}
    w_note = {s: PartWriter(out, "notes", s, counts[s], melody_schema) for s in SPLITS}
    hist = np.zeros((CODEBOOKS, CODEBOOK_SIZE), dtype=np.int64)
    seen, n_notes, rendered = set(), 0, 0.0
    for metas, codes in load_shards(shards):
        for c in range(CODEBOOKS):
            hist[c] += np.bincount(codes[:, c].ravel(), minlength=CODEBOOK_SIZE)
        groups: dict[str, list[int]] = {s: [] for s in SPLITS}
        for j, m in enumerate(metas):
            groups[split_for(m["item"])].append(j)
            seen.add(tuple((n["midi"], round(n["onset"], 4)) for n in m["notes"]))
            n_notes += len(m["notes"])
            rendered += m["length_sec"] * len(CONDITIONS)
        for split, idx in groups.items():
            if not idx:
                continue
            rows = [{"id": f"qsm-{metas[j]['item']:06d}-{c}", "condition": c, **_common(metas[j])} for j in idx for c in CONDITIONS]
            take = np.concatenate([np.arange(j * len(CONDITIONS), (j + 1) * len(CONDITIONS)) for j in idx])
            inner = pa.FixedSizeListArray.from_arrays(pa.array(codes[take].ravel(), type=pa.int16()), FRAMES)
            columns = {name: pa.array([r[name] for r in rows], type=clip_schema.field(name).type) for name in clip_schema.names if name != "codes"}
            columns["codes"] = pa.FixedSizeListArray.from_arrays(inner, CODEBOOKS)
            w_clip[split].write(pa.table(columns, schema=clip_schema))
            melodies = [{"id": f"qsm-{metas[j]['item']:06d}", **_common(metas[j]), "notes": metas[j]["notes"]} for j in idx]
            w_note[split].write(pa.Table.from_pylist(melodies, schema=melody_schema))
    for w in (*w_clip.values(), *w_note.values()):
        w.close()
    n_mel = sum(counts.values())
    if len(seen) != n_mel:
        raise SystemExit(f"{n_mel - len(seen)} duplicate melodies")
    p = hist / hist.sum(axis=1, keepdims=True)
    entropy = [round(float(-(q[q > 0] * np.log2(q[q > 0])).sum()), 3) for q in p]
    stats = {
        "melodies": n_mel, "clips": n_mel * len(CONDITIONS), "tokens": n_mel * len(CONDITIONS) * CODEBOOKS * FRAMES,
        "notes": n_notes, "hours_clip": round(n_mel * len(CONDITIONS) * CLIP_SECONDS / 3600, 1), "hours_rendered": round(rendered / 3600, 1),
        "melodies_by_split": counts, "entropy_bits_by_codebook": entropy,
        "codes_used_by_codebook": [int((h > 0).sum()) for h in hist],
    }
    (out / "scripts").mkdir()
    for name in ("synth_somali_bench.py", "synth_token_corpus.py", "verify_token_corpus.py", "assemble_token_corpus.py"):
        shutil.copyfile(scripts_dir / name, out / "scripts" / name)
    verify = json.loads((shards / "verify.json").read_text(encoding="utf-8"))
    stats["parquet_mb"] = round(sum(f.stat().st_size for f in (out / "data").rglob("*.parquet")) / 1e6, 1)
    (out / "stats.json").write_text(json.dumps({**stats, "verify": verify}, indent=1) + "\n", encoding="utf-8")
    (out / "README.md").write_text(render_card(stats, verify, repo_id), encoding="utf-8")
    files = sorted(f for f in out.rglob("*") if f.is_file())
    (out / "SHA256SUMS").write_text("".join(f"{hashlib.sha256(f.read_bytes()).hexdigest()}  {f.relative_to(out).as_posix()}\n" for f in files), encoding="utf-8")
    return stats


def _size_category(n: int) -> str:
    return "n<1K" if n < 1000 else "1K<n<10K" if n < 10000 else "10K<n<100K" if n < 100000 else "100K<n<1M"


def render_card(s: dict, verify: dict, repo_id: str) -> str:
    cfg = lambda name: "\n".join([f"- config_name: {name}", *(["  default: true"] if name == "encodec_32khz" else []), "  data_files:"]
                                 + [line for sp in SPLITS for line in (f"  - split: {sp}", f"    path: data/{name}/{sp}-*.parquet")])
    table = "\n".join(f"| `{c}` | {v['log_mel_corr']:.3f} | {v['chroma_corr']:.3f} | {v['reencode_match']:.1%} |" for c, v in verify["conditions"].items())
    by = s["melodies_by_split"]
    return f"""---
pretty_name: QaraamiGen Synthetic Melody Tokens
license:
- cc-by-nc-4.0
- cc-by-4.0
tags:
- music
- audio
- encodec
- musicgen
- synthetic
- pentatonic
- music-transcription
size_categories:
- {_size_category(s['clips'])}
configs:
{cfg('encodec_32khz')}
{cfg('notes')}
---

# QaraamiGen Synthetic Melody Tokens

**{s['tokens']:,} EnCodec tokens from {s['clips']:,} synthetic clips of {s['melodies']:,} pentatonic melodies ({s['hours_rendered']:,} hours of rendered audio), with {s['notes']:,} exact note labels.**

**This dataset is synthetic. It contains no recording of any musician, and its melodies are random walks on a pentatonic scale, not Somali compositions.** Do not present it as Somali music.

It belongs to [QaraamiGen](https://www.qaraamigen.com), a research programme on Somali *qaraami*. Real Somali recordings stay private under that programme's rights rules; this set exists so that pipelines, transcribers and token-level models can be built and tested in the open, on material with exact ground truth and nothing to clear.

## Contents

| Config | One row is | Rows | Use |
| --- | --- | ---: | --- |
| `encodec_32khz` (default) | one 17-second clip as codec tokens | {s['clips']:,} | token-level models, codec studies |
| `notes` | one melody with its exact notes | {s['melodies']:,} | transcription ground truth, symbolic models |

Splits are by melody, so the five renderings of a melody never cross a split: {by['train']:,} train, {by['validation']:,} validation and {by['test']:,} test melodies.

## Token format

`codes` has shape (4, 850): 4 codebooks by 850 frames at 50 Hz, with integer values from 0 to 2047. The tokenizer is [`facebook/encodec_32khz`](https://huggingface.co/facebook/encodec_32khz) at 2.2 kbps, the one every MusicGen size shares. Every clip is 17 seconds; audio after `length_sec` is digital silence.

## Fields

`encodec_32khz`: `id`, `condition`, `item`, `register`, `tonic`, `scale_pcs`, `bpm`, `offset_cents`, `length_sec`, `codes`. `notes`: the same melody fields plus `notes`, a list of `{{onset, offset, midi, cents}}` in seconds. A note's fundamental is `440 · 2^((midi + cents/100 − 69)/12)` Hz.

## How it was made

`scripts/synth_somali_bench.py` draws a melody as a random walk on one of the five rotations of the anhemitonic pentatonic set, at 70 to 140 BPM, with a global tuning offset within ±40 cents and a per-note deviation (sd 12 cents, clipped at ±30). A Karplus–Strong plucked string or a harmonic voice-like source plays it, rendered at 32 kHz in five conditions: `clean`, `bass`, `bass_drums`, `noise` (20 dB SNR) and `full_mix` (bass, drums, reverb, noise).

Each melody has its own random stream, so its audio can be regenerated exactly from the shipped scripts. Audio is not shipped, because the tokens are the product and the audio is reproducible:

```python
# Run from the folder that holds scripts/. Needs numpy and soundfile.
from scripts.synth_token_corpus import render_item
meta, clips = render_item(4321)  # five clips of melody 4321, shape (5, 544000), 32 kHz
```

## Measured quality

Measured on {verify['melodies']} melodies spread across the set by `scripts/verify_token_corpus.py`. The first two columns compare decoded tokens with the original audio. The last is how many tokens match when a clip is re-encoded alone.

| Condition | Log-mel correlation | Chroma correlation | Re-encoding match |
| --- | ---: | ---: | ---: |
{table}

Entropy per codebook is {', '.join(str(x) for x in s['entropy_bits_by_codebook'])} bits of a possible 11. All {s['melodies']:,} melodies are distinct.

## Loading and decoding

```python
import numpy as np, torch
from datasets import load_dataset
from transformers import EncodecModel

clip = next(iter(load_dataset("{repo_id}", "encodec_32khz", split="train", streaming=True)))
codes = torch.tensor(np.array(clip["codes"])).long()[None, None]
model = EncodecModel.from_pretrained("facebook/encodec_32khz").eval()
audio = model.decode(codes, [None]).audio_values[0, 0]  # mono, 32 kHz
```

## Limitations

- **Synthetic timbres.** There is no room, performer, ornament or cassette in this data, so results on it bound real-world performance from above.
- **Random-walk melodies.** They have no phrase structure or cadence. A model trained on them learns pentatonic note statistics, not style.
- **Five renderings per melody.** The clip count overstates independent musical content; count melodies when reasoning about diversity.
- **Lossy tokens.** At 2.2 kbps the codec discards detail, as the table above shows.

## Licences

- Tokens (`encodec_32khz`): CC BY-NC 4.0. The encoder comes from Meta's AudioCraft release, whose weights are CC BY-NC 4.0, so non-commercial is the conservative reading.
- Notes (`notes`): CC BY 4.0.
- Scripts: Apache-2.0.

## Citation

```bibtex
@misc{{qaraamigen_synthetic_tokens_2026,
  author       = {{Ibrahim, Khalid}},
  title        = {{QaraamiGen Synthetic Melody Tokens}},
  year         = {{2026}},
  howpublished = {{Hugging Face dataset}},
  url          = {{https://huggingface.co/datasets/{repo_id}}}
}}
```
"""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--shards", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--repo-id", required=True)
    args = ap.parse_args()
    stats = assemble(args.shards, args.out, args.repo_id, Path(__file__).resolve().parent)
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
