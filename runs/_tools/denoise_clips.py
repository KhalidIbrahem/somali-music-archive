"""DeepFilterNet3 denoising of the Harvard clip set, clip-for-clip.

For every clip listed in data/captions.jsonl (train/val/test), write a denoised twin at
data/clips_denoised/<split>/<same filename>.wav with the same spec as phase1_preprocess
(32 kHz mono PCM_16, 15.0 s, re-normalised to -14 LUFS, peak <= 0.99). Splits, filenames
and captions are unchanged, so raw-vs-denoised is a controlled comparison; a
data/captions_denoised.jsonl is written with clip_path repointed.

Denoiser: DeepFilterNet3 via df.enhance (the same model the project's process_harvard.py
`clean` stage and harvard_pipeline notebook use). Audio is resampled 32k -> 48k (3:2,
polyphase) for the model and back. Resumable; skips clips already written.

Runs in ~/ai/df-env (torch + deepfilternet). torchaudio >= 2.9 removed
torchaudio.backend.common, which deepfilternet 0.5.6 imports at load; a minimal stand-in
is registered below (df.io only uses AudioMetaData as a type, and we never call df.io).

Usage: python -u runs/_tools/denoise_clips.py --workers 4 --threads 3
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import sys
import time
import types
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

REPO = Path(__file__).resolve().parents[2]
CAPTIONS = REPO / "data/captions.jsonl"
OUT_ROOT = REPO / "data/clips_denoised"
OUT_CAPTIONS = REPO / "data/captions_denoised.jsonl"
SRC_SR = 32000
CLIP_SAMPLES = 15 * SRC_SR
TARGET_LUFS = -14.0
PEAK = 0.99

_MODEL = None
_STATE = None


def _shim_torchaudio_backend() -> None:
    try:
        import torchaudio.backend.common  # noqa: F401
    except Exception:
        b = types.ModuleType("torchaudio.backend")
        c = types.ModuleType("torchaudio.backend.common")

        class AudioMetaData:  # type-only stand-in
            def __init__(self, *a, **k):
                pass

        c.AudioMetaData = AudioMetaData
        b.common = c
        sys.modules["torchaudio.backend"] = b
        sys.modules["torchaudio.backend.common"] = c


def _init_worker(threads: int) -> None:
    global _MODEL, _STATE
    import torch
    torch.set_num_threads(threads)
    _shim_torchaudio_backend()
    from df.enhance import init_df
    _MODEL, _STATE, _ = init_df(log_level="ERROR")
    _MODEL.eval()


def _lufs(y: np.ndarray) -> float:
    import pyloudnorm as pyln
    return float(pyln.Meter(SRC_SR).integrated_loudness(y.astype(np.float64)))


def _normalise(y: np.ndarray) -> tuple[np.ndarray, float, float]:
    loud = _lufs(y)
    gain_db = 0.0
    if np.isfinite(loud):
        gain_db = TARGET_LUFS - loud
        y = y * (10 ** (gain_db / 20))
    peak = float(np.max(np.abs(y))) if y.size else 0.0
    if peak > PEAK:
        y = y * (PEAK / peak)
    return y.astype(np.float32), gain_db, loud


def _process(job: tuple[str, str]) -> tuple[str, bool, dict, str]:
    src, dst = job
    try:
        import torch
        from df.enhance import enhance
        x, sr = sf.read(src, dtype="float32")
        assert sr == SRC_SR and x.ndim == 1, (sr, x.shape)
        x48 = resample_poly(x, 3, 2).astype(np.float32)
        with torch.no_grad():
            y48 = enhance(_MODEL, _STATE, torch.from_numpy(x48)[None, :])  # (1, T) @ 48 kHz
        y = resample_poly(y48.squeeze(0).numpy(), 2, 3).astype(np.float32)
        if y.shape[0] < CLIP_SAMPLES:
            y = np.pad(y, (0, CLIP_SAMPLES - y.shape[0]))
        y = y[:CLIP_SAMPLES]
        y, gain_db, pre_lufs = _normalise(y)
        n = min(len(x), len(y))
        corr = float(np.corrcoef(x[:n], y[:n])[0, 1]) if n > 1 else float("nan")
        tmp = dst + ".tmp.wav"
        sf.write(tmp, y, SRC_SR, subtype="PCM_16")
        os.replace(tmp, dst)
        diag = {"gain_db": gain_db, "raw_lufs": _lufs(x), "denoised_lufs_pre_gain": pre_lufs,
                "corr_raw_vs_denoised": corr}
        return src, True, diag, ""
    except Exception as exc:  # report, never abort the pool
        return src, False, {}, repr(exc)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--threads", type=int, default=3, help="torch threads per worker")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    rows = [json.loads(l) for l in open(CAPTIONS)]
    if args.limit:
        rows = rows[: args.limit]
    for split in {r["split"] for r in rows}:
        (OUT_ROOT / split).mkdir(parents=True, exist_ok=True)

    def dst_for(r: dict) -> Path:
        return OUT_ROOT / r["split"] / Path(r["clip_path"]).name

    jobs = [(str(REPO / r["clip_path"]), str(dst_for(r))) for r in rows
            if not dst_for(r).exists()]
    print(f"{len(rows)} clips listed, {len(jobs)} to denoise, workers={args.workers} "
          f"threads/worker={args.threads}", flush=True)

    t0 = time.time()
    done = ok = 0
    diags: list[dict] = []
    failures: list[tuple[str, str]] = []
    if jobs:
        ctx = mp.get_context("spawn")
        with ctx.Pool(args.workers, initializer=_init_worker, initargs=(args.threads,)) as pool:
            for src, good, diag, err in pool.imap_unordered(_process, jobs, chunksize=4):
                done += 1
                if good:
                    ok += 1
                    diags.append(diag)
                else:
                    failures.append((src, err))
                if done % 500 == 0 or done == len(jobs):
                    rate = done / (time.time() - t0)
                    eta = (len(jobs) - done) / rate / 60 if rate else 0
                    print(f"denoised {done}/{len(jobs)}  {rate:.1f} clips/s  ETA {eta:.0f} min  "
                          f"failures={len(failures)}", flush=True)

    # captions with clip_path repointed (same order, same captions, same splits)
    with open(OUT_CAPTIONS, "w") as f:
        for r in rows:
            f.write(json.dumps({**r, "clip_path": str(dst_for(r).relative_to(REPO))}) + "\n")

    missing = [r for r in rows if not dst_for(r).exists()]
    stats = {
        "denoiser": "DeepFilterNet3 (df.enhance, default settings)",
        "source_captions": str(CAPTIONS.relative_to(REPO)),
        "clips_listed": len(rows),
        "denoised_this_run": ok,
        "failures_this_run": len(failures),
        "missing_after_run": len(missing),
        "diagnostics_median": {k: round(float(np.median([d[k] for d in diags if np.isfinite(d[k])])), 2)
                               for k in ("gain_db", "raw_lufs", "denoised_lufs_pre_gain",
                                         "corr_raw_vs_denoised")} if diags else None,
        "diagnostics_p10_p90_corr": [round(float(np.percentile([d["corr_raw_vs_denoised"] for d in diags], q)), 3)
                                     for q in (10, 90)] if diags else None,
        "note": "DeepFilterNet3 is a speech enhancer; on this corpus it removes ~13-18 dB of energy "
                "(mostly 1-3 kHz) and the output correlates only ~0.3-0.45 with the raw waveform. "
                "This is the project's documented `clean` stage, reproduced as-is.",
        "spec": "32 kHz mono PCM_16, 15.0 s, -14 LUFS, peak<=0.99 (phase1_preprocess spec)",
        "resample": "scipy resample_poly 32k->48k->32k",
        "seconds": round(time.time() - t0, 1),
        "failures": failures[:50],
    }
    (OUT_ROOT / "denoise_stats.json").write_text(json.dumps(stats, indent=2))
    (OUT_ROOT / "README.md").write_text(
        "# clips_denoised\n\nDeepFilterNet3-denoised twins of data/clips (clip-for-clip, same "
        "filenames/splits/captions), re-normalised to -14 LUFS. Built by "
        "runs/_tools/denoise_clips.py on the M5 Max, 2026-09-03. Captions: "
        "data/captions_denoised.jsonl. Tokens: data/tokens_denoised. Stats: denoise_stats.json.\n")
    print(json.dumps({k: v for k, v in stats.items() if k != "failures"}, indent=2), flush=True)
    if missing:
        print(f"DENOISE_INCOMPLETE missing={len(missing)}", flush=True)
        sys.exit(2)
    if args.limit:
        print("limited test run: not marking .DONE", flush=True)
        return
    (OUT_ROOT / ".DONE").write_text(time.strftime("%F %T") + "\n")
    print("DENOISE_DONE", flush=True)


if __name__ == "__main__":
    main()
