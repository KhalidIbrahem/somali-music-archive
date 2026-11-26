"""Numbers for the evaluation summary page (/results).

    python -m scripts.results_summary_build

Reads only result files tracked in the repository and writes
apps/web/lib/results-summary.json:
  - scaling: held-out per-song cross-entropy, base against adapter, with the
    bootstrap 95 % interval on the improvement (runs/*/eval_*.json)
  - listening: every blind sitting on those adapters (data/listening/*.json)
  - qormada: note-level F1 against the vocadito annotations (docs/eval/qormada_eval_summary.json)
  - restoration: band SNR of generated clips, raw-trained against restored-trained
    (runs/harvard_restored/generation_compare.json)
Nothing on the page is typed by hand. No audio is read or written.
"""

from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
RUNS = [
    ("medium", "runs/qaraami_medium_r32/eval_medium.json", "MusicGen-medium, 1.5 B", "ab_medium"),
    ("large", "runs/qaraami_large_r32/eval_large.json", "MusicGen-large, 3.3 B", "ab_large"),
    ("qaraami_all", "runs/qaraami_all/eval_qaraami_all.json", "MusicGen-medium, whole corpus", "ab_qaraami_all"),
]


def main() -> None:
    scaling = []
    for key, path, label, ab_set in RUNS:
        d = json.loads((REPO / path).read_text())
        ce = d["per_song_ce"]
        imp = ce["improvement_base_minus_adapter"]
        sittings = []
        for f in sorted((REPO / "data" / "listening").glob(f"{ab_set}_*.json")):
            s = json.loads(f.read_text())
            sittings.append({"date": s["date"][:10], **{k: s["summary"][k] for k in ("n", "adapter", "base", "none")}})
        scaling.append({
            "key": key,
            "label": label,
            "model": d["model"],
            "checkpoint": d["best_ckpt"],
            "testSongs": ce["n_songs"],
            "testClips": d["test_clips"],
            "baseCe": ce["base"]["mean"],
            "adapterCe": ce["adapter"]["mean"],
            "improvement": imp["mean"],
            "ci95": imp["ci95"],
            "voicedBase": d["ab"]["base"]["voiced_fraction_mean"],
            "voicedAdapter": d["ab"]["adapter"]["voiced_fraction_mean"],
            "pcsBase": d["ab"]["base"]["pcs_mean"],
            "pcsAdapter": d["ab"]["adapter"]["pcs_mean"],
            "abPairs": d["ab"]["n"],
            "sittings": sittings,
        })

    q = json.loads((REPO / "docs" / "eval" / "qormada_eval_summary.json").read_text())["vocadito"]
    f1 = lambda k: {"mean": round(q[k]["conp_f"]["mean"], 3), "ci95": [round(q[k]["conp_f"]["ci_low"], 3), round(q[k]["conp_f"]["ci_high"], 3)]}  # noqa: E731
    qormada = {"system": f1("qormada_v2"), "human": f1("human_A2_vs_A1")}
    qormada["shareOfHuman"] = round(qormada["system"]["mean"] / qormada["human"]["mean"], 2)

    r = json.loads((REPO / "runs" / "harvard_restored" / "generation_compare.json").read_text())["summary"]
    restoration = {"bandSnrRawTrained": round(r["base"]["band_snr_db"], 1), "bandSnrRestoredTrained": round(r["adapter"]["band_snr_db"], 1)}

    out = {"scaling": scaling, "qormada": qormada, "restoration": restoration}
    (REPO / "apps" / "web" / "lib" / "results-summary.json").write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
