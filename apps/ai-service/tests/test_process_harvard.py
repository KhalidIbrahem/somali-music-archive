"""Unit tests for the pure logic in scripts/process_harvard.py.

Everything here runs without ML deps and without the corpus: filename/catalog
parsing, inventory assembly, quality math on synthetic signals, note-event
segmentation, ornament classification, and checkpoint round-tripping.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from scripts.process_harvard import (
    GLISSANDO_MIN_NET_CENTS,
    NoteEvent,
    Progress,
    aggregate_track_pitch,
    build_inventory_rows,
    classify_ornament,
    estimate_singing_segments,
    extract_recording_date,
    load_progress,
    parse_catalog_title,
    parse_track_filename,
    quality_metrics,
    save_progress,
    segment_note_events,
)

# ---------------------------------------------------------------------------
# Filename / catalog parsing
# ---------------------------------------------------------------------------


def test_parse_track_filename_with_side() -> None:
    parsed = parse_track_filename("track_0005_Side_B_Track_1_Balanbaallis.mp3")
    assert parsed is not None
    assert parsed.track_id == "track_0005"
    assert parsed.index == 5
    assert parsed.side == "B"
    assert parsed.track_on_side == 1


def test_parse_track_filename_without_side() -> None:
    parsed = parse_track_filename("track_0001_Sahro_Axmed_Sahra_Ahmed_and_others.wav")
    assert parsed is not None
    assert parsed.track_id == "track_0001"
    assert parsed.side is None


def test_parse_track_filename_rejects_strays() -> None:
    assert parse_track_filename("somali_test_001.wav") is None
    assert parse_track_filename("README.md") is None


def test_parse_catalog_title_track_row() -> None:
    parsed = parse_catalog_title("Side A. Track 1: Wisiisi (Longing)")
    assert parsed["kind"] == "track"
    assert parsed["side"] == "A"
    assert parsed["track_on_side"] == 1
    assert parsed["song_title"] == "Wisiisi (Longing)"


def test_parse_catalog_title_songs_by_row_carries_artist() -> None:
    parsed = parse_catalog_title("Songs by Xasan Aadan Samatar (Hasan Aden Samatar)")
    assert parsed["kind"] == "cassette"
    assert parsed["artists"] == "Xasan Aadan Samatar (Hasan Aden Samatar)"


def test_extract_recording_date_full_and_year_only() -> None:
    assert extract_recording_date("Milgo, 1966-08-25") == ("1966-08-25", 1966)
    assert extract_recording_date("Soo Hor Caashaqa, 1974") == ("1974", 1974)
    assert extract_recording_date("Wisiisi (Longing)") == (None, None)
    assert extract_recording_date(None) == (None, None)
    # A number that is not a plausible session year must not parse as one.
    assert extract_recording_date("Track, 2205") == (None, None)


def test_parse_catalog_title_header_row_strips_and_others() -> None:
    parsed = parse_catalog_title("Sahro Axmed (Sahra Ahmed) and others")
    assert parsed["kind"] == "cassette"
    assert parsed["artists"] == "Sahro Axmed (Sahra Ahmed)"


# ---------------------------------------------------------------------------
# Inventory assembly (real tiny files on disk so hashing/stat are exercised)
# ---------------------------------------------------------------------------


def test_build_inventory_flags_duplicates_and_joins_catalog(tmp_path: Path) -> None:
    (tmp_path / "track_0001_Sahro_Axmed.mp3").write_bytes(b"identical-bytes")
    (tmp_path / "track_0002_Side_A_Track_1_Wisiisi_Longing.mp3").write_bytes(b"other-bytes")
    dupe_dir = tmp_path / "copy"
    dupe_dir.mkdir()
    (dupe_dir / "track_0001_Sahro_Axmed.mp3").write_bytes(b"identical-bytes")

    catalog = [
        {"title": "Sahro Axmed (Sahra Ahmed) and others", "url": "u1", "date": "1955-1991"},
        {"title": "Side A. Track 1: Wisiisi (Longing)", "url": "u2", "date": "1955-1991"},
    ]
    files = sorted(tmp_path.rglob("*.mp3"))
    rows = build_inventory_rows(files, catalog)

    assert len(rows) == 3
    # Exactly one of the two byte-identical copies is flagged (first seen wins).
    copies = [r for r in rows if r["track_id"] == "track_0001"]
    assert len(copies) == 2
    flagged = [r for r in copies if "duplicate_of:track_0001_Sahro_Axmed.mp3" in r["flags"]]
    assert len(flagged) == 1

    track2 = next(r for r in rows if r["track_id"] == "track_0002")
    assert track2["title"] == "Wisiisi (Longing)"
    assert track2["artists"] == "Sahro Axmed (Sahra Ahmed)"  # inherited from cassette row
    assert track2["side"] == "A"
    assert track2["cassette_number"] == 1


def test_build_inventory_flags_unrecognized_filenames(tmp_path: Path) -> None:
    stray = tmp_path / "somali_test_001.wav"
    stray.write_bytes(b"xx")
    rows = build_inventory_rows([stray], None)
    assert "needs_review:unrecognized_filename" in rows[0]["flags"]


# ---------------------------------------------------------------------------
# Quality metrics on synthetic signals
# ---------------------------------------------------------------------------


def test_quality_metrics_clean_sine_has_high_snr_no_clipping() -> None:
    sr = 44100
    t = np.linspace(0, 2.0, sr * 2, endpoint=False)
    # Half signal, half near-silence: gives the estimator a real noise floor.
    signal = 0.5 * np.sin(2 * math.pi * 440 * t).astype(np.float32)
    signal[sr:] *= 0.001
    metrics = quality_metrics(signal, sr)
    assert metrics["snr_estimate_db"] > 30
    assert not metrics["is_clipped"]
    assert not metrics["below_snr_threshold"]


def test_quality_metrics_detects_clipping() -> None:
    sr = 44100
    clipped = np.clip(2.0 * np.sin(np.linspace(0, 100, sr)), -1.0, 1.0).astype(np.float32)
    metrics = quality_metrics(clipped, sr)
    assert metrics["is_clipped"]


def test_quality_metrics_measures_leading_silence() -> None:
    sr = 44100
    audio = np.concatenate(
        [np.zeros(sr, dtype=np.float32), 0.5 * np.ones(sr, dtype=np.float32)]
    )
    metrics = quality_metrics(audio, sr)
    assert metrics["leading_silence_sec"] == pytest.approx(1.0, abs=0.1)
    assert metrics["trailing_silence_sec"] == pytest.approx(0.0, abs=0.1)


def test_quality_metrics_empty_audio() -> None:
    assert quality_metrics(np.array([], dtype=np.float32), 44100) == {"error": "empty_audio"}


# ---------------------------------------------------------------------------
# Note events and ornament classification
# ---------------------------------------------------------------------------


def _points(spec: list[tuple[float, str, float]]) -> list[dict[str, float | str]]:
    return [
        {"time_sec": t, "note_label": note, "cents_deviation": cents, "frequency_hz": 0.0}
        for t, note, cents in spec
    ]


def test_segment_note_events_splits_on_note_change_and_gap() -> None:
    pts = _points(
        [(0.00, "do", 0), (0.01, "do", 1), (0.02, "sol", 0), (0.03, "sol", 0), (0.50, "sol", 0)]
    )
    events = segment_note_events(pts)
    assert [e.note for e in events] == ["do", "sol", "sol"]  # gap 0.03→0.50 splits


def test_classify_grace_note() -> None:
    ev = NoteEvent(note="re", start_sec=0.0, end_sec=0.02, cents=[0.0, 5.0, 3.0])
    assert classify_ornament(ev) == "grace_note"


def test_classify_straight_tone() -> None:
    ev = NoteEvent(note="do", start_sec=0.0, end_sec=0.5, cents=[0.0, 4.0, -3.0, 2.0] * 10)
    assert classify_ornament(ev) == "straight"


def test_classify_glissando() -> None:
    # 300 ms monotonic slide covering more than the glissando threshold.
    cents = list(np.linspace(0, GLISSANDO_MIN_NET_CENTS + 20, 30))
    ev = NoteEvent(note="mi", start_sec=0.0, end_sec=0.30, cents=cents)
    assert classify_ornament(ev) == "glissando"


def test_classify_vibrato() -> None:
    # 6 Hz oscillation, ±40 cents, 1 s hold at 100 frames/s.
    t = np.arange(0, 1.0, 0.01)
    cents = (40.0 * np.sin(2 * math.pi * 6.0 * t)).tolist()
    ev = NoteEvent(note="sol", start_sec=0.0, end_sec=1.0, cents=cents)
    assert classify_ornament(ev) == "vibrato"


def test_aggregate_track_pitch_summary() -> None:
    pts = _points(
        [(i * 0.01, "do", 2.0) for i in range(100)]  # 1 s of do
        + [(1.0 + i * 0.01, "sol", -6.0) for i in range(50)]  # 0.5 s of sol
    )
    summary = aggregate_track_pitch(pts)
    assert summary["modal_center"] == "do"
    assert summary["dominant_notes"][0] == "do"
    assert summary["melodic_intervals"] == {"do->sol": 1}
    assert summary["avg_cents_deviation"]["do"] == pytest.approx(2.0)
    assert summary["avg_cents_deviation"]["sol"] == pytest.approx(-6.0)


def test_aggregate_track_pitch_empty() -> None:
    summary = aggregate_track_pitch([])
    assert summary["n_pitch_points"] == 0
    assert summary["modal_center"] is None


# ---------------------------------------------------------------------------
# Singing heuristic
# ---------------------------------------------------------------------------


def test_estimate_singing_segments_flags_repetitive_low_confidence() -> None:
    segments = [
        {  # spoken announcer intro: confident, non-repetitive
            "start": 0.0, "end": 10.0, "text": "Radio Muqdisho",
            "compression_ratio": 1.2, "avg_logprob": -0.2, "no_speech_prob": 0.05,
        },
        {  # sung refrain: hallucination-shaped statistics
            "start": 10.0, "end": 40.0, "text": "la la la",
            "compression_ratio": 3.1, "avg_logprob": -1.4, "no_speech_prob": 0.7,
        },
    ]
    annotated, ratio = estimate_singing_segments(segments)
    assert annotated[0]["is_singing"] is False
    assert annotated[1]["is_singing"] is True
    assert ratio == pytest.approx(30.0 / 40.0)


def test_estimate_singing_segments_empty() -> None:
    annotated, ratio = estimate_singing_segments([])
    assert annotated == [] and ratio == 0.0


# ---------------------------------------------------------------------------
# Checkpoint ledger
# ---------------------------------------------------------------------------


def test_progress_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "progress.json"
    ledger = {
        "pitch": Progress(
            completed=["track_0001"], failed={"track_0002": "boom"}, pending=["track_0003"]
        )
    }
    save_progress(path, ledger)
    loaded = load_progress(path)
    assert loaded["pitch"].completed == ["track_0001"]
    assert loaded["pitch"].failed == {"track_0002": "boom"}
    assert loaded["pitch"].pending == ["track_0003"]


def test_load_progress_tolerates_corruption(tmp_path: Path) -> None:
    path = tmp_path / "progress.json"
    path.write_text("{not json")
    assert load_progress(path) == {}


def test_save_progress_is_atomic(tmp_path: Path) -> None:
    path = tmp_path / "progress.json"
    save_progress(path, {"quality": Progress(completed=["a"])})
    # No stray temp file left behind, and the ledger parses.
    assert not path.with_suffix(".json.tmp").exists()
    assert json.loads(path.read_text())["quality"]["completed"] == ["a"]
