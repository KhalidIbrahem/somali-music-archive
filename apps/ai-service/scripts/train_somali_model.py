"""Training harness for the Somali genre and scale-degree classifiers (Phase E).

Two entry points:

    python -m scripts.train_somali_model genre --labels-csv data/labels/genre_labels.csv
    python -m scripts.train_somali_model scale

Genre model (Phase E2)
    Supervised by a human-curated CSV (track_id, genre) because the Harvard
    catalog does not carry genre labels — labelling is expert work, not
    something to fabricate from filenames. Features: log-mel spectrograms of
    random 30 s crops. Augmentation: pitch shift ±2 semitones, time stretch
    0.85–1.15×, gaussian noise (genre is invariant to all three).

Scale model (Phase E3)
    Self-labelled from the Phase D pitch analysis: each 1 s window whose
    CREPE-mapped modal degree holds ≥60% of voiced frames is labelled with
    that degree; windows with almost no voiced frames become `unvoiced`;
    ambiguous windows are DROPPED, not guessed. Augmentation: noise and gain
    only — pitch shifting would silently relabel the window (a ±2 semitone
    shift moves `do` past `re`), which is exactly the kind of bug that
    survives to a camera-ready paper. Time-stretch is also excluded because
    it re-pitches naive implementations; not worth the risk for this model.

Both trainers:
  * split train/val BY TRACK (deterministic hash), never by window — windows
    of one cassette in both splits would leak recording conditions and
    inflate accuracy;
  * checkpoint the best-validation model to models/<name>.pt (resumable);
  * write evaluation/<name>_report.json with per-epoch curves and final
    per-class metrics via evaluation.evaluate_model.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import logging
import sys
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

_SERVICE_ROOT = Path(__file__).resolve().parent.parent
if str(_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVICE_ROOT))

import numpy as np

from models.somali_genre_classifier import GENRE_LABELS, N_MEL_BINS, SomaliGenreClassifier
from models.somali_scale_classifier import (
    SAMPLE_RATE as SCALE_SR,
)
from models.somali_scale_classifier import (
    SCALE_DEGREE_LABELS,
    WINDOW_SAMPLES,
    SomaliScaleClassifier,
)
from scripts.process_harvard import PipelineConfig, default_config, load_audio_mono

log = logging.getLogger("train_somali_model")

TRAIN_SPLIT_PERCENT = 80
GENRE_CROP_SEC = 30.0
GENRE_SR = 22_050
SCALE_MIN_VOICED_FRACTION = 0.5
SCALE_MIN_MODAL_SHARE = 0.6
PITCH_FRAMES_PER_SEC = 100  # CREPE at 10 ms steps


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested without torch/audio)
# ---------------------------------------------------------------------------


def assign_split(track_id: str, train_percent: int = TRAIN_SPLIT_PERCENT) -> str:
    """Deterministic per-track split: same track always lands in the same set.

    Hash-based (not random.shuffle) so the split survives corpus growth —
    adding tracks later never migrates an old track from val into train,
    which would quietly invalidate every previously reported number.
    """
    digest = hashlib.sha1(track_id.encode("utf-8")).hexdigest()
    return "train" if int(digest, 16) % 100 < train_percent else "val"


def encode_labels(labels: Sequence[str], vocabulary: Sequence[str]) -> list[int]:
    """Label names → class ids, failing loudly on anything outside the schema.

    A typo'd genre in the labels CSV must abort training, not become a
    silent 5th class.
    """
    index = {name: i for i, name in enumerate(vocabulary)}
    try:
        return [index[label] for label in labels]
    except KeyError as exc:
        raise ValueError(
            f"unknown label {exc.args[0]!r}; expected one of {list(vocabulary)}"
        ) from exc


def label_windows_from_points(
    points: Sequence[dict[str, Any]],
    duration_sec: float,
    window_sec: float = 1.0,
    min_voiced_fraction: float = SCALE_MIN_VOICED_FRACTION,
    min_modal_share: float = SCALE_MIN_MODAL_SHARE,
) -> list[tuple[float, str]]:
    """Derive (window_start_sec, label) training pairs from Phase D pitch points.

    Three-way outcome per window — degree label, `unvoiced`, or DROPPED:
      * voiced fraction < min_voiced_fraction/4 → `unvoiced` (confidently empty)
      * voiced fraction ≥ min_voiced_fraction and modal degree share ≥
        min_modal_share → that degree (confidently one note)
      * anything between → dropped (a window fought over by two degrees is a
        bad example for BOTH classes; silence-adjacent windows are ambiguous)
    """
    frames_per_window = int(window_sec * PITCH_FRAMES_PER_SEC)
    by_window: dict[int, list[str]] = {}
    for pt in points:
        window_index = int(float(pt["time_sec"]) // window_sec)
        by_window.setdefault(window_index, []).append(str(pt["note_label"]))

    labelled: list[tuple[float, str]] = []
    for window_index in range(int(duration_sec // window_sec)):
        notes = by_window.get(window_index, [])
        voiced_fraction = len(notes) / frames_per_window
        start = window_index * window_sec
        if voiced_fraction < min_voiced_fraction / 4:
            labelled.append((start, "unvoiced"))
            continue
        if voiced_fraction < min_voiced_fraction:
            continue
        modal, count = max(
            ((n, notes.count(n)) for n in set(notes)), key=lambda item: item[1]
        )
        if count / len(notes) >= min_modal_share:
            labelled.append((start, modal))
    return labelled


@dataclass
class EpochMetrics:
    epoch: int
    train_loss: float
    val_loss: float
    val_accuracy: float


@dataclass
class TrainReport:
    """Everything the paper needs to report about one training run."""

    model_name: str
    labels: list[str]
    n_train_examples: int
    n_val_examples: int
    n_train_tracks: int
    n_val_tracks: int
    epochs: list[EpochMetrics] = field(default_factory=list)
    best_val_accuracy: float = 0.0
    best_epoch: int = -1

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2)


# ---------------------------------------------------------------------------
# Augmentation
# ---------------------------------------------------------------------------


def augment_genre_waveform(samples: np.ndarray, sr: int, rng: np.random.Generator) -> np.ndarray:
    """Phase E2 augmentation: pitch shift ±2 st, stretch 0.85–1.15×, noise.

    Safe for genre labels (a heello shifted a tone up is still a heello);
    NEVER reuse for the scale model — see module docstring.
    """
    import librosa

    out = samples
    if rng.random() < 0.5:
        out = librosa.effects.pitch_shift(out, sr=sr, n_steps=float(rng.uniform(-2, 2)))
    if rng.random() < 0.5:
        out = librosa.effects.time_stretch(out, rate=float(rng.uniform(0.85, 1.15)))
    if rng.random() < 0.3:
        out = out + rng.normal(0.0, float(rng.uniform(0.001, 0.005)), size=out.shape)
    return out.astype(np.float32)


def augment_scale_waveform(samples: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Label-preserving augmentation only: gain and tape-hiss-like noise."""
    out = samples * float(rng.uniform(0.6, 1.4))
    if rng.random() < 0.5:
        out = out + rng.normal(0.0, float(rng.uniform(0.001, 0.01)), size=out.shape)
    return np.clip(out, -1.0, 1.0).astype(np.float32)


# ---------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------


def log_mel_spectrogram(samples: np.ndarray, sr: int) -> np.ndarray:
    """(n_mels, time) log-mel features matching the genre model contract."""
    import librosa

    mel = librosa.feature.melspectrogram(
        y=samples, sr=sr, n_mels=N_MEL_BINS, hop_length=512, fmax=8000
    )
    return librosa.power_to_db(mel, ref=np.max).astype(np.float32)


# ---------------------------------------------------------------------------
# Dataset assembly
# ---------------------------------------------------------------------------


def _genre_examples(
    config: PipelineConfig, labels_csv: Path
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(train, val) example specs: {track_id, path, label_id, split}."""
    import pandas as pd

    labels = pd.read_csv(labels_csv)
    required = {"track_id", "genre"}
    if not required.issubset(labels.columns):
        raise SystemExit(f"{labels_csv} must have columns {sorted(required)}")
    inventory = pd.read_csv(config.inventory_csv).set_index("track_id")
    encode_labels(labels["genre"].tolist(), GENRE_LABELS)  # fail fast on typos

    train: list[dict[str, Any]] = []
    val: list[dict[str, Any]] = []
    for _, row in labels.iterrows():
        track_id = str(row["track_id"])
        if track_id not in inventory.index:
            log.warning("label for %s has no inventory row — skipped", track_id)
            continue
        inv = inventory.loc[track_id]
        example = {
            "track_id": track_id,
            "path": Path(str(inv["source_dir"])) / str(inv["filename"]),
            "label_id": GENRE_LABELS.index(str(row["genre"])),
        }
        (train if assign_split(track_id) == "train" else val).append(example)
    return train, val


def _scale_examples(
    config: PipelineConfig,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Window-level examples derived from every Phase D pitch JSON on disk."""
    train: list[dict[str, Any]] = []
    val: list[dict[str, Any]] = []
    pitch_files = sorted(config.pitch_dir.glob("*_pitch.json"))
    if not pitch_files:
        raise SystemExit(
            f"no pitch data in {config.pitch_dir} — run `process_harvard pitch` first"
        )
    for pitch_path in pitch_files:
        record = json.loads(pitch_path.read_text())
        track_id = str(record["track_id"])
        points = record.get("points", [])
        duration = max((float(p["time_sec"]) for p in points), default=0.0)
        source = config.separated_dir / track_id / "no_vocals.wav"
        if not source.is_file():
            continue
        split = assign_split(track_id)
        for start_sec, label in label_windows_from_points(points, duration):
            example = {
                "track_id": track_id,
                "path": source,
                "start_sec": start_sec,
                "label_id": SCALE_DEGREE_LABELS.index(label),
            }
            (train if split == "train" else val).append(example)
    return train, val


# ---------------------------------------------------------------------------
# Torch datasets + train loop
# ---------------------------------------------------------------------------


def _select_device() -> str:
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _make_torch_dataset(examples: list[dict[str, Any]], kind: str, augment: bool) -> Any:
    """Map-style dataset decoding audio lazily — 22 h of corpus does not fit RAM."""
    import torch
    from torch.utils.data import Dataset

    rng = np.random.default_rng(20260711)

    class _Dataset(Dataset):  # type: ignore[type-arg]
        def __len__(self) -> int:
            return len(examples)

        def __getitem__(self, i: int) -> tuple[Any, int]:
            ex = examples[i]
            if kind == "genre":
                samples = load_audio_mono(ex["path"], GENRE_SR)
                crop = int(GENRE_CROP_SEC * GENRE_SR)
                if len(samples) > crop:
                    offset = int(rng.integers(0, len(samples) - crop)) if augment else 0
                    samples = samples[offset : offset + crop]
                if augment:
                    samples = augment_genre_waveform(samples, GENRE_SR, rng)
                features = log_mel_spectrogram(samples, GENRE_SR)
                return torch.from_numpy(features).unsqueeze(0), ex["label_id"]
            samples = load_audio_mono(ex["path"], SCALE_SR)
            start = int(ex["start_sec"] * SCALE_SR)
            window = samples[start : start + WINDOW_SAMPLES]
            if len(window) < WINDOW_SAMPLES:
                window = np.pad(window, (0, WINDOW_SAMPLES - len(window)))
            if augment:
                window = augment_scale_waveform(window, rng)
            return torch.from_numpy(window), ex["label_id"]

    return _Dataset()


def train_model(
    kind: str,
    config: PipelineConfig,
    labels_csv: Path | None,
    epochs: int,
    batch_size: int,
    learning_rate: float,
) -> TrainReport:
    """Shared training loop for both classifiers; returns the run report."""
    import torch
    from torch.utils.data import DataLoader

    if kind == "genre":
        if labels_csv is None:
            raise SystemExit("genre training needs --labels-csv (track_id,genre)")
        train_ex, val_ex = _genre_examples(config, labels_csv)
        model: torch.nn.Module = SomaliGenreClassifier()
        labels = list(GENRE_LABELS)
    else:
        train_ex, val_ex = _scale_examples(config)
        model = SomaliScaleClassifier()
        labels = list(SCALE_DEGREE_LABELS)

    if not train_ex or not val_ex:
        raise SystemExit(
            f"insufficient examples (train={len(train_ex)}, val={len(val_ex)}) — "
            "need labelled data in both splits"
        )
    report = TrainReport(
        model_name=f"somali_{kind}_classifier",
        labels=labels,
        n_train_examples=len(train_ex),
        n_val_examples=len(val_ex),
        n_train_tracks=len({e["track_id"] for e in train_ex}),
        n_val_tracks=len({e["track_id"] for e in val_ex}),
    )
    device = _select_device()
    log.info(
        "training %s on %s: %d train / %d val examples (%d/%d tracks)",
        report.model_name,
        device,
        len(train_ex),
        len(val_ex),
        report.n_train_tracks,
        report.n_val_tracks,
    )
    model = model.to(device)
    train_loader = DataLoader(
        _make_torch_dataset(train_ex, kind, augment=True), batch_size=batch_size, shuffle=True
    )
    val_loader = DataLoader(
        _make_torch_dataset(val_ex, kind, augment=False), batch_size=batch_size
    )
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
    criterion = torch.nn.CrossEntropyLoss()
    checkpoint_path = _SERVICE_ROOT / "models" / f"somali_{kind}_classifier.pt"

    for epoch in range(1, epochs + 1):
        model.train()
        train_losses: list[float] = []
        for features, targets in train_loader:
            features, targets = features.to(device), targets.to(device)
            optimizer.zero_grad()
            loss = criterion(model(features), targets)
            loss.backward()
            optimizer.step()
            train_losses.append(float(loss.item()))

        model.eval()
        val_losses: list[float] = []
        correct = 0
        total = 0
        with torch.no_grad():
            for features, targets in val_loader:
                features, targets = features.to(device), targets.to(device)
                logits = model(features)
                val_losses.append(float(criterion(logits, targets).item()))
                correct += int((logits.argmax(dim=-1) == targets).sum().item())
                total += int(targets.numel())
        val_accuracy = correct / max(total, 1)
        metrics = EpochMetrics(
            epoch=epoch,
            train_loss=round(float(np.mean(train_losses)), 4),
            val_loss=round(float(np.mean(val_losses)), 4),
            val_accuracy=round(val_accuracy, 4),
        )
        report.epochs.append(metrics)
        log.info(
            "epoch %d/%d  train_loss=%.4f  val_loss=%.4f  val_acc=%.1f%%",
            epoch,
            epochs,
            metrics.train_loss,
            metrics.val_loss,
            100 * val_accuracy,
        )
        if val_accuracy > report.best_val_accuracy:
            report.best_val_accuracy = round(val_accuracy, 4)
            report.best_epoch = epoch
            torch.save(
                {
                    "state_dict": model.state_dict(),
                    "labels": labels,
                    "kind": kind,
                    "epoch": epoch,
                    "val_accuracy": val_accuracy,
                },
                checkpoint_path,
            )
            log.info("checkpoint saved → %s", checkpoint_path)

    report_path = _SERVICE_ROOT / "evaluation" / f"{kind}_classifier_report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report.to_json())
    log.info(
        "done: best val accuracy %.1f%% (epoch %d) → report %s",
        100 * report.best_val_accuracy,
        report.best_epoch,
        report_path,
    )
    gc.collect()
    return report


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("model", choices=("genre", "scale"))
    parser.add_argument(
        "--labels-csv", type=Path, default=None, help="genre labels (track_id,genre)"
    )
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--data-root", type=Path, default=None)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
    config = default_config()
    if args.data_root:
        config = PipelineConfig(
            data_root=args.data_root, audio_dirs=config.audio_dirs, catalog_csv=config.catalog_csv
        )
    train_model(args.model, config, args.labels_csv, args.epochs, args.batch_size, args.lr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
