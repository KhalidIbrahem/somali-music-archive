"""Phase 4c ablation over the test split.

Conditions per clip:
  (i)   basic-pitch raw
  (ii)  + Western 12-TET key correction (Krumhansl major/minor, snap everything)
  (iii) + our pentatonic stage (snap within 50c, mark outliers)

NO ground-truth MIDI exists for this corpus, so note-level F1 is NOT computable
— stated plainly. We report PCS-of-transcription (against the raw-detected
scale, same reference for all conditions) plus alteration statistics.

Run: /opt/anaconda3/envs/somali311/bin/python -m scripts.phase4_ablation
"""

from __future__ import annotations

import csv
import json
import time
from pathlib import Path

import numpy as np

from scripts.quantize import detect_scale, pcs_of_notes, pentatonic_quantize, western_correct
from scripts.transcribe import load_notes, transcribe_file

REPO = Path(__file__).resolve().parents[3]
CLIPS = sorted((REPO / "data/clips/test").glob("*.wav"))
OUT = REPO / "data/transcriptions"
N_DEMO = 3


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    skipped = 0
    demos_done = 0
    t0 = time.time()
    with open(OUT / "ablation.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["clip", "n_notes", "tonic", "tuning_offset", "western_key",
                    "pcs_raw", "pcs_western", "pcs_penta",
                    "penta_snapped_pct", "penta_marked_pct", "western_altered_pct",
                    "mean_confidence"])
        for i, clip in enumerate(CLIPS, 1):
            notes = load_notes(clip)
            if len(notes) < 5:
                skipped += 1
                continue
            det = detect_scale(notes)
            western, wkey = western_correct(notes)
            penta = pentatonic_quantize(notes, det)
            altered = sum(1 for a, b in zip(notes, western)
                          if abs(a.cents - b.cents) > 1e-6) / len(notes)
            row = {
                "clip": clip.name, "n_notes": len(notes),
                "tonic": det["tonic_name"],
                "tuning_offset": round(det["tuning_offset_cents"], 1),
                "western_key": wkey,
                "pcs_raw": pcs_of_notes(notes, det),
                "pcs_western": pcs_of_notes(western, det),
                "pcs_penta": pcs_of_notes(penta, det),
                "penta_snapped_pct": sum(q.snapped for q in penta) / len(penta),
                "penta_marked_pct": sum(q.marked for q in penta) / len(penta),
                "western_altered_pct": altered,
                "mean_confidence": float(np.mean([q.confidence for q in penta])),
            }
            w.writerow([row[k] if not isinstance(row[k], float) else round(row[k], 4)
                        for k in row])
            rows.append(row)
            if demos_done < N_DEMO and len(notes) >= 20:
                transcribe_file(clip, OUT / "demo")
                demos_done += 1
            if i % 100 == 0:
                print(f"{i}/{len(CLIPS)} ({(time.time()-t0)/i:.2f}s/clip)", flush=True)

    def mean(k):
        return round(float(np.mean([r[k] for r in rows])), 4)

    summary = {
        "clips_scored": len(rows),
        "clips_skipped_lt5_notes": skipped,
        "ground_truth_f1": "NOT COMPUTABLE — no ground-truth MIDI exists for this corpus",
        "pcs_raw_mean": mean("pcs_raw"),
        "pcs_western_mean": mean("pcs_western"),
        "pcs_penta_mean": mean("pcs_penta"),
        "penta_snapped_pct_mean": mean("penta_snapped_pct"),
        "penta_marked_pct_mean": mean("penta_marked_pct"),
        "western_altered_pct_mean": mean("western_altered_pct"),
        "mean_confidence": mean("mean_confidence"),
        "sec_total": round(time.time() - t0, 1),
    }
    (OUT / "ablation_summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    main()
