"""Model and baseline evaluation for the SomaliMusicCorpus (Phase E/H).

Three responsibilities:

  1. Pure metrics — implemented here, unit-tested, no sklearn dependency:
       * word_error_rate           (Whisper transcription baseline, §7 of paper)
       * confusion_matrix + per-class precision/recall/F1 (classifiers)
       * raw_pitch_accuracy        (CREPE/scale-map baseline, MIREX convention)
  2. Classifier evaluation CLI — loads a checkpoint saved by
     scripts/train_somali_model.py, runs the held-out track split, writes
     evaluation/<kind>_classifier_report.json with the full confusion matrix.
  3. Honesty rules — every report records HOW MANY examples produced each
     number; a 98% accuracy over 12 windows must be legible as such.

Usage:
    python -m evaluation.evaluate_model genre
    python -m evaluation.evaluate_model scale
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

_SERVICE_ROOT = Path(__file__).resolve().parent.parent
if str(_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVICE_ROOT))

import numpy as np

log = logging.getLogger("evaluate_model")

PITCH_ACCURACY_TOLERANCE_CENTS = 50.0  # MIREX raw-pitch-accuracy convention


# ---------------------------------------------------------------------------
# Pure metrics
# ---------------------------------------------------------------------------


def word_error_rate(reference: str, hypothesis: str) -> float:
    """Word error rate = (substitutions + deletions + insertions) / |reference|.

    Standard Levenshtein on whitespace tokens. Case-folded because Somali
    orthography in the catalog is inconsistently capitalized; punctuation is
    NOT stripped so transcript quality of poetic lines is measured honestly.

    Returns 0.0 for two empty strings, and |hypothesis| insertions' worth of
    error (i.e. ≥ 1.0 capped by convention at the raw value) when the
    reference is empty but the hypothesis is not.
    """
    ref_tokens = reference.lower().split()
    hyp_tokens = hypothesis.lower().split()
    if not ref_tokens:
        return 0.0 if not hyp_tokens else float(len(hyp_tokens))
    # Classic DP edit distance, two rolling rows.
    previous = list(range(len(hyp_tokens) + 1))
    for i, ref_token in enumerate(ref_tokens, start=1):
        current = [i] + [0] * len(hyp_tokens)
        for j, hyp_token in enumerate(hyp_tokens, start=1):
            substitution = previous[j - 1] + (ref_token != hyp_token)
            current[j] = min(previous[j] + 1, current[j - 1] + 1, substitution)
        previous = current
    return previous[-1] / len(ref_tokens)


def confusion_matrix(
    y_true: Sequence[int], y_pred: Sequence[int], n_classes: int
) -> list[list[int]]:
    """Row = true class, column = predicted class. Plain lists for JSON."""
    if len(y_true) != len(y_pred):
        raise ValueError(f"length mismatch: {len(y_true)} true vs {len(y_pred)} predicted")
    matrix = [[0] * n_classes for _ in range(n_classes)]
    for t, p in zip(y_true, y_pred, strict=True):
        matrix[t][p] += 1
    return matrix


def per_class_metrics(matrix: Sequence[Sequence[int]], labels: Sequence[str]) -> dict[str, Any]:
    """Precision/recall/F1 per class plus accuracy and macro-F1 from a confusion matrix.

    Classes absent from the evaluation set report null (not 0.0) so a missing
    genre reads as "unmeasured", never as "the model scored zero".
    """
    n = len(labels)
    total = sum(sum(row) for row in matrix)
    correct = sum(matrix[i][i] for i in range(n))
    per_class: dict[str, Any] = {}
    f1_values: list[float] = []
    for i, label in enumerate(labels):
        true_positive = matrix[i][i]
        predicted = sum(matrix[r][i] for r in range(n))
        actual = sum(matrix[i])
        precision = true_positive / predicted if predicted else None
        recall = true_positive / actual if actual else None
        f1 = (
            2 * precision * recall / (precision + recall)
            if precision and recall and (precision + recall) > 0
            else (0.0 if actual else None)
        )
        per_class[label] = {
            "precision": round(precision, 4) if precision is not None else None,
            "recall": round(recall, 4) if recall is not None else None,
            "f1": round(f1, 4) if f1 is not None else None,
            "support": actual,
        }
        if f1 is not None:
            f1_values.append(f1)
    return {
        "accuracy": round(correct / total, 4) if total else None,
        "macro_f1": round(float(np.mean(f1_values)), 4) if f1_values else None,
        "n_examples": total,
        "per_class": per_class,
    }


def raw_pitch_accuracy(
    cents_errors: Sequence[float], tolerance_cents: float = PITCH_ACCURACY_TOLERANCE_CENTS
) -> float:
    """Fraction of voiced frames whose pitch error is within ±tolerance cents.

    The MIREX melody-extraction convention (50 cents = half a semitone).
    Input is per-frame signed cents error against the reference annotation.
    """
    if not cents_errors:
        return 0.0
    errors = np.abs(np.asarray(cents_errors, dtype=np.float64))
    return round(float(np.mean(errors <= tolerance_cents)), 4)


# ---------------------------------------------------------------------------
# Classifier evaluation CLI
# ---------------------------------------------------------------------------


def evaluate_classifier(kind: str, labels_csv: Path | None, batch_size: int = 16) -> dict[str, Any]:
    """Run the held-out split through a saved checkpoint and write the report."""
    import torch
    from torch.utils.data import DataLoader

    from models.somali_genre_classifier import SomaliGenreClassifier
    from models.somali_scale_classifier import SomaliScaleClassifier
    from scripts.process_harvard import default_config
    from scripts.train_somali_model import (
        _genre_examples,
        _make_torch_dataset,
        _scale_examples,
        _select_device,
    )

    checkpoint_path = _SERVICE_ROOT / "models" / f"somali_{kind}_classifier.pt"
    if not checkpoint_path.is_file():
        raise SystemExit(f"{checkpoint_path} not found — train first (scripts/train_somali_model)")
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    labels: list[str] = list(checkpoint["labels"])

    config = default_config()
    if kind == "genre":
        if labels_csv is None:
            raise SystemExit("genre evaluation needs --labels-csv")
        _, val_examples = _genre_examples(config, labels_csv)
        model: torch.nn.Module = SomaliGenreClassifier(n_genres=len(labels))
    else:
        _, val_examples = _scale_examples(config)
        model = SomaliScaleClassifier(n_classes=len(labels))
    model.load_state_dict(checkpoint["state_dict"])
    device = _select_device()
    model = model.to(device).eval()

    loader = DataLoader(
        _make_torch_dataset(val_examples, kind, augment=False), batch_size=batch_size
    )
    y_true: list[int] = []
    y_pred: list[int] = []
    with torch.no_grad():
        for features, targets in loader:
            logits = model(features.to(device))
            y_pred.extend(int(i) for i in logits.argmax(dim=-1).cpu())
            y_true.extend(int(t) for t in targets)

    matrix = confusion_matrix(y_true, y_pred, len(labels))
    report = {
        "model": f"somali_{kind}_classifier",
        "checkpoint_epoch": checkpoint.get("epoch"),
        "labels": labels,
        "confusion_matrix": matrix,
        **per_class_metrics(matrix, labels),
        "n_val_tracks": len({e["track_id"] for e in val_examples}),
    }
    out_path = _SERVICE_ROOT / "evaluation" / f"{kind}_classifier_report.json"
    existing = json.loads(out_path.read_text()) if out_path.is_file() else {}
    existing["held_out_evaluation"] = report
    out_path.write_text(json.dumps(existing, indent=2))
    log.info(
        "accuracy %.1f%% over %d examples → %s",
        100 * (report["accuracy"] or 0),
        report["n_examples"],
        out_path,
    )
    return report


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("model", choices=("genre", "scale"))
    parser.add_argument("--labels-csv", type=Path, default=None)
    parser.add_argument("--batch-size", type=int, default=16)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
    evaluate_classifier(args.model, args.labels_csv, args.batch_size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
