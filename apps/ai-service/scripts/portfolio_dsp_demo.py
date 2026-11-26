"""Run the separation and restoration demos on three takes and write the audio and the numbers.

    python -m scripts.portfolio_dsp_demo --oud take1_oud.wav --train take2_oud.wav --voice take3_voice.wav --out <dir>
    python -m scripts.portfolio_dsp_demo --synthetic --out <dir>        (no recording needed)

Separation: the oud dictionary is learned from `--train` (a different piece),
the mixture is `--oud` + `--voice`, and both estimates are scored against the
true takes. Restoration: synthetic tape noise is added to `--oud` at a known
SNR and removed again. Writes WAVs and metrics.json to `--out`; publishes nothing.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from scripts.portfolio_dsp import (
    SR,
    add_noise,
    learn_dictionary,
    separate,
    si_sdr,
    snr_db,
    synth_oud,
    synth_voice,
    tape_noise,
)
from scripts.restore_clips import restore

SCALE = [57, 60, 62, 64, 67, 69, 72, 74]


def _melody(seconds: float, step: float, seed: int, hold: float) -> list[tuple[float, float, float]]:
    rng = np.random.default_rng(seed)
    return [(i * step, step * hold, SCALE[rng.integers(0, len(SCALE))]) for i in range(int(seconds / step) - 1)]


def load(path: Path) -> np.ndarray:
    y, _ = librosa.load(path, sr=SR, mono=True)
    return y.astype(np.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--oud", type=Path)
    ap.add_argument("--train", type=Path)
    ap.add_argument("--voice", type=Path)
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--bases", type=int, default=60)
    ap.add_argument("--free", type=int, default=16)
    ap.add_argument("--tape-snr", type=float, default=10.0)
    ap.add_argument("--alpha", type=float, default=2.0)
    ap.add_argument("--max-atten-db", type=float, default=18.0)
    a = ap.parse_args()

    if a.synthetic:
        seconds = 20.0
        oud = synth_oud(_melody(seconds, 0.35, 20, 2.5), seconds)
        train = synth_oud(_melody(seconds, 0.3, 10, 2.5), seconds)
        voice = 0.8 * synth_voice(_melody(seconds, 0.7, 30, 0.95), seconds)
    else:
        oud, train, voice = load(a.oud), load(a.train), load(a.voice)
        n = min(len(oud), len(voice))
        oud, voice = oud[:n], voice[:n]
    mix = oud + voice
    peak = np.abs(mix).max()
    if peak > 0.98:  # one gain for all three, so the parts still add up to the mixture
        oud, voice, mix = oud * 0.98 / peak, voice * 0.98 / peak, mix * 0.98 / peak

    W = learn_dictionary(train, a.bases)
    oud_hat, voice_hat = separate(mix, W, a.free)
    remix = oud_hat + 0.25 * voice_hat  # the voice turned down by 12 dB

    noisy = add_noise(oud, tape_noise(len(oud)), a.tape_snr)
    restored = restore(noisy, SR, alpha=a.alpha, max_atten_db=a.max_atten_db)

    a.out.mkdir(parents=True, exist_ok=True)
    clips = {"sep_mixture": mix, "sep_oud": oud_hat, "sep_voice": voice_hat, "sep_remix": remix,
             "sep_true_oud": oud, "sep_true_voice": voice,
             "rest_noisy": noisy, "rest_noise": noisy - oud, "rest_restored": restored, "rest_clean": oud}
    for name, y in clips.items():
        sf.write(a.out / f"{name}.wav", np.clip(y, -1.0, 1.0), SR)
    metrics = {
        "source": "synthetic test signals" if a.synthetic else {k: str(getattr(a, k)) for k in ("oud", "train", "voice")},
        "seconds": round(len(mix) / SR, 1),
        "separation": {
            "method": f"semi-supervised NMF, {a.bases} oud bases learned from another piece, {a.free} free bases",
            "oud": {"mixtureSiSdr": round(si_sdr(mix, oud), 1), "separatedSiSdr": round(si_sdr(oud_hat, oud), 1)},
            "voice": {"mixtureSiSdr": round(si_sdr(mix, voice), 1), "separatedSiSdr": round(si_sdr(voice_hat, voice), 1)},
        },
        "restoration": {
            "method": f"spectral subtraction, alpha {a.alpha}, at most {a.max_atten_db} dB",
            "noisySnr": round(snr_db(noisy, oud), 1),
            "restoredSnr": round(snr_db(restored, oud), 1),
        },
    }
    (a.out / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    print(json.dumps(metrics, indent=1))


if __name__ == "__main__":
    main()
