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


def load_notes(audio_path: str | Path) -> list[Note]:
    """basic-pitch note events -> Note list with sub-semitone cents.

    pitch_bends are integer contour-bin offsets at 3 bins/semitone, so each
    bin is 100/3 cents.
    """
    from basic_pitch.inference import predict

    with contextlib.redirect_stdout(io.StringIO()):
        _, _, events = predict(str(audio_path), _model())
    notes = []
    for start, end, midi, amp, bends in events:
        bend_cents = float(np.median(bends)) * (100.0 / 3.0) if bends else 0.0
        notes.append(Note(start=float(start), end=float(end), midi=int(midi),
                          amp=float(amp), cents=100.0 * midi + bend_cents))
    return sorted(notes, key=lambda n: n.start)


def estimate_bpm(audio_path: str | Path) -> float:
    import librosa
    import soundfile as sf

    y, sr = sf.read(audio_path, dtype="float32")
    if y.ndim > 1:
        y = y.mean(axis=1)
    try:
        from librosa.feature.rhythm import tempo as _tempo
    except ImportError:
        _tempo = librosa.beat.tempo
    t = _tempo(y=y, sr=sr)
    return float(t[0]) if len(t) else 100.0


def to_musicxml(qnotes: list[QNote], det: dict, bpm: float, out_xml: Path,
                title: str = "") -> None:
    """Emit MusicXML with 16th-grid rhythm at the detected tempo. Marked
    outliers: red notehead + '~' lyric (ornament preserved, not corrected)."""
    from music21 import metadata, note as m21note, stream, tempo as m21tempo

    s = stream.Stream()
    s.metadata = metadata.Metadata(title=title or out_xml.stem)
    s.append(m21tempo.MetronomeMark(number=round(bpm)))
    grid = 60.0 / bpm / 4.0  # 16th note seconds
    for q in qnotes:
        ql = max(1, round(q.dur / grid)) * 0.25
        n = m21note.Note(q.midi, quarterLength=ql)
        n.volume.velocity = int(np.clip(q.amp, 0, 1) * 127)
        off = max(0.0, round(q.start / grid) * 0.25)
        if q.marked:
            n.style.color = "#B03030"
            n.addLyric("~")  # unsnapped inflection
        s.insert(off, n)
    s.write("musicxml", fp=str(out_xml))


def render_svg(xml_path: Path, svg_path: Path) -> None:
    import verovio

    tk = verovio.toolkit()
    tk.loadFile(str(xml_path))
    svg_path.write_text(tk.renderToSVG(1))


def transcribe_file(audio_path: str | Path, out_dir: str | Path,
                    tol_cents: float = 50.0) -> dict:
    """Full pipeline for one file. Returns a summary dict (also written as JSON)."""
    import json

    audio_path, out_dir = Path(audio_path), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    notes = load_notes(audio_path)
    if len(notes) < 5:
        return {"file": audio_path.name, "error": "fewer than 5 notes detected"}
    det = detect_scale(notes)
    qnotes = pentatonic_quantize(notes, det, tol=tol_cents)
    bpm = estimate_bpm(audio_path)
    stem = audio_path.stem
    to_musicxml(qnotes, det, bpm, out_dir / f"{stem}.musicxml", title=stem)
    render_svg(out_dir / f"{stem}.musicxml", out_dir / f"{stem}.svg")
    from music21 import converter

    converter.parse(out_dir / f"{stem}.musicxml").write(
        "midi", fp=out_dir / f"{stem}.mid")
    summary = {
        "file": audio_path.name,
        "n_notes": len(notes),
        "tonic": det["tonic_name"],
        "mode": det["mode"],
        "degrees": det["degrees"],
        "tuning_offset_cents": round(det["tuning_offset_cents"], 1),
        "bpm": round(bpm),
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
    import json

    print(json.dumps(transcribe_file(sys.argv[1], sys.argv[2]), indent=2))
