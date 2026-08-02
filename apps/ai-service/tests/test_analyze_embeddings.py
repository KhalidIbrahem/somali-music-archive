"""Unit tests for the embedding-space analysis (scripts/analyze_embeddings.py)."""

from __future__ import annotations

import numpy as np
import pytest

from scripts.analyze_embeddings import same_cassette_audit, top_neighbors


def _unit(v: list[float]) -> np.ndarray:
    arr = np.asarray(v, dtype=np.float64)
    return arr / np.linalg.norm(arr)


def test_top_neighbors_orders_by_cosine_and_excludes_self() -> None:
    ids = ["a", "b", "c", "d"]
    matrix = np.stack(
        [
            _unit([1.0, 0.0, 0.0]),
            _unit([0.9, 0.1, 0.0]),  # nearest to a
            _unit([0.0, 1.0, 0.0]),
            _unit([-1.0, 0.0, 0.0]),  # farthest from a
        ]
    )
    neighbors = top_neighbors(ids, matrix, n_neighbors=3)
    a = neighbors["a"]
    assert [n["track_id"] for n in a] == ["b", "c", "d"]
    assert all(n["track_id"] != "a" for n in a)  # self excluded
    assert a[0]["cosine"] > a[1]["cosine"] > a[2]["cosine"]
    assert a[0]["cosine"] == pytest.approx(0.9938, abs=1e-3)


def test_top_neighbors_caps_at_available_tracks() -> None:
    ids = ["a", "b"]
    matrix = np.stack([_unit([1.0, 0.0]), _unit([0.0, 1.0])])
    neighbors = top_neighbors(ids, matrix, n_neighbors=5)
    assert len(neighbors["a"]) == 1  # only one other track exists


def test_same_cassette_audit_known_answer() -> None:
    # 4 tracks, 2 cassettes of 2: a,b on tape 1; c,d on tape 2.
    # a→b (same), b→c (cross), c→d (same), d→c (same) ⇒ rate 3/4.
    # Chance = Σ s(s−1)/n(n−1) = (2+2)/12 = 1/3.
    ids = ["a", "b", "c", "d"]
    meta = {t: {"cassette": 1 if t in ("a", "b") else 2} for t in ids}
    neighbors = {
        "a": [{"track_id": "b", "cosine": 0.99}],
        "b": [{"track_id": "c", "cosine": 0.98}],
        "c": [{"track_id": "d", "cosine": 0.97}],
        "d": [{"track_id": "c", "cosine": 0.97}],
    }
    audit = same_cassette_audit(ids, neighbors, meta)
    assert audit["top1_same_cassette"] == 3
    assert audit["top1_same_cassette_rate"] == pytest.approx(0.75)
    assert audit["chance_rate"] == pytest.approx(1 / 3, abs=1e-4)
    assert audit["n_cassettes"] == 2
    assert audit["top1_cosine_median"] == pytest.approx(0.98)


def test_same_cassette_audit_degenerate_returns_none() -> None:
    audit = same_cassette_audit(["a"], {"a": []}, {"a": {"cassette": 1}})
    assert audit["top1_same_cassette_rate"] is None
    assert audit["chance_rate"] is None
