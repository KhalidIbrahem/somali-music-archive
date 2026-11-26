"""Separation and restoration on synthetic signals whose true parts are known."""

import numpy as np

from scripts.portfolio_dsp import (
    SR,
    add_noise,
    learn_dictionary,
    nmf,
    separate,
    si_sdr,
    snr_db,
    synth_oud,
    synth_voice,
    tape_noise,
)
from scripts.restore_clips import restore

SCALE = [57, 60, 62, 64, 67, 69, 72]
SECONDS = 8.0


def melody(step: float, seed: int, hold: float) -> list[tuple[float, float, float]]:
    rng = np.random.default_rng(seed)
    return [(i * step, step * hold, SCALE[rng.integers(0, len(SCALE))]) for i in range(int(SECONDS / step) - 1)]


def test_nmf_keeps_fixed_bases_and_stays_non_negative():
    rng = np.random.default_rng(0)
    V = rng.random((40, 30))
    fixed = rng.random((40, 5))
    W, H = nmf(V, 3, W_fixed=fixed.copy(), n_iter=20)
    assert np.array_equal(W[:, :5], fixed)
    assert W.min() >= 0 and H.min() >= 0
    assert W.shape == (40, 8) and H.shape == (8, 30)


def test_nmf_reduces_the_error():
    V = np.random.default_rng(1).random((40, 30))
    err = lambda n: np.abs(V - np.matmul(*nmf(V, 6, n_iter=n))).mean()  # noqa: E731
    assert err(100) < err(2)


def test_separation_recovers_both_sources_and_they_add_up_to_the_mixture():
    train = synth_oud(melody(0.3, 10, 2.5), SECONDS)  # a different melody from the mixture's
    oud = synth_oud(melody(0.35, 20, 2.5), SECONDS)
    voice = 0.8 * synth_voice(melody(0.7, 30, 0.95), SECONDS)
    mix = oud + voice
    W = learn_dictionary(train, 60)
    oud_hat, voice_hat = separate(mix, W, 16)
    assert si_sdr(oud_hat, oud) > si_sdr(mix, oud) + 5.0
    assert si_sdr(voice_hat, voice) > si_sdr(mix, voice) + 4.0
    assert np.abs(oud_hat + voice_hat - mix).max() < 1e-3


def test_restoration_raises_the_snr_of_a_noisy_tape():
    clean = synth_oud(melody(0.35, 20, 2.5), SECONDS)
    noisy = add_noise(clean, tape_noise(len(clean)), 10.0)
    assert abs(snr_db(noisy, clean) - 10.0) < 0.1
    restored = restore(noisy, SR, alpha=2.0, max_atten_db=18.0)
    assert snr_db(restored, clean) > 16.0
