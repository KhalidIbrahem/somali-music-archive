"""Build the before/after pairs of the public Listen page from generated candidates.

    python -m scripts.listen_pairs_build --cand <dir with candNN_{base,oud}.{wav,json}> [--keep 4]

Input: pairs generated through the local service with the same prompt, seed and
cfg on both sides (`base` = facebook/musicgen-small as published, `oud` = the same
model with the oud adapter). They are NOT the /study stimuli.

Output, all under apps/web/:
  public/demos/generated/pair_NN_{base,oud}.mp3   (-16 LUFS, 160 kbps)
  lib/listen-pairs.json                           (what the page renders)
  public-audio-rights.json                        (one entry per file)

Selection is by a fixed rule, printed on the page with the means over every
candidate: the `--keep` pairs with the largest gain in voiced fraction among
pairs where both sides could be scored. `listenFor` is drafted from the
measurements and kept if someone has edited it in listen-pairs.json.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import librosa
import numpy as np

REPO = Path(__file__).resolve().parents[3]
WEB = REPO / "apps" / "web"
SIDES = {
    "base": ("musicgen_small_base", "MusicGen-small as published"),
    "oud": ("oud", "MusicGen-small + oud adapter"),
}


def flatness(wav: Path) -> float:
    y, _ = librosa.load(wav, sr=32000, mono=True)
    return float(np.mean(librosa.feature.spectral_flatness(y=y)))


def load(cand: Path) -> list[dict]:
    rows = []
    for base_meta in sorted(cand.glob("cand*_base.json")):
        stem = base_meta.name.split("_")[0]
        pair = {"stem": stem}
        for side in SIDES:
            meta = json.loads((cand / f"{stem}_{side}.json").read_text())
            wav = cand / f"{stem}_{side}.wav"
            pcs = meta.get("pcs") or {}
            pair[side] = {
                "wav": wav,
                "scored": bool(pcs.get("scored")),
                "pcs": pcs.get("pcs"),
                "voiced": pcs.get("voiced_fraction"),
                "offset": pcs.get("tuning_offset_cents"),
                "flatness": round(flatness(wav), 4),
            }
            pair.update(prompt=meta["prompt"], seed=meta["seed"], duration=meta["duration"])
        rows.append(pair)
    return rows


def title(prompt: str) -> str:
    bpm = prompt.split(" BPM")[0].split(" ")[-1]
    tonic = prompt.split("rooted on ")[1].split(",")[0]
    return f"Qaraami on {tonic}, {bpm} BPM"


def draft_listen_for(p: dict) -> str:
    b, t = p["base"], p["oud"]
    parts = [
        "the plucked melody line. A pitch tracker follows "
        f"{round(t['voiced'] * 100)} % of the fine-tuned clip and {round(b['voiced'] * 100)} % of the base."
    ]
    if t["flatness"] > 2 * b["flatness"]:
        parts.append("The fine-tuned clip also has more hiss, learned from the home recordings.")
    if abs(t["offset"]) >= 15:
        way = "flat" if t["offset"] < 0 else "sharp"
        parts.append(f"It sits {abs(round(t['offset']))} cents {way} of concert pitch.")
    return " ".join(parts)


def encode(src: Path, dst: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
         "-ar", "44100", "-ac", "1", "-b:a", "160k", "-map_metadata", "-1", str(dst)],
        check=True,
    )


def mean(rows: list[dict], side: str, key: str) -> float:
    return float(np.mean([r[side][key] for r in rows]))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cand", type=Path, required=True)
    ap.add_argument("--keep", type=int, default=4)
    args = ap.parse_args()

    rows = load(args.cand)
    scored = [r for r in rows if r["base"]["scored"] and r["oud"]["scored"]]
    ranked = sorted(scored, key=lambda r: r["oud"]["voiced"] - r["base"]["voiced"], reverse=True)
    kept = sorted(ranked[: args.keep], key=lambda r: r["stem"])

    out_json = WEB / "lib" / "listen-pairs.json"
    old = json.loads(out_json.read_text()) if out_json.exists() else {"pairs": []}
    old_lines = {(p["prompt"], p["seed"]): p["listenFor"] for p in old.get("pairs", [])}

    manifest_path = WEB / "public-audio-rights.json"
    manifest = json.loads(manifest_path.read_text())
    audio_dir = WEB / "public" / "demos" / "generated"

    pairs = []
    for n, r in enumerate(kept, start=1):
        entry = {
            "id": f"pair-{n:02d}",
            "title": title(r["prompt"]),
            "prompt": r["prompt"],
            "seed": r["seed"],
            "durationSec": r["duration"],
            "listenFor": old_lines.get((r["prompt"], r["seed"])) or draft_listen_for(r),
        }
        for side, key in (("base", "base"), ("oud", "tuned")):
            adapter, label = SIDES[side]
            name = f"pair_{n:02d}_{side}.mp3"
            encode(r[side]["wav"], audio_dir / name)
            entry[key] = {
                "file": f"/demos/generated/{name}",
                "label": label,
                "pcs": r[side]["pcs"],
                "voiced": r[side]["voiced"],
                "flatness": r[side]["flatness"],
            }
            manifest["files"][f"apps/web/public/demos/generated/{name}"] = {
                "kind": "model_output",
                "adapter": adapter,
                "rights": "releasable",
                "source": f"data/portfolio/listen_pairs/{r['stem']}_{side}.wav",
            }
        pairs.append(entry)

    note = (
        f"{len(kept)} of {len(rows)} prompt-and-seed pairs generated on 2026-11-21, kept for the largest gain in "
        f"trackable melody ({len(scored)} of {len(rows)} could be scored on both sides). Over those {len(scored)}: melody "
        f"{round(mean(scored, 'base', 'voiced') * 100)} % base against {round(mean(scored, 'oud', 'voiced') * 100)} % "
        f"fine-tuned, PCS {mean(scored, 'base', 'pcs'):.2f} against {mean(scored, 'oud', 'pcs'):.2f}, noise "
        f"{mean(rows, 'base', 'flatness'):.3f} against {mean(rows, 'oud', 'flatness'):.3f}. "
        "None of these clips is in the listening study."
    )
    restoration = old.get("restoration") or {
        "title": "Cassette restoration: raw, then restored",
        "note": (
            "Placeholder. The restoration study ran on archival cassette transfers that are research-only, so no "
            "raw or restored clip from it can be played here. A pair made from a rights-clear recording will "
            "replace this note. The measured result is in the evaluation summary."
        ),
    }
    out_json.write_text(json.dumps({"selectionNote": note, "pairs": pairs, "restoration": restoration}, indent=2, ensure_ascii=False) + "\n")
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    for r in rows:
        mark = "KEEP" if r in kept else "    "
        print(mark, r["stem"], {s: (r[s]["scored"], r[s]["pcs"], r[s]["voiced"], r[s]["offset"], r[s]["flatness"]) for s in SIDES})
    print(note)


if __name__ == "__main__":
    main()
