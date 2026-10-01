"""Precompute the musicgen-melody conditioning (chroma) for every clip of a captions file.

facebook/musicgen-melody conditions on a 12-bin chroma sequence that its
AutoProcessor (MusicgenMelodyFeatureExtractor: n_fft 16384, hop 4096, 32 kHz)
computes from the raw waveform. For a 30 s clip that is (235, 12). This script
loads the processor once (HF_HUB_OFFLINE=1 is honoured), pads or trims every
clip to exactly `--seconds` of 32 kHz mono so the sequence length is constant,
runs processor(audio=clip, sampling_rate=32000, return_tensors="pt") and saves
input_features[0] as float16 at <chroma-dir>/<clip stem>.npy. The shape of the
first clip is printed and every later clip must match it (a change aborts
the run: it is systematic). A clip that cannot be read (corrupt or empty WAV,
wrong sample rate, missing file) is logged, counted under "failed" and
skipped; the run goes on, the summary is still printed and the process exits
1 at the end. Resumable: an existing .npy is skipped. With --write-chroma-dir
the captions file is rewritten with "chroma_dir" on every row whose chroma
exists, which is what scale_train/scale_eval read to find it.

Usage (from apps/ai-service):
  HF_HUB_OFFLINE=1 python -m scripts.scale_chroma --captions ../../data/sets/ahmed_oud/captions.jsonl \
      --chroma-dir ../../data/sets/ahmed_oud/chroma [--seconds 30] [--smoke N] [--write-chroma-dir]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections.abc import Callable
from pathlib import Path

import numpy as np
import soundfile as sf

REPO = Path(__file__).resolve().parents[3]
SR = 32000
MODEL = "facebook/musicgen-melody"
CLIP_ERRORS: tuple[type[Exception], ...] = (sf.LibsndfileError, ValueError, OSError)
"""Per-clip failures that are logged and skipped; anything else (a shape change) aborts the run."""


def load_processor(model: str = MODEL):  # noqa: ANN201 - transformers processor, untyped upstream
    """The melody processor (feature extractor + tokenizer), loaded once."""
    from transformers import AutoProcessor

    return AutoProcessor.from_pretrained(model)


def resolve_clip(clip_path: str, root: Path = REPO) -> Path:
    p = Path(clip_path)
    return p if p.is_absolute() else root / p


def chroma_path(chroma_dir: Path, clip_path: str) -> Path:
    return chroma_dir / f"{Path(clip_path).stem}.npy"


def load_clip(path: Path, n_samples: int) -> np.ndarray:
    """32 kHz mono float32, zero-padded or trimmed to exactly n_samples."""
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != SR:
        raise ValueError(f"{path}: expected {SR} Hz clips, got {sr} Hz")
    fixed = np.zeros(n_samples, dtype=np.float32)
    k = min(n_samples, len(audio))
    fixed[:k] = audio[:k]
    return fixed


def to_numpy(feat: object) -> np.ndarray:
    if hasattr(feat, "detach"):
        feat = feat.detach().cpu().numpy()  # type: ignore[union-attr]
    return np.asarray(feat)


def compute_chroma(processor: Callable[..., dict], audio: np.ndarray) -> np.ndarray:
    """input_features[0] of the processor as float16, shape (frames, 12)."""
    out = processor(audio=audio, sampling_rate=SR, return_tensors="pt")
    return to_numpy(out["input_features"][0]).astype(np.float16)


def run(
    rows: list[dict],
    chroma_dir: Path,
    processor: Callable[..., dict],
    seconds: float = 30.0,
    smoke: int = 0,
    root: Path = REPO,
    log: Callable[[str], None] = print,
) -> dict:
    """Write chroma for every row lacking one; returns the summary (shape, counts)."""
    chroma_dir.mkdir(parents=True, exist_ok=True)
    n_samples = int(round(seconds * SR))
    clips = [r["clip_path"] for r in rows]
    if smoke:
        clips = clips[:smoke]
    todo = [c for c in clips if not chroma_path(chroma_dir, c).exists()]
    log(f"{len(clips)} clips, {len(todo)} to compute, {seconds:g} s each")
    shape: tuple[int, ...] | None = None
    t0 = time.time()
    done = 0
    failed: list[str] = []
    for clip in todo:
        try:
            feats = compute_chroma(processor, load_clip(resolve_clip(clip, root), n_samples))
        except CLIP_ERRORS as exc:
            failed.append(clip)
            log(f"FAILED {clip}: {exc}")
            continue
        if shape is None:
            shape = tuple(feats.shape)
            log(f"chroma shape {shape} dtype {feats.dtype} (first clip {Path(clip).name})")
        elif tuple(feats.shape) != shape:
            raise RuntimeError(f"chroma shape changed: {clip} gave {tuple(feats.shape)}, expected {shape}")
        np.save(chroma_path(chroma_dir, clip), feats)
        done += 1
        if done % 200 == 0 or done == len(todo):
            rate = done / max(1e-9, time.time() - t0)
            log(f"{done}/{len(todo)}  {rate:.1f} clips/s  ETA {(len(todo) - done) / max(rate, 1e-9) / 60:.0f} min")
    return {
        "clips": len(clips), "computed": done, "skipped_existing": len(clips) - len(todo),
        "failed": len(failed), "failed_clips": failed[:50],
        "shape": list(shape) if shape else None, "seconds": round(time.time() - t0, 1),
        "chroma_dir": str(chroma_dir),
    }


def write_chroma_dir(captions: Path, rows: list[dict], chroma_dir: Path, root: Path = REPO) -> int:
    """Set row["chroma_dir"] on every row whose chroma exists and rewrite the captions file."""
    try:
        rel = chroma_dir.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        rel = str(chroma_dir.resolve())
    n = 0
    for r in rows:
        if chroma_path(chroma_dir, r["clip_path"]).exists():
            r["chroma_dir"] = rel
            n += 1
    tmp = captions.with_suffix(captions.suffix + ".tmp")
    tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    os.replace(tmp, captions)
    return n


def main(argv: list[str] | None = None) -> int:
    """0 when every clip has chroma, 1 when some clips failed (summary still printed, rows still stamped)."""
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--captions", required=True)
    ap.add_argument("--chroma-dir", required=True)
    ap.add_argument("--seconds", type=float, default=30.0)
    ap.add_argument("--smoke", type=int, default=0, help="only the first N clips")
    ap.add_argument("--model", default=MODEL)
    ap.add_argument("--write-chroma-dir", action="store_true",
                    help="after computing, set chroma_dir on the captions rows that have chroma")
    args = ap.parse_args(argv)
    captions = Path(args.captions)
    rows = [json.loads(line) for line in captions.read_text().splitlines() if line.strip()]
    chroma_dir = Path(args.chroma_dir)
    processor = load_processor(args.model)
    summary = run(rows, chroma_dir, processor, seconds=args.seconds, smoke=args.smoke)
    if args.write_chroma_dir:
        summary["rows_with_chroma_dir"] = write_chroma_dir(captions, rows, chroma_dir)
    print(json.dumps(summary), flush=True)
    if summary["failed"]:
        print(f"{summary['failed']} clips failed (see FAILED lines above); their rows carry no chroma_dir",
              file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
