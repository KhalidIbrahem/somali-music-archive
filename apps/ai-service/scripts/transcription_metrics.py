"""Benchmark metrics for the transcription pipeline.

    python -m scripts.transcription_metrics --ref corrected.musicxml \
        --est output.json [--ref-scale meta.json] [--onset-tol 0.25] [--pitch-tol 50] [--json out.json]

Compares a pipeline output (the CLI's JSON, or a MusicXML file) against a
corrected MusicXML score in beat space (quarter lengths), which is the space an
annotator edits in. A reference note is ground truth only when its `verified`
flag is set: in the corrected MusicXML a note coloured blue (#0000FF) is
UNVERIFIED, every other note is verified. Unverified reference notes, and the
estimated notes that land on them, are left out of both precision and recall.

Note-level metrics (per staff and overall):
  * precision, recall, F1 with an onset tolerance (quarter lengths) AND a pitch
    tolerance (cents), one-to-one matched by the Hungarian algorithm;
  * the same with the pitch condition dropped (onset-only), which separates
    rhythm errors from pitch errors.

Scale-estimation accuracy, when a reference scale is given:
  * tonic pitch class correct;
  * degree set correct (every template degree within 50 cents of a reference
    degree, same count);
  * mean absolute error in cents of the estimated degrees against the
    reference degrees, matched to the nearest.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

UNVERIFIED_COLOURS = {"#0000ff", "blue"}
PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


# ----------------------------------------------------------------------------- loading
def load_musicxml_notes(path: str | Path) -> list[dict]:
    """Every pitched note in every part: onset and duration in quarter
    lengths from the start of the part, pitch in cents (microtones kept),
    staff name, verified flag from the note colour."""
    from music21 import converter

    score = converter.parse(str(path))
    rows = []
    for part in score.parts:
        flat = part.flatten()
        for n in flat.notes:
            pitches = n.pitches if hasattr(n, "pitches") else [n.pitch]
            colour = (getattr(n.style, "color", None) or "").lower()
            for p in pitches:
                micro = float(p.microtone.cents) if p.microtone is not None else 0.0
                rows.append({
                    "staff": part.partName or part.id,
                    "onset_ql": float(n.offset), "duration_ql": float(n.quarterLength),
                    "cents": p.midi * 100.0 + micro,
                    "verified": colour not in UNVERIFIED_COLOURS,
                })
    return rows


def load_json_notes(path: str | Path) -> list[dict]:
    """Notes from the CLI's JSON: engraved notes only, exact cents."""
    d = json.loads(Path(path).read_text())
    rows = []
    for n in d["notes"]:
        if n.get("offset_ql") is None or n.get("engraved") is False:
            continue
        rows.append({"staff": n["staff"], "onset_ql": float(n["offset_ql"]),
                     "duration_ql": float(n["duration_ql"]), "cents": float(n["cents"]),
                     "verified": True})
    return rows


def load_estimate(path: str | Path) -> list[dict]:
    path = Path(path)
    return load_json_notes(path) if path.suffix == ".json" else load_musicxml_notes(path)


# ----------------------------------------------------------------------------- matching
def match_notes(ref: list[dict], est: list[dict], onset_tol: float, pitch_tol: float | None) -> list[tuple[int, int]]:
    """One-to-one matching (Hungarian) between reference and estimated notes
    within the onset tolerance (quarter lengths) and, unless pitch_tol is
    None, the pitch tolerance (cents). Returns (ref_index, est_index) pairs."""
    if not ref or not est:
        return []
    from scipy.optimize import linear_sum_assignment

    r_on = np.array([r["onset_ql"] for r in ref]); e_on = np.array([e["onset_ql"] for e in est])
    r_c = np.array([r["cents"] for r in ref]); e_c = np.array([e["cents"] for e in est])
    d_on = np.abs(r_on[:, None] - e_on[None, :])
    d_c = np.abs(r_c[:, None] - e_c[None, :])
    ok = d_on <= onset_tol
    if pitch_tol is not None:
        ok &= d_c <= pitch_tol
    cost = d_on / max(onset_tol, 1e-9) + (d_c / max(pitch_tol, 1e-9) if pitch_tol else 0.0)
    cost = np.where(ok, cost, 1e6)
    ri, ei = linear_sum_assignment(cost)
    return [(int(a), int(b)) for a, b in zip(ri, ei) if ok[a, b]]


def prf(n_match: int, n_ref: int, n_est: int) -> dict:
    p = n_match / n_est if n_est else 0.0
    r = n_match / n_ref if n_ref else 0.0
    f = 2 * p * r / (p + r) if (p + r) else 0.0
    return {"precision": round(p, 4), "recall": round(r, 4), "f1": round(f, 4),
            "n_ref": n_ref, "n_est": n_est, "n_match": n_match}


def note_metrics(ref: list[dict], est: list[dict], onset_tol: float = 0.25,
                 pitch_tol: float = 50.0) -> dict:
    """Per-staff and overall P/R/F1 (onset+pitch, and onset-only). Unverified
    reference notes are excluded, together with any estimated note that
    matches one of them."""
    out = {}
    staves = sorted({r["staff"] for r in ref} | {e["staff"] for e in est})
    for staff in staves + ["overall"]:
        rs = [r for r in ref if staff == "overall" or r["staff"] == staff]
        es = [e for e in est if staff == "overall" or e["staff"] == staff]
        result = {}
        for name, ptol in (("onset_pitch", pitch_tol), ("onset_only", None)):
            pairs = match_notes(rs, es, onset_tol, ptol)
            unverified_est = {b for a, b in pairs if not rs[a]["verified"]}
            verified_pairs = [(a, b) for a, b in pairs if rs[a]["verified"]]
            n_ref = sum(1 for r in rs if r["verified"])
            n_est = len(es) - len(unverified_est)
            result[name] = prf(len(verified_pairs), n_ref, n_est)
        result["n_unverified_ref"] = sum(1 for r in rs if not r["verified"])
        out[staff] = result
    return out


# ----------------------------------------------------------------------------- scale
def scale_accuracy(est: dict, ref: dict, tol_cents: float = 50.0) -> dict:
    """est/ref carry tonic_pc (or tonic_name) and scale_cents (relative to the
    tonic, octave-folded)."""
    def pc(d):
        return int(d["tonic_pc"]) if "tonic_pc" in d else PC_NAMES.index(d["tonic_name"])

    e_t, r_t = pc(est), pc(ref)
    e_s = np.asarray(est["scale_cents"], float) % 1200.0
    r_s = np.asarray(ref["scale_cents"], float) % 1200.0
    # compare degree positions as absolute pitch classes in cents, so a wrong
    # tonic with the right pitch set is still scored on the set
    e_abs = (e_t * 100.0 + e_s) % 1200.0
    r_abs = (r_t * 100.0 + r_s) % 1200.0
    d = np.abs(((e_abs[:, None] - r_abs[None, :]) + 600.0) % 1200.0 - 600.0)
    nearest = d.min(axis=1)
    return {
        "tonic_correct": bool(e_t == r_t),
        "tonic_est": PC_NAMES[e_t], "tonic_ref": PC_NAMES[r_t],
        "degree_set_correct": bool(len(e_s) == len(r_s) and np.all(nearest <= tol_cents)),
        "mean_abs_degree_error_cents": round(float(nearest.mean()), 1),
        "max_abs_degree_error_cents": round(float(nearest.max()), 1),
    }


# ----------------------------------------------------------------------------- CLI
def evaluate(ref_path, est_path, ref_scale_path=None, onset_tol=0.25, pitch_tol=50.0) -> dict:
    ref = load_musicxml_notes(ref_path)
    est = load_estimate(est_path)
    out = {"reference": str(ref_path), "estimate": str(est_path),
           "onset_tolerance_ql": onset_tol, "pitch_tolerance_cents": pitch_tol,
           "notes": note_metrics(ref, est, onset_tol, pitch_tol)}
    if ref_scale_path:
        ref_scale = json.loads(Path(ref_scale_path).read_text())
        est_scale = None
        if str(est_path).endswith(".json"):
            est_scale = json.loads(Path(est_path).read_text()).get("scale")
        if est_scale:
            out["scale"] = scale_accuracy(est_scale, ref_scale)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="transcription benchmark metrics")
    ap.add_argument("--ref", required=True, help="corrected MusicXML")
    ap.add_argument("--est", required=True, help="pipeline JSON or MusicXML")
    ap.add_argument("--ref-scale", default=None, help="JSON with tonic and scale_cents")
    ap.add_argument("--onset-tol", type=float, default=0.25)
    ap.add_argument("--pitch-tol", type=float, default=50.0)
    ap.add_argument("--json", default=None, help="write the result here")
    a = ap.parse_args(argv)
    res = evaluate(a.ref, a.est, a.ref_scale, a.onset_tol, a.pitch_tol)
    text = json.dumps(res, indent=1)
    if a.json:
        Path(a.json).write_text(text)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
