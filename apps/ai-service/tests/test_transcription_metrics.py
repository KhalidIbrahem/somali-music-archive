"""Synthetic benchmark example: a corrected score with two unverified notes
against an estimate with one miss, one wrong pitch, one spurious note and one
onset inside the tolerance."""
import json

from scripts.transcription_metrics import (
    load_json_notes, load_musicxml_notes, match_notes, note_metrics, scale_accuracy,
)

REF = ["A4", "C5", "D5", "E5", "G5", "A5", "G5", "E5", "D5", "C5"]  # A minor pentatonic


def _write_ref(path):
    from music21 import instrument, note, stream

    part = stream.Part(id="Voice"); part.partName = "Voice"; part.insert(0, instrument.Vocalist())
    for i, p in enumerate(REF):
        n = note.Note(p, quarterLength=1.0)
        if i in (3, 7):
            n.style.color = "#0000FF"  # annotator unsure: unverified
        part.insert(i, n)
    s = stream.Score(); s.append(part); s.write("musicxml", fp=str(path))


def _estimate():
    from music21 import pitch

    rows = []
    for i, p in enumerate(REF):
        if i == 5:
            continue  # missed note
        cents = pitch.Pitch(p).midi * 100.0
        if i == 2:
            cents += 300  # wrong pitch
        onset = i + (0.2 if i == 4 else 0.0)  # inside the 0.25 ql tolerance
        rows.append({"staff": "Voice", "onset_ql": onset, "duration_ql": 1.0, "cents": cents, "verified": True})
    rows.append({"staff": "Voice", "onset_ql": 9.5, "duration_ql": 0.5, "cents": 6900.0, "verified": True})  # spurious
    return rows


def test_note_metrics_on_the_synthetic_example(tmp_path):
    ref_path = tmp_path / "ref.musicxml"; _write_ref(ref_path)
    ref = load_musicxml_notes(ref_path)
    assert len(ref) == 10 and sum(not r["verified"] for r in ref) == 2
    est = _estimate()
    m = note_metrics(ref, est, onset_tol=0.25, pitch_tol=50.0)["overall"]
    # 8 verified refs; estimate has 10 notes, of which 2 sit on unverified refs and are ignored,
    # leaving 8: 6 correct (0,1,4,6,8,9), 1 wrong pitch (2), 1 spurious (9.5)
    op = m["onset_pitch"]
    assert (op["n_ref"], op["n_est"], op["n_match"]) == (8, 8, 6)
    assert op["precision"] == 0.75 and op["recall"] == 0.75 and op["f1"] == 0.75
    oo = m["onset_only"]
    assert oo["n_match"] == 7  # the wrong-pitch note still matches on onset
    assert m["n_unverified_ref"] == 2


def test_matching_is_one_to_one_and_respects_tolerances():
    ref = [{"staff": "V", "onset_ql": 0.0, "cents": 6900.0, "verified": True}]
    est = [{"staff": "V", "onset_ql": 0.1, "cents": 6900.0, "verified": True},
           {"staff": "V", "onset_ql": 0.05, "cents": 6900.0, "verified": True}]
    assert len(match_notes(ref, est, 0.25, 50.0)) == 1
    assert match_notes(ref, [{"staff": "V", "onset_ql": 0.5, "cents": 6900.0}], 0.25, 50.0) == []
    assert match_notes(ref, [{"staff": "V", "onset_ql": 0.0, "cents": 6980.0}], 0.25, 50.0) == []


def test_scale_accuracy_reports_tonic_and_degree_errors():
    ref = {"tonic_name": "A", "scale_cents": [0, 300, 500, 700, 1000]}
    good = scale_accuracy({"tonic_pc": 9, "scale_cents": [0, 302, 497, 704, 1000]}, ref)
    assert good["tonic_correct"] and good["degree_set_correct"] and good["mean_abs_degree_error_cents"] < 5
    wrong_tonic = scale_accuracy({"tonic_pc": 0, "scale_cents": [0, 200, 400, 700, 900]}, ref)  # C major pentatonic = same pitch set
    assert not wrong_tonic["tonic_correct"] and wrong_tonic["degree_set_correct"]
    off = scale_accuracy({"tonic_pc": 9, "scale_cents": [0, 200, 400, 700, 900]}, ref)
    assert not off["degree_set_correct"] and off["max_abs_degree_error_cents"] >= 100


def test_json_loader_skips_unengraved_notes(tmp_path):
    d = {"notes": [{"staff": "Oud", "offset_ql": 0.0, "duration_ql": 1.0, "cents": 5700.0, "engraved": True},
                   {"staff": "Oud", "offset_ql": 0.0, "duration_ql": 1.0, "cents": 5900.0, "engraved": False}]}
    p = tmp_path / "e.json"; p.write_text(json.dumps(d))
    assert len(load_json_notes(p)) == 1
