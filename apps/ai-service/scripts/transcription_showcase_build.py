"""Numbers for the transcription showcase page (/scores) and the evaluation summary.

    python -m scripts.transcription_showcase_build --data-root <repo with data/>/data

Reads the pipeline's own outputs and writes apps/web/lib/transcription-showcase.json:
  - per published score: PCS of the kept notes and the recording's tuning offset
    (data/transcription_demo/<slug>/*.json)
  - over the pool (data/transcription_pool/pool_index.json, duplicates folded as
    in pool_report.py): PCS by source, and where each scale degree sits relative
    to equal temperament, pooled and by source.
Nothing on the page is typed by hand. No audio is read or written.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from scripts.pool_report import _stats, fold_duplicates

REPO = Path(__file__).resolve().parents[3]
SCORES = ["oud_02_aha_aha", "oud_04_kaban_wadada", "band_e0e0a1425885_seg000"]


def r1(x: float) -> float:
    return round(float(x), 1)


def stats(xs: list[float], digits: int = 1) -> dict:
    s = _stats(xs)
    return {k: (v if k == "n" else round(float(v), digits)) for k, v in s.items()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-root", type=Path, default=REPO / "data")
    a = ap.parse_args()

    scores = {}
    for slug in SCORES:
        (meta_path,) = [p for p in (a.data_root / "transcription_demo" / slug).glob("*.json")]
        m = json.loads(meta_path.read_text())
        scores[slug] = {
            "pcs": round(m["pcs_of_kept_notes"]["overall"], 3),
            "pcsByStaff": {k: round(v, 3) for k, v in m["pcs_of_kept_notes"].items() if k != "overall"},
        }

    rows = json.loads((a.data_root / "transcription_pool" / "pool_index.json").read_text())
    ok, folded = fold_duplicates([r for r in rows if not r.get("error")])

    dev: dict[int, list[float]] = defaultdict(list)
    dev_src: dict[tuple[int, str], list[float]] = defaultdict(list)
    for r in ok:
        sc, tp, ref = r.get("scale_cents"), r.get("scale_cents_template"), r.get("degree_refined")
        if not (sc and tp and ref):
            continue
        for i in range(1, len(tp)):
            if ref[i]:
                d = ((sc[i] - tp[i]) + 600.0) % 1200.0 - 600.0
                dev[int(round(tp[i]))].append(d)
                dev_src[(int(round(tp[i])), r["source"])].append(d)

    intervals = []
    for iv in sorted(dev):
        s = stats(dev[iv])
        s["se"] = r1(s["sd"] / (s["n"] ** 0.5))
        intervals.append({
            "interval": iv,
            **s,
            "bySource": {src: stats(dev_src[(iv, src)]) for src in ("band", "oud") if dev_src.get((iv, src))},
        })

    by_src = lambda src: [r for r in ok if r["source"] == src]  # noqa: E731
    marked = [100.0 * r["n_marked"] / r["n_notes"] for r in ok if r.get("n_notes")]
    out = {
        "generatedFrom": "data/transcription_demo/*/*.json and data/transcription_pool/pool_index.json",
        "scores": scores,
        "pool": {
            "recordings": len(ok),
            "duplicatesFolded": folded,
            "bySource": {
                src: {
                    "recordings": len(by_src(src)),
                    "sourceHours": r1(sum(r.get("duration_s") or 0 for r in by_src(src)) / 3600),
                    "pcs": stats([r["pcs"] for r in by_src(src)], 3),
                    "markedPercent": stats([100.0 * r["n_marked"] / r["n_notes"] for r in by_src(src) if r.get("n_notes")]),
                    "tonicAmbiguous": sum(1 for r in by_src(src) if r.get("tonic_ambiguous")),
                }
                for src in ("oud", "band")
            },
            "pcs": stats([r["pcs"] for r in ok], 3),
            "tonicAmbiguous": sum(1 for r in ok if r.get("tonic_ambiguous")),
            "markedPercent": stats(marked),
            "tuningOffsetCents": stats([r["tuning_offset_cents"] for r in ok]),
            "intervals": intervals,
        },
    }
    dst = REPO / "apps" / "web" / "lib" / "transcription-showcase.json"
    dst.write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out["scores"]), out["pool"]["recordings"], out["pool"]["bySource"])
    for iv in intervals:
        print(iv["interval"], iv["n"], iv["mean"], iv["sd"], iv["se"], {k: (v["n"], v["mean"]) for k, v in iv["bySource"].items()})


if __name__ == "__main__":
    main()
