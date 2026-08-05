"""CREPE vocal transcriber — separated vocal stem → note-events JSON.

The dedicated melody engine (Track B accuracy stage 2): CREPE ('full') tracks
the singer's f0 at 10 ms resolution with per-frame confidence — far finer than
a general polyphonic detector — and scripts/f0_notes.py segments that ribbon
into notes with microtone-accurate cents. Runs in a torch-capable Python (the
service's base env; see config.vocal_python), unlike the basic-pitch pipeline
which needs the somali311 env — hence a separate subprocess entrypoint that
communicates via JSON.

Usage: python -m scripts.vocal_f0 <vocals.wav> <out.json> [--voicing 0.5]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.f0_notes import hz_to_cents, median_smooth, segment_notes  # noqa: E402

SAMPLE_RATE = 16_000  # CREPE's native rate
HOP = 160  # 10 ms


def extract_notes(audio_path: str | Path, voicing_threshold: float = 0.5) -> dict:
    import librosa
    import torch
    import torchcrepe

    y, _ = librosa.load(str(audio_path), sr=SAMPLE_RATE, mono=True)
    audio = torch.from_numpy(y).float().unsqueeze(0)

    def run(device: str):
        return torchcrepe.predict(
            audio, SAMPLE_RATE, hop_length=HOP,
            fmin=55.0, fmax=1047.0,  # A1..C6 — generous singing range
            model="full", batch_size=512, device=device,
            return_periodicity=True,
        )

    # MPS when available (M-series), CPU fallback — torchcrepe's MPS support
    # has rough edges across versions.
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    try:
        pitch, periodicity = run(device)
    except Exception:  # noqa: BLE001 — any MPS failure → CPU retry
        if device == "cpu":
            raise
        pitch, periodicity = run("cpu")

    f0 = pitch.squeeze(0).cpu().numpy()
    conf = periodicity.squeeze(0).cpu().numpy()
    n = len(f0)
    times = np.arange(n) * (HOP / SAMPLE_RATE)

    # Loudness per frame (note amp/velocity): RMS at the same hop, normalised.
    rms = librosa.feature.rms(y=y, frame_length=4 * HOP, hop_length=HOP)[0][:n]
    amp = rms / max(float(rms.max()), 1e-9)

    cents = median_smooth(hz_to_cents(f0), width=5)
    conf = median_smooth(conf, width=3)
    notes = segment_notes(times, cents, conf, amp, voicing_threshold=voicing_threshold)

    return {
        "engine": "torchcrepe-full",
        "device": device,
        "n_frames": int(n),
        "voiced_fraction": round(float(np.mean(conf >= voicing_threshold)), 3),
        "notes": [
            {
                "start": round(nt.start, 4),
                "end": round(nt.end, 4),
                "midi": nt.midi,
                "cents": round(nt.cents, 1),
                "amp": round(nt.amp, 3),
                "confidence": round(nt.confidence, 3),
            }
            for nt in notes
        ],
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="CREPE vocal stem → notes JSON")
    ap.add_argument("audio")
    ap.add_argument("out_json")
    ap.add_argument("--voicing", type=float, default=0.5)
    args = ap.parse_args()
    result = extract_notes(args.audio, voicing_threshold=args.voicing)
    Path(args.out_json).write_text(json.dumps(result, indent=1))
    print(json.dumps({k: v for k, v in result.items() if k != "notes"}
                     | {"n_notes": len(result["notes"])}))
