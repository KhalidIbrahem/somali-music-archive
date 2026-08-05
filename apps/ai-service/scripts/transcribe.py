"""Track B pipeline: audio -> basic-pitch -> pentatonic quantization -> MusicXML/SVG.

Runs under the somali311 env (basic-pitch needs Python <=3.11):
  /opt/anaconda3/envs/somali311/bin/python -m scripts.transcribe <audio> <out_dir>

The research stage lives in scripts/quantize.py; this module is the frontend
(ONNX basic-pitch, loaded once) and the notation backend (music21 -> MusicXML,
Verovio -> SVG). Marked outlier notes are colored red and annotated so
ornaments/microtonal inflections stay visible in the score.
"""

from __future__ import annotations

import contextlib
import io
import sys
from pathlib import Path

import numpy as np

from scripts.quantize import Note, QNote, detect_scale, pentatonic_quantize

_MODEL = None


def _model():
    global _MODEL
    if _MODEL is None:
        from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
        from basic_pitch.inference import Model

        _MODEL = Model(build_icassp_2022_model_path(FilenameSuffix.onnx))
    return _MODEL


def load_notes(
    audio_path: str | Path,
    *,
    onset_threshold: float = 0.5,
    frame_threshold: float = 0.3,
    min_note_len_ms: float = 127.7,
    fmin_hz: float | None = None,
    fmax_hz: float | None = None,
) -> list[Note]:
    """basic-pitch note events -> Note list with sub-semitone cents.

    pitch_bends are integer contour-bin offsets at 3 bins/semitone, so each
    bin is 100/3 cents. The three thresholds are basic-pitch's own knobs
    (upstream defaults kept): raise onset/min-length to shed ghost fragments
    on noisy cassette material, lower them for sparse solo lines.
    """
    from basic_pitch.inference import predict

    with contextlib.redirect_stdout(io.StringIO()):
        _, _, events = predict(
            str(audio_path),
            _model(),
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            minimum_note_length=min_note_len_ms,
            # Instrument-range priors: confining detection to the chosen
            # instrument's register sheds harmonics and neighbours' bleed.
            minimum_frequency=fmin_hz,
            maximum_frequency=fmax_hz,
        )
    notes = []
    for start, end, midi, amp, bends in events:
        bend_cents = float(np.median(bends)) * (100.0 / 3.0) if bends else 0.0
        notes.append(Note(start=float(start), end=float(end), midi=int(midi),
                          amp=float(amp), cents=100.0 * midi + bend_cents))
    return sorted(notes, key=lambda n: n.start)


def track_beats(audio_path: str | Path) -> np.ndarray:
    """Tracked beat positions in seconds (empty-ish array when tracking fails)."""
    import librosa

    y, sr = librosa.load(str(audio_path), sr=None, mono=True)
    _tempo, frames = librosa.beat.beat_track(y=y, sr=sr)
    return librosa.frames_to_time(frames, sr=sr)


def estimate_bpm(audio_path: str | Path) -> float:
    import librosa

    # librosa.load tries soundfile first, then audioread (CoreAudio on macOS) —
    # so containers libsndfile can't touch (m4a/3gp phone recordings, often
    # renamed .mp3) still decode instead of failing the whole job. Mirrors how
    # basic-pitch itself reads the file for note prediction.
    y, sr = librosa.load(str(audio_path), sr=None, mono=True)
    try:
        from librosa.feature.rhythm import tempo as _tempo
    except ImportError:
        _tempo = librosa.beat.tempo
    t = _tempo(y=y, sr=sr)
    return float(t[0]) if len(t) else 100.0


# Friendlier enharmonic key signatures (C# major's 7 sharps → Db's 5 flats).
_ENHARMONIC_SIG = {"C#": "D-", "D#": "E-", "G#": "A-", "A#": "B-"}


def load_melody_notes_json(path: str | Path) -> list[Note]:
    """Notes JSON from the CREPE vocal engine (scripts/vocal_f0.py) → Notes."""
    import json

    data = json.loads(Path(path).read_text())
    return [Note(start=n["start"], end=n["end"], midi=int(n["midi"]),
                 amp=float(n.get("amp", 0.7)), cents=float(n["cents"]))
            for n in data["notes"]]


def build_score(parts: list[tuple[str, list[QNote], tuple[np.ndarray, np.ndarray] | None]],
                det: dict, bpm: float, out_xml: Path, title: str = ""):
    """Engraved score: per-part staves, key/time signatures, tempo, metadata.

    Marked outliers: red notehead + '~' lyric (ornament preserved, not
    corrected). Rhythm placement per part: `grid_ql` carries beat-tracked
    (offset, duration) quarterLengths from scripts.beat_grid — the accurate
    path; None falls back to the fixed 16th grid at the global BPM. Returns
    the music21 Score (caller writes MIDI from the same object so instrument
    programs survive)."""
    from music21 import (
        instrument, key, metadata, meter, note as m21note, stream,
        tempo as m21tempo,
    )

    part_instrument = {
        "Voice": instrument.Vocalist,
        "Oud": instrument.Lute,
        "Kaban": instrument.Lute,  # the Somali oud
        "Violin": instrument.Violin,
        "Flute": instrument.Flute,
    }
    score = stream.Score()
    score.metadata = metadata.Metadata(title=title or out_xml.stem)
    score.metadata.composer = "AI transcription — Somali Music Archive"
    tonic = str(det.get("tonic_name", "C"))
    sig_tonic = _ENHARMONIC_SIG.get(tonic, tonic)
    grid = 60.0 / bpm / 4.0  # 16th note seconds (fixed-grid fallback only)

    for pi, (pname, qnotes, grid_ql) in enumerate(parts):
        part = stream.Part(id=pname)
        part.partName = pname
        part.insert(0, part_instrument.get(pname, instrument.Instrument)())
        part.insert(0, key.Key(sig_tonic))
        part.insert(0, meter.TimeSignature("4/4"))
        if pi == 0:
            part.insert(0, m21tempo.MetronomeMark(number=round(bpm)))
        for i, q in enumerate(qnotes):
            if grid_ql is not None:
                off, ql = float(grid_ql[0][i]), float(grid_ql[1][i])
            else:
                ql = max(1, round(q.dur / grid)) * 0.25
                off = max(0.0, round(q.start / grid) * 0.25)
            n = m21note.Note(q.midi, quarterLength=ql)
            n.volume.velocity = int(np.clip(q.amp, 0, 1) * 127)
            if q.marked:
                n.style.color = "#B03030"
                n.addLyric("~")  # unsnapped inflection
            part.insert(off, n)
        score.append(part)
    score.write("musicxml", fp=str(out_xml))
    return score


def render_svg(xml_path: Path, svg_path: Path) -> None:
    import verovio

    tk = verovio.toolkit()
    tk.loadFile(str(xml_path))
    svg_path.write_text(tk.renderToSVG(1))


def transcribe_file(audio_path: str | Path, out_dir: str | Path,
                    tol_cents: float = 50.0,
                    onset_threshold: float = 0.5,
                    frame_threshold: float = 0.3,
                    min_note_len_ms: float = 127.7,
                    beat_audio_path: str | Path | None = None,
                    melody: bool = False,
                    melody_notes_json: str | Path | None = None,
                    accomp_audio_path: str | Path | None = None,
                    part_name: str | None = None,
                    fmin_hz: float | None = None,
                    fmax_hz: float | None = None) -> dict:
    """Full pipeline for one file. Returns a summary dict (also written as JSON).

    `beat_audio_path` lets the rhythm grid come from a DIFFERENT recording
    than the notes: when transcribing a separated vocal stem, the beats are
    tracked on the full mix — percussion and oud carry the pulse, while the
    isolated voice floats over it and misleads the tracker."""
    import json

    from scripts.beat_grid import (
        MIN_BEATS_FOR_GRID, median_bpm, snap_notes_to_beats,
    )

    audio_path, out_dir = Path(audio_path), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    if melody_notes_json:
        # Dedicated vocal engine: CREPE f0 → segmented notes (vocal_f0.py),
        # 10 ms resolution with microtone-accurate cents — the accuracy path.
        notes = load_melody_notes_json(melody_notes_json)
        engine = "crepe-vocal"
    else:
        notes = load_notes(audio_path, onset_threshold=onset_threshold,
                           frame_threshold=frame_threshold,
                           min_note_len_ms=min_note_len_ms,
                           fmin_hz=fmin_hz, fmax_hz=fmax_hz)
        engine = "basic-pitch"
        if melody:
            # Notation surface: reduce the polyphonic detection soup to the
            # one singable line a reader expects (scripts/melody.py).
            from scripts.melody import melody_skyline

            notes = melody_skyline(notes)
    if len(notes) < 5:
        return {"file": audio_path.name, "error": "fewer than 5 notes detected"}
    det = detect_scale(notes)
    qnotes = pentatonic_quantize(notes, det, tol=tol_cents)

    # Optional second staff: the melodic accompaniment ('other' Demucs stem —
    # oud/kaban territory), skyline-reduced and quantized against the SAME
    # detected scale so both staves agree on the tonal frame.
    accomp_q: list[QNote] | None = None
    if accomp_audio_path:
        from scripts.melody import melody_skyline

        accomp_raw = load_notes(accomp_audio_path, onset_threshold=0.6,
                                frame_threshold=frame_threshold,
                                min_note_len_ms=90.0)
        accomp_q = pentatonic_quantize(melody_skyline(accomp_raw), det, tol=tol_cents)

    # Rhythm: beat-tracked grid when the tracker finds enough beats (rubato-
    # safe — each note aligns to its local beat); fixed global grid otherwise.
    beat_times = track_beats(beat_audio_path or audio_path)
    if len(beat_times) >= MIN_BEATS_FOR_GRID:
        grid_kind = "beat-tracked"
        bpm = median_bpm(beat_times)

        def snap(qs: list[QNote]):
            return snap_notes_to_beats(
                [q.start for q in qs], [q.end for q in qs], beat_times)
    else:
        grid_kind = "fixed"
        bpm = estimate_bpm(audio_path)

        def snap(qs: list[QNote]):
            return None

    lead_name = part_name or ("Voice" if melody_notes_json else "Melody")
    parts = [(lead_name, qnotes, snap(qnotes))]
    if accomp_q:
        parts.append(("Oud", accomp_q, snap(accomp_q)))

    stem = audio_path.stem
    score = build_score(parts, det, bpm, out_dir / f"{stem}.musicxml", title=stem)
    render_svg(out_dir / f"{stem}.musicxml", out_dir / f"{stem}.svg")
    # MIDI straight from the same Score so part instruments survive.
    score.write("midi", fp=out_dir / f"{stem}.mid")
    summary = {
        "file": audio_path.name,
        "n_notes": len(notes),
        "tonic": det["tonic_name"],
        "mode": det["mode"],
        "degrees": det["degrees"],
        "tuning_offset_cents": round(det["tuning_offset_cents"], 1),
        "bpm": round(bpm),
        "grid": grid_kind,
        "n_beats": int(len(beat_times)),
        "melody": melody,
        "engine": engine,
        "parts": [p[0] for p in parts],
        "accomp_notes": len(accomp_q) if accomp_q else 0,
        "snapped": sum(1 for q in qnotes if q.snapped),
        "marked_outliers": sum(1 for q in qnotes if q.marked),
        "mean_confidence": round(float(np.mean([q.confidence for q in qnotes])), 3),
        "outputs": [f"{stem}.musicxml", f"{stem}.svg", f"{stem}.mid"],
        "notes": [{"start": round(q.start, 3), "end": round(q.end, 3),
                   "midi": q.midi, "snapped": q.snapped, "marked": q.marked,
                   "confidence": round(q.confidence, 3)} for q in qnotes],
    }
    (out_dir / f"{stem}.json").write_text(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    import argparse
    import json

    ap = argparse.ArgumentParser(description="Pentatonic-aware transcription")
    ap.add_argument("audio")
    ap.add_argument("out_dir")
    ap.add_argument("--onset-threshold", type=float, default=0.5)
    ap.add_argument("--frame-threshold", type=float, default=0.3)
    ap.add_argument("--min-note-ms", type=float, default=127.7)
    ap.add_argument("--beat-audio", default=None,
                    help="track the rhythm grid on this file instead "
                         "(e.g. the full mix when transcribing a vocal stem)")
    ap.add_argument("--melody", action="store_true",
                    help="skyline-reduce to a monophonic melody line "
                         "(notation surface; research default keeps polyphony)")
    ap.add_argument("--melody-notes", default=None,
                    help="notes JSON from the CREPE vocal engine "
                         "(scripts/vocal_f0.py) — replaces basic-pitch for "
                         "the melody staff")
    ap.add_argument("--accomp-audio", default=None,
                    help="melodic accompaniment stem (Demucs 'other') for a "
                         "second staff")
    ap.add_argument("--part-name", default=None,
                    help="staff label for the lead part (Voice/Kaban/Violin/Flute)")
    ap.add_argument("--fmin", type=float, default=None,
                    help="instrument-range prior: minimum frequency in Hz")
    ap.add_argument("--fmax", type=float, default=None,
                    help="instrument-range prior: maximum frequency in Hz")
    args = ap.parse_args()
    print(json.dumps(transcribe_file(
        args.audio, args.out_dir,
        onset_threshold=args.onset_threshold,
        frame_threshold=args.frame_threshold,
        min_note_len_ms=args.min_note_ms,
        beat_audio_path=args.beat_audio,
        melody=args.melody,
        melody_notes_json=args.melody_notes,
        accomp_audio_path=args.accomp_audio,
        part_name=args.part_name,
        fmin_hz=args.fmin,
        fmax_hz=args.fmax), indent=2))
