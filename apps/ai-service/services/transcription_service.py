"""Somali speech transcription (SESSION P3-01, ARCHITECTURE.md §10 Job 2).

The first pipeline built to automatically transcribe Somali traditional music.

RESEARCH NOTE — singing vs. speech: Whisper was trained on speech. Fed sung
material (heello melisma, buraanbur metre), it frequently HALLUCINATES fluent
text that was never sung. An archive that silently stored those hallucinations
as "transcripts" would poison the research corpus. So instead of trusting
Whisper blindly, we read the signals Whisper itself exposes per segment:

  * ``no_speech_prob``      — its own "this isn't speech" detector,
  * ``compression_ratio``   — hallucination loops repeat text, compressing well,
  * ``avg_logprob``         — token confidence collapses on sung content.

Segments failing these checks are counted; a majority marks the recording
``is_singing`` so consumers treat the transcript as advisory, not ground truth.
The thresholds follow the values Whisper itself uses for decoding fallbacks
(compression_ratio 2.4, logprob −1.0) plus a no-speech majority vote — and are
themselves data to refine against Ahmed Ali Egal's recordings, exactly like the
scale table in services/scale.py.

Everything above the pipeline runner is pure (stdlib only) and unit-tested with
synthetic Whisper output; the model, network, and ffmpeg enter only inside
``run_transcription_job`` via lazy imports (Phase-0 convention).
"""

from __future__ import annotations

import logging
import math
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("ai.transcribe")

# ── Hallucination / singing heuristics (thresholds documented above) ─────────
NO_SPEECH_THRESHOLD: float = 0.6
COMPRESSION_RATIO_THRESHOLD: float = 2.4
LOGPROB_THRESHOLD: float = -1.0
SINGING_SEGMENT_FRACTION: float = 0.5

# Non-lexical filler Whisper emits around music: note glyphs and stage tags.
_NOTE_GLYPHS = re.compile(r"[♪♫♬]+")
_FILLER_TAG = re.compile(
    r"[\[\(]\s*(?:music|applause|laughter|singing|instrumental|foreign|noise)\s*[\]\)]",
    re.IGNORECASE,
)
_WHITESPACE = re.compile(r"\s+")


@dataclass
class TranscriptionResult:
    """Structured output stored on the recording's ``ai`` document (§9)."""

    somali_text: str
    english_text: str
    segments: list[dict[str, float | str]] = field(default_factory=list)
    detected_language: str = "so"
    is_singing: bool = False
    duration_sec: float = 0.0

    def to_payload(self) -> dict[str, Any]:
        """Wire shape POSTed back to the Node API's internal callback."""
        return {
            "somali_text": self.somali_text,
            "english_text": self.english_text,
            "segments": self.segments,
            "detected_language": self.detected_language,
            "is_singing": self.is_singing,
            "duration_sec": self.duration_sec,
        }


# ── Pure scoring / classification (unit-tested) ──────────────────────────────


def segment_confidence(avg_logprob: float | None) -> float:
    """Map Whisper's per-segment mean token log-probability to a 0–1 score.

    ``exp(avg_logprob)`` is the geometric-mean token probability — a proper
    probability-scale number reviewers can read ("0.78 confident"), unlike the
    raw negative logprob. Missing values score 0 so nothing masquerades as
    confident by accident.
    """
    if avg_logprob is None:
        return 0.0
    return max(0.0, min(1.0, math.exp(avg_logprob)))


def looks_hallucinated(segment: Mapping[str, Any]) -> bool:
    """Does one segment carry Whisper's own markers of unreliable output?

    Any single marker is enough: high no-speech probability with text present,
    a compression ratio typical of repeated hallucination loops, or collapsed
    token confidence. These are the same signals Whisper's decoder uses to
    trigger its internal fallbacks.
    """
    no_speech = float(segment.get("no_speech_prob", 0.0))
    compression = float(segment.get("compression_ratio", 1.0))
    logprob = float(segment.get("avg_logprob", 0.0))
    return (
        no_speech > NO_SPEECH_THRESHOLD
        or compression > COMPRESSION_RATIO_THRESHOLD
        or logprob < LOGPROB_THRESHOLD
    )


def detect_singing(segments: Sequence[Mapping[str, Any]]) -> bool:
    """Classify a recording as sung when unreliable segments form a majority.

    A lone bad segment is normal even in clean speech (a cough, a pause); a
    majority means Whisper spent most of the clip outside its training
    distribution — which for this archive means singing. Empty input is not
    evidence of anything → False.
    """
    if not segments:
        return False
    flagged = sum(1 for seg in segments if looks_hallucinated(seg))
    return flagged / len(segments) >= SINGING_SEGMENT_FRACTION


def clean_segment_text(text: str) -> str:
    """Strip non-lexical filler (♪, [Music], (applause)…) and tidy whitespace.

    Deliberately conservative: only a fixed allowlist of stage tags is removed,
    never arbitrary bracketed text — Somali lyrics may legitimately contain
    parentheticals, and destroying real words would corrupt the corpus.
    """
    cleaned = _NOTE_GLYPHS.sub(" ", text)
    cleaned = _FILLER_TAG.sub(" ", cleaned)
    return _WHITESPACE.sub(" ", cleaned).strip()


def collapse_repeats(texts: Sequence[str], max_repeats: int = 2) -> list[str]:
    """Cap consecutive identical lines at ``max_repeats``.

    Whisper's classic failure mode on music is looping one phrase dozens of
    times. Somali forms DO repeat refrains, so repeats are capped — preserving
    the fact of repetition — rather than deduplicated to one.
    """
    out: list[str] = []
    run = 0
    for text in texts:
        if out and text == out[-1]:
            run += 1
        else:
            run = 1
        if run <= max_repeats:
            out.append(text)
    return out


def build_transcript(segments: Sequence[Mapping[str, Any]]) -> str:
    """Assemble the display transcript from segments: clean → collapse → join."""
    cleaned = [clean_segment_text(str(seg.get("text", ""))) for seg in segments]
    kept = collapse_repeats([t for t in cleaned if t])
    return " ".join(kept)


# ── Transcription (model injected; tested with a fake) ───────────────────────

LanguageDetector = Callable[[Any, str], tuple[str, float]]


def _detect_language_whisper(model: Any, audio_path: str) -> tuple[str, float]:
    """Detect the spoken language from the first 30 s via Whisper's own head.

    Runs BEFORE the forced-language pass: forcing ``so`` maximises Somali
    accuracy, but we still need independent confirmation the material actually
    is Somali (mislabeled uploads must be flagged, not silently mis-forced).
    """
    import whisper

    audio = whisper.load_audio(audio_path)
    audio = whisper.pad_or_trim(audio)
    mel = whisper.log_mel_spectrogram(audio, n_mels=model.dims.n_mels).to(model.device)
    _, probs = model.detect_language(mel)
    language = max(probs, key=probs.get)
    return language, float(probs[language])


def transcribe_recording(
    model: Any,
    audio_path: str,
    language: str = "so",
    *,
    detector: LanguageDetector | None = None,
    fp16: bool = False,
) -> TranscriptionResult:
    """Two-pass Whisper transcription of one prepared (16 kHz WAV) recording.

    Pass 1 transcribes in the forced source language (word timestamps kept for
    future subtitle/karaoke rendering); pass 2 translates to English. Language
    is verified independently, and the singing classifier runs on the raw
    pass-1 segments BEFORE cleaning (cleaning would erase the very evidence —
    note glyphs, repeats — that singing detection relies on).

    ``detector`` is injectable so tests supply a stub instead of the real
    Whisper language head.
    """
    detect = detector or _detect_language_whisper
    try:
        detected_language, lang_prob = detect(model, audio_path)
    except Exception:  # detection is advisory — never let it kill the job
        logger.warning("language detection failed; assuming '%s'", language, exc_info=True)
        detected_language, lang_prob = language, 0.0

    if detected_language != language:
        logger.warning(
            "language mismatch: expected=%s detected=%s (p=%.2f)",
            language,
            detected_language,
            lang_prob,
        )

    original = model.transcribe(
        audio_path,
        language=language,
        task="transcribe",
        word_timestamps=True,
        fp16=fp16,
        verbose=None,
    )
    english = model.transcribe(
        audio_path,
        language=language,
        task="translate",
        fp16=fp16,
        verbose=None,
    )

    raw_segments: list[Mapping[str, Any]] = list(original.get("segments", []))

    segments_out: list[dict[str, float | str]] = []
    for seg in raw_segments:
        text = clean_segment_text(str(seg.get("text", "")))
        if not text:
            continue
        segments_out.append(
            {
                "start": round(float(seg.get("start", 0.0)), 3),
                "end": round(float(seg.get("end", 0.0)), 3),
                "text": text,
                "confidence": round(segment_confidence(seg.get("avg_logprob")), 3),
            }
        )

    duration = float(raw_segments[-1].get("end", 0.0)) if raw_segments else 0.0

    return TranscriptionResult(
        somali_text=build_transcript(raw_segments),
        english_text=build_transcript(english.get("segments", [])),
        segments=segments_out,
        detected_language=detected_language,
        is_singing=detect_singing(raw_segments),
        duration_sec=round(duration, 2),
    )


# ── Pipeline runner (worker / background-task entrypoint) ─────────────────────


def run_transcription_job(
    job_id: str,
    recording_id: str,
    audio_url: str,
    language: str = "so",
) -> None:
    """Full job: download → validate → transcribe both passes → post result.

    Synchronous ON PURPOSE: Whisper inference is blocking CPU/GPU work. As a
    Celery task it owns its worker process; as a FastAPI background task,
    Starlette runs sync callables in a thread pool — either way the event loop
    serving /health and new requests is never blocked. Raises on transient
    failure so the Celery retry policy can take over.
    """
    from models.whisper_model import fp16_for, get_whisper_model
    from services.callback import post_ai_result
    from utils.audio_download import prepared_audio

    log = logging.LoggerAdapter(logger, {"job_id": job_id, "recording_id": recording_id})
    log.info("transcription job started job_id=%s recording_id=%s", job_id, recording_id)

    with prepared_audio(audio_url, recording_id) as wav_path:
        model = get_whisper_model()
        result = transcribe_recording(model, str(wav_path), language, fp16=fp16_for(model))

    log.info(
        "transcription done job_id=%s lang=%s singing=%s segments=%d",
        job_id,
        result.detected_language,
        result.is_singing,
        len(result.segments),
    )
    post_ai_result(job_id, recording_id, "transcription", result.to_payload())
