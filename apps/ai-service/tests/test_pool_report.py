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


def test_pool_items_with_identical_content_are_folded(monkeypatch, tmp_path):
    import json
    from scripts import transcribe_pool as tp

    inv = tmp_path / "data" / "inventory"
    inv.mkdir(parents=True)
    rows = [{"name": "a.m4a", "path": "/x/a.m4a", "duration_s": 10, "sha256_16": "abcdef0123456789"},
            {"name": "a copy.m4a", "path": "/x/a copy.m4a", "duration_s": 10, "sha256_16": "abcdef0123456789"},
            {"name": "b.m4a", "path": "/x/b.m4a", "duration_s": 12, "sha256_16": "0123456789abcdef"}]
    (inv / "oud_ilkacase.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    monkeypatch.setattr(tp, "REPO", tmp_path)
    items = tp.load_items(["oud"])
    assert [it["name"] for it in items] == ["a.m4a", "b.m4a"]


def test_report_and_pick_fold_rows_that_share_audio():
    from scripts.pick_benchmark_items import pick
    from scripts.pool_report import fold_duplicates

    minor = [0, 300, 500, 700, 1000]
    a = _row("oud_abcd1234_song", "oud", "A", 4, minor, minor, [True] * 5, 0.99, 400, 4, 0.5, False)
    a2 = _row("oud_abcd1234_song_copy", "oud", "A", 4, minor, minor, [True] * 5, 0.99, 400, 4, 0.5, False)
    b = _row("oud_9999ffff_other", "oud", "D", 4, minor, minor, [True] * 5, 0.97, 300, 3, 0.5, False)
    kept, folded = fold_duplicates([a2, a, b])
    assert folded == 1 and [r["slug"] for r in kept] == ["oud_9999ffff_other", "oud_abcd1234_song"]
    assert "1 pool rows were files with the same audio" in build_report([a, a2, b], "d")
    assert "| A | 1 |" in build_report([a, a2, b], "d")
    assert [r["slug"] for r in pick([a, a2, b], n=5, min_vocal=0)] == ["oud_abcd1234_song", "oud_9999ffff_other"]
