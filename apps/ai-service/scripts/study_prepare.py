"""Prepare the public blind listening study (apps/web /study) from local A/B sets.

Only sets whose both sides are releasable are used (DATA_PROVENANCE.md; the
rights gate re-checks every file at build time):

* oud     — MusicGen small, base vs the `oud` adapter (10 s clips)
* cleanoud — ACE-Step 1.5 base vs the `ace_clean_oud` adapter (first 20 s)
* songs   — ACE-Step 1.5 base vs the `ace_songs_v4` adapter, Somali lyrics (first 20 s)

Every clip is loudness-matched (EBU R128, -16 LUFS, a louder clip would win
on loudness alone), faded out over the last 0.5 s, and encoded as 44.1 kHz
mono MP3 under an opaque name, so neither the file name nor the level tells
a listener which side is which. Writes:

* apps/web/public/study/<id>.mp3
* apps/web/lib/study/stimuli.json   — what the page needs (no conditions)
* apps/ai-service/study/key.json    — id -> set, pair, condition, adapter, caption, seed (for the analysis);
  git-ignored, the only record of which clip is which
* entries in apps/web/public-audio-rights.json (both models of the pair, not the clip's own)

Rerunning replaces every clip under new random ids and overwrites the key.

    python apps/ai-service/scripts/study_prepare.py --data ~/Projects/somali-music-archive/data --repo .
"""

from __future__ import annotations

import argparse
import json
import re
import secrets
import subprocess
from pathlib import Path

SETS = [
    {
        "id": "oud",
        "dir": "oud_ab_listening",
        "label": "Solo oud (MusicGen small)",
        "sides": {"base": ("base", "musicgen_small_base"), "adapter": ("finetuned", "oud")},
        "seconds": None,
    },
    {
        "id": "cleanoud",
        "dir": "ab_stage3_acelora_vs_acebase",
        "label": "Solo oud (ACE-Step)",
        "sides": {"base": ("base", "acestep_base"), "adapter": ("adapter", "ace_clean_oud")},
        "seconds": 20.0,
    },
    {
        "id": "songs",
        "dir": "ab_stageC_v4_vs_acebase",
        "label": "Songs with Somali lyrics (ACE-Step)",
        "sides": {"base": ("base", "acestep_base"), "adapter": ("adapter", "ace_songs_v4")},
        "seconds": 20.0,
    },
]
FADE = 0.5
LUFS = -16


def clip_id() -> str:
    """A random id. Anything derived from the set, pair or side could be recomputed by a listener."""
    return secrets.token_hex(6)


def duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def encode(src: Path, dst: Path, seconds: float | None) -> float:
    length = min(seconds, duration(src)) if seconds else duration(src)
    af = f"loudnorm=I={LUFS}:TP=-1.5:LRA=11,afade=t=out:st={max(0.0, length - FADE):.3f}:d={FADE}"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-t", f"{length:.3f}", "-af", af,
         "-ac", "1", "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "128k", "-map_metadata", "-1", str(dst)],
        check=True,
    )
    return round(length, 2)


def captions(d: Path) -> dict[int, str]:
    out = {}
    for line in (d / "CAPTIONS.txt").read_text().splitlines():
        m = re.match(r"pair(\d+):\s*(.*)", line)
        if m:
            out[int(m.group(1))] = m.group(2).strip()
    return out


def seeds(d: Path) -> dict[int, int]:
    f = d / "ab_scores.json"
    if not f.exists():
        return {}
    return {int(p["pair"]): p.get("seed") for p in json.loads(f.read_text())["pairs"]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--repo", type=Path, required=True)
    args = ap.parse_args()
    out_dir = args.repo / "apps/web/public/study"
    out_dir.mkdir(parents=True, exist_ok=True)
    rights_path = args.repo / "apps/web/public-audio-rights.json"
    rights = json.loads(rights_path.read_text())

    # Ids are random, so a rerun replaces the previous clips rather than overwriting them.
    for old in out_dir.glob("*.mp3"):
        old.unlink()
    rights["files"] = {f: e for f, e in rights["files"].items() if not f.startswith("apps/web/public/study/")}

    stimuli = {"version": 1, "loudnessLufs": LUFS, "comparisons": []}
    key = {}
    for s in SETS:
        d = args.data / s["dir"]
        caps, sds = captions(d), seeds(d)
        pairs = sorted({int(m.group(1)) for f in d.iterdir() if (m := re.match(r"pair(\d+)_", f.name))})
        comp = {"id": s["id"], "pairs": []}
        for p in pairs:
            ids = []
            for side, (suffix, adapter) in s["sides"].items():
                src = d / f"pair{p:03d}_{suffix}.wav"
                cid = clip_id()
                secs = encode(src, out_dir / f"{cid}.mp3", s["seconds"])
                ids.append(cid)
                key[cid] = {"set": s["id"], "pair": p, "condition": side, "adapter": adapter,
                            "caption": caps.get(p), "seed": sds.get(p), "seconds": secs, "source": f"data/{s['dir']}/{src.name}"}
                # This file is public: name both models of the pair, never which one made this clip.
                rights["files"][f"apps/web/public/study/{cid}.mp3"] = {
                    "kind": "model_output", "adapters": sorted(a for _, a in s["sides"].values()), "rights": "releasable"}
            comp["pairs"].append({"pair": p, "clips": sorted(ids)})  # sorted ids: no fixed base-first order
        stimuli["comparisons"].append(comp)
        print(f"{s['id']}: {len(pairs)} pairs")

    (args.repo / "apps/web/lib/study").mkdir(parents=True, exist_ok=True)
    (args.repo / "apps/web/lib/study/stimuli.json").write_text(json.dumps(stimuli, indent=1) + "\n")
    (args.repo / "apps/ai-service/study").mkdir(parents=True, exist_ok=True)
    (args.repo / "apps/ai-service/study/key.json").write_text(json.dumps(key, indent=1, ensure_ascii=False) + "\n")
    rights_path.write_text(json.dumps(rights, indent=2) + "\n")
    print(f"{len(key)} clips in {out_dir}")


if __name__ == "__main__":
    main()
