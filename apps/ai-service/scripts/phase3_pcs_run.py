"""Phase 3: run PCS over a directory of audio clips (real or generated).

Writes per-clip rows to <out>.csv and a summary to <out>.json. Caption tonic
(when a captions source is available) is compared against the detected tonic
as a secondary prompt-adherence metric.

Usage (from apps/ai-service):
  python3 -m scripts.phase3_pcs_run --group real_test
  python3 -m scripts.phase3_pcs_run --group base
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from scripts.pcs import caption_tonic_pc, extract_f0, score_frames

REPO = Path(__file__).resolve().parents[3]
OUT_DIR = REPO / "data/eval_pcs"
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"


def clip_list(group: str) -> list[tuple[Path, str | None]]:
    if group == "real_test":
        caps = {Path(json.loads(l)["clip_path"]).name: json.loads(l)["caption"]
                for l in open(REPO / "data/captions.jsonl")
                if json.loads(l)["split"] == "test"}
        d = REPO / "data/clips/test"
        return [(p, caps.get(p.name)) for p in sorted(d.glob("*.wav"))]
    d = REPO / "data/eval_gen" / group
    idx = json.loads((d / "captions_index.json").read_text())
    return [(d / name, cap) for name, cap in sorted(idx.items()) if (d / name).exists()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", required=True)
    args = ap.parse_args()

    clips = clip_list(args.group)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = OUT_DIR / f"{args.group}.csv"
    print(f"[{args.group}] scoring {len(clips)} clips on {DEVICE}", flush=True)

    rows = []
    t0 = time.time()
    skipped = 0
    with open(csv_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["clip", "pcs", "tonic", "mode", "tonic_score", "tuning_offset_cents",
                    "voiced_fraction", "n_voiced_frames", "caption_tonic", "tonic_match"])
        for i, (path, caption) in enumerate(clips, 1):
            audio, sr = sf.read(path, dtype="float32")
            f0, pd = extract_f0(audio, DEVICE, sr=sr)
            res = score_frames(f0, pd)
            if res is None:
                skipped += 1
                w.writerow([path.name, "", "", "", "", "", "", "", "", ""])
                continue
            cap_pc = caption_tonic_pc(caption) if caption else None
            match = "" if cap_pc is None else int(cap_pc == res.tonic_pc)
            w.writerow([path.name, round(res.pcs, 4), res.tonic_name, res.mode,
                        round(res.tonic_score, 3), round(res.tuning_offset_cents, 1),
                        round(res.voiced_fraction, 3), res.n_voiced_frames,
                        cap_pc if cap_pc is not None else "", match])
            rows.append((res, match))
            if i % 100 == 0:
                print(f"[{args.group}] {i}/{len(clips)} "
                      f"({(time.time()-t0)/i:.2f}s/clip)", flush=True)

    pcs = np.array([r.pcs for r, _ in rows])
    matches = [m for _, m in rows if m != ""]
    summary = {
        "group": args.group,
        "clips_scored": len(rows),
        "clips_skipped_unvoiced": skipped,
        "pcs_mean": round(float(pcs.mean()), 4),
        "pcs_median": round(float(np.median(pcs)), 4),
        "pcs_std": round(float(pcs.std()), 4),
        "voiced_fraction_mean": round(float(np.mean([r.voiced_fraction for r, _ in rows])), 3),
        "tuning_offset_abs_median": round(float(np.median(
            [abs(r.tuning_offset_cents) for r, _ in rows])), 1),
        "tonic_match_rate": round(float(np.mean(matches)), 4) if matches else None,
        "sec_total": round(time.time() - t0, 1),
    }
    (OUT_DIR / f"{args.group}.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    main()
