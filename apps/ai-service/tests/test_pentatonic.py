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
