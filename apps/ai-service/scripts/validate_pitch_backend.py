"""Robustness check: CREPE tiny vs full capacity on a validation subset.

The corpus sweep uses torchcrepe's *tiny* capacity (the full model runs at
1.7x realtime on this hardware — infeasible for 22.6 h of audio; tiny runs at
~11x). This script quantifies what that trades away FOR THE PAPER'S ACTUAL
STATISTIC — per-degree octave-folded deviation medians — by running both
capacities on the same tracks and reporting the deltas.

If the median per-degree deltas are small (a few cents) relative to the
effects the paper reports, the tiny-capacity sweep is defensible and the
number goes in the paper; if they are large, the sweep must be redone. Either
way the answer is measured, not assumed.

Usage:
    cd apps/ai-service
    python -m scripts.validate_pitch_backend --tracks track_0015,track_0118,track_0129
Writes: data/analysis/pitch_backend_validation.json
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

_SERVICE_ROOT = Path(__file__).resolve().parent.parent
if str(_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVICE_ROOT))

import numpy as np

from scripts.process_harvard import (
    PITCH_CONFIDENCE_THRESHOLD,
    _crepe_predict_frames,
    default_config,
    load_audio_mono,
)
from services.scale import SOMALI_SCALE_HZ
from utils.scale_mapping import map_pitch_frames

log = logging.getLogger("validate_pitch_backend")

DEGREES = tuple(SOMALI_SCALE_HZ.keys())


def per_degree_medians(points: list[dict[str, Any]]) -> dict[str, float | None]:
    by_degree: dict[str, list[float]] = {d: [] for d in DEGREES}
    for pt in points:
        by_degree[str(pt["note_label"])].append(float(pt["cents_deviation"]))
    return {
        d: (round(float(np.median(v)), 2) if len(v) >= 50 else None)
        for d, v in by_degree.items()
    }


def compare_capacities(track_ids: list[str], max_sec: int) -> dict[str, Any]:
    """Run both capacities on each track; report per-degree median deltas."""
    config = default_config()
    import pandas as pd

    inventory = pd.read_csv(config.inventory_csv).set_index("track_id")
    per_track: list[dict[str, Any]] = []
    for track_id in track_ids:
        row = inventory.loc[track_id]
        samples = load_audio_mono(
            Path(str(row["source_dir"])) / str(row["filename"]), sample_rate=16000
        )
        if len(samples) > max_sec * 16000:
            start = (len(samples) - max_sec * 16000) // 2
            samples = samples[start : start + max_sec * 16000]
        medians: dict[str, dict[str, float | None]] = {}
        for capacity in ("tiny", "full"):
            os.environ["SOMALI_CREPE_CAPACITY"] = capacity
            frames, decoder = _crepe_predict_frames(samples)
            points = map_pitch_frames(frames, PITCH_CONFIDENCE_THRESHOLD)
            medians[capacity] = per_degree_medians(points)
            log.info("%s %s: %d gated points", track_id, decoder, len(points))
        per_track.append(
            {
                "track_id": track_id,
                "tiny": medians["tiny"],
                "full": medians["full"],
                "delta_cents": {
                    d: (
                        round(medians["tiny"][d] - medians["full"][d], 2)
                        if medians["tiny"][d] is not None and medians["full"][d] is not None
                        else None
                    )
                    for d in DEGREES
                },
            }
        )
    os.environ.pop("SOMALI_CREPE_CAPACITY", None)

    deltas = [
        abs(t["delta_cents"][d])
        for t in per_track
        for d in DEGREES
        if t["delta_cents"][d] is not None
    ]
    return {
        "n_tracks": len(per_track),
        "max_analyzed_sec_per_track": max_sec,
        "per_track": per_track,
        "median_abs_delta_cents": round(float(np.median(deltas)), 2) if deltas else None,
        "max_abs_delta_cents": round(float(np.max(deltas)), 2) if deltas else None,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tracks",
        type=str,
        default="track_0015,track_0118,track_0129,track_0002,track_0005",
        help="comma-separated track ids for the validation subset",
    )
    parser.add_argument("--max-sec", type=int, default=180)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")

    result = compare_capacities([t.strip() for t in args.tracks.split(",")], args.max_sec)
    out = default_config().data_root / "analysis" / "pitch_backend_validation.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2))
    log.info(
        "median |Δ| %s cents, max |Δ| %s cents → %s",
        result["median_abs_delta_cents"],
        result["max_abs_delta_cents"],
        out,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
