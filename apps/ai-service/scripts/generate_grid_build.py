"""Build the prompt-and-seed picker of the public Generate page from a generated grid.

    python -m scripts.generate_grid_build --grid <dir with p{i}_s{seed}_{base,oud}.{wav,json}>

Input: every prompt x seed generated through the local service on both sides
(`base` = facebook/musicgen-small as published, `oud` = the same model with the
oud adapter), cfg 3, 15 s, batch 1. Not the /study stimuli.

Output under apps/web/: public/demos/generated/gen_p{i}_s{seed}_{side}.mp3
(-16 LUFS, 160 kbps), lib/generate-grid.json, and one public-audio-rights.json
entry per file. Every clip of the grid is published; nothing is selected.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from scripts.listen_pairs_build import SIDES, WEB, encode


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grid", type=Path, required=True)
    a = ap.parse_args()

    manifest_path = WEB / "public-audio-rights.json"
    manifest = json.loads(manifest_path.read_text())
    audio_dir = WEB / "public" / "demos" / "generated"

    prompts: dict[int, dict] = {}
    seeds: set[int] = set()
    clips: dict[str, dict] = {}
    seconds: list[float] = []
    for meta_path in sorted(a.grid.glob("p*_s*_*.json")):
        m = re.fullmatch(r"p(\d+)_s(\d+)_(base|oud)", meta_path.stem)
        if not m:
            continue
        i, seed, side = int(m.group(1)), int(m.group(2)), m.group(3)
        meta = json.loads(meta_path.read_text())
        bpm = re.search(r"(\w+) at (\d+) BPM", meta["prompt"])
        tonic = re.search(r"rooted on ([A-G]#?)", meta["prompt"])
        prompts[i] = {"id": i, "label": f"{bpm.group(1).capitalize()}, {bpm.group(2)} BPM, on {tonic.group(1)}", "prompt": meta["prompt"]}
        seeds.add(seed)
        name = f"gen_{meta_path.stem}.mp3"
        encode(meta_path.with_suffix(".wav"), audio_dir / name)
        pcs = meta.get("pcs") or {}
        clips[f"p{i}_s{seed}_{'tuned' if side == 'oud' else 'base'}"] = {
            "file": f"/demos/generated/{name}",
            "pcs": pcs.get("pcs"),
            "voiced": pcs.get("voiced_fraction"),
        }
        seconds.append(meta["generation_seconds"])
        manifest["files"][f"apps/web/public/demos/generated/{name}"] = {
            "kind": "model_output",
            "adapter": SIDES[side][0],
            "rights": "releasable",
            "source": f"data/portfolio/generate_grid/{meta_path.stem}.wav",
        }

    out = {
        "durationSec": 15,
        "cfg": 3.0,
        "medianGenerationSeconds": round(sorted(seconds)[len(seconds) // 2], 1),
        "labels": {"base": SIDES["base"][1], "tuned": SIDES["oud"][1]},
        "prompts": [prompts[i] for i in sorted(prompts)],
        "seeds": sorted(seeds),
        "clips": clips,
    }
    expected = len(out["prompts"]) * len(out["seeds"]) * 2
    assert len(clips) == expected, f"grid incomplete: {len(clips)} of {expected} clips"
    (WEB / "lib" / "generate-grid.json").write_text(json.dumps(out, indent=2) + "\n")
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(len(clips), "clips;", out["medianGenerationSeconds"], "s median generation;", [p["label"] for p in out["prompts"]])


if __name__ == "__main__":
    main()
