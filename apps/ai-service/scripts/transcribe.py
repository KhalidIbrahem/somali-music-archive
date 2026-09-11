"""Somali-aware transcription: a qaraami recording in, sheet music out.

    python -m scripts.transcribe <audio> --out <dir> [--instrumental] [--excerpt-sec N]

Stages, each reusing the Track B modules rather than replacing them:

  a. source separation with Demucs (htdemucs) into a vocal stem and an "other"
     stem, which is where the oud lives; skipped with --instrumental, when the
     whole mix is treated as the oud stem
  b. pitch tracking on each stem with CREPE (scripts/vocal_f0.py), keeping the
     per-frame confidence and the raw 10 ms pitch track
  c. scale estimation for the recording: tonic and pentatonic degrees from the
     recording's own pitch histogram (scripts/quantize.detect_scale with
     refine=True, on top of scripts/pentatonic), stored in cents relative to the
     tonic, not as note names
  d. note segmentation (scripts/f0_notes via vocal_f0), the oud line reduced to
     one voice (scripts/melody.melody_skyline), and quantization to the
     estimated scale rather than 12-TET (scripts/quantize.pentatonic_quantize);
     every note keeps its signed deviation from the nearest degree and the
     marked flag, so nothing is corrected away silently
  e. beat tracking on the full mix and a coarse eighth-note grid
     (scripts/beat_grid); notes below the confidence or length floor are
     dropped, preferring fewer wrong notes over more notes
  f. MusicXML through music21 (voice and oud as two staves), a PDF through
     MuseScore 4 with Verovio SVG as the fallback, a MIDI file, and a JSON
     carrying the raw pitch tracks, the estimated scale and every note's fields
  g. a short report

Outputs in <dir>: <stem>.musicxml, <stem>.pdf (or .svg), <stem>.mid,
<stem>.json, report.txt, and stems/ when separation ran.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.beat_grid import (  # noqa: E402
    MIN_BEATS_FOR_GRID, median_bpm, pickup_shift_beats, snap_notes_monophonic,
)
from scripts.melody import melody_skyline  # noqa: E402
from scripts.pentatonic import PC_NAMES  # noqa: E402
from scripts.quantize import Note, QNote, detect_scale, pcs_of_notes, pentatonic_quantize  # noqa: E402

MSCORE = Path("/Applications/MuseScore 4.app/Contents/MacOS/mscore")
AMBIGUITY_RATIO = 0.95  # runner-up with another tonic within 5 percent of the winner
_FLATS = {"DB": "C#", "EB": "D#", "GB": "F#", "AB": "G#", "BB": "A#"}


def parse_tonic(name: str) -> int:
    """'D', 'f#', 'Bb' -> pitch class 0..11."""
    key = name.strip().upper().replace("♭", "B").replace("♯", "#")
    key = _FLATS.get(key, key)
    if key not in PC_NAMES:
        raise ValueError(f"unknown tonic {name!r}; use one of {PC_NAMES} or a flat spelling")
    return PC_NAMES.index(key)


def tonic_ambiguity(det: dict, ratio: float = AMBIGUITY_RATIO) -> dict:
    """Is the best reading with another tonic within `ratio` of the winner?
    Returns {"ambiguous": bool, "label": "D (F)" or "D", "runner_up": ...}."""
    other = det.get("runner_up_other_tonic")
    best = float(det.get("score", 0.0))
    amb = bool(other and best > 0 and float(other["score"]) >= ratio * best)
    label = f"{det['tonic_name']} ({other['tonic_name']})" if amb else str(det["tonic_name"])
    return {"ambiguous": amb, "label": label, "runner_up": other,
            "ratio_to_winner": round(float(other["score"]) / best, 3) if other and best > 0 else None}
DECODE_SR = 44_100
VOICE, OUD = "Voice", "Oud (kaban)"
MAX_BPM = 140.0  # above this the tracker has found the eighth-note pulse; halve it
# Friendlier enharmonic key signatures (C# major's 7 sharps -> Db's 5 flats).
_ENHARMONIC_SIG = {"C#": "D-", "D#": "E-", "G#": "A-", "A#": "B-"}
_MAJOR = {0, 200, 400, 500, 700, 900, 1100}
_MINOR = {0, 200, 300, 500, 700, 800, 1000}


def key_for_scale(tonic_name: str, template_cents: list[float]):
    """Key signature that leaves the fewest degrees needing accidentals: the
    tonic's major or minor key, whichever contains more of the pentatonic set
    (so an A minor-pentatonic mode gets A minor, not three sharps)."""
    from music21 import key

    degs = {int(round(c)) for c in template_cents}
    mode = "major" if len(degs & _MAJOR) >= len(degs & _MINOR) else "minor"
    name = _ENHARMONIC_SIG.get(tonic_name, tonic_name)
    return key.Key(name if mode == "major" else name.lower(), mode)


# ----------------------------------------------------------------------------- audio
def decode(audio: Path, out_dir: Path, excerpt_sec: float | None) -> tuple[Path, float]:
    """ffmpeg decode to 44.1 kHz mono wav (m4a, mp3, anything), optionally the
    first `excerpt_sec` seconds. Returns (wav path, duration in seconds)."""
    suffix = f"_excerpt{int(excerpt_sec)}" if excerpt_sec else ""
    wav = out_dir / f"{audio.stem}{suffix}.input.wav"
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(audio)]
    if excerpt_sec:
        cmd += ["-t", str(excerpt_sec)]
    cmd += ["-ac", "1", "-ar", str(DECODE_SR), str(wav)]
    subprocess.run(cmd, check=True, capture_output=True)
    import soundfile as sf

    info = sf.info(str(wav))
    return wav, float(info.frames / info.samplerate)


def separate(wav: Path, out_dir: Path, device: str = "auto") -> dict:
    """Demucs htdemucs -> vocals.wav + other.wav. MPS first, CPU fallback."""
    stems_root = out_dir / "stems"
    devices = ["mps", "cpu"] if device == "auto" else [device]
    last_err = ""
    for dev in devices:
        t0 = time.time()
        # --shifts 0: no random time shift, so the stems (and everything
        # downstream) are the same on every run of the same file.
        proc = subprocess.run([sys.executable, "-m", "demucs", "-n", "htdemucs", "-d", dev,
                               "--shifts", "0", "-o", str(stems_root), str(wav)],
                              capture_output=True, text=True)
        if proc.returncode == 0:
            d = stems_root / "htdemucs" / wav.stem
            return {"used": True, "model": "htdemucs", "device": dev,
                    "seconds": round(time.time() - t0, 1),
                    "vocals": str(d / "vocals.wav"), "other": str(d / "other.wav")}
        last_err = proc.stderr.strip()[-400:]
    raise RuntimeError(f"demucs failed on {devices}: {last_err}")


# ----------------------------------------------------------------------------- notes
def stem_notes(path: Path, *, min_conf: float, min_note_ms: float,
               skyline: bool, pitch_device: str | None = None,
               legato: bool = False) -> tuple[list[Note], list[float], dict]:
    """CREPE notes for one stem, filtered conservatively, optionally reduced
    to a single line. Returns (notes, CREPE confidence per note, info with the
    raw frames). The CREPE confidence is kept apart from the quantizer's own
    scale-fit confidence; both end up in the JSON."""
    from scripts.vocal_f0 import extract_notes

    raw = extract_notes(path, return_frames=True, device=pitch_device, legato=legato)
    notes = [Note(start=n["start"], end=n["end"], midi=int(n["midi"]),
                  amp=float(n["amp"]), cents=float(n["cents"])) for n in raw["notes"]]
    confs = {(n["start"], n["end"]): float(n["confidence"]) for n in raw["notes"]}
    kept = [n for n in notes
            if confs[(n.start, n.end)] >= min_conf and n.dur >= min_note_ms / 1000.0]
    if skyline:
        kept = melody_skyline(kept)
    info = {
        "engine": raw["engine"], "device": raw["device"], "n_frames": raw["n_frames"],
        "voiced_fraction": raw["voiced_fraction"],
        "n_notes_raw": len(notes), "n_notes_kept": len(kept),
        "dropped_low_confidence_or_short": len(notes) - len(kept) if not skyline else None,
        "reduced_to_single_line": bool(skyline),
        "legato": bool(legato),
        "frames": raw["frames"],
    }
    if skyline:
        n_filtered = sum(1 for n in notes
                         if confs[(n.start, n.end)] >= min_conf and n.dur >= min_note_ms / 1000.0)
        info["dropped_low_confidence_or_short"] = len(notes) - n_filtered
        info["dropped_by_skyline"] = n_filtered - len(kept)
    crepe_conf = [confs.get((n.start, n.end), 1.0) for n in kept]
    return kept, crepe_conf, info


def scale_summary(det: dict) -> dict:
    off = float(det["tuning_offset_cents"])
    ref = float(det.get("tonic_refined_offset_cents", 0.0))
    c4 = 261.6256
    amb = tonic_ambiguity(det)
    return {
        "tonic_label": amb["label"], "tonic_ambiguous": amb["ambiguous"],
        "tonic_runner_up": amb["runner_up"], "tonic_ratio_to_winner": amb["ratio_to_winner"],
        "override": det.get("constrained"), "unconstrained_best": det.get("unconstrained"),
        "tonic_name": det["tonic_name"], "tonic_pc": int(det["tonic_pc"]),
        "mode": int(det["mode"]), "template_fit_r": round(float(det["score"]), 3),
        "tuning_offset_cents": round(off, 1),
        "tonic_refined_offset_cents": round(ref, 1),
        "tonic_hz_c4_octave": round(c4 * 2 ** ((int(det["tonic_pc"]) * 100 + off + ref) / 1200.0), 2),
        "scale_cents": det.get("scale_cents"),
        "scale_cents_template": det.get("scale_cents_template"),
        "scale_degree_mass": det.get("scale_degree_mass"),
        "scale_degree_refined": det.get("scale_degree_refined"),
        "degrees_pc": [int(d) for d in det["degrees"]],
        "degrees_pc_names": [PC_NAMES[d] for d in det["degrees"]],
        "tonic_alternatives": det.get("alternatives"),
    }


# ----------------------------------------------------------------------------- rhythm
def track_beats(wav: Path) -> np.ndarray:
    import librosa

    y, sr = librosa.load(str(wav), sr=None, mono=True)
    _t, frames = librosa.beat.beat_track(y=y, sr=sr)
    return librosa.frames_to_time(frames, sr=sr)


def estimate_bpm(wav: Path) -> float:
    import librosa

    y, sr = librosa.load(str(wav), sr=None, mono=True)
    try:
        from librosa.feature.rhythm import tempo as _tempo
    except ImportError:  # older librosa
        _tempo = librosa.beat.tempo
    t = _tempo(y=y, sr=sr)
    return float(t[0]) if len(t) else 100.0


# ----------------------------------------------------------------------------- score
def build_score(parts: list[tuple[str, list[QNote], tuple[np.ndarray, np.ndarray, np.ndarray] | None]],
                det: dict, bpm: float, out_xml: Path, title: str, scale_text: str):
    """Two-staff score (or one, when instrumental). Marked outliers: red
    notehead and the signed deviation in cents as a lyric, so an editor sees
    exactly what was not snapped. Returns the music21 Score (MIDI is written
    from the same object)."""
    from music21 import (clef, expressions, instrument, metadata, meter,
                         note as m21note, stream, tempo as m21tempo)

    score = stream.Score()
    score.metadata = metadata.Metadata(title=title)
    score.metadata.composer = "automatic transcription, unverified"
    tonic = str(det.get("tonic_name", "C"))
    from scripts.pentatonic import scale_cents_template

    template = scale_cents_template(det)
    grid = 60.0 / bpm / 2.0  # eighth-note seconds, fixed-grid fallback only
    for pi, (pname, qnotes, grid_ql) in enumerate(parts):
        part = stream.Part(id=pname.split(" ")[0])
        part.partName = pname
        part.insert(0, instrument.Vocalist() if pname == VOICE else instrument.Lute())
        part.insert(0, clef.TrebleClef() if pname == VOICE else clef.Treble8vbClef())
        part.insert(0, key_for_scale(tonic, template))  # a fresh object per part: music21's
        # MIDI conductor track rejects one element inserted into two parts
        part.insert(0, meter.TimeSignature("4/4"))
        if pi == 0:
            part.insert(0, m21tempo.MetronomeMark(number=round(bpm)))
            te = expressions.TextExpression(scale_text)
            te.style.fontSize = 9
            part.insert(0, te)
        for i, q in enumerate(qnotes):
            if grid_ql is not None:
                if not bool(grid_ql[2][i]):
                    continue  # dropped by the monophonic grid (same cell as its neighbour)
                off, ql = float(grid_ql[0][i]), float(grid_ql[1][i])
            else:
                ql = max(1, round(q.dur / grid)) * 0.5
                off = max(0.0, round(q.start / grid) * 0.5)
            n = m21note.Note(q.midi, quarterLength=ql)
            if n.pitch.accidental is not None and n.pitch.accidental.alter == 0:
                n.pitch.accidental = None  # let the notation pass decide on naturals
            n.volume.velocity = int(max(24, np.clip(q.amp, 0, 1) * 127))
            if q.marked:
                n.style.color = "#B03030"
                dev = q.deviation_cents
                n.addLyric(f"{'+' if dev >= 0 else chr(0x2212)}{abs(dev):.0f}c")
            part.insert(off, n)
        score.insert(0, part)  # not append: append would place this part AFTER the previous one in time
    score.write("musicxml", fp=str(out_xml))
    return score


def render_pdf(xml: Path, pdf: Path) -> dict:
    """MuseScore 4 CLI for the PDF (it may abort at shutdown after writing the
    file, so success is judged by the PDF). A Verovio SVG of the first page is
    written as well every time: the web page inlines it, and it is the
    fallback when MuseScore is absent or fails."""
    out: dict = {"renderer": "none"}
    if MSCORE.exists():
        try:
            subprocess.run([str(MSCORE), "-o", str(pdf), str(xml)], capture_output=True,
                           text=True, timeout=300)
        except subprocess.TimeoutExpired:
            pass
        if pdf.exists() and pdf.stat().st_size > 0:
            out = {"renderer": "musescore-4", "path": str(pdf)}
    try:
        import verovio

        tk = verovio.toolkit()
        tk.loadFile(str(xml))
        svg = xml.with_suffix(".svg")
        svg.write_text(tk.renderToSVG(1))
        out["svg"] = str(svg)
        out["svg_pages"] = tk.getPageCount()
        if out["renderer"] == "none":
            out.update({"renderer": "verovio-svg (fallback: MuseScore render failed)", "path": str(svg)})
    except Exception as e:  # noqa: BLE001
        out["svg_error"] = str(e)[:200]
    return out


# ----------------------------------------------------------------------------- pipeline
def transcribe_file(audio: str | Path, out: str | Path, *, instrumental: bool = False,
                    tol_cents: float = 50.0, sub: int = 2, min_conf: float = 0.6,
                    min_note_ms: float = 100.0, excerpt_sec: float | None = None,
                    device: str = "auto", pitch_device: str | None = None, pdf: bool = True,
                    tonic: str | None = None, mode: int | None = None,
                    legato: bool | None = None) -> dict:
    audio, out = Path(audio), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    timings: dict[str, float] = {}
    t_all = time.time()

    t0 = time.time()
    wav, duration = decode(audio, out, excerpt_sec)
    timings["decode"] = round(time.time() - t0, 1)
    stem = wav.stem.replace(".input", "")

    # a. stems
    if instrumental:
        sep = {"used": False, "reason": "instrumental: the whole mix is the oud stem"}
        stems = {OUD: wav}
    else:
        t0 = time.time()
        sep = separate(wav, out, device)
        timings["separation"] = sep["seconds"]
        stems = {VOICE: Path(sep["vocals"]), OUD: Path(sep["other"])}

    # b + d(1). notes per stem
    notes: dict[str, list[Note]] = {}
    crepe_conf: dict[str, list[float]] = {}
    stem_info: dict[str, dict] = {}
    t0 = time.time()
    # Legato (sustain through the ring-out, merge re-attacks under 120 ms, no
    # rests shorter than an eighth) is on for oud stems unless told otherwise.
    legato_for = {label: (legato if legato is not None else label == OUD) for label in stems}
    for label, path in stems.items():
        kept, cc, info = stem_notes(path, min_conf=min_conf, min_note_ms=min_note_ms,
                                    skyline=(label == OUD), pitch_device=pitch_device,
                                    legato=legato_for[label])
        notes[label], crepe_conf[label], stem_info[label] = kept, cc, info
    timings["pitch_tracking"] = round(time.time() - t0, 1)

    all_notes = [n for ns in notes.values() for n in ns]
    if len(all_notes) < 5:
        result = {"file": audio.name, "error": "fewer than 5 confident notes in the recording",
                  "stems": {k: {kk: vv for kk, vv in v.items() if kk != "frames"}
                            for k, v in stem_info.items()}}
        (out / f"{stem}.json").write_text(json.dumps(result, indent=1))
        return result

    # c. scale from the recording itself
    det = detect_scale(all_notes, refine=True,
                       tonic_pc=parse_tonic(tonic) if tonic else None, mode=mode)
    scale = scale_summary(det)

    # d(2). quantize to the estimated scale
    q: dict[str, list[QNote]] = {label: pentatonic_quantize(ns, det, tol=tol_cents)
                                 for label, ns in notes.items() if ns}

    # e. rhythm on the full mix
    t0 = time.time()
    beat_times = track_beats(wav)
    tempo_halved = False
    shift = 0
    if len(beat_times) >= 2 * MIN_BEATS_FOR_GRID and median_bpm(beat_times) > MAX_BPM:
        beat_times, sub, tempo_halved = beat_times[::2], sub * 2, True  # same grid resolution
    if len(beat_times) >= MIN_BEATS_FOR_GRID:
        grid_kind, bpm = "beat-tracked", median_bpm(beat_times)
        # one pickup shift for the whole score, so the staves stay aligned
        shift = pickup_shift_beats([x.start for x in all_notes], beat_times, sub=sub)

        def snap(qs, label=None):
            return snap_notes_monophonic([x.start for x in qs], [x.end for x in qs], beat_times,
                                         sub=sub, bar_shift=shift,
                                         min_rest_ql=0.5 if legato_for.get(label) else 0.0)
    else:
        grid_kind, bpm = "fixed", estimate_bpm(wav)

        def snap(qs, label=None):
            return None
    timings["rhythm"] = round(time.time() - t0, 1)

    # f. outputs
    order = [VOICE, OUD] if VOICE in q else [OUD]
    parts = [(label, q[label], snap(q[label], label)) for label in order if label in q]
    sc = scale["scale_cents"] or scale["scale_cents_template"]
    scale_text = ((f"tonic ambiguous: {scale['tonic_label']}" if scale["tonic_ambiguous"] else f"Tonic {scale['tonic_name']}")
                  + (" (pinned)" if scale["override"] else "")
                  + f" ({scale['tuning_offset_cents'] + scale['tonic_refined_offset_cents']:+.0f}c); "
                  f"scale {'/'.join(f'{c:.0f}' for c in sc)}c above tonic; "
                  f"red = off-scale, deviation shown")
    t0 = time.time()
    xml = out / f"{stem}.musicxml"
    score = build_score(parts, det, bpm, xml, title=stem, scale_text=scale_text)
    score.write("midi", fp=str(out / f"{stem}.mid"))
    render = render_pdf(xml, out / f"{stem}.pdf") if pdf else {"renderer": "skipped"}
    timings["notation"] = round(time.time() - t0, 1)

    # g. report
    pcs = {}
    for label, ns in notes.items():
        if ns:
            pcs[label] = round(pcs_of_notes(ns, det, tol=tol_cents), 3)
    pcs["overall"] = round(pcs_of_notes(all_notes, det, tol=tol_cents), 3)
    n_marked = sum(1 for qs in q.values() for x in qs if x.marked)
    n_total = sum(len(qs) for qs in q.values())
    n_snapped = sum(1 for qs in q.values() for x in qs if x.snapped)
    mean_fit = float(np.mean([x.confidence for qs in q.values() for x in qs])) if n_total else 0.0
    timings["total"] = round(time.time() - t_all, 1)

    def note_rows(label: str) -> list[dict]:
        qs = q[label]
        g = snap(qs, label)
        rows = []
        for i, x in enumerate(qs):
            rows.append({
                "staff": label, "start": round(x.start, 3), "end": round(x.end, 3),
                "midi": x.midi, "cents": round(x.cents, 1), "rel_cents": x.rel_cents,
                "degree": x.degree, "deviation_cents": x.deviation_cents,
                "snapped": x.snapped, "marked": x.marked,
                "crepe_confidence": round(float(crepe_conf[label][i]), 3),
                "scale_fit_confidence": round(float(x.confidence), 3),
                "amp": round(x.amp, 3),
                "offset_ql": round(float(g[0][i]), 3) if g is not None else None,
                "duration_ql": round(float(g[1][i]), 3) if g is not None else None,
                "engraved": bool(g[2][i]) if g is not None else True,
            })
        return rows

    result = {
        "file": audio.name, "input_wav": wav.name, "duration_sec": round(duration, 1),
        "excerpt_sec": excerpt_sec, "instrumental": instrumental,
        "separation": sep,
        "stems": {k: {kk: vv for kk, vv in v.items() if kk != "frames"} for k, v in stem_info.items()},
        "raw_pitch": {k: v["frames"] for k, v in stem_info.items()},
        "scale": scale,
        "tempo": {"bpm": round(bpm), "grid": grid_kind, "n_beats": int(len(beat_times)),
                  "subdivision_per_beat": sub, "tempo_halved_from_tracker": tempo_halved,
                  "beats_per_bar": 4, "pickup_shift_beats": int(shift),
                  # the beat grid the score was snapped to, in seconds of the input
                  "beat_times": [round(float(t), 3) for t in beat_times]},
        "quantization": {"tolerance_cents": tol_cents, "min_confidence": min_conf,
                         "min_note_ms": min_note_ms, "n_notes": n_total,
                         "n_marked_off_scale": n_marked, "legato": legato_for},
        "pcs_of_kept_notes": pcs,
        "outputs": {"musicxml": xml.name, "midi": f"{stem}.mid", "json": f"{stem}.json",
                    "pdf": f"{stem}.pdf" if render.get("renderer") == "musescore-4" else None,
                    "svg": f"{stem}.svg" if render.get("svg") else None, "render": render},
        # The short form the notation service and the web page read.
        "summary": {"tonic": scale["tonic_name"], "mode": scale["mode"], "degrees": scale["degrees_pc"],
                    "scale_cents": sc, "tuning_offset_cents": scale["tuning_offset_cents"],
                    "bpm": round(bpm), "n_notes": n_total, "snapped": n_snapped,
                    "marked_outliers": n_marked, "mean_confidence": round(mean_fit, 3),
                    "pcs": pcs["overall"], "staves": [label for label in order if label in q]},
        "timings_sec": timings,
        "notes": [row for label in order if label in q for row in note_rows(label)],
    }
    (out / f"{stem}.json").write_text(json.dumps(result, indent=1))
    per_staff = ", ".join(f"{label}: {len(q[label])}" for label in order if label in q)
    report = "\n".join([
        f"file: {audio.name} ({duration:.0f} s{', excerpt' if excerpt_sec else ''})",
        f"tonic: {scale['tonic_name']}{' (pinned by --tonic/--mode)' if scale['override'] else ''} "
        f"(tape offset {scale['tuning_offset_cents']:+.1f} c, "
        f"refined {scale['tonic_refined_offset_cents']:+.1f} c; {scale['tonic_hz_c4_octave']} Hz in the C4 octave)"
        + (f"; tonic ambiguous: {scale['tonic_label']} (r {det['score']:.3f} vs "
           f"{scale['tonic_runner_up']['score']:.3f})" if scale["tonic_ambiguous"] else "")
        + (f"; runner-up {scale['tonic_alternatives'][1]['tonic_name']} mode {scale['tonic_alternatives'][1]['mode']} "
           f"(r {scale['tonic_alternatives'][0]['score']:.3f} vs {scale['tonic_alternatives'][1]['score']:.3f})"
           if scale.get("tonic_alternatives") and len(scale["tonic_alternatives"]) > 1 else ""),
        f"scale (cents above tonic): {sc}  template: {scale['scale_cents_template']}",
        f"degrees refined from the recording: {scale['scale_degree_refined']}  mass: {scale['scale_degree_mass']}",
        f"PCS of kept notes: {pcs}",
        f"notes: {n_total} ({per_staff}); off-scale kept and marked: {n_marked}",
        f"tempo: {round(bpm)} BPM{' (tracker pulse halved)' if tempo_halved else ''}, {grid_kind} grid, "
        f"{len(beat_times)} beats, 1/{sub} beat subdivision",
        f"separation: {sep.get('device', 'skipped')}"
        + (f" ({sep['seconds']} s)" if sep.get("used") else "") + f"; oud reduced to one line: {OUD in stem_info}",
        f"render: {render.get('renderer')} -> {render.get('path', '-')}",
        f"time: {timings}",
    ])
    (out / "report.txt").write_text(report + "\n")
    print(report)
    return result


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Somali-aware transcription to sheet music")
    ap.add_argument("audio")
    ap.add_argument("out_dir", nargs="?", help="(alias for --out)")
    ap.add_argument("--out", help="output directory")
    ap.add_argument("--instrumental", action="store_true",
                    help="no separation; the whole mix is the oud stem (one staff)")
    ap.add_argument("--tol", type=float, default=50.0, help="snap tolerance in cents")
    ap.add_argument("--sub", type=int, default=2, help="grid subdivisions per beat (2 = eighths)")
    ap.add_argument("--min-conf", type=float, default=0.6,
                    help="CREPE confidence a note needs to be kept (default 0.6; lower keeps "
                         "more, fainter notes; higher keeps fewer, surer ones)")
    ap.add_argument("--tonic", default=None,
                    help="pin the tonic (e.g. D, F#, Bb) when the histogram is ambiguous")
    ap.add_argument("--mode", type=int, default=None, choices=range(5),
                    help="pin the pentatonic mode 0-4 (rotation of the anhemitonic set)")
    ap.add_argument("--min-note-ms", type=float, default=100.0)
    ap.add_argument("--excerpt-sec", type=float, default=None)
    ap.add_argument("--device", default="auto", help="demucs device: auto|mps|cpu")
    ap.add_argument("--pitch-device", default=None,
                    help="CREPE device: cpu for exactly repeatable output, mps (default) for speed")
    ap.add_argument("--legato", action=argparse.BooleanOptionalAction, default=None,
                    help="sustain plucked notes through the ring-out, merge re-attacks under 120 ms, "
                         "and write no rest shorter than an eighth (default: on for oud stems, "
                         "off for the voice; --no-legato restores the earlier behaviour)")
    ap.add_argument("--no-pdf", action="store_true")
    a = ap.parse_args(argv)
    out = a.out or a.out_dir
    if not out:
        ap.error("--out <dir> is required")
    transcribe_file(a.audio, out, instrumental=a.instrumental, tol_cents=a.tol, sub=a.sub,
                    min_conf=a.min_conf, min_note_ms=a.min_note_ms, excerpt_sec=a.excerpt_sec,
                    device=a.device, pitch_device=a.pitch_device, pdf=not a.no_pdf,
                    tonic=a.tonic, mode=a.mode, legato=a.legato)
    return 0


if __name__ == "__main__":
    sys.exit(main())
