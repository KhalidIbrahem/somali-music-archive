"""Archive-style restoration of the Harvard cassette clips: stationary noise-profile
spectral subtraction, conservative by construction, measured against the raw clips.

DeepFilterNet (the pipeline's `clean` stage, tested clip for clip on 2026-09-03) is a
speech enhancer: it removed a median 13-15 dB, mostly the 1-3 kHz band where the oud and
the voice live, left a signal correlating 0.41 with the raw waveform, and an adapter
trained on its output was worse than base on raw audio. This is the other approach
archives take: estimate the tape's stationary noise from the quietest moments of each
clip and subtract only that, with a floor on how much any time-frequency cell may be
attenuated, so nothing is hallucinated and nothing musical can be removed wholesale.

Per clip (32 kHz mono, 15 s):
  STFT 2048/512 Hann -> noise PSD = per-bin median of |X|^2 over the quietest 15% of
  frames (fallback: per-bin 5th percentile over all frames) -> Wiener-style gain
  G = max(1 - alpha * N / |X|^2, floor), alpha 1.5, floor = -max_atten dB (12 dB),
  smoothed over 3 frames x 3 bins to limit musical noise -> iSTFT -> re-normalised to
  -14 LUFS, peak <= 0.99 (the phase1_preprocess spec, same as the denoised twin set).

Diagnostics per clip, written to data/clips_restored/restore_stats.jsonl: energy removed
(dB), share of energy in 1-3 kHz before/after, waveform correlation raw vs restored, band
SNR before/after (scripts.reward_model.hiss_terms), and, with --mert, the cosine between
the MERT embeddings of raw and restored (does it still sound like the same recording).
The same diagnostics DeepFilterNet was judged on.

Usage (from apps/ai-service):
  python -m scripts.restore_clips --sample 64            # measure on a test-split sample
  python -m scripts.restore_clips --all --workers 6      # every clip -> data/clips_restored/
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import time
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.ndimage import uniform_filter
from scipy.signal import stft, istft

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "data"
CAPTIONS = DATA / "captions.jsonl"
OUT_ROOT = DATA / "clips_restored"
OUT_CAPTIONS = DATA / "captions_restored.jsonl"
SR = 32000
N_FFT, HOP = 2048, 512
TARGET_LUFS = -14.0


def restore(audio: np.ndarray, sr: int = SR, alpha: float = 1.5, max_atten_db: float = 12.0,
            quiet_frac: float = 0.15) -> np.ndarray:
    f, t, X = stft(audio, fs=sr, window="hann", nperseg=N_FFT, noverlap=N_FFT - HOP, padded=True)
    P = np.abs(X) ** 2
    frame_e = P.sum(axis=0)
    k = max(8, int(quiet_frac * P.shape[1]))
    quiet = np.argsort(frame_e)[:k]
    noise = np.median(P[:, quiet], axis=1, keepdims=True)
    if not np.isfinite(noise).all() or noise.max() <= 0:
        noise = np.percentile(P, 5, axis=1, keepdims=True)
    floor = 10.0 ** (-max_atten_db / 10.0)
    gain = np.maximum(1.0 - alpha * noise / (P + 1e-12), floor)
    gain = uniform_filter(gain, size=(3, 3), mode="nearest")
    gain = np.clip(gain, floor, 1.0)
    _, y = istft(X * gain, fs=sr, window="hann", nperseg=N_FFT, noverlap=N_FFT - HOP)
    y = y[: len(audio)].astype(np.float32)
    if len(y) < len(audio):
        y = np.pad(y, (0, len(audio) - len(y)))
    return y


def normalise(y: np.ndarray, sr: int = SR) -> np.ndarray:
    meter = pyln.Meter(sr)
    try:
        lufs = meter.integrated_loudness(y.astype(np.float64))
        if np.isfinite(lufs):
            y = y * 10.0 ** ((TARGET_LUFS - lufs) / 20.0)
    except ValueError:
        pass
    peak = float(np.abs(y).max()) + 1e-9
    if peak > 0.99:
        y = y * (0.99 / peak)
    return y.astype(np.float32)


def band_share(audio: np.ndarray, sr: int, lo: float, hi: float) -> float:
    f, _, X = stft(audio, fs=sr, nperseg=N_FFT, noverlap=N_FFT - HOP)
    P = np.abs(X) ** 2
    return float(P[(f >= lo) & (f <= hi)].sum() / (P.sum() + 1e-12))


def diagnostics(raw: np.ndarray, out: np.ndarray, sr: int) -> dict:
    from scripts.reward_model import hiss_terms
    e_raw = float(np.mean(raw ** 2)) + 1e-12
    e_out_pre = float(np.mean(out ** 2)) + 1e-12
    corr = float(np.corrcoef(raw, out)[0, 1]) if raw.std() > 0 and out.std() > 0 else 0.0
    hr, ho = hiss_terms(raw, sr), hiss_terms(out, sr)
    return {
        "energy_removed_db": round(10.0 * np.log10(e_raw / e_out_pre), 2),
        "band_1_3k_share_raw": round(band_share(raw, sr, 1000, 3000), 4),
        "band_1_3k_share_out": round(band_share(out, sr, 1000, 3000), 4),
        "corr_raw_vs_out": round(corr, 4),
        "band_snr_db_raw": hr["band_snr_db"], "band_snr_db_out": ho["band_snr_db"],
        "rolloff95_hz_raw": hr["rolloff95_hz"], "rolloff95_hz_out": ho["rolloff95_hz"],
        "noise_floor_db_raw": hr["noise_floor_db"], "noise_floor_db_out": ho["noise_floor_db"],
    }


def process_one(args: tuple) -> dict:
    rel, alpha, max_atten, with_diag = args
    src = REPO / rel
    dst = OUT_ROOT / Path(rel).relative_to("data/clips")
    dst.parent.mkdir(parents=True, exist_ok=True)
    raw, sr = sf.read(src, dtype="float32")
    if raw.ndim > 1:
        raw = raw.mean(axis=1)
    out = restore(raw, sr, alpha=alpha, max_atten_db=max_atten)
    rec = {"clip": rel}
    if with_diag:
        rec.update(diagnostics(raw, out, sr))
    sf.write(dst, normalise(out, sr), sr, subtype="PCM_16")
    return rec


def rows(split: str | None = None) -> list[dict]:
    out = [json.loads(l) for l in CAPTIONS.open()]
    return [r for r in out if split is None or r["split"] == split]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=0, help="measure on N stride-sampled test clips")
    ap.add_argument("--all", action="store_true", help="restore every clip in captions.jsonl")
    ap.add_argument("--alpha", type=float, default=1.5)
    ap.add_argument("--max-atten-db", type=float, default=12.0)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--mert", action="store_true", help="also compute MERT cosine raw vs restored (sample only)")
    args = ap.parse_args()

    if args.sample:
        test = sorted(rows("test"), key=lambda r: r["clip_path"])
        stride = max(1, len(test) // args.sample)
        todo = test[::stride][: args.sample]
        with_diag = True
    elif args.all:
        todo = rows()
        with_diag = False
    else:
        raise SystemExit("give --sample N or --all")
    todo = [r for r in todo if not (args.all and (OUT_ROOT / Path(r["clip_path"]).relative_to("data/clips")).exists())]
    print(f"{len(todo)} clips, alpha {args.alpha}, max attenuation {args.max_atten_db} dB", flush=True)
    t0 = time.time()
    work = [(r["clip_path"], args.alpha, args.max_atten_db, with_diag) for r in todo]
    if args.workers > 1 and not with_diag:
        with mp.Pool(args.workers) as pool:
            recs = []
            for i, rec in enumerate(pool.imap_unordered(process_one, work, chunksize=8), 1):
                recs.append(rec)
                if i % 500 == 0 or i == len(work):
                    print(f"  {i}/{len(work)}  {(time.time() - t0) / 60:.1f} min", flush=True)
    else:
        recs = [process_one(w) for w in work]
    OUT_ROOT.mkdir(parents=True, exist_ok=True)

    if with_diag:
        if args.mert:
            from scripts.reward_model import embed_mert, DEVICE
            raws = [REPO / r["clip_path"] for r in todo]
            outs = [OUT_ROOT / Path(r["clip_path"]).relative_to("data/clips") for r in todo]
            er, eo = embed_mert(raws, DEVICE), embed_mert(outs, DEVICE)
            for rec, a, b in zip(recs, er, eo):
                rec["mert_cosine_raw_vs_out"] = round(float(np.dot(a, b)), 4)
        with (OUT_ROOT / "restore_stats.jsonl").open("w") as fh:
            for rec in recs:
                fh.write(json.dumps(rec) + "\n")
        keys = [k for k in recs[0] if k != "clip"]
        summary = {k: {"median": round(float(np.median([r[k] for r in recs])), 4),
                       "p10": round(float(np.percentile([r[k] for r in recs], 10)), 4),
                       "p90": round(float(np.percentile([r[k] for r in recs], 90)), 4)} for k in keys}
        summary["n"] = len(recs)
        summary["settings"] = {"alpha": args.alpha, "max_atten_db": args.max_atten_db, "n_fft": N_FFT, "hop": HOP}
        (OUT_ROOT / "restore_summary.json").write_text(json.dumps(summary, indent=2))
        for k in keys:
            print(f"{k:24s} median {summary[k]['median']:>10}  p10 {summary[k]['p10']:>10}  p90 {summary[k]['p90']:>10}")
    if args.all:
        with OUT_CAPTIONS.open("w") as fh:
            for r in rows():
                fh.write(json.dumps(r | {"clip_path": str(Path("data/clips_restored") / Path(r["clip_path"]).relative_to("data/clips"))}) + "\n")
        print(f"wrote {OUT_CAPTIONS}")
    print(f"done in {(time.time() - t0) / 60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
