from scripts.pick_benchmark_items import eligible, pick


def _row(slug, source, tonic, pcs, n, marked=5, vv=None, amb=False, refined=True, err=None):
    return {"slug": slug, "source": source, "tonic": tonic, "tonic_label": tonic, "pcs": pcs, "n_notes": n,
            "n_marked": marked, "voice_voiced_fraction": vv, "tonic_ambiguous": amb,
            "degree_refined": [True, True, True, refined, True], "duration_s": 120.0, "excerpt_sec": None,
            "error": err, "runtime_s": 1.0}


def test_pick_prefers_clean_items_mixes_tonics_and_keeps_two_vocal_items():
    rows = [
        _row("oud_a", "oud", "A", 0.96, 400),
        _row("oud_b", "oud", "A", 0.95, 390),          # same tonic as oud_a: skipped while others remain
        _row("oud_c", "oud", "D", 0.94, 380),
        _row("oud_d", "oud", "G", 0.80, 380),          # low PCS: ineligible
        _row("oud_e", "oud", "C", 0.93, 30),           # too few notes: ineligible
        _row("band_f", "band", "F", 0.97, 90, vv=0.40),
        _row("band_g", "band", "E", 0.90, 80, vv=0.30),
        _row("band_h", "band", "B", 0.99, 95, vv=0.10),  # voice barely voiced: ineligible
        _row("band_i", "band", "C", 0.98, 100, vv=0.5, amb=True),  # ambiguous tonic: ineligible
        _row("oud_j", "oud", "E", 0.92, 300, err="timeout"),
    ]
    chosen = [r["slug"] for r in pick(rows, n=5, min_vocal=2)]
    assert chosen[:2] == ["band_f", "band_g"]
    assert set(chosen) == {"band_f", "band_g", "oud_a", "oud_c", "oud_b"}
    assert chosen.index("oud_b") == 4  # only taken once the one-per-tonic rule is relaxed
    ok, why = eligible(rows[7])
    assert not ok and any("voiced" in w for w in why)
    assert eligible(rows[9]) == (False, ["failed"])
