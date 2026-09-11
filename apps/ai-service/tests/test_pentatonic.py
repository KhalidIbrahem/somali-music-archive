import numpy as np
import pytest

from scripts.pentatonic import (
    MODES,
    detect_from_events,
    detect_tonic,
    hist_from_events,
)


def test_modes_are_five_distinct_rotations():
    assert len(MODES) == 5
    assert len(set(MODES)) == 5
    assert all(len(m) == 5 and m[0] == 0 for m in MODES)


def test_c_major_pentatonic_root_emphasis_wins():
    # C D E G A with C emphasized by duration -> tonic C, mode 0
    pitches = [60, 62, 64, 67, 69, 72, 60]
    durs = [2.0, 1.0, 1.0, 1.0, 1.0, 1.0, 2.0]
    res = detect_from_events(np.array(pitches), np.array(durs))
    assert res["tonic_name"] == "C"
    assert res["mode"] == 0
    assert res["degrees"] == [0, 2, 4, 7, 9]


def test_a_minor_pentatonic_same_pcs_different_root():
    # Same pitch classes as C major pentatonic, but A emphasized -> tonic A
    pitches = [57, 60, 62, 64, 67, 69, 57]
    durs = [2.5, 1.0, 1.0, 1.0, 1.0, 1.0, 2.5]
    res = detect_from_events(np.array(pitches), np.array(durs))
    assert res["tonic_name"] == "A"
    assert set(res["degrees"]) == {9, 0, 2, 4, 7}


def test_transposition_invariance():
    rng = np.random.default_rng(7)
    base = np.array([0, 2, 4, 7, 9])
    for shift in range(12):
        pitches = 60 + ((base + shift) % 12)
        durs = np.array([2.0, 1.0, 1.0, 1.0, 1.0])
        res = detect_from_events(pitches + rng.integers(0, 1), durs)
        assert res["tonic_pc"] == (60 + shift) % 12


def test_beerdilacshe_modal_root_case():
    """Modal-root artifact (the Beerdilacshe case, synthetic — the real Qarshe
    recording is not in the local subset): a C-pentatonic melody centered on a
    non-tonic degree. A Western major-profile detector would call this F major
    ("apparent Fa"); our detector must pick a root INSIDE the sounding set and
    keep all five degrees, so no note is flagged as a scale violation."""
    # PCs {C,D,E,G,A} with G heavily emphasized (modal center), C barely present
    pitches = [67, 69, 72, 74, 76, 67, 79, 67]  # G A C D E G G' G
    durs = [3.0, 1.0, 0.5, 1.0, 1.0, 2.0, 1.0, 3.0]
    res = detect_from_events(np.array(pitches), np.array(durs))
    assert res["tonic_pc"] in {0, 2, 4, 7, 9}  # root within the sounding set — never F(5)
    assert res["tonic_name"] == "G"
    assert set(res["degrees"]) == {0, 2, 4, 7, 9}


def test_empty_histogram_raises():
    with pytest.raises(ValueError):
        detect_tonic(np.zeros(12))


def test_hist_from_events_duration_weighting():
    h = hist_from_events(np.array([60, 62]), np.array([3.0, 1.0]))
    assert h[0] == 3.0 and h[2] == 1.0 and h.sum() == 4.0


def test_refine_scale_cents_finds_a_just_third_and_keeps_unsung_degrees():
    from scripts.pentatonic import refine_scale_cents, scale_cents_template

    det = {"tonic_pc": 0, "degrees": [0, 2, 4, 7, 9]}
    assert scale_cents_template(det) == [0, 200, 400, 700, 900]
    rng = np.random.default_rng(0)
    # tonic on C, a third sung at 386 cents (just intonation), a fifth at 700;
    # the second and sixth degrees never occur
    cents = np.concatenate([6000 + rng.normal(0, 4, 200),
                            6386 + rng.normal(0, 4, 150),
                            6700 + rng.normal(0, 4, 100)])
    r = refine_scale_cents(cents, np.ones_like(cents), det)
    assert r["scale_cents"][0] == 0.0
    assert abs(r["scale_cents"][2] - 386) < 6
    assert abs(r["scale_cents"][3] - 700) < 6
    assert r["scale_degree_refined"] == [True, False, True, True, False]
    assert r["scale_cents"][1] == 200.0 and r["scale_cents"][4] == 900.0
    assert abs(r["tonic_refined_offset_cents"]) < 3


def test_refine_scale_cents_is_relative_to_the_refined_tonic():
    from scripts.pentatonic import refine_scale_cents

    det = {"tonic_pc": 9, "degrees": [9, 11, 1, 4, 6]}  # A major pentatonic
    rng = np.random.default_rng(1)
    # everything sits 12 cents sharp of 12-TET: the tonic absorbs the shift
    cents = np.concatenate([5712 + rng.normal(0, 3, 100), 5912 + rng.normal(0, 3, 80),
                            6412 + rng.normal(0, 3, 60)])
    r = refine_scale_cents(cents, np.ones_like(cents), det)
    assert abs(r["tonic_refined_offset_cents"] - 12) < 3
    assert abs(r["scale_cents"][1] - 200) < 4 and abs(r["scale_cents"][3] - 700) < 4


def test_detect_tonic_lists_the_runner_up_readings():
    hist = np.zeros(12)
    for pc, wgt in ((0, 3.0), (2, 1.0), (4, 1.0), (7, 1.5), (9, 1.0)):  # C major pentatonic, C emphasised
        hist[pc] = wgt
    det = detect_tonic(hist)
    alts = det["alternatives"]
    assert alts[0]["tonic_name"] == det["tonic_name"] == "C" and len(alts) == 3
    assert alts[0]["score"] >= alts[1]["score"] >= alts[2]["score"]


def test_detect_tonic_can_be_pinned_and_reports_the_other_tonic():
    hist = np.zeros(12)
    for pc, wgt in ((2, 2.0), (5, 2.0), (7, 1.0), (9, 1.5), (0, 1.5)):  # D F G A C: D minor / F major pentatonic
        hist[pc] = wgt
    free = detect_tonic(hist)
    other = free["runner_up_other_tonic"]
    assert other is not None and other["tonic_name"] != free["tonic_name"]
    assert {free["tonic_name"], other["tonic_name"]} <= {"D", "F", "A", "C", "G"}
    pinned = detect_tonic(hist, tonic_pc=5)  # F
    assert pinned["tonic_name"] == "F" and pinned["constrained"] == {"tonic_pc": 5, "mode": None}
    assert pinned["unconstrained"]["tonic_name"] == free["tonic_name"]
    assert sorted(pinned["degrees"]) == sorted(free["degrees"])  # same pitch set, different root
    pinned_mode = detect_tonic(hist, tonic_pc=2, mode=4)
    assert pinned_mode["mode"] == 4 and pinned_mode["tonic_name"] == "D"
