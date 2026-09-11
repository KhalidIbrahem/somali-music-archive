from scripts.pool_report import build_report


def _row(slug, source, tonic, mode, sc, tp, ref, pcs, n, marked, ratio, amb, vv=None, dur=120.0, excerpt=None, err=None):
    return {"slug": slug, "source": source, "tonic": tonic, "mode": mode, "scale_cents": sc, "scale_cents_template": tp,
            "degree_refined": ref, "degree_mass": [0.3] * 5, "pcs": pcs, "n_notes": n, "n_marked": marked,
            "ratio_to_winner": ratio, "tonic_ambiguous": amb, "tonic_label": f"{tonic} (F)" if amb else tonic,
            "voice_voiced_fraction": vv, "duration_s": dur, "excerpt_sec": excerpt, "runtime_s": 60.0,
            "tuning_offset_cents": 5.0, "error": err, "pcs_voice": None if vv is None else pcs, "pcs_oud": pcs}


def test_report_counts_and_deviations_are_right():
    minor = [0, 300, 500, 700, 1000]
    rows = [
        _row("a", "oud", "A", 4, [0, 312, 502, 700, 1015], minor, [True] * 5, 0.95, 400, 20, 0.80, False),
        _row("b", "oud", "A", 4, [0, 308, 498, 702, 1013], minor, [True] * 5, 0.93, 380, 18, 0.99, True),
        _row("c", "band", "D", 4, [0, 300, 500, 700, 1000], minor, [True, True, True, False, True], 0.80, 30, 8, 0.70, False, vv=0.10, excerpt=90),
        _row("d", "band", "D", 4, None, None, None, None, None, None, None, False, err="timeout"),
    ]
    text = build_report(rows, "2026-09-10")
    assert "4 recordings attempted, 3 transcribed, 1 failed" in text
    assert "| A | 2 |" in text and "| D | 1 |" in text
    assert "1 of 3 recordings (33 percent)" in text  # ambiguity count
    # interval 300: deviations +12 and +8 over the two refined oud rows plus 0 from c -> n=3 mean +6.7
    assert "| 300 | n = 3, mean +6.7" in text
    # interval 700: c is not refined there -> n=2, not refined count 1
    assert "| 700 | n = 2, mean +1.0" in text and "| 1 |" in text
    assert "`c`" in text and "PCS below 0.85" in text and "voice stem voiced under 15 percent" in text
    assert "`d`" in text and "failed: timeout" in text
