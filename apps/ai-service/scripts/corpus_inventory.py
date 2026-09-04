"""Corpus inventory for the scaling programme (Stage 1).

For every source group (a name, a list of files, a rights tier taken from
docs/DATA_PROVENANCE.md) this measures per file: duration, sample rate,
channels, a vocal-presence estimate, and coarse instrument descriptors; then
writes a JSON record per file and the aggregate tables the inventory doc needs.

Vocal detection: Silero VAD (speech VAD; sung vowels trigger it less reliably
than speech, so thresholds are conservative and the result is labelled a
heuristic). Instrument descriptors: librosa HPSS energy split (percussive vs
harmonic), plus torchcrepe voiced fraction (trackable melody) reused from
the PCS scorer. Nothing here is a classifier for "oud"; metadata supplies that.

Analysis window: up to ANALYSIS_SECONDS per file, sampled as evenly spaced
chunks so long tracks are not dominated by their intro.

Usage (from apps/ai-service):
  python -m scripts.corpus_inventory --sources sources.json --out ../../data/inventory
sources.json: [{"name": ..., "rights": ..., "notes": ..., "files": [...]}]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

import numpy as np
import torch

import os
ANALYSIS_SECONDS = int(os.environ.get("INV_ANALYSIS_SECONDS", "240"))          # per file, in 30 s chunks spread over the track
CHUNK = 30
VAD_SR = 16000
VOCAL_LIKELY = 0.25             # voiced-speech fraction above → "vocals likely"
VOCAL_UNLIKELY = 0.06           # below → "instrumental likely"


def ffprobe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
         "stream=sample_rate,channels,codec_name,bit_rate:format=duration,tags", "-of", "json", str(path)],
        capture_output=True, text=True,
    )
    try:
        d = json.loads(out.stdout)
    except json.JSONDecodeError:
        return {}
    s = (d.get("streams") or [{}])[0]
    f = d.get("format", {})
    return {
        "duration_s": float(f.get("duration", 0) or 0),
        "sample_rate": int(s.get("sample_rate", 0) or 0),
        "channels": int(s.get("channels", 0) or 0),
        "codec": s.get("codec_name"),
        "tags": {k.lower(): v for k, v in (f.get("tags") or {}).items()},
    }


def decode(path: Path, sr: int, start: float, seconds: float) -> np.ndarray:
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{start:.2f}", "-t", f"{seconds:.2f}", "-i", str(path),
         "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True,
    )
    return np.frombuffer(out.stdout, dtype=np.float32).copy()


def chunk_starts(duration: float) -> list[float]:
    if duration <= CHUNK:
        return [0.0]
    n = max(1, min(int(ANALYSIS_SECONDS // CHUNK), int(duration // CHUNK)))
    if n == 1:
        return [max(0.0, duration / 2 - CHUNK / 2)]
    step = (duration - CHUNK) / (n - 1)
    return [i * step for i in range(n)]


class Analyzer:
    def __init__(self, device: str):
        from silero_vad import get_speech_timestamps, load_silero_vad

        self.vad = load_silero_vad()
        self.get_ts = get_speech_timestamps
        self.device = device

    def vocal_fraction(self, audio16: np.ndarray) -> float:
        if audio16.size < VAD_SR:
            return 0.0
        ts = self.get_ts(torch.from_numpy(audio16), self.vad, sampling_rate=VAD_SR, threshold=0.5, min_speech_duration_ms=150)
        voiced = sum(t["end"] - t["start"] for t in ts)
        return float(voiced / audio16.size)

    def descriptors(self, audio32: np.ndarray, crepe: bool = True) -> dict:
        import librosa
        from scripts.pcs import extract_f0, score_frames  # noqa: PLC0415

        if audio32.size < 32000:
            return {}
        harm, perc = librosa.effects.hpss(audio32)
        e_h = float(np.mean(harm ** 2)) + 1e-9
        e_p = float(np.mean(perc ** 2)) + 1e-9
        onset = librosa.onset.onset_strength(y=audio32, sr=32000)
        out = {"percussive_ratio": round(e_p / (e_h + e_p), 3), "onset_strength_mean": round(float(onset.mean()), 3)}
        if crepe:
            f0, pd = extract_f0(audio32, self.device, sr=32000)
            res = score_frames(f0, pd)
            out.update({"trackable_melody_fraction": round(res.voiced_fraction, 3) if res else 0.0,
                        "pcs": round(res.pcs, 3) if res else None,
                        "detected_tonic": res.tonic_name if res else None})
        return out


def sha256_prefix(path: Path, n: int = 16) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()[:n]


def analyze_file(path: Path, an: Analyzer, crepe: bool = True) -> dict:
    meta = ffprobe(path)
    rec = {"path": str(path), "name": path.name, "bytes": path.stat().st_size, **meta}
    dur = meta.get("duration_s", 0)
    if not dur:
        rec["error"] = "unreadable"
        return rec
    vf, tm, pr, pcs, tonics = [], [], [], [], []
    for start in chunk_starts(dur):
        a16 = decode(path, VAD_SR, start, CHUNK)
        vf.append(an.vocal_fraction(a16))
        a32 = decode(path, 32000, start, CHUNK)
        d = an.descriptors(a32, crepe=crepe)
        if d:
            if "trackable_melody_fraction" in d:
                tm.append(d["trackable_melody_fraction"])
            pr.append(d["percussive_ratio"])
            if d.get("pcs") is not None:
                pcs.append(d["pcs"])
                tonics.append(d["detected_tonic"])
    v = float(np.mean(vf)) if vf else 0.0
    rec.update({
        "chunks_analyzed": len(vf),
        "vocal_fraction": round(v, 3),
        "vocals": "likely" if v >= VOCAL_LIKELY else ("unlikely" if v <= VOCAL_UNLIKELY else "uncertain"),
        "trackable_melody_fraction": round(float(np.mean(tm)), 3) if tm else None,
        "percussive_ratio": round(float(np.mean(pr)), 3) if pr else None,
        "pcs_mean": round(float(np.mean(pcs)), 3) if pcs else None,
        "tonic_mode": max(set(tonics), key=tonics.count) if tonics else None,
        "sha256_16": sha256_prefix(path),
    })
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0, help="files per source (debug)")
    ap.add_argument("--no-crepe", action="store_true", help="VAD + HPSS only (fast inventory pass)")
    args = ap.parse_args()
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    an = Analyzer(device)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    sources = json.loads(Path(args.sources).read_text())
    summary = []
    for src in sources:
        files = [Path(p) for p in src["files"]]
        if args.limit:
            files = files[: args.limit]
        recs = []
        t0 = time.time()
        for i, p in enumerate(files, 1):
            try:
                recs.append(analyze_file(p, an, crepe=not args.no_crepe))
            except Exception as exc:  # keep going; record the failure
                recs.append({"path": str(p), "name": p.name, "error": repr(exc)})
            if i % 10 == 0 or i == len(files):
                print(f"[{src['name']}] {i}/{len(files)} ({time.time() - t0:.0f}s)", flush=True)
        (out / f"{src['name']}.jsonl").write_text("\n".join(json.dumps(r) for r in recs) + "\n")
        ok = [r for r in recs if "error" not in r]
        hours = sum(r["duration_s"] for r in ok) / 3600
        vocal = [r for r in ok if r["vocals"] == "likely"]
        instr = [r for r in ok if r["vocals"] == "unlikely"]
        unc = [r for r in ok if r["vocals"] == "uncertain"]
        srs = sorted({r["sample_rate"] for r in ok})
        chans = sorted({r["channels"] for r in ok})
        dedup = len({r["sha256_16"] for r in ok})
        summary.append({
            "name": src["name"], "rights": src["rights"], "notes": src.get("notes", ""),
            "files": len(recs), "unreadable": len(recs) - len(ok), "unique_by_sha256": dedup,
            "hours": round(hours, 2),
            "hours_vocals_likely": round(sum(r["duration_s"] for r in vocal) / 3600, 2),
            "hours_instrumental_likely": round(sum(r["duration_s"] for r in instr) / 3600, 2),
            "hours_uncertain": round(sum(r["duration_s"] for r in unc) / 3600, 2),
            "sample_rates": srs, "channels": chans,
            "mean_trackable_melody": round(float(np.mean([r["trackable_melody_fraction"] for r in ok if r.get("trackable_melody_fraction") is not None])), 3) if ok else None,
            "mean_percussive_ratio": round(float(np.mean([r["percussive_ratio"] for r in ok if r.get("percussive_ratio") is not None])), 3) if ok else None,
        })
        print(json.dumps(summary[-1]), flush=True)
    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    print("wrote", out / "summary.json")


if __name__ == "__main__":
    main()
