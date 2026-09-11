"""Choose the first benchmark items from the transcription pool.

    python -m scripts.pick_benchmark_items [--n 5] [--min-vocal 2] [--pool-dir ...] [--json out]

Mechanical and explainable: items carrying any of the pool report's warning
signs are set aside; the rest are ranked by PCS, then notes per minute, with
vocal items also needing a voiced fraction of at least 0.25; the pick walks
down the ranking taking at most one item per tonic until the count is met,
and guarantees `min_vocal` band recordings. Prints the pick with reasons.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.pool_report import FLAGS, _minutes, fold_duplicates  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
MIN_VOICED = 0.25


def eligible(r: dict) -> tuple[bool, list[str]]:
    if r.get("error"):
        return False, ["failed"]
    reasons = [FLAGS[k][0] for k in FLAGS if FLAGS[k][1](r)]
    if r["source"] == "band" and (r.get("voice_voiced_fraction") or 0.0) < MIN_VOICED:
        reasons.append(f"voice voiced fraction under {MIN_VOICED}")
    return not reasons, reasons


def rank_key(r: dict) -> tuple:
    return (-(r.get("pcs") or 0.0), -(r.get("n_notes") or 0) / max(_minutes(r), 1e-6))


def pick(rows: list[dict], n: int = 5, min_vocal: int = 2) -> list[dict]:
    rows, _ = fold_duplicates(rows)
    good = sorted((r for r in rows if eligible(r)[0]), key=rank_key)
    chosen: list[dict] = []
    tonics: set[str] = set()

    def take(pool_rows):
        for r in pool_rows:
            if len(chosen) >= n:
                return
            if r in chosen or r["tonic"] in tonics:
                continue
            chosen.append(r)
            tonics.add(r["tonic"])

    take([r for r in good if r["source"] == "band"][:min_vocal])  # the vocal items first
    take(good)
    if len(chosen) < n:  # relax the one-per-tonic rule rather than come up short
        for r in good:
            if len(chosen) >= n:
                break
            if r not in chosen:
                chosen.append(r)
    return chosen


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="pick the first benchmark items from the pool")
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--min-vocal", type=int, default=2)
    ap.add_argument("--pool-dir", default=str(REPO / "data" / "transcription_pool"))
    ap.add_argument("--json", default=None)
    a = ap.parse_args(argv)
    rows = json.loads((Path(a.pool_dir) / "pool_index.json").read_text())
    chosen = pick(rows, a.n, a.min_vocal)
    out = []
    for r in chosen:
        vv = r.get("voice_voiced_fraction")
        out.append({"slug": r["slug"], "source": r["source"], "tonic": r["tonic_label"], "pcs": r["pcs"],
                    "n_notes": r["n_notes"], "notes_per_min": round(r["n_notes"] / max(_minutes(r), 1e-6), 1),
                    "voice_voiced_fraction": vv, "duration_s": r["duration_s"], "excerpt_sec": r.get("excerpt_sec")})
        print(f"{r['slug']}: {r['source']}, tonic {r['tonic_label']}, PCS {r['pcs']:.3f}, {out[-1]['notes_per_min']} notes/min"
              + (f", voice voiced {vv:.2f}" if vv is not None else ""))
    n_good = sum(1 for r in rows if eligible(r)[0])
    print(f"({n_good} of {len(rows)} pool items were eligible)")
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
