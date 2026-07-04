"""Unit tests for the transcription pipeline (SESSION P3-01).

Whisper is mocked with a canned-output fake, so these run in milliseconds with
no ML stack installed — the same dependency-light contract as test_scale.py.
The singing-vs-speech classifier is the research-critical logic here; it gets
the densest coverage.
"""

from __future__ import annotations

from typing import Any

import pytest

from services.transcription_service import (
    TranscriptionResult,
    build_transcript,
    clean_segment_text,
    collapse_repeats,
    detect_singing,
    looks_hallucinated,
    segment_confidence,
    transcribe_recording,
)
from utils.audio_download import (
    MAX_DURATION_SEC,
    MIN_DURATION_SEC,
    AudioValidationError,
    extension_from_url,
    validate_duration,
    validate_format,
)

# ── Fixtures: synthetic Whisper output ────────────────────────────────────────

SPEECH_SEGMENTS = [
    {
        "start": 0.0,
        "end": 4.2,
        "text": " Waa maxay heesta?",
        "avg_logprob": -0.25,
        "no_speech_prob": 0.05,
        "compression_ratio": 1.3,
    },
    {
        "start": 4.2,
        "end": 9.6,
        "text": " Heestani waa balwo.",
        "avg_logprob": -0.31,
        "no_speech_prob": 0.08,
        "compression_ratio": 1.4,
    },
]

# Hallucination-shaped: high no_speech_prob, looping compression, collapsed logprob.
SINGING_SEGMENTS = [
    {
        "start": 0.0,
        "end": 5.0,
        "text": " la la la la la la",
        "avg_logprob": -1.4,
        "no_speech_prob": 0.72,
        "compression_ratio": 2.9,
    },
    {
        "start": 5.0,
        "end": 10.0,
        "text": " la la la la la la",
        "avg_logprob": -1.2,
        "no_speech_prob": 0.65,
        "compression_ratio": 2.7,
    },
    {
        "start": 10.0,
        "end": 14.0,
        "text": " hooyo macaan",
        "avg_logprob": -0.4,
        "no_speech_prob": 0.2,
        "compression_ratio": 1.5,
    },
]


class FakeWhisperModel:
    """Returns canned transcribe/translate results; records the calls it gets."""

    def __init__(self, transcribe_result: dict[str, Any], translate_result: dict[str, Any]):
        self.transcribe_result = transcribe_result
        self.translate_result = translate_result
        self.calls: list[dict[str, Any]] = []

    def transcribe(self, audio_path: str, **kwargs: Any) -> dict[str, Any]:
        self.calls.append({"audio_path": audio_path, **kwargs})
        if kwargs.get("task") == "translate":
            return self.translate_result
        return self.transcribe_result


def make_model() -> FakeWhisperModel:
    return FakeWhisperModel(
        transcribe_result={
            "text": " Waa maxay heesta? Heestani waa balwo.",
            "segments": SPEECH_SEGMENTS,
            "language": "so",
        },
        translate_result={
            "text": " What is this song? This song is a balwo.",
            "segments": [
                {"start": 0.0, "end": 4.2, "text": " What is this song?"},
                {"start": 4.2, "end": 9.6, "text": " This song is a balwo."},
            ],
            "language": "so",
        },
    )


SOMALI_DETECTOR = lambda model, path: ("so", 0.97)  # noqa: E731


# ── Confidence scoring ────────────────────────────────────────────────────────


def test_confidence_is_geometric_mean_probability() -> None:
    assert segment_confidence(0.0) == 1.0
    assert segment_confidence(-0.25) == pytest.approx(0.7788, abs=1e-3)
    assert segment_confidence(-3.0) == pytest.approx(0.0498, abs=1e-3)


def test_confidence_handles_missing_and_positive_values() -> None:
    assert segment_confidence(None) == 0.0
    assert segment_confidence(0.5) == 1.0  # clamped — never above 1


# ── Singing vs speech classification (the research contribution) ─────────────


def test_clean_speech_segment_is_not_flagged() -> None:
    assert looks_hallucinated(SPEECH_SEGMENTS[0]) is False


def test_each_hallucination_marker_flags_alone() -> None:
    base = {"avg_logprob": -0.3, "no_speech_prob": 0.1, "compression_ratio": 1.2}
    assert looks_hallucinated({**base, "no_speech_prob": 0.7}) is True
    assert looks_hallucinated({**base, "compression_ratio": 2.5}) is True
    assert looks_hallucinated({**base, "avg_logprob": -1.3}) is True


def test_singing_detected_when_flagged_segments_form_majority() -> None:
    assert detect_singing(SINGING_SEGMENTS) is True


def test_speech_not_classified_as_singing() -> None:
    assert detect_singing(SPEECH_SEGMENTS) is False


def test_no_segments_is_not_singing() -> None:
    assert detect_singing([]) is False


def test_minority_of_bad_segments_stays_speech() -> None:
    segments = SPEECH_SEGMENTS * 2 + [SINGING_SEGMENTS[0]]  # 1 of 5 flagged
    assert detect_singing(segments) is False


# ── Transcript cleaning ───────────────────────────────────────────────────────


def test_cleaning_strips_note_glyphs_and_stage_tags() -> None:
    raw = " ♪♪ Balwo [Music] hooyo (applause) macaan ♫ "
    assert clean_segment_text(raw) == "Balwo hooyo macaan"


def test_cleaning_preserves_real_parentheticals() -> None:
    # Only the fixed tag allowlist is removed — real lyric text must survive.
    assert clean_segment_text("Hooyo (macaan) waa balwo") == "Hooyo (macaan) waa balwo"


def test_collapse_repeats_caps_hallucination_loops_but_keeps_refrains() -> None:
    looped = ["la la", "la la", "la la", "la la", "hooyo"]
    assert collapse_repeats(looped) == ["la la", "la la", "hooyo"]


def test_build_transcript_cleans_collapses_and_joins() -> None:
    segments = [
        {"text": " ♪ Balwo ♪ "},
        {"text": " Balwo "},
        {"text": " Balwo "},  # third identical repeat — dropped
        {"text": " [Music] "},  # cleans to empty — dropped
        {"text": " hooyo "},
    ]
    assert build_transcript(segments) == "Balwo Balwo hooyo"


# ── Full transcription flow (fake model) ─────────────────────────────────────


def test_transcribe_recording_produces_structured_result() -> None:
    result = transcribe_recording(make_model(), "x.wav", "so", detector=SOMALI_DETECTOR)

    assert isinstance(result, TranscriptionResult)
    assert result.somali_text == "Waa maxay heesta? Heestani waa balwo."
    assert result.english_text == "What is this song? This song is a balwo."
    assert result.detected_language == "so"
    assert result.is_singing is False
    assert result.duration_sec == 9.6
    assert [s["text"] for s in result.segments] == ["Waa maxay heesta?", "Heestani waa balwo."]
    assert all(0.0 <= float(s["confidence"]) <= 1.0 for s in result.segments)


def test_transcribe_runs_forced_somali_with_word_timestamps_then_translate() -> None:
    model = make_model()
    transcribe_recording(model, "x.wav", "so", detector=SOMALI_DETECTOR)

    first, second = model.calls
    assert first["language"] == "so"
    assert first["task"] == "transcribe"
    assert first["word_timestamps"] is True
    assert second["task"] == "translate"


def test_language_mismatch_is_surfaced_not_hidden() -> None:
    result = transcribe_recording(
        make_model(), "x.wav", "so", detector=lambda m, p: ("en", 0.91)
    )
    assert result.detected_language == "en"  # consumer compares against expected "so"


def test_failing_detector_falls_back_to_requested_language() -> None:
    def broken(model: Any, path: str) -> tuple[str, float]:
        raise RuntimeError("no mel for you")

    result = transcribe_recording(make_model(), "x.wav", "so", detector=broken)
    assert result.detected_language == "so"


def test_singing_recording_is_flagged_end_to_end() -> None:
    model = FakeWhisperModel(
        transcribe_result={"text": " la la la", "segments": SINGING_SEGMENTS, "language": "so"},
        translate_result={"text": " la la la", "segments": [], "language": "so"},
    )
    result = transcribe_recording(model, "x.wav", "so", detector=SOMALI_DETECTOR)
    assert result.is_singing is True
    assert result.duration_sec == 14.0


def test_result_payload_matches_storage_contract() -> None:
    payload = transcribe_recording(make_model(), "x.wav", "so", detector=SOMALI_DETECTOR).to_payload()
    assert set(payload) == {
        "somali_text",
        "english_text",
        "segments",
        "detected_language",
        "is_singing",
        "duration_sec",
    }


# ── Download validation (fail-fast gate in front of the GPU) ─────────────────


def test_extension_ignores_presigned_query_string() -> None:
    assert extension_from_url("https://r2.test/ab/uuid.wav?X-Amz-Signature=abc") == ".wav"


def test_allowed_formats_pass_and_others_are_rejected() -> None:
    assert validate_format("https://r2.test/x.flac?sig=1") == ".flac"
    with pytest.raises(AudioValidationError):
        validate_format("https://r2.test/x.mp3?sig=1")
    with pytest.raises(AudioValidationError):
        validate_format("https://r2.test/no-extension")


def test_duration_window_enforced() -> None:
    validate_duration(MIN_DURATION_SEC)  # boundary ok
    validate_duration(MAX_DURATION_SEC)  # boundary ok
    with pytest.raises(AudioValidationError):
        validate_duration(MIN_DURATION_SEC - 0.1)
    with pytest.raises(AudioValidationError):
        validate_duration(MAX_DURATION_SEC + 0.1)
