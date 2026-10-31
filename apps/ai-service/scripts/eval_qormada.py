"""Score the browser transcriber (Qormada) against note- and f0-annotated audio.

Input: the JSON written by ``apps/web/scripts/qormada-eval/transcribe.ts`` and a
dataset directory. Metrics are mir_eval's standard ones:

* on the synthetic Somali set also: tuning-offset error (cents), scale
  identified (fitted pentatonic set equals the true one), and the median cents
  error of matched notes;
* note F1, onset + pitch (COnP): onset within 50 ms, pitch within 50 cents;
* note F1, onset + pitch + offset (COnPOff): offset within 20 % of the note or 50 ms;
* onset-only F1;
* frame metrics against the f0 track: raw pitch accuracy (RPA), raw chroma
  accuracy (RCA, octave errors forgiven), voicing recall / false alarm, overall
  accuracy (OA).

Note metrics are computed against each annotator and averaged, per track, then
over tracks with a bootstrap 95 % CI. The two annotators scored against each
other give the human agreement ceiling.

Run without touching the research env:
    uv run --with mir_eval --with numpy python apps/ai-service/scripts/eval_qormada.py \
        --dataset vocadito --root data/raw_incoming/vocadito \
        --pred melody=data/eval_qormada/vocadito_melody.json \
        --pred plain=data/eval_qormada/vocadito_plain.json --out data/eval_qormada/vocadito.json
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import mir_eval
import numpy as np

SEED = 0
N_BOOT = 10_000


def load_vocadito(root: Path) -> dict[str, dict]:
    tracks = {}
    meta = {r["track_id"]: r for r in csv.DictReader(open(root / "vocadito_metadata.csv"))}
    for tid, row in meta.items():
        name = f"vocadito_{tid}"
        notes = []
        for a in ("A1", "A2"):
            rows = np.loadtxt(root / "Annotations/Notes" / f"{name}_notes{a}.csv", delimiter=",", ndmin=2)
            notes.append((np.c_[rows[:, 0], rows[:, 0] + rows[:, 2]], rows[:, 1]))
        f0 = np.loadtxt(root / "Annotations/F0" / f"{name}_f0.csv", delimiter=",", ndmin=2)
        tracks[name + ".wav"] = {
            "notes": notes,
            "f0": (f0[:, 0], f0[:, 1]),
            "meta": {"singer": row["singer_id"], "avg_midi": float(row["average_pitch"]), "language": row["language"]},
        }
    return tracks


def load_synth(root: Path) -> dict[str, dict]:
    truth = json.load(open(root / "truth.json"))
    tracks = {}
    for name, t in truth.items():
        on = np.array([n["onset"] for n in t["notes"]])
        off = np.array([n["offset"] for n in t["notes"]])
        hz = 440.0 * 2 ** ((np.array([n["midi"] for n in t["notes"]]) - 69 + np.array([n["cents"] for n in t["notes"]]) / 100) / 12)
        grid = np.arange(0, t["length"], 0.01)
        f0 = np.zeros_like(grid)
        for a, b, h in zip(on, off, hz):
            f0[(grid >= a) & (grid < b - 0.02)] = h
        tracks[name] = {
            "notes": [(np.c_[on, off], hz)],
            "f0": (grid, f0),
            "meta": {
                "condition": t["condition"],
                "register": t["register"],
                "true_offset": t["offset_cents"],
                "true_scale": t["scale_pcs"],
                "avg_midi": float(np.mean([n["midi"] for n in t["notes"]])),
            },
        }
    return tracks


def wrap_cents(c: float) -> float:
    return (c + 50) % 100 - 50


def somali_scores(ref: tuple, est_iv: np.ndarray, est_hz: np.ndarray, pred: dict, meta: dict) -> dict[str, float]:
    """Tuning offset error, scale identified, per-note cents error on matched notes."""
    out = {
        "offset_err_c": abs(wrap_cents(pred["offsetCents"] - meta["true_offset"])),
        "scale_correct": float(pred.get("scalePcs") == meta["true_scale"]),
    }
    if len(est_hz):
        m = mir_eval.transcription.match_notes(ref[0], ref[1], est_iv, est_hz, offset_ratio=None)
        errs = [abs(1200 * np.log2(est_hz[j] / ref[1][i])) for i, j in m]
        out["note_cents_err"] = float(np.median(errs)) if errs else float("nan")
    else:
        out["note_cents_err"] = float("nan")
    return out


def note_scores(ref: tuple, est_iv: np.ndarray, est_hz: np.ndarray) -> dict[str, float]:
    ref_iv, ref_hz = ref
    if len(est_hz) == 0:
        return {"conp_f": 0.0, "conp_p": 0.0, "conp_r": 0.0, "conpoff_f": 0.0, "onset_f": 0.0}
    p, r, f, _ = mir_eval.transcription.precision_recall_f1_overlap(ref_iv, ref_hz, est_iv, est_hz, offset_ratio=None)
    _, _, foff, _ = mir_eval.transcription.precision_recall_f1_overlap(ref_iv, ref_hz, est_iv, est_hz)
    _, _, fon = mir_eval.transcription.onset_precision_recall_f1(ref_iv, est_iv)
    return {"conp_f": f, "conp_p": p, "conp_r": r, "conpoff_f": foff, "onset_f": fon}


def frame_scores(ref: tuple, frames: list) -> dict[str, float]:
    ref_t, ref_hz = ref
    arr = np.asarray(frames, dtype=float)
    est_t, est_hz = arr[:, 0], arr[:, 1]
    m = mir_eval.melody.evaluate(ref_t, ref_hz, est_t, est_hz)
    return {
        "rpa": m["Raw Pitch Accuracy"],
        "rca": m["Raw Chroma Accuracy"],
        "voicing_recall": m["Voicing Recall"],
        "voicing_false_alarm": m["Voicing False Alarm"],
        "oa": m["Overall Accuracy"],
    }


def summarise(per_track: list[dict], keys: list[str]) -> dict[str, dict[str, float]]:
    rng = np.random.default_rng(SEED)
    out = {}
    for k in keys:
        v = np.array([t[k] for t in per_track])
        boots = rng.choice(v, size=(N_BOOT, len(v)), replace=True).mean(axis=1)
        out[k] = {"mean": float(v.mean()), "ci_low": float(np.percentile(boots, 2.5)), "ci_high": float(np.percentile(boots, 97.5))}
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=["vocadito", "synth"], required=True)
    ap.add_argument("--root", type=Path, required=True)
    ap.add_argument("--pred", action="append", required=True, help="name=path to transcribe.ts output")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    tracks = load_vocadito(args.root) if args.dataset == "vocadito" else load_synth(args.root)
    note_keys = ["conp_f", "conp_p", "conp_r", "conpoff_f", "onset_f"]
    frame_keys = ["rpa", "rca", "voicing_recall", "voicing_false_alarm", "oa"]
    report: dict = {"dataset": args.dataset, "tracks": len(tracks), "systems": {}}

    if args.dataset == "vocadito":
        human = []
        for name, t in tracks.items():
            a1, a2 = t["notes"]
            s = note_scores(a1, *a2)
            human.append({"track": name, **s})
        report["systems"]["human_A2_vs_A1"] = {"summary": summarise(human, note_keys), "per_track": human}

    for spec in args.pred:
        label, path = spec.split("=", 1)
        preds = {p["file"]: p for p in json.load(open(path))}
        rows = []
        for name, t in tracks.items():
            p = preds[name]
            iv = np.array([[n["onset"], n["offset"]] for n in p["notes"]]).reshape(-1, 2)
            hz = np.array([n["hz"] for n in p["notes"]])
            per_ann = [note_scores(ref, iv, hz) for ref in t["notes"]]
            row = {k: float(np.mean([s[k] for s in per_ann])) for k in note_keys}
            row.update(frame_scores(t["f0"], p["frames"]))
            if args.dataset == "synth":
                row.update(somali_scores(t["notes"][0], iv, hz, p, t["meta"]))
            row.update({"track": name, "n_est": len(hz), "n_ref": len(t["notes"][0][1]), "rt_factor": p["analysisMs"] / 1000 / p["seconds"], **t["meta"]})
            rows.append(row)
        summ = summarise(rows, note_keys + frame_keys + ["rt_factor"])
        group_keys = ["conp_f", "rpa", "voicing_recall"]
        if args.dataset == "vocadito":
            groups = {"low_lt_midi55": lambda r: r["avg_midi"] < 55, "high_ge_midi55": lambda r: r["avg_midi"] >= 55}
        else:
            group_keys += ["offset_err_c", "scale_correct"]
            summ.update(summarise(rows, ["offset_err_c", "scale_correct"]))
            summ["note_cents_err_median"] = float(np.nanmedian([r["note_cents_err"] for r in rows]))
            groups = {f"cond_{c}": (lambda r, c=c: r["condition"] == c) for c in ["clean", "bass", "bass_drums", "noise", "full_mix"]}
            groups.update({f"reg_{g}": (lambda r, g=g: r["register"] == g) for g in ["oud", "voice_low", "voice_high"]})
        summ["by_voice"] = {g: {"n": len(sel), **summarise(sel, group_keys)} for g, f in groups.items() if (sel := [r for r in rows if f(r)])}
        report["systems"][label] = {"summary": summ, "per_track": rows}

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=1))
    for label, sysrep in report["systems"].items():
        s = sysrep["summary"]
        line = "  ".join(f"{k} {s[k]['mean']:.3f} [{s[k]['ci_low']:.3f},{s[k]['ci_high']:.3f}]" for k in ("conp_f", "conpoff_f", "onset_f", "rpa", "rca", "voicing_recall", "voicing_false_alarm", "offset_err_c", "scale_correct") if k in s)
        print(f"{label:16s} {line}")
        if "note_cents_err_median" in s:
            print(f"    median cents error on matched notes: {s['note_cents_err_median']:.1f}")
        if "by_voice" in s:
            for g, d in s["by_voice"].items():
                print(f"    {g:16s} n={d['n']:3d}: " + "  ".join(f"{k} {d[k]['mean']:.3f}" for k in d if k != "n"))


if __name__ == "__main__":
    main()
