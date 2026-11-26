"""Separation and restoration for the portfolio demos. numpy and scipy only.

Separation: semi-supervised non-negative matrix factorisation (NMF), after
Smaragdis, Raj and Shashanka, "Supervised and semi-supervised separation of
sounds from single-channel mixtures" (ICA 2007).

    1. Learn a dictionary of oud spectra from a solo oud recording.
    2. Explain the mixture's spectrogram with that dictionary (kept fixed) plus
       a few free spectra that are learned from the mixture itself. Whatever the
       oud dictionary cannot explain goes to the free spectra: the voice.
    3. Turn the two explanations into soft masks and apply them to the mixture.

Restoration: stationary spectral subtraction (`scripts/restore_clips.restore`),
the method measured in docs/eval/RESTORATION.md.

Everything here works on a magnitude spectrogram V (frequency x time), which is
never negative. NMF writes V ≈ W @ H: each column of W is one spectrum (a
"basis"), each row of H says how loud that basis is over time.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import istft, stft

SR = 32000
N_FFT = 2048
HOP = 512
EPS = 1e-10


# ── spectrogram in, audio out ───────────────────────────────────────────────────
def spectrogram(y: np.ndarray, sr: int = SR) -> np.ndarray:
    """Complex STFT, shape (N_FFT / 2 + 1, frames)."""
    _, _, X = stft(y, fs=sr, window="hann", nperseg=N_FFT, noverlap=N_FFT - HOP, padded=True)
    return X


def audio(X: np.ndarray, length: int, sr: int = SR) -> np.ndarray:
    """Inverse STFT, cut or padded to `length` samples."""
    _, y = istft(X, fs=sr, window="hann", nperseg=N_FFT, noverlap=N_FFT - HOP)
    y = y[:length]
    return np.pad(y, (0, length - len(y))).astype(np.float32)


# ── NMF ─────────────────────────────────────────────────────────────────────────
def nmf(V: np.ndarray, n_free: int, W_fixed: np.ndarray | None = None, n_iter: int = 200,
        seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """V ≈ W @ H with the Kullback-Leibler multiplicative updates (Lee and Seung, 2001).

    W = [W_fixed | W_free]. Columns of W_fixed are never changed; the `n_free`
    other columns start random and are learned. H is always learned.
    Multiplicative updates only ever multiply by positive numbers, so W and H
    stay non-negative without any clipping.
    """
    rng = np.random.default_rng(seed)
    n_bins, n_frames = V.shape
    n_fixed = 0 if W_fixed is None else W_fixed.shape[1]
    W_free = rng.random((n_bins, n_free)) + EPS
    W = W_free if W_fixed is None else np.hstack([W_fixed, W_free])
    H = rng.random((n_fixed + n_free, n_frames)) + EPS
    ones = np.ones_like(V)
    for _ in range(n_iter):
        # H: how much of each basis is needed, given the current W
        H *= (W.T @ (V / (W @ H + EPS))) / (W.T @ ones + EPS)
        if n_free:
            # W_free: what the free bases should look like, given the current H
            ratio = V / (W @ H + EPS)
            Hf = H[n_fixed:]
            W[:, n_fixed:] *= (ratio @ Hf.T) / (ones @ Hf.T + EPS)
            # keep each free basis at unit sum and move its scale into H
            scale = W[:, n_fixed:].sum(axis=0, keepdims=True) + EPS
            W[:, n_fixed:] /= scale
            H[n_fixed:] *= scale.T
    return W, H


def learn_dictionary(y: np.ndarray, n_bases: int = 60, sr: int = SR, seed: int = 0) -> np.ndarray:
    """Spectra that add up to the instrument in `y`, one per column, each summing to 1."""
    V = np.abs(spectrogram(y, sr))
    W, _ = nmf(V, n_bases, seed=seed)
    return W


def separate(mix: np.ndarray, W_known: np.ndarray, n_free: int = 16, sr: int = SR, n_iter: int = 200,
             seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """Split `mix` into (known source, everything else).

    `W_known` is the dictionary of the known source (the oud). The other source
    gets `n_free` bases learned from the mixture. Few free bases keep them from
    also explaining the oud.
    """
    X = spectrogram(mix, sr)
    V = np.abs(X)
    k = W_known.shape[1]
    W, H = nmf(V, n_free, W_fixed=W_known, n_iter=n_iter, seed=seed)
    known = W[:, :k] @ H[:k]
    other = W[:, k:] @ H[k:]
    # Soft (Wiener-style) masks: each source takes its share of every cell, so
    # the two outputs always add back up to the mixture.
    mask = known / (known + other + EPS)
    return audio(X * mask, len(mix), sr), audio(X * (1.0 - mask), len(mix), sr)


# ── scoring ─────────────────────────────────────────────────────────────────────
def si_sdr(estimate: np.ndarray, target: np.ndarray) -> float:
    """Scale-invariant signal-to-distortion ratio in dB (Le Roux et al., 2019). Higher is better."""
    target = target - target.mean()
    estimate = estimate - estimate.mean()
    scaled = (estimate @ target) / (target @ target + EPS) * target
    return float(10.0 * np.log10((scaled @ scaled + EPS) / ((estimate - scaled) @ (estimate - scaled) + EPS)))


def snr_db(noisy: np.ndarray, clean: np.ndarray) -> float:
    """Plain signal-to-noise ratio in dB of `noisy` against the known `clean` signal."""
    return float(10.0 * np.log10((clean @ clean + EPS) / ((noisy - clean) @ (noisy - clean) + EPS)))


# ── test signals (no recording needed) ──────────────────────────────────────────
def midi_hz(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69.0) / 12.0)


def synth_oud(notes: list[tuple[float, float, float]], seconds: float, sr: int = SR) -> np.ndarray:
    """Plucked string: harmonics that start together and die away, higher ones faster.
    `notes` are (start seconds, length seconds, MIDI pitch)."""
    y = np.zeros(int(seconds * sr))
    for start, length, pitch in notes:
        t = np.arange(int(length * sr)) / sr
        f0 = midi_hz(pitch)
        tone = sum(np.sin(2 * np.pi * f0 * h * t) * np.exp(-t * (3.0 + 1.5 * h)) / h for h in range(1, 13) if f0 * h < sr / 2)
        tone *= np.minimum(1.0, t / 0.004)  # 4 ms attack, no click
        i = int(start * sr)
        y[i:i + len(tone)] += tone[: len(y) - i]
    return (0.5 * y / (np.abs(y).max() + EPS)).astype(np.float32)


def synth_voice(notes: list[tuple[float, float, float]], seconds: float, sr: int = SR) -> np.ndarray:
    """Sung vowel: sustained harmonics with vibrato, shaped by two formant bumps."""
    y = np.zeros(int(seconds * sr))
    for start, length, pitch in notes:
        t = np.arange(int(length * sr)) / sr
        f0 = midi_hz(pitch) * (1.0 + 0.012 * np.sin(2 * np.pi * 5.5 * t))  # 5.5 Hz vibrato
        phase = 2 * np.pi * np.cumsum(f0) / sr
        tone = np.zeros_like(t)
        for h in range(1, 25):
            f = midi_hz(pitch) * h
            if f >= sr / 2:
                break
            formants = np.exp(-((f - 700.0) / 250.0) ** 2) + 0.6 * np.exp(-((f - 1200.0) / 350.0) ** 2)
            tone += (0.15 / h + formants) * np.sin(h * phase)
        env = np.minimum(1.0, t / 0.06) * np.minimum(1.0, (length - t) / 0.08)  # slow in, slow out
        i = int(start * sr)
        y[i:i + len(tone)] += (tone * env)[: len(y) - i]
    return (0.5 * y / (np.abs(y).max() + EPS)).astype(np.float32)


def tape_noise(n: int, sr: int = SR, seed: int = 0) -> np.ndarray:
    """Cassette-style noise at unit power: hiss that rises with frequency, plus mains hum."""
    rng = np.random.default_rng(seed)
    spectrum = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1.0 / sr)
    spectrum *= np.sqrt(1.0 + (f / 2000.0) ** 2)  # flat to 2 kHz, then +6 dB per octave
    hiss = np.fft.irfft(spectrum, n)
    t = np.arange(n) / sr
    hum = np.sin(2 * np.pi * 60.0 * t) + 0.5 * np.sin(2 * np.pi * 180.0 * t)
    noise = hiss / hiss.std() + 0.3 * hum
    return (noise / noise.std()).astype(np.float32)


def add_noise(clean: np.ndarray, noise: np.ndarray, snr: float) -> np.ndarray:
    """`clean` plus `noise` scaled so that the result has the given SNR in dB."""
    gain = np.sqrt((clean @ clean) / ((noise @ noise) * 10.0 ** (snr / 10.0) + EPS))
    return (clean + gain * noise).astype(np.float32)
