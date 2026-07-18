import numpy as np
import pytest

from scripts.quantize import (
    Note,
    detect_scale,
    pcs_of_notes,
    pentatonic_quantize,
    western_correct,
)


def _mk(cents_list, dur=0.5):
    return [Note(start=i * dur, end=(i + 1) * dur, midi=int(round(c / 100)),
                 amp=0.8, cents=c) for i, c in enumerate(cents_list)]


def c_pent_melody(extra=()):
    # C4 D4 E4 G4 A4 C5 with tonic emphasized, in cents
    base = [6000, 6000, 6200, 6400, 6700, 6900, 7200]
    return _mk(base + list(extra))


def test_detect_scale_c_pentatonic():
    det = detect_scale(c_pent_melody())
    assert det["tonic_name"] == "C"
    assert det["degrees"] == [0, 2, 4, 7, 9]
    assert abs(det["tuning_offset_cents"]) < 1


def test_detect_scale_finds_tape_detuning():
    det = detect_scale(_mk([c + 30 for c in [6000, 6000, 6200, 6400, 6700, 6900]]))
    assert abs(det["tuning_offset_cents"] - 30) < 2
    assert det["tonic_name"] == "C"


def test_quantize_snaps_near_and_marks_far():
    notes = c_pent_melody(extra=[6430, 6580])  # +30c off E (snap), 6580 = 80c off (mark)
    det = detect_scale(c_pent_melody())
    det["tuning_offset_cents"] = 0.0
    q = pentatonic_quantize(notes, det, tol=50)
    near, far = q[-2], q[-1]
    assert near.snapped and not near.marked and near.cents == 6400
    assert far.marked and not far.snapped and far.cents == 6580  # preserved, not "corrected"
    assert near.confidence > far.confidence
    assert far.confidence < 0.5


def test_quantized_output_is_fully_conformant_but_outliers_stay():
    notes = c_pent_melody(extra=[6580])
    det = detect_scale(c_pent_melody())
    det["tuning_offset_cents"] = 0.0
    q = pentatonic_quantize(notes, det, tol=50)
    snapped_only = [n for n in q if n.snapped]
    assert pcs_of_notes(snapped_only, det) == 1.0
    assert pcs_of_notes(q, det) < 1.0  # marked outlier still off-grid — by design


def test_western_correction_destroys_offgrid_inflection():
    # the 6580 inflection gets forcibly snapped to SOME 12-TET diatonic pitch
    notes = c_pent_melody(extra=[6580])
    corrected, key = western_correct(notes)
    assert all(abs(n.cents % 100) < 1e-6 for n in corrected)
    det = detect_scale(c_pent_melody())
    det["tuning_offset_cents"] = 0.0
    # the inflected note is gone — replaced by an exact 12-TET pitch
    assert corrected[-1].cents in (6500.0, 6600.0)


def test_western_key_estimate_is_reasonable():
    _, key = western_correct(c_pent_melody())
    assert key.split()[0] in {"C", "F", "G", "A"}  # C-pent PCs fit these keys best
