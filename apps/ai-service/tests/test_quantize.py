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


def test_detect_scale_refine_reports_tonic_relative_cents():
    det = detect_scale(c_pent_melody(), refine=True)
    assert det["scale_cents_template"] == [0, 200, 400, 700, 900]
    assert det["scale_cents"][0] == 0.0
    assert all(abs(a - b) < 10 for a, b in zip(det["scale_cents"], det["scale_cents_template"]))
    assert "scale_cents" not in detect_scale(c_pent_melody())  # off by default


def test_every_note_carries_signed_deviation_and_degree():
    det = detect_scale(c_pent_melody())
    e_sharp, g_flat = pentatonic_quantize(_mk([6418, 6675]), det)
    assert e_sharp.degree == 2 and abs(e_sharp.deviation_cents - 18) < 0.6 and e_sharp.snapped
    assert g_flat.degree == 3 and abs(g_flat.deviation_cents + 25) < 0.6 and g_flat.snapped
    assert abs(e_sharp.rel_cents - 418) < 0.6
    outlier = pentatonic_quantize(_mk([6560]), det)[0]  # 140 cents under G: too far
    assert outlier.marked and not outlier.snapped
    assert outlier.degree == 3 and abs(outlier.deviation_cents + 140) < 0.6
    assert outlier.cents == 6560  # original pitch untouched


def test_quantize_snaps_to_the_refined_degree_not_12tet():
    det = detect_scale(c_pent_melody())
    det["scale_cents"] = [0.0, 200.0, 386.0, 700.0, 900.0]  # a just third measured from the recording
    q = pentatonic_quantize(_mk([6390]), det)[0]
    assert q.snapped and abs(q.cents - 6386) < 0.01
    assert abs(q.deviation_cents - 4) < 0.01 and q.midi == 64
