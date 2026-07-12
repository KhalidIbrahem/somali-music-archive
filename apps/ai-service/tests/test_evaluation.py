"""Unit tests for the pure metrics in evaluation/evaluate_model.py.

These functions produce the numbers printed in the ISMIR paper — they get
known-answer tests, not smoke tests.
"""

from __future__ import annotations

import pytest

from evaluation.evaluate_model import (
    confusion_matrix,
    per_class_metrics,
    raw_pitch_accuracy,
    word_error_rate,
)

# ---------------------------------------------------------------------------
# Word error rate
# ---------------------------------------------------------------------------


def test_wer_identical_is_zero() -> None:
    assert word_error_rate("hobeeya hobeeya heedhe", "hobeeya hobeeya heedhe") == 0.0


def test_wer_known_substitution_deletion_insertion() -> None:
    # ref: 4 words; hyp substitutes 1 ("caashaqa"→"caashiga") and deletes 1.
    ref = "soo hor caashaqa maanta"
    hyp = "soo hor caashiga"
    assert word_error_rate(ref, hyp) == pytest.approx(2 / 4)


def test_wer_case_insensitive() -> None:
    assert word_error_rate("Balanbaallis", "balanbaallis") == 0.0


def test_wer_all_wrong_is_one() -> None:
    assert word_error_rate("a b c", "x y z") == pytest.approx(1.0)


def test_wer_empty_reference() -> None:
    assert word_error_rate("", "") == 0.0
    assert word_error_rate("", "hallucinated text here") == 3.0  # pure insertions


# ---------------------------------------------------------------------------
# Confusion matrix and per-class metrics
# ---------------------------------------------------------------------------


def test_confusion_matrix_layout() -> None:
    #        pred:0  1
    # true 0:    2   1
    # true 1:    0   3
    matrix = confusion_matrix([0, 0, 0, 1, 1, 1], [0, 0, 1, 1, 1, 1], n_classes=2)
    assert matrix == [[2, 1], [0, 3]]


def test_confusion_matrix_rejects_length_mismatch() -> None:
    with pytest.raises(ValueError):
        confusion_matrix([0, 1], [0], n_classes=2)


def test_per_class_metrics_known_values() -> None:
    matrix = [[2, 1], [0, 3]]
    report = per_class_metrics(matrix, ["heello", "qaraami"])
    assert report["accuracy"] == pytest.approx(5 / 6, abs=1e-4)
    heello = report["per_class"]["heello"]
    assert heello["precision"] == pytest.approx(1.0)  # 2/(2+0)
    assert heello["recall"] == pytest.approx(2 / 3, abs=1e-4)
    assert heello["support"] == 3
    qaraami = report["per_class"]["qaraami"]
    assert qaraami["precision"] == pytest.approx(3 / 4)
    assert qaraami["recall"] == pytest.approx(1.0)


def test_per_class_metrics_absent_class_is_null_not_zero() -> None:
    matrix = [[4, 0, 0], [1, 3, 0], [0, 0, 0]]  # third class never appears
    report = per_class_metrics(matrix, ["heello", "qaraami", "dhaanto"])
    dhaanto = report["per_class"]["dhaanto"]
    assert dhaanto["support"] == 0
    assert dhaanto["recall"] is None  # unmeasured, NOT "scored zero"


def test_per_class_metrics_empty() -> None:
    report = per_class_metrics([[0, 0], [0, 0]], ["a", "b"])
    assert report["accuracy"] is None
    assert report["n_examples"] == 0


# ---------------------------------------------------------------------------
# Raw pitch accuracy
# ---------------------------------------------------------------------------


def test_raw_pitch_accuracy_mirex_tolerance() -> None:
    # Errors: 0, 49.9 and -50 are hits at ±50 cents; 51 and 120 are misses.
    assert raw_pitch_accuracy([0.0, 49.9, -50.0, 51.0, 120.0]) == pytest.approx(3 / 5)


def test_raw_pitch_accuracy_empty_is_zero() -> None:
    assert raw_pitch_accuracy([]) == 0.0


def test_raw_pitch_accuracy_custom_tolerance() -> None:
    assert raw_pitch_accuracy([10.0, 30.0], tolerance_cents=20.0) == pytest.approx(0.5)
