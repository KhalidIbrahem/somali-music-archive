"""CREPE pitch extraction + Somali scale analytics (SESSION P3-02, §10 Job 3).

The microtonality pipeline — the platform's core research instrument. CREPE
gives a fundamental-frequency contour; services/scale.py maps each confident
frame onto the Somali pentatonic scale with its cents deviation. THIS module
adds the aggregate layer the research actually cites:

  * ``dominant_notes``   — which scale degrees carry the melody, by prevalence,
  * ``note_statistics``  — per-degree mean cents deviation: the recording's
                           microtonal fingerprint ("in this performance, *mi*
                           sits 18 cents flat of equal temperament"),
  * ``voiced_fraction``  — how much of the clip held a confident pitch, an
                           honest quality signal for corpus curation.

WHY prevalence is confidence-weighted: a frame CREPE is 0.95 sure about is
stronger evidence for a degree than one at 0.55. Weighting by confidence makes
the dominance ranking robust to borderline frames without discarding them.

Everything above the pipeline runner is pure (stdlib only) and unit-tested with
synthetic frames; CREPE/librosa/network enter only inside ``run_pitch_job`` via
lazy imports (Phase-0 convention). Thresholds are named constants, refined
empirically against Ahmed Ali Egal's recordings — same governance as the scale
table itself.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from statistics import mean
from typing import Any

from services.scale import map_pitch_frames

logger = logging.getLogger("ai.pitch")

# A degree carrying under 5% of the confidence-weighted frames is treated as
# passing ornamentation/noise, not part of the melodic skeleton.
DOMINANT_NOTE_MIN_SHARE: float = 0.05


@dataclass
class PitchResult:
    """Structured pitch analysis stored on the recording's ``ai`` document (§9)."""

    pitch_data: list[dict[str, float | str]] = field(default_factory=list)
    dominant_notes: list[str] = field(default_factory=list)
    note_statistics: dict[str, dict[str, float]] = field(default_factory=dict)
    voiced_fraction: float = 0.0
    duration_sec: float = 0.0

    def to_payload(self) -> dict[str, Any]:
        """Wire shape POSTed back to the Node API's internal callback."""
        return {
            "pitch_data": self.pitch_data,
            "dominant_notes": self.dominant_notes,
            "note_statistics": self.note_statistics,
            "voiced_fraction": self.voiced_fraction,
            "duration_sec": self.duration_sec,
        }


# ── Pure analytics (unit-tested) ──────────────────────────────────────────────


def note_statistics(
    points: Sequence[Mapping[str, float | str]],
) -> dict[str, dict[str, float]]:
    """Per-degree aggregates: frame count, confidence-weighted share, mean cents.

    ``mean_cents`` is the headline research number — the systematic deviation of
    each sung/played degree from equal temperament. Keeping it per-recording
    (rather than only corpus-wide) lets the analysis compare performers, eras,
    and genres later.
    """
    cents_by_note: dict[str, list[float]] = {}
    weight_by_note: dict[str, float] = {}

    for point in points:
        label = str(point["note_label"])
        cents_by_note.setdefault(label, []).append(float(point["cents_deviation"]))
        weight = float(point.get("confidence", 1.0))
        weight_by_note[label] = weight_by_note.get(label, 0.0) + weight

    total_weight = sum(weight_by_note.values())
    if total_weight <= 0:
        return {}

    return {
        label: {
            "count": float(len(cents)),
            "share": round(weight_by_note[label] / total_weight, 3),
            "mean_cents": round(mean(cents), 2),
        }
        for label, cents in cents_by_note.items()
    }


def dominant_notes(
    statistics: Mapping[str, Mapping[str, float]],
    min_share: float = DOMINANT_NOTE_MIN_SHARE,
) -> list[str]:
    """Scale degrees ordered by melodic prevalence, noise degrees dropped.

    Order matters downstream: the first entry is the recording's tonal centre
    candidate, which feeds mode/genre analysis in later sessions.
    """
    ranked = sorted(statistics.items(), key=lambda item: item[1]["share"], reverse=True)
    return [label for label, stats in ranked if stats["share"] >= min_share]


def extract_pitch(
    times: Sequence[float],
    frequencies: Sequence[float],
    confidences: Sequence[float],
    *,
    confidence_threshold: float,
) -> PitchResult:
    """Turn raw CREPE output arrays into the full structured analysis.

    Accepts plain sequences (numpy arrays qualify) so the function stays pure
    and testable without numpy. Filtering to confident, voiced frames happens
    in scale.map_pitch_frames — the single shared gate — so the pitch points
    here are exactly what every other consumer of the mapping sees.
    """
    frames = [
        (float(t), float(hz), float(conf))
        # CREPE emits parallel arrays; strict=True turns a length drift into a
        # loud error instead of silently truncating the analysis.
        for t, hz, conf in zip(times, frequencies, confidences, strict=True)
    ]
    points = map_pitch_frames(frames, confidence_threshold)
    stats = note_statistics(points)

    return PitchResult(
        pitch_data=points,
        dominant_notes=dominant_notes(stats),
        note_statistics=stats,
        voiced_fraction=round(len(points) / len(frames), 3) if frames else 0.0,
        duration_sec=round(frames[-1][0], 2) if frames else 0.0,
    )


# ── Pipeline runner (worker / background-task entrypoint) ─────────────────────


def run_pitch_job(job_id: str, recording_id: str, audio_url: str) -> None:
    """Full job: download → validate → CREPE → scale analytics → post result.

    Synchronous on purpose (same reasoning as transcription): CREPE inference is
    blocking compute; as a Celery task it owns its process, as a FastAPI
    background task it runs on the thread pool. Raises on transient failure so
    the worker retry policy takes over.
    """
    from config import get_settings
    from services.callback import post_ai_result
    from utils.audio_download import prepared_audio

    log = logging.LoggerAdapter(logger, {"job_id": job_id, "recording_id": recording_id})
    log.info("pitch job started job_id=%s recording_id=%s", job_id, recording_id)

    with prepared_audio(audio_url, recording_id) as wav_path:
        times, frequencies, confidences = _run_crepe(str(wav_path))

    settings = get_settings()
    result = extract_pitch(
        times,
        frequencies,
        confidences,
        confidence_threshold=settings.pitch_confidence_threshold,
    )

    log.info(
        "pitch done job_id=%s points=%d dominant=%s voiced=%.2f",
        job_id,
        len(result.pitch_data),
        ",".join(result.dominant_notes) or "-",
        result.voiced_fraction,
    )
    post_ai_result(job_id, recording_id, "pitch", result.to_payload())


def _run_crepe(wav_path: str) -> tuple[Sequence[float], Sequence[float], Sequence[float]]:
    """Run CREPE over the prepared 16 kHz mono WAV (§10 Job 3 settings).

    ``model_capacity="full"`` for maximum accuracy (this is research data, not a
    live meter) and ``viterbi=True`` for a smooth melody contour instead of
    frame-to-frame jitter. prepared_audio already delivers CREPE's required
    16 kHz mono, so the load here is a plain read, not a resample.
    """
    import crepe  # type: ignore[import-untyped]
    import librosa

    audio, sr = librosa.load(wav_path, sr=16000, mono=True)
    times, frequencies, confidences, _ = crepe.predict(
        audio,
        sr,
        model_capacity="full",
        viterbi=True,
        step_size=10,  # 10 ms frames (§10)
        verbose=0,
    )
    return times, frequencies, confidences
