"""Unit tests for scripts/ahmed_report.py: table rendering from fake eval JSONs
(including a missing run and a small-model test_ce.json), the head-to-head
table with its shared-source and per-source rows, corpus summaries from
captions / the real SET_CARD.md layout, the overlap-aware hours estimate, the
measured A/B clip length and the two figures. No corpus, GPU or network."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from scripts import ahmed_report as ar

SET_CARD = """# Set card: ahmed_oud

Built 2026-09-25T10:00:00-05:00 by `scripts/build_sets.py`.

- Rights: `ahmed_ilkacase_consented` — Ahmed Ilkacase's own sessions, consented for training.
- Source files: 41 (unique songs by sha256: 41, song groups: 30)
- Source audio: 5.43 h (manifest/inventory durations)
- Clips: 1240 × 30 s = 10.33 h
- Clips per split: {"train": 990, "val": 120, "test": 130}
"""


def _eval_json(tag: str, base: float, adapter: float, headtohead: dict | None = None, seconds: int | None = 30) -> dict:
    d = base - adapter
    out = {
        "tag": tag, "model": "facebook/musicgen-large", "run": f"/x/runs/{tag}", "best_ckpt": "ckpt_step_2750",
        "test_clips": 64, "test_songs": 9,
        "per_song_ce": {"n_songs": 9, "base": {"mean": base, "ci95": [base - 0.2, base + 0.2]},
                        "adapter": {"mean": adapter, "ci95": [adapter - 0.2, adapter + 0.2]},
                        "improvement_base_minus_adapter": {"mean": round(d, 4), "ci95": [round(d - 0.03, 4), round(d + 0.03, 4)], "significant": d - 0.03 > 0}},
        "ab": {"dir": str(ar.REPO / f"data/ab_{tag}"), "n": 16,
               "base": {"pcs_mean": 0.81, "voiced_fraction_mean": 0.41, "n_scored": 16},
               "adapter": {"pcs_mean": 0.85, "voiced_fraction_mean": 0.52, "n_scored": 16},
               "pairs": [{"pair": 0, "caption": "x", "base": {}, "adapter": {}}]},
    }
    if seconds is not None:
        out["ab"]["seconds"] = seconds
    if headtohead:
        out["headtohead"] = headtohead
    return out


def _write_run(runs: Path, name: str, ev: dict | None, captions: Path, steps: int = 500, rank: int | None = 64, alpha: int | None = 128) -> None:
    d = runs / name
    d.mkdir(parents=True)
    (d / "config.json").write_text(json.dumps({"model": "facebook/musicgen-large", "captions": str(captions), "rank": rank, "alpha": alpha}))
    lines = ["step,train_loss,val_loss,lr,sec_per_step,mps_driver_gb", "0,,4.50,0.0,,8.0"]
    for s in range(1, steps + 1):
        lines.append(f"{s},{4.5 - s / steps:.4f},,1e-5,10.0,12.0")
        if s % 250 == 0:
            lines.append(f"{s},,{4.5 - 0.1 * s / 250:.4f},1e-5,,12.0")
    (d / "loss.csv").write_text("\n".join(lines) + "\n")
    if ev is not None:
        (d / f"eval_{name}.json").write_text(json.dumps(ev))


def _rows(src: str, n: int, songs: int, split: str = "train") -> list[dict]:
    return [{"clip_path": f"data/sets/{src}/clips/{split}/{src}_{i % songs:012d}_seg{i // songs:03d}.wav",
             "source": src, "split": split, "song_sha256": f"{src}-{i % songs}"} for i in range(n)]


@pytest.fixture
def fake_tree(tmp_path: Path) -> tuple[Path, Path]:
    runs = tmp_path / "runs"
    data = tmp_path / "data"
    (data / "sets" / "ahmed_oud").mkdir(parents=True)
    (data / "sets" / "ahmed_oud" / "SET_CARD.md").write_text(SET_CARD)
    caps = data / "sets" / "run_combined_large_captions.jsonl"
    rows = _rows("ahmed_oud", 10, 2) + _rows("harvard_full", 240, 20)
    caps.write_text("".join(json.dumps(r) + "\n" for r in rows))
    h2h = {"other_run": "/x/runs/ahmed_only_large", "other_ckpt": "ckpt_step_2500", "n_songs": 9,
           "sources": {"ahmed_mix": {"clips": 20, "songs": 3}, "ahmed_oud": {"clips": 40, "songs": 6}},
           "this": {"mean": 3.9, "ci95": [3.7, 4.1]}, "other": {"mean": 3.95, "ci95": [3.75, 4.15]},
           "difference_other_minus_this": {"mean": 0.05, "ci95": [0.02, 0.08], "significant": True},
           "per_source": {"ahmed_oud": {"n_songs": 6, "this": {"mean": 3.8, "ci95": [3.6, 4.0]}, "other": {"mean": 3.81, "ci95": [3.6, 4.0]},
                                        "difference_other_minus_this": {"mean": 0.01, "ci95": [-0.02, 0.04], "significant": False}},
                          "ahmed_mix": {"n_songs": 3, "this": {"mean": 4.1, "ci95": [3.9, 4.3]}, "other": {"mean": 4.23, "ci95": [4.0, 4.4]},
                                        "difference_other_minus_this": {"mean": 0.13, "ci95": [0.10, 0.16], "significant": True}}}}
    _write_run(runs, "ahmed_only", _eval_json("ahmed_only", 4.1, 3.98), caps, rank=32, alpha=64)
    _write_run(runs, "combined_large", _eval_json("combined_large", 4.05, 3.9, h2h), caps)
    # prior small-model run with test_ce.json only
    hr = runs / "harvard_raw_3000"
    hr.mkdir()
    (hr / "config.json").write_text(json.dumps({"model": "facebook/musicgen-small", "captions": str(caps), "frames": 750}))
    (hr / "test_ce.json").write_text(json.dumps({"test_ce": {"base": 4.8363, "step_2750": 4.7468, "step_3000": 4.7468}, "best_test_ckpt": "step_2750"}))
    return runs, data


def test_report_renders_present_missing_and_prior_rows(fake_tree: tuple[Path, Path]) -> None:
    runs, data = fake_tree
    md, ahmed, prior = ar.build_report(runs, data)
    assert md.startswith("# Ahmed Ilkacase corpus")
    # ahmed_oud has a card: its SOURCE-audio hours (5.43), never the card's 10.33 h window total;
    # harvard_full has none: ~(240 + 20 songs) x 15 s = 1.1 h, marked as an estimate
    assert ("| ahmed_only | musicgen-large (r32, α64) | ahmed_oud 10 clips (5.4 h), harvard_full 240 clips (~1.1 h) | ckpt_step_2750 | "
            "4.1000 → 3.9800 (Δ +0.120 [0.090, 0.150], n = 9 songs) | 0.410 → 0.520 | 0.8100 → 0.8500 | `data/ab_ahmed_only/` (16 pairs, 30 s) |") in md
    assert "| ahmed_only_large | not run |" in md and "| ahmed_melody | not run |" in md
    assert "| qaraami_medium_r32 | not run |" in md
    assert "| harvard_raw_3000 | musicgen-small | ahmed_oud 10 clips (5.4 h), harvard_full 240 clips (~0.5 h) |" in md
    assert "4.8363 → 4.7468 (Δ +0.089, clip mean, no CI)" in md
    assert [r.present for r in ahmed] == [True, False, True, False]
    assert [r.present for r in prior] == [False, False, True]
    assert ahmed[0].recipe == "r32, α64" and prior[2].recipe == ""


def test_report_headtohead_table_with_sources_and_per_source_rows(fake_tree: tuple[Path, Path]) -> None:
    runs, data = fake_tree
    md, _, _ = ar.build_report(runs, data)
    assert "| run | versus | shared sources (songs) | this CE | other CE | Δ other − this [95% CI] | songs | verdict |" in md
    assert ("| combined_large (ckpt_step_2750) | ahmed_only_large (ckpt_step_2500) | ahmed_mix 3, ahmed_oud 6 | 3.9000 | 3.9500 | "
            "+0.050 [0.020, 0.080] | 9 | this run lower CE |") in md
    assert "| ↳ ahmed_oud only | | ahmed_oud 6 | 3.8000 | 3.8100 | +0.010 [-0.020, 0.040] | 6 | no significant difference |" in md
    assert "| ↳ ahmed_mix only | | ahmed_mix 3 | 4.1000 | 4.2300 | +0.130 [0.100, 0.160] | 3 | this run lower CE |" in md


def test_headtohead_row_without_breakdown_says_so() -> None:
    rec = ar.RunRecord(run="r", present=True, best_ckpt="ckpt_step_0250",
                       headtohead={"other_run": "/x/o", "other_ckpt": "ckpt_step_0500", "n_songs": 4,
                                   "this": {"mean": 4.0}, "other": {"mean": 4.1},
                                   "difference_other_minus_this": {"mean": 0.1, "ci95": [-0.1, 0.3], "significant": False}})
    rows = ar.headtohead_rows([rec])
    assert rows == ["| r (ckpt_step_0250) | o (ckpt_step_0500) | all test sources (no breakdown recorded) | 4.0000 | 4.1000 | +0.100 [-0.100, 0.300] | 4 | no significant difference |"]


def test_report_headtohead_empty_when_no_run_has_it(tmp_path: Path) -> None:
    md, _, _ = ar.build_report(tmp_path / "runs", tmp_path / "data")
    assert "| not run | | | | | | | |" in md
    assert md.count("| not run |") == 8  # 4 Ahmed + 1 head-to-head + 3 prior


def test_write_report_writes_markdown_and_figures(fake_tree: tuple[Path, Path], tmp_path: Path) -> None:
    runs, data = fake_tree
    out = tmp_path / "docs" / "eval" / "AHMED_TABLES.md"
    figs = tmp_path / "docs" / "figures"
    ar.write_report(runs, data, out, figs)
    assert out.exists() and "![" in out.read_text() and "../figures/ahmed_loss_curves.png" in out.read_text()
    for name in ("ahmed_loss_curves.png", "ahmed_ce_improvement.png"):
        p = figs / name
        assert p.exists() and p.stat().st_size > 1000 and p.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_figures_survive_no_runs(tmp_path: Path) -> None:
    out = tmp_path / "AHMED_TABLES.md"
    ar.write_report(tmp_path / "runs", tmp_path / "data", out, tmp_path / "figs")
    assert (tmp_path / "figs" / "ahmed_loss_curves.png").exists() and (tmp_path / "figs" / "ahmed_ce_improvement.png").exists()


def test_set_card_hours_reads_source_audio_line_only(tmp_path: Path) -> None:
    (tmp_path / "sets" / "ahmed_oud").mkdir(parents=True)
    (tmp_path / "sets" / "ahmed_oud" / "SET_CARD.md").write_text(SET_CARD)
    assert ar.set_card_hours(tmp_path, "ahmed_oud") == 5.43
    (tmp_path / "sets" / "x").mkdir()
    (tmp_path / "sets" / "x" / "SET_CARD.md").write_text("# x\n\n- Clips: 40 × 30 s = 0.33 h\nTotal audio: 6.8 hours from 41 sources.\n")
    assert ar.set_card_hours(tmp_path, "x") is None  # no Source audio line: no card figure, the estimate is used
    assert ar.set_card_hours(tmp_path, "missing") is None


def test_estimate_hours_matches_the_documented_corpora() -> None:
    # data/scale_captions.jsonl: 9,662 30 s clips over 311 songs, documented as the 43 h corpus
    assert ar.estimate_hours(9662, 311) == pytest.approx(41.6, abs=0.1)
    # data/captions.jsonl: 11,386 15 s clips over 119 Harvard tracks, documented as ~24 h
    assert ar.estimate_hours(11386, 119, clip_seconds=15.0) == pytest.approx(24.0, abs=0.1)
    # one song, one clip: the whole window; two overlapping clips: one and a half windows
    assert ar.estimate_hours(1, 1) == pytest.approx(30 / 3600) and ar.estimate_hours(2, 1) == pytest.approx(45 / 3600)
    # without overlap the estimate is simply clips x window
    assert ar.estimate_hours(120, 5, overlap=0.0) == pytest.approx(1.0)


def test_corpus_summary_card_versus_estimate(tmp_path: Path) -> None:
    (tmp_path / "sets" / "ahmed_oud").mkdir(parents=True)
    (tmp_path / "sets" / "ahmed_oud" / "SET_CARD.md").write_text(SET_CARD)
    caps = tmp_path / "c.jsonl"
    caps.write_text("".join(json.dumps(r) + "\n" for r in _rows("ahmed_oud", 1240, 41) + _rows("y", 3, 1)))
    # the card's 5.43 h source audio, not 1240 x 30 s = 10.33 h; y: (3 + 1) x 15 s = 60 s
    assert ar.corpus_summary(caps, tmp_path) == "ahmed_oud 1240 clips (5.4 h), y 3 clips (~0.0 h)"
    caps.write_text("".join(json.dumps({"clip_path": f"{i}.wav", "rights": "harvard_raw", "song_sha256": f"s{i % 119}"}) + "\n" for i in range(11386)))
    assert ar.corpus_summary(caps, tmp_path, clip_seconds=15.0) == "harvard_raw 11386 clips (~24.0 h)"
    assert ar.corpus_summary(None, tmp_path) == "captions file missing"
    caps.write_text("")
    assert ar.corpus_summary(caps, tmp_path) == "empty captions"


def test_ab_seconds_is_recorded_or_measured_never_typed(tmp_path: Path) -> None:
    assert ar.ab_seconds({"seconds": 30}, "") == 30.0
    ab_dir = tmp_path / "ab_x"
    ab_dir.mkdir()
    sf.write(ab_dir / "pair000_base.wav", np.zeros(32000 * 2, dtype=np.float32), 32000, subtype="PCM_16")
    assert ar.ab_seconds({}, str(ab_dir)) == pytest.approx(2.0)
    assert ar.ab_seconds({}, str(tmp_path / "nowhere")) is None and ar.ab_seconds(None, "") is None
    rec = ar.RunRecord(run="r", present=True, model="facebook/musicgen-medium", best_ckpt="c", corpus="x",
                       ab={"n": 16, "base": {"pcs_mean": 0.8, "voiced_fraction_mean": 0.4}, "adapter": {"pcs_mean": 0.8, "voiced_fraction_mean": 0.5}},
                       ab_dir=str(ab_dir))
    assert "(16 pairs, 2 s)" in ar.results_row(rec)
    rec.ab_dir = str(tmp_path / "nowhere")
    assert "(16 pairs, length –)" in ar.results_row(rec)


def test_recipe_from_config() -> None:
    assert ar.recipe_from_config({"rank": 32, "alpha": 64}) == "r32, α64"
    assert ar.recipe_from_config({"rank": None, "alpha": None}) == "" and ar.recipe_from_config({}) == ""
    assert ar.recipe_from_config({"rank": 16}) == "r16"


def test_read_loss_and_smooth(tmp_path: Path) -> None:
    run = tmp_path / "r"
    run.mkdir()
    (run / "loss.csv").write_text("step,train_loss,val_loss,lr,sec_per_step,mps_driver_gb\n0,,4.5,0,,1\n1,4.0,,1e-5,1,1\n2,3.0,,1e-5,1,1\n250,,4.4,1e-5,,1\n")
    val, train = ar.read_loss(run)
    assert val == {0: 4.5, 250: 4.4} and train == {1: 4.0, 2: 3.0}
    steps, sm = ar.smooth(train, window=2)
    assert steps == [1, 2] and sm == [4.0, 3.5]
