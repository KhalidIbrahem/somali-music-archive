"""Synthetic Somali-style transcription benchmark with exact ground truth.

Each item is a pentatonic melody (one of the five rotations of the anhemitonic
pentatonic set, the scale family of qaraami and heello), with a global tuning
offset (±40 cents from A440) and a per-note deviation (sd 12 cents), played by
a plucked string (Karplus-Strong, oud register) or a voice-like source
(harmonics, vibrato, low or high register). Every melody is rendered in five
conditions: clean, + bass line, + bass and drums, + noise (20 dB SNR), and a
full mix (bass, drums, reverb, noise). All audio is synthesised here; nothing
comes from a recording, so the set is public-safe.

    uv run --with numpy --with soundfile python apps/ai-service/scripts/synth_somali_bench.py \
        --out data/eval_qormada/synth --items 24
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44100
PENTATONIC = [0, 2, 4, 7, 9]
CONDITIONS = ["clean", "bass", "bass_drums", "noise", "full_mix"]


def rotations() -> list[list[int]]:
    out = []
    for i in range(5):
        root = PENTATONIC[i]
        out.append(sorted(((p - root) % 12) for p in PENTATONIC))
    return out


def hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def pluck(f0: float, dur: float, rng: np.random.Generator) -> np.ndarray:
    # Karplus-Strong: the two-point average adds half a sample of delay, so the
    # line is SR/f0 - 0.5 samples, the fraction by linear interpolation.
    n = int(dur * SR)
    d = SR / f0 - 0.5
    p = int(d)
    frac = d - p
    y = np.zeros(n + p + 2)
    y[: p + 2] = rng.uniform(-1, 1, p + 2)
    for i in range(p + 2, n + p + 2):
        a = (1 - frac) * y[i - p] + frac * y[i - p - 1]
        b = (1 - frac) * y[i - p - 1] + frac * y[i - p - 2]
        y[i] = 0.998 * 0.5 * (a + b)
    out = y[p + 2 :]
    return out / (np.abs(out).max() + 1e-9)


def voice(f0: float, dur: float, rng: np.random.Generator) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    vib = 1 + 0.012 * np.sin(2 * np.pi * rng.uniform(4.5, 6.0) * t) * np.clip(t / 0.25, 0, 1)
    phase = 2 * np.pi * np.cumsum(f0 * vib) / SR
    sig = sum((0.9**k) / k * np.sin(k * phase) * (1.0 if k * f0 < 4000 else 0.0) for k in range(1, 16))
    env = np.clip(t / 0.04, 0, 1) * np.clip((dur - t) / 0.06, 0, 1)
    return sig * env


def melody(rng: np.random.Generator, register: str) -> dict:
    scale = rotations()[rng.integers(5)]
    tonic = int(rng.integers(12))
    lo, hi = {"oud": (50, 74), "voice_low": (43, 60), "voice_high": (57, 76)}[register]
    pitches = sorted(m for m in range(lo, hi + 1) if (m - tonic) % 12 in scale)
    bpm = float(rng.uniform(70, 140))
    beat = 60 / bpm
    offset_c = float(rng.uniform(-40, 40))
    t = 0.5
    idx = int(rng.integers(len(pitches) // 3, 2 * len(pitches) // 3))
    notes = []
    while t < 14.0:
        units = rng.choice([0.5, 1, 1, 1.5, 2], p=[0.3, 0.3, 0.15, 0.1, 0.15])
        step = int(rng.choice([-2, -1, -1, 0, 1, 1, 2]))
        idx = int(np.clip(idx + step, 0, len(pitches) - 1))
        dev = float(np.clip(rng.normal(0, 12), -30, 30))
        dur = units * beat
        notes.append({"onset": t, "offset": t + dur, "midi": pitches[idx], "cents": offset_c + dev})
        t += dur
    return {"scale_pcs": sorted((tonic + d) % 12 for d in scale), "tonic": tonic, "bpm": bpm, "offset_cents": offset_c, "notes": notes, "length": t + 1.0}


def render(item: dict, register: str, rng: np.random.Generator) -> np.ndarray:
    out = np.zeros(int(item["length"] * SR))
    for n in item["notes"]:
        f0 = hz(n["midi"] + n["cents"] / 100)
        dur = n["offset"] - n["onset"]
        x = pluck(f0, dur, rng) * np.exp(-np.arange(int(dur * SR)) / SR / 0.9) if register == "oud" else voice(f0, dur, rng)
        i = int(n["onset"] * SR)
        out[i : i + len(x)] += 0.5 * x
    return out


def bass_line(item: dict, length: int, rng: np.random.Generator) -> np.ndarray:
    beat = 60 / item["bpm"]
    out = np.zeros(length)
    root = 36 + item["tonic"] if 36 + item["tonic"] <= 43 else 24 + item["tonic"]
    t = 0.5
    while t < item["length"] - 0.5:
        m = root + int(rng.choice([0, 7, 0, 5, 12]))
        f0 = hz(m + item["offset_cents"] / 100)
        n = int(beat * 2 * SR * 0.95)
        tt = np.arange(n) / SR
        x = (np.sin(2 * np.pi * f0 * tt) + 0.4 * np.sin(4 * np.pi * f0 * tt)) * np.exp(-tt / 0.8)
        i = int(t * SR)
        out[i : i + n] += x[: max(0, min(n, length - i))]
        t += beat * 2
    return out


def drums(item: dict, length: int, rng: np.random.Generator) -> np.ndarray:
    beat = 60 / item["bpm"]
    out = np.zeros(length)
    t = 0.5
    k = 0
    while t < item["length"] - 0.3:
        n = int(0.15 * SR)
        tt = np.arange(n) / SR
        if k % 2 == 0:  # low drum: pitch-swept sine
            x = np.sin(2 * np.pi * (60 + 80 * np.exp(-tt / 0.03)) * tt) * np.exp(-tt / 0.08)
        else:  # high hand drum: filtered noise burst
            x = rng.normal(0, 0.6, n) * np.exp(-tt / 0.03)
        i = int(t * SR)
        out[i : i + n] += x[: max(0, min(n, length - i))]
        t += beat / 2 if rng.random() < 0.3 else beat
        k += 1
    return out


def reverb(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    n = int(1.2 * SR)
    ir = rng.normal(0, 1, n) * np.exp(-np.arange(n) / SR / 0.35)
    ir[0] = 1.0
    ir *= 0.25 / np.sqrt(np.sum(ir[1:] ** 2))
    ir[0] = 1.0
    return np.fft.irfft(np.fft.rfft(x, len(x) + n) * np.fft.rfft(ir, len(x) + n))[: len(x)]


def with_snr(x: np.ndarray, snr_db: float, rng: np.random.Generator) -> np.ndarray:
    p = np.mean(x**2)
    return x + rng.normal(0, np.sqrt(p / 10 ** (snr_db / 10)), len(x))


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x**2)) + 1e-12)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--items", type=int, default=24)
    ap.add_argument("--seed", type=int, default=2026)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(args.seed)
    registers = ["oud", "voice_low", "voice_high"]
    truth = {}
    for i in range(args.items):
        register = registers[i % 3]
        item = melody(rng, register)
        lead = render(item, register, rng)
        lead /= rms(lead)
        bass = bass_line(item, len(lead), rng)
        bass *= 0.7 / rms(bass)  # bass about 3 dB below the melody
        drum = drums(item, len(lead), rng)
        drum *= 0.5 / rms(drum)
        mixes = {
            "clean": lead,
            "bass": lead + bass,
            "bass_drums": lead + bass + drum,
            "noise": with_snr(lead, 20, rng),
            "full_mix": with_snr(reverb(lead + bass + drum, rng), 20, rng),
        }
        for cond, x in mixes.items():
            name = f"synth_{i:02d}_{register}_{cond}.wav"
            sf.write(args.out / name, (0.3 * x / np.abs(x).max()).astype(np.float32), SR, subtype="FLOAT")
            truth[name] = {**item, "register": register, "condition": cond, "item": i}
    (args.out / "truth.json").write_text(json.dumps(truth, indent=1))
    print(f"wrote {len(truth)} files to {args.out}")


if __name__ == "__main__":
    main()
