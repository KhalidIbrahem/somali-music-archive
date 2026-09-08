"""Reward terms for preference optimisation toward clean oud qaraami (Stage 5).

Three families of measurement on a generated clip, all computed locally:

1. Closeness to the real oud collection in MERT space. `m-a-p/MERT-v1-95M`
   embeddings pooled as in process_harvard.py Phase F (mean over every hidden
   layer and over time, L2-normalised), projected onto a 32-d PCA fitted on the
   real oud training clips. `oud_dist` is the Mahalanobis distance to that
   distribution (regularised covariance); `oud_sim` is the cosine to its
   centroid. The same space gives a Fréchet distance (MERT-FAD) between any
   pool of clips and the held-out real oud test clips.

2. Tape hiss and level, from the waveform. The term that tracks what a
   listener calls "noisy" is `band_snr_db`: median minus 10th-percentile
   energy of the 3-10 kHz band across STFT frames, in dB. Stationary hiss
   fills that band during the quiet moments, so the spread collapses
   (real cassette clips ~4.5 dB, real oud home recordings ~8.7 dB, base
   MusicGen ~10 dB). `noise_floor_db` (10th percentile of 50 ms frame RMS),
   `quiet_flatness`, `hf_ratio` (energy above 8 kHz over total),
   `rolloff95_hz` and `loudness_dbfs` are kept as diagnostics; flatness and
   floor are dominated by whether a clip contains pauses, not by hiss.

3. Melody, from the project's own pitch scorer (scripts.pcs, torchcrepe):
   `pcs` and `voiced_fraction`, exactly as scale_eval.score_clip computes them;
   `scored` is False when fewer than 1 s of voiced frames exist.

Composite reward, z-scored within the pool being ranked:

    hiss_index = -z(band_snr_db)                                (higher = hissier)
    melody     = pcs * min(voiced_fraction, 0.6) / 0.6          (0 when unscored)
    R = 1.0 * z(-oud_dist) + 0.5 * z(-hiss_index) + 0.5 * z(melody)
        - 2.0 * [voiced_fraction < 0.15]

Weights are overridable. Embeddings and terms are cached under data/reward/cache
keyed by path and mtime, so re-scoring a clip is free.

Usage (from apps/ai-service):
  python -m scripts.reward_model --fit          # data/reward/oud_ref.npz (+ .json)
  python -m scripts.reward_model --score DIR [--out scores.json]
  python -m scripts.reward_model --calibrate    # data/reward/calibration.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
import torch
from scipy.signal import resample_poly

from scripts.pcs import CONF_THRESH, FMAX, FMIN, extract_f0, score_frames

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "data"
REWARD_DIR = DATA / "reward"
CACHE = REWARD_DIR / "cache"
REF_PATH = REWARD_DIR / "oud_ref.npz"
MERT_ID = "m-a-p/MERT-v1-95M"
PCA_DIM = 32
COV_REG = 1e-3
HISS_KEYS = ("band_snr_db", "noise_floor_db", "quiet_flatness", "hf_ratio", "rolloff95_hz", "loudness_dbfs")
DEFAULT_WEIGHTS = {"oud": 1.0, "clean": 0.5, "melody": 0.5, "silence_penalty": 2.0, "voiced_gate": 0.15}
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"


# ------------------------------------------------------------------ audio

REWARD_VERSION = 2   # v2: every feature is computed on level-normalised audio, with raw loudness,
                     # gain and clip fraction kept as diagnostics. Recalibration showed v1 and v2
                     # agree to three decimals on every group: MERT's processor already standardises
                     # the waveform and band SNR is a ratio, so loudness was never a reward channel.
                     # The first medium DPO round drifted loud for optimisation reasons (step size),
                     # not because the reward paid for it; the KL budget in dpo_train is the fix.
TARGET_RMS_DB = -20.0
MAX_GAIN_DB = 30.0


def normalise(audio: np.ndarray) -> tuple[np.ndarray, float, float]:
    """Scale to TARGET_RMS_DB, never above 0.99 peak, never more than MAX_GAIN_DB up.
    Returns (audio, raw rms dBFS, gain applied in dB)."""
    rms = float(np.sqrt(np.mean(audio ** 2)))
    raw_db = 20.0 * np.log10(rms + 3e-5)
    gain = 10.0 ** (min(TARGET_RMS_DB - raw_db, MAX_GAIN_DB) / 20.0)
    peak = float(np.abs(audio).max()) + 1e-9
    gain = min(gain, 0.99 / peak)
    return (audio * gain).astype(np.float32), round(raw_db, 2), round(20.0 * np.log10(gain), 2)


def load_mono(path: Path, normalised: bool = True) -> tuple[np.ndarray, int]:
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if normalised:
        audio = normalise(audio)[0]
    return audio, sr


def _key(path: Path) -> str:
    p = Path(path).resolve()
    return hashlib.sha1(f"{p}|{p.stat().st_mtime_ns}|v{REWARD_VERSION}".encode()).hexdigest()


# ------------------------------------------------------------------- MERT

_MERT: tuple | None = None


def mert(device: str = DEVICE):
    global _MERT
    if _MERT is None:
        from transformers import AutoModel, AutoProcessor
        proc = AutoProcessor.from_pretrained(MERT_ID, trust_remote_code=True)
        model = AutoModel.from_pretrained(MERT_ID, trust_remote_code=True).to(device).eval()
        _MERT = (proc, model)
    return _MERT


@torch.no_grad()
def embed_mert(paths: list[Path], device: str = DEVICE, batch: int = 8, verbose: bool = False) -> np.ndarray:
    """(n, 768) pooled MERT embeddings, L2-normalised; cached per file."""
    CACHE.mkdir(parents=True, exist_ok=True)
    out: list[np.ndarray | None] = [None] * len(paths)
    todo: list[tuple[int, np.ndarray]] = []
    for i, p in enumerate(paths):
        c = CACHE / f"{_key(p)}.mert.npy"
        if c.exists():
            out[i] = np.load(c)
            continue
        audio, sr = load_mono(p)
        todo.append((i, audio if sr == 24000 else resample_poly(audio.astype(np.float64), 24000, sr).astype(np.float32)))
    if todo:
        proc, model = mert(device)
        t0 = time.time()
        # equal-length clips go through together; anything else one at a time
        todo.sort(key=lambda t: len(t[1]))
        j = 0
        while j < len(todo):
            n = len(todo[j][1])
            group = [todo[j]]
            while len(group) < batch and j + len(group) < len(todo) and len(todo[j + len(group)][1]) == n:
                group.append(todo[j + len(group)])
            inputs = proc([g[1] for g in group], sampling_rate=24000, return_tensors="pt", padding=False)
            inputs = {k: v.to(device) for k, v in inputs.items()}
            hidden = model(**inputs, output_hidden_states=True).hidden_states   # layers x (b, t, 768)
            pooled = torch.stack(hidden).mean(dim=(0, 2))                         # (b, 768)
            pooled = pooled / (pooled.norm(dim=1, keepdim=True) + 1e-12)
            for (i, _), vec in zip(group, pooled.cpu().numpy().astype(np.float32)):
                out[i] = vec
                np.save(CACHE / f"{_key(paths[i])}.mert.npy", vec)
            j += len(group)
        if device == "mps":
            torch.mps.empty_cache()
        if verbose:
            print(f"  mert: {len(todo)} clips in {time.time() - t0:.1f} s ({(time.time() - t0) / len(todo):.2f} s/clip)", flush=True)
    return np.stack(out)


# --------------------------------------------------------- hiss and melody

def hiss_terms(audio: np.ndarray, sr: int) -> dict:
    frame = int(0.05 * sr)
    rms = librosa.feature.rms(y=audio, frame_length=frame, hop_length=frame // 2, center=False)[0]
    rms_db = 20.0 * np.log10(rms + 3e-5)          # floor at about -90 dBFS; digital silence is not "clean"
    n_fft, hop = 2048, 512
    spec = np.abs(librosa.stft(audio, n_fft=n_fft, hop_length=hop)) ** 2
    frame_e = spec.sum(axis=0)
    flat = librosa.feature.spectral_flatness(S=np.sqrt(spec), n_fft=n_fft, hop_length=hop)[0]
    k = max(1, int(0.2 * len(frame_e)))
    quiet = np.argsort(frame_e)[:k]
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    total = float(spec.sum()) + 1e-12
    band = (freqs >= 3000.0) & (freqs <= 10000.0)
    band_db = 10.0 * np.log10(spec[band].sum(axis=0) / band.sum() + 1e-12)
    rolloff = librosa.feature.spectral_rolloff(S=np.sqrt(spec), sr=sr, roll_percent=0.95)[0]
    return {
        "band_snr_db": round(float(np.percentile(band_db, 50) - np.percentile(band_db, 10)), 2),
        "band_floor_db": round(float(np.percentile(band_db, 10)), 2),
        "rolloff95_hz": round(float(np.median(rolloff)), 1),
        "noise_floor_db": round(float(np.percentile(rms_db, 10)), 2),
        "quiet_flatness": round(float(flat[quiet].mean()), 4),
        "hf_ratio": round(float(spec[freqs >= 8000.0].sum() / total), 5),
        "loudness_dbfs": round(float(20.0 * np.log10(np.sqrt(np.mean(audio ** 2)) + 3e-5)), 2),
    }


def pitch_terms(audio: np.ndarray, sr: int, device: str) -> dict:
    f0, pd = extract_f0(audio, device, sr=sr)
    res = score_frames(f0, pd)
    if device == "mps":
        torch.mps.empty_cache()
    if res is None:
        voiced = (pd >= CONF_THRESH) & (f0 > FMIN) & (f0 < FMAX)
        return {"scored": False, "pcs": None, "voiced_fraction": round(float(voiced.mean()), 3),
                "tuning_offset_cents": None, "tonic": None}
    return {"scored": True, "pcs": round(res.pcs, 4), "voiced_fraction": round(res.voiced_fraction, 3),
            "tuning_offset_cents": round(res.tuning_offset_cents, 1), "tonic": res.tonic_name}


def waveform_terms(path: Path, device: str = DEVICE) -> dict:
    c = CACHE / f"{_key(path)}.terms.json"
    cached = json.loads(c.read_text()) if c.exists() else None
    if cached and "band_snr_db" in cached:
        return cached
    raw, sr = load_mono(path, normalised=False)
    audio, raw_db, gain_db = normalise(raw)
    t = {"seconds": round(len(audio) / sr, 2), "raw_loudness_dbfs": raw_db, "gain_db": gain_db,
         "clip_fraction": round(float((np.abs(raw) > 0.98).mean()), 5)}
    t0 = time.time()
    t.update(hiss_terms(audio, sr))
    t1 = time.time()
    if cached and cached.get("pcs") is not None or (cached and cached.get("scored") is False):
        t.update({k: cached[k] for k in ("scored", "pcs", "voiced_fraction", "tuning_offset_cents", "tonic")})
    else:
        t.update(pitch_terms(audio, sr, device))
    t["_sec_hiss"], t["_sec_pcs"] = round(t1 - t0, 3), round(time.time() - t1, 3)
    CACHE.mkdir(parents=True, exist_ok=True)
    c.write_text(json.dumps(t))
    return t


# -------------------------------------------------------------- reference

def _sqrt_psd(m: np.ndarray) -> np.ndarray:
    w, v = np.linalg.eigh((m + m.T) / 2)
    return (v * np.sqrt(np.clip(w, 0, None))) @ v.T


def fad(a: np.ndarray, b: np.ndarray) -> float:
    """Fréchet distance between Gaussian fits of two (n, d) sets."""
    mu_a, mu_b = a.mean(axis=0), b.mean(axis=0)
    ca, cb = np.cov(a, rowvar=False), np.cov(b, rowvar=False)
    sa = _sqrt_psd(ca)
    w = np.linalg.eigvalsh((sa @ cb @ sa + (sa @ cb @ sa).T) / 2)
    tr_sqrt = float(np.sqrt(np.clip(w, 0, None)).sum())
    return float(np.sum((mu_a - mu_b) ** 2) + np.trace(ca) + np.trace(cb) - 2.0 * tr_sqrt)


@dataclass
class Reference:
    pca_mean: np.ndarray        # (768,)
    components: np.ndarray      # (32, 768)
    mu: np.ndarray              # (32,) mean of real oud train in PCA space
    cov_inv: np.ndarray         # (32, 32)
    centroid: np.ndarray        # (768,) unit vector
    test_pca: np.ndarray        # (n_test, 32) real oud test clips, for FAD
    hiss_mean: dict
    hiss_std: dict

    def project(self, embs: np.ndarray) -> np.ndarray:
        return (embs - self.pca_mean) @ self.components.T

    def mahalanobis(self, embs: np.ndarray) -> np.ndarray:
        z = self.project(np.atleast_2d(embs)) - self.mu
        return np.sqrt(np.einsum("ij,jk,ik->i", z, self.cov_inv, z))

    def cosine(self, embs: np.ndarray) -> np.ndarray:
        return np.atleast_2d(embs) @ self.centroid

    @classmethod
    def fit(cls, oud_train_dir: Path = DATA / "oud_clips/train", oud_test_dir: Path = DATA / "oud_clips/test",
            out: Path = REF_PATH, device: str = DEVICE) -> "Reference":
        train = sorted(oud_train_dir.glob("*.wav"))
        test = sorted(oud_test_dir.glob("*.wav"))
        t0 = time.time()
        e_train = embed_mert(train, device, verbose=True)
        e_test = embed_mert(test, device, verbose=True)
        t_mert = time.time() - t0
        pca_mean = e_train.mean(axis=0)
        u, s, vt = np.linalg.svd(e_train - pca_mean, full_matrices=False)
        components = vt[:PCA_DIM]
        explained = float((s[:PCA_DIM] ** 2).sum() / (s ** 2).sum())
        z = (e_train - pca_mean) @ components.T
        mu = z.mean(axis=0)
        cov = np.cov(z, rowvar=False) + COV_REG * np.eye(PCA_DIM)
        centroid = e_train.mean(axis=0)
        centroid = centroid / (np.linalg.norm(centroid) + 1e-12)
        t1 = time.time()
        hiss = [hiss_terms(*load_mono(p)) for p in train]
        t_hiss = time.time() - t1
        hiss_mean = {k: round(float(np.mean([h[k] for h in hiss])), 4) for k in HISS_KEYS}
        hiss_std = {k: round(float(np.std([h[k] for h in hiss])), 4) for k in HISS_KEYS}
        ref = cls(pca_mean, components, mu, np.linalg.inv(cov), centroid, (e_test - pca_mean) @ components.T, hiss_mean, hiss_std)
        out.parent.mkdir(parents=True, exist_ok=True)
        np.savez(out, pca_mean=pca_mean, components=components, mu=mu, cov_inv=ref.cov_inv, centroid=centroid,
                 test_pca=ref.test_pca, hiss_mean=json.dumps(hiss_mean), hiss_std=json.dumps(hiss_std))
        d_train = ref.mahalanobis(e_train)
        d_test = ref.mahalanobis(e_test)
        half = len(test) // 2
        summary = {
            "mert": MERT_ID, "pca_dim": PCA_DIM, "cov_reg": COV_REG, "explained_variance": round(explained, 4),
            "n_train": len(train), "n_test": len(test), "train_dir": str(oud_train_dir), "test_dir": str(oud_test_dir),
            "oud_dist_train": {"mean": round(float(d_train.mean()), 3), "p90": round(float(np.percentile(d_train, 90)), 3)},
            "oud_dist_test": {"mean": round(float(d_test.mean()), 3), "p90": round(float(np.percentile(d_test, 90)), 3)},
            "fad_test_split_half": round(fad(ref.test_pca[:half], ref.test_pca[half:]), 4),
            "fad_train_vs_test": round(fad(z, ref.test_pca), 4),
            "hiss_mean": hiss_mean, "hiss_std": hiss_std,
            "seconds": {"mert_total": round(t_mert, 1), "mert_per_clip": round(t_mert / (len(train) + len(test)), 3),
                        "hiss_total": round(t_hiss, 1), "hiss_per_clip": round(t_hiss / len(train), 3)},
            "fitted": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        out.with_suffix(".json").write_text(json.dumps(summary, indent=2) + "\n")
        return ref

    @classmethod
    def load(cls, path: Path = REF_PATH) -> "Reference":
        z = np.load(path, allow_pickle=False)
        return cls(z["pca_mean"], z["components"], z["mu"], z["cov_inv"], z["centroid"], z["test_pca"],
                   json.loads(str(z["hiss_mean"])), json.loads(str(z["hiss_std"])))


def fad_to_ref(embs: np.ndarray, ref: Reference) -> float:
    """MERT-FAD of a pool of (n, 768) embeddings against the real oud test clips."""
    return fad(ref.project(embs), ref.test_pca)


# ---------------------------------------------------------------- scoring

def score_clips(paths: list[Path], ref: Reference, device: str = DEVICE, return_embs: bool = False, verbose: bool = False):
    paths = [Path(p) for p in paths]
    embs = embed_mert(paths, device, verbose=verbose)
    dist = ref.mahalanobis(embs)
    sim = ref.cosine(embs)
    terms = []
    t0 = time.time()
    for i, p in enumerate(paths):
        t = {"path": str(p), "oud_dist": round(float(dist[i]), 4), "oud_sim": round(float(sim[i]), 4)}
        t.update(waveform_terms(p, device))
        terms.append(t)
    if verbose:
        print(f"  terms: {len(paths)} clips in {time.time() - t0:.1f} s", flush=True)
    return (terms, embs) if return_embs else terms


def _z(x: np.ndarray) -> np.ndarray:
    s = x.std()
    return (x - x.mean()) / s if s > 1e-9 else np.zeros_like(x)


def composite(terms: list[dict], weights: dict | None = None) -> list[float]:
    """Composite reward, z-scored within `terms`; writes reward and z-terms into each dict."""
    w = dict(DEFAULT_WEIGHTS, **(weights or {}))
    if not terms:
        return []
    dist = np.array([t["oud_dist"] for t in terms], dtype=float)
    snr = np.array([t["band_snr_db"] for t in terms], dtype=float)
    vf = np.array([t.get("voiced_fraction") or 0.0 for t in terms], dtype=float)
    pcs = np.array([(t.get("pcs") or 0.0) if t.get("scored") else 0.0 for t in terms], dtype=float)
    hiss_index = -_z(snr)
    melody = pcs * np.minimum(vf, 0.6) / 0.6
    z_oud, z_clean, z_mel = _z(-dist), _z(-hiss_index), _z(melody)
    r = w["oud"] * z_oud + w["clean"] * z_clean + w["melody"] * z_mel - w["silence_penalty"] * (vf < w["voiced_gate"])
    for i, t in enumerate(terms):
        t.update({"hiss_index": round(float(hiss_index[i]), 4), "melody": round(float(melody[i]), 4),
                  "z_oud": round(float(z_oud[i]), 4), "z_clean": round(float(z_clean[i]), 4),
                  "z_melody": round(float(z_mel[i]), 4), "reward": round(float(r[i]), 4)})
    return [float(x) for x in r]


# ------------------------------------------------------------ calibration

def _clips(d: Path, pattern: str = "*.wav", stride_to: int | None = None) -> list[Path]:
    files = sorted(d.glob(pattern))
    if stride_to and len(files) > stride_to:
        step = len(files) / stride_to
        files = [files[int(i * step)] for i in range(stride_to)]
    return files


def calibration_groups() -> dict[str, list[Path]]:
    g = {
        "real_oud_test": _clips(DATA / "oud_clips/test", stride_to=64),
        "real_harvard_test": _clips(DATA / "clips/test", stride_to=64),
    }
    for tag in ("large", "medium"):
        d = DATA / f"ab_{tag}"
        if d.is_dir():
            g[f"ab_{tag}_base"] = _clips(d, "pair*_base.wav")
            g[f"ab_{tag}_adapter"] = _clips(d, "pair*_adapter.wav")
    for name in ("oud_ab_listening", "harvard_ab_listening"):
        d = DATA / name
        if d.is_dir():
            g[f"{name}_base"] = _clips(d, "pair*_base.wav")
            g[f"{name}_adapter"] = _clips(d, "pair*_finetuned.wav")
    if (DATA / "ab_melody").is_dir():
        g["ab_melody_base"] = _clips(DATA / "ab_melody", "melody*_base.wav")
    return {k: v for k, v in g.items() if v}


TERM_KEYS = ("oud_dist", "oud_sim", "band_snr_db", "noise_floor_db", "quiet_flatness", "hf_ratio", "rolloff95_hz", "loudness_dbfs", "pcs", "voiced_fraction")
# sign: +1 when a higher value should favour the listener's choice, -1 when lower should
TERM_SIGN = {"reward": 1, "z_oud": 1, "z_clean": 1, "z_melody": 1, "oud_dist": -1, "oud_sim": 1, "band_snr_db": 1,
             "noise_floor_db": -1, "quiet_flatness": -1, "hf_ratio": -1, "rolloff95_hz": 1, "pcs": 1, "voiced_fraction": 1}


def listener_check(pool: dict[str, dict]) -> dict:
    """Agreement between each term and the blind listening choices on ab_large."""
    files = sorted((DATA / "listening").glob("ab_large_*.json"))
    if not files:
        return {"note": "no data/listening/ab_large_*.json"}
    res = json.loads(files[-1].read_text())
    decided, noisy = [], []
    for p in res["pairs"]:
        base = pool.get(str(DATA / "ab_large" / f"pair{p['pair']:03d}_base.wav"))
        adapter = pool.get(str(DATA / "ab_large" / f"pair{p['pair']:03d}_adapter.wav"))
        if not base or not adapter:
            continue
        if p["preferred"] in ("adapter", "base"):
            chosen, other = (adapter, base) if p["preferred"] == "adapter" else (base, adapter)
            decided.append((chosen, other))
            if re.search(r"nois", p.get("note", ""), re.I):
                noisy.append((chosen, other))
    agreement = {}
    for k, sign in TERM_SIGN.items():
        pairs = [(c, o) for c, o in decided if c.get(k) is not None and o.get(k) is not None]
        if pairs:
            wins = sum(1 for c, o in pairs if sign * (c[k] - o[k]) > 0)
            agreement[k] = {"agree": wins, "n": len(pairs), "rate": round(wins / len(pairs), 3)}
    noisy_terms = {}
    for k in ("band_snr_db", "noise_floor_db", "quiet_flatness", "hf_ratio", "rolloff95_hz", "hiss_index"):
        if noisy:
            noisy_terms[k] = {"chosen_mean": round(float(np.mean([c[k] for c, _ in noisy])), 4),
                              "other_mean": round(float(np.mean([o[k] for _, o in noisy])), 4)}
    return {"file": files[-1].name, "n_decided": len(decided), "n_noted_noisy": len(noisy),
            "agreement": agreement, "noisy_pairs_hiss_terms": noisy_terms}


def calibrate(device: str = DEVICE) -> dict:
    ref = Reference.load()
    groups = calibration_groups()
    allp = [p for ps in groups.values() for p in ps]
    print(f"calibrating on {len(allp)} clips in {len(groups)} groups", flush=True)
    terms, embs = score_clips(allp, ref, device, return_embs=True, verbose=True)
    composite(terms)
    by_path = {t["path"]: t for t in terms}
    idx = {str(p): i for i, p in enumerate(allp)}
    out = {"reward_version": REWARD_VERSION, "groups": {}, "weights": DEFAULT_WEIGHTS, "n_clips": len(allp)}
    for name, ps in groups.items():
        ts = [by_path[str(p)] for p in ps]
        e = embs[[idx[str(p)] for p in ps]]
        row = {"n": len(ps)}
        for k in TERM_KEYS + ("reward", "z_oud", "z_clean", "z_melody", "hiss_index"):
            vals = [t[k] for t in ts if t.get(k) is not None]
            row[k] = round(float(np.mean(vals)), 4) if vals else None
        row["scored"] = sum(1 for t in ts if t.get("scored"))
        row["fad_to_real_oud_test"] = round(fad_to_ref(e, ref), 4) if len(ps) >= 3 else None
        out["groups"][name] = row
    out["listener_check"] = listener_check(by_path)
    secs = [t for t in terms if "_sec_hiss" in t]
    out["seconds_per_clip"] = {"hiss": round(float(np.mean([t["_sec_hiss"] for t in secs])), 3) if secs else None,
                               "pcs": round(float(np.mean([t["_sec_pcs"] for t in secs])), 3) if secs else None,
                               "mert": json.loads(REF_PATH.with_suffix(".json").read_text())["seconds"]["mert_per_clip"]}
    (REWARD_DIR / "calibration.json").write_text(json.dumps(out, indent=2) + "\n")
    cols = ("n", "oud_dist", "oud_sim", "band_snr_db", "noise_floor_db", "hf_ratio", "rolloff95_hz", "pcs", "voiced_fraction", "reward", "fad_to_real_oud_test")
    print(f"{'group':28s}" + "".join(f"{c:>15s}" for c in cols))
    for name, row in out["groups"].items():
        print(f"{name:28s}" + "".join(f"{('–' if row[c] is None else row[c]):>15}" for c in cols))
    lc = out["listener_check"]
    if "agreement" in lc:
        print(f"listener check ({lc['file']}): {lc['n_decided']} decided pairs, {lc['n_noted_noisy']} noted noisy")
        for k, a in lc["agreement"].items():
            print(f"  {k:16s} agrees {a['agree']}/{a['n']} = {a['rate']}")
        for k, v in lc["noisy_pairs_hiss_terms"].items():
            print(f"  noisy-noted pairs, {k}: chosen {v['chosen_mean']} vs other {v['other_mean']}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--fit", action="store_true")
    ap.add_argument("--score", nargs="*", help="directories or wav files to score")
    ap.add_argument("--out", default=None)
    ap.add_argument("--calibrate", action="store_true")
    ap.add_argument("--device", default=DEVICE)
    args = ap.parse_args()
    if args.fit:
        ref = Reference.fit(device=args.device)
        print(json.dumps(json.loads(REF_PATH.with_suffix(".json").read_text()), indent=2))
    if args.score:
        ref = Reference.load()
        paths: list[Path] = []
        for s in args.score:
            p = Path(s)
            paths += sorted(p.glob("*.wav")) if p.is_dir() else [p]
        terms, embs = score_clips(paths, ref, args.device, return_embs=True, verbose=True)
        composite(terms)
        result = {"n": len(paths), "fad_to_real_oud_test": round(fad_to_ref(embs, ref), 4) if len(paths) >= 3 else None, "clips": terms}
        if args.out:
            Path(args.out).write_text(json.dumps(result, indent=2) + "\n")
        for t in terms:
            print(f"{Path(t['path']).name:36s} R={t['reward']:+.2f} dist={t['oud_dist']:.2f} sim={t['oud_sim']:.3f} "
                  f"snr={t['band_snr_db']:.1f} floor={t['noise_floor_db']:.1f} pcs={t['pcs']} voiced={t['voiced_fraction']}")
        print("fad_to_real_oud_test:", result["fad_to_real_oud_test"])
    if args.calibrate:
        calibrate(args.device)
    if not (args.fit or args.score or args.calibrate):
        ap.print_help()


if __name__ == "__main__":
    main()
