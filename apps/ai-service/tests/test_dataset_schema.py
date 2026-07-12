"""Tests for data/schema/dataset_schema.json — the dataset's public contract.

The schema is what external researchers validate downloads against, so it
gets known-answer tests: the spec's canonical example must pass, a
progressively-enriched (mostly-null) record must pass, and malformed records
must fail for the right reason.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

jsonschema = pytest.importorskip("jsonschema")

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "data" / "schema" / "dataset_schema.json"


@pytest.fixture(scope="module")
def schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text())


@pytest.fixture(scope="module")
def validator(schema: dict[str, Any]) -> Any:
    jsonschema.Draft202012Validator.check_schema(schema)  # schema itself is valid
    return jsonschema.Draft202012Validator(schema)


def _full_record() -> dict[str, Any]:
    """The canonical fully-enriched record from the session spec (Phase G1)."""
    return {
        "track_id": "AWM-HAR-0001",
        "source": "Harvard AWM Spec Coll 103",
        "license": "CC BY 4.0 (catalog) / research use (audio)",
        "filename": "track_0001_Sahro_Axmed.wav",
        "title": "Wisiisi (Longing)",
        "artists": ["Sahro Axmed (Sahra Ahmed)"],
        "duration_sec": 247.3,
        "cassette": "cassette_001",
        "side": "A",
        "recorded_date": "1966-08-25",
        "era": "1966-1974",
        "genre_labeled": "heello",
        "genre_predicted": "heello",
        "genre_confidence": 0.94,
        "transcript_somali": "…",
        "transcript_english": "…",
        "transcript_confidence": 0.87,
        "singing_ratio": 0.82,
        "dominant_notes": ["do", "sol", "la"],
        "modal_center": "do",
        "tempo_bpm": 76,
        "avg_cents_deviation": {"do": -4.2, "re": 8.7, "mi": -23.4, "sol": -1.1, "la": 12.3},
        "ornament_types": {"glissando": 47, "vibrato": 12},
        "instruments_detected": ["voice", "oud", "organ"],
        "embedding_id": "3f0f9e0e-58f2-4d5f-9a52-2f9d4d3f2b10",
        "quality": {"snr_estimate_db": 13.2},
        "quality_score": 0.78,
        "files": {
            "original": "data/01_raw/track_0001.wav",
            "cleaned": "data/02_cleaned/track_0001.wav",
            "vocals": "data/03_separated/track_0001/vocals.wav",
            "instruments": "data/03_separated/track_0001/no_vocals.wav",
            "pitch_data": "data/pitch_data/track_0001_pitch.json",
            "transcript": "data/transcripts/track_0001_transcript.json",
        },
    }


def test_full_record_validates(validator: Any) -> None:
    validator.validate(_full_record())


def test_minimal_inventory_only_record_validates(validator: Any) -> None:
    # A record fresh from Phase A — no AI enrichment yet — must already be valid.
    validator.validate(
        {
            "track_id": "track_0015",
            "source": "Harvard AWM Spec Coll 103",
            "license": "CC BY 4.0 (catalog metadata) / research use (audio)",
            "filename": "track_0015_Side_B_Track_2_Nuxurka_sheekada.mp3",
            "title": None,
            "artists": [],
            "duration_sec": 92.29,
            "side": "B",
            "files": {"original": "/corpus/track_0015.mp3"},
        }
    )


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        ({"track_id": "harvard-1"}, "track_id pattern"),
        ({"side": "C"}, "side enum"),
        ({"genre_labeled": "jazz"}, "genre outside label schema"),
        ({"avg_cents_deviation": {"ti": 4.0}}, "non-Somali scale degree"),
        ({"avg_cents_deviation": {"do": 250.0}}, "deviation beyond ±100 cents is a mapping bug"),
        ({"singing_ratio": 1.4}, "ratio above 1"),
        ({"duration_sec": 0}, "zero duration"),
        ({"files": {}}, "files.original required"),
        ({"unexpected_field": 1}, "additionalProperties: false"),
    ],
)
def test_malformed_records_fail(validator: Any, mutation: dict[str, Any], reason: str) -> None:
    record = _full_record()
    record.update(mutation)
    assert not validator.is_valid(record), f"schema should reject: {reason}"


def test_actual_assemble_output_matches_schema(validator: Any, tmp_path: Path) -> None:
    """End-to-end: stage_assemble's real output rows validate against the schema."""
    import pandas as pd

    from scripts.process_harvard import PipelineConfig, stage_assemble

    config = PipelineConfig(data_root=tmp_path, audio_dirs=(), catalog_csv=None)
    pd.DataFrame(
        [
            {
                "track_id": "track_0001",
                "filename": "track_0001_x.mp3",
                "source_dir": str(tmp_path),
                "title": "Wisiisi",
                "artists": "Sahro Axmed",
                "duration_sec": 100.0,
                "side": "A",
                "cassette_number": 1,
                "flags": None,
            }
        ]
    ).to_csv(config.inventory_csv, index=False)
    stage_assemble(config)
    records = json.loads((config.dataset_dir / "somali_music_dataset_v1.json").read_text())
    assert len(records) == 1
    validator.validate(records[0])
