"""Pure parts of scripts/transcribe.py: no audio, no CREPE, no MuseScore."""
import numpy as np

from scripts.quantize import Note, detect_scale, pentatonic_quantize
from scripts.transcribe import OUD, VOICE, build_score, key_for_scale, scale_summary


def _notes(cents_list, dur=0.5, t0=0.0):
    return [Note(start=t0 + i * dur, end=t0 + (i + 1) * dur, midi=int(round(c / 100)),
                 amp=0.8, cents=c) for i, c in enumerate(cents_list)]


def test_key_for_scale_picks_minor_for_a_minor_pentatonic_mode():
    assert key_for_scale("A", [0, 300, 500, 700, 1000]).sharps == 0  # A minor, not A major
    assert key_for_scale("C", [0, 200, 400, 700, 900]).sharps == 0  # C major
    assert key_for_scale("A", [0, 200, 400, 700, 900]).sharps == 3  # A major pentatonic


def test_scale_summary_reports_cents_relative_to_the_tonic():
    det = detect_scale(_notes([6000, 6000, 6200, 6400, 6700, 6900, 7200]), refine=True)
    s = scale_summary(det)
    assert s["tonic_name"] == "C" and s["scale_cents"][0] == 0.0
    assert s["scale_cents_template"] == [0, 200, 400, 700, 900]
    assert abs(s["tonic_hz_c4_octave"] - 261.63) < 2


def test_build_score_two_staves_single_voice_and_signed_lyrics(tmp_path):
    from music21 import converter

    melody = _notes([6900, 6900, 7100, 7300, 7600, 7800, 8100])  # A pentatonic, sung
    det = detect_scale(melody)
    voice = pentatonic_quantize(melody + _notes([7160], t0=3.5), det)   # one note 140c under G5... nearest A5? -> marked
    oud = pentatonic_quantize(_notes([5700, 5900, 6100, 6400, 6600]), det)
    beats = np.arange(0.0, 8.0, 0.5)
    from scripts.beat_grid import snap_notes_monophonic

    def grid(qs):
        return snap_notes_monophonic([q.start for q in qs], [q.end for q in qs], beats, sub=2)

    xml = tmp_path / "t.musicxml"
    build_score([(VOICE, voice, grid(voice)), (OUD, oud, grid(oud))], det, 120.0, xml,
                title="t", scale_text="scale")
    text = xml.read_text()
    assert "<voice>0</voice>" not in text
    score = converter.parse(str(xml))
    assert [p.partName for p in score.parts] == [VOICE, OUD]
    lyrics = [ly.text for n in score.parts[0].recurse().notes for ly in n.lyrics]
    assert lyrics and all(t[0] in "+−" and t.endswith("c") for t in lyrics)
    assert all(len(m.voices) == 0 for p in score.parts for m in p.getElementsByClass("Measure"))
