"""Unit tests for the Stage 3-4 harness extensions in scripts/scale_train.py and
scripts/scale_eval.py: row-level tokens_dir / chroma_dir resolution, chroma
loading, the unchanged delay-pattern labels, the version record, best SAVED
checkpoint selection, the head-to-head planning (shared sources, base model,
adapter presence) and its bootstrap helpers, song-spread melody references and
rights-filtered A/B caption seeding. No corpus, GPU or network."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
import pytest
import torch

from scripts import scale_eval as se
from scripts import scale_train as st
from scripts.scale_eval import bootstrap_ci, find_best_ckpt, headtohead_stats, scorer_version

ROW = {"caption": "qaraami, Somali traditional song", "clip_path": "data/sets/ahmed_oud/clips/train/ahmed_oud_abc_seg003.wav"}


# --- token_path / chroma_path -------------------------------------------------

def test_token_path_uses_cli_dir_when_row_has_no_override(tmp_path: Path) -> None:
    assert st.token_path(tmp_path, ROW) == tmp_path / "ahmed_oud_abc_seg003.npy"
    assert st.token_path(str(tmp_path), ROW) == tmp_path / "ahmed_oud_abc_seg003.npy"


def test_token_path_row_override_is_repo_relative(tmp_path: Path) -> None:
    row = dict(ROW, tokens_dir="data/sets/ahmed_oud/tokens")
    assert st.token_path(tmp_path, row) == st.REPO / "data/sets/ahmed_oud/tokens/ahmed_oud_abc_seg003.npy"


def test_token_path_row_override_absolute_stays(tmp_path: Path) -> None:
    row = dict(ROW, tokens_dir=str(tmp_path / "tok"))
    assert st.token_path(None, row) == tmp_path / "tok" / "ahmed_oud_abc_seg003.npy"


def test_token_path_without_any_dir_raises() -> None:
    with pytest.raises(ValueError, match="tokens_dir"):
        st.token_path(None, ROW)


def test_chroma_path_none_without_dirs_and_row_override_wins(tmp_path: Path) -> None:
    assert st.chroma_path(None, ROW) is None
    assert st.chroma_path(tmp_path, ROW) == tmp_path / "ahmed_oud_abc_seg003.npy"
    row = dict(ROW, chroma_dir="data/sets/ahmed_oud/chroma")
    assert st.chroma_path(tmp_path, row) == st.REPO / "data/sets/ahmed_oud/chroma/ahmed_oud_abc_seg003.npy"


# --- chroma loading and the no-text-only rule ----------------------------------

def test_load_chroma_float16_2d_becomes_float32_batched(tmp_path: Path) -> None:
    p = tmp_path / "c.npy"
    np.save(p, np.random.default_rng(0).random((235, 12)).astype(np.float16))
    x = st.load_chroma(p)
    assert x.dtype == torch.float32 and x.shape == (1, 235, 12)
    np.save(p, np.zeros((1, 40, 12), dtype=np.float16))
    assert st.load_chroma(p).shape == (1, 40, 12)


def test_load_chroma_rejects_wrong_shape(tmp_path: Path) -> None:
    p = tmp_path / "bad.npy"
    np.save(p, np.zeros((235, 13), dtype=np.float16))
    with pytest.raises(ValueError, match="expected chroma shape"):
        st.load_chroma(p)


def test_melody_features_refuses_text_only(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="refusing a text-only step"):
        st.melody_features(None, ROW)
    with pytest.raises(FileNotFoundError, match="does not exist"):
        st.melody_features(tmp_path, ROW)


# --- delayed labels (unchanged contract) ---------------------------------------

def test_delayed_labels_layout_unchanged(tmp_path: Path) -> None:
    p = tmp_path / "t.npy"
    np.save(p, np.array([[1, 2, 3], [4, 5, 6]], dtype=np.int16))
    lab = st.delayed_labels(p)
    expected = torch.tensor([[1, -100], [2, 4], [3, 5], [-100, 6]], dtype=torch.int64)
    assert lab.shape == (4, 2) and torch.equal(lab, expected)


def test_delayed_labels_30s_shape(tmp_path: Path) -> None:
    p = tmp_path / "t.npy"
    np.save(p, np.zeros((4, 1500), dtype=np.int16))
    assert st.delayed_labels(p).shape == (1503, 4)


# --- versions / resume helpers -------------------------------------------------

def test_library_versions_dict(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(st, "git_commit", lambda: "deadbeef")
    v = st.library_versions()
    assert set(v) >= {"python", "torch", "transformers", "peft", "torchcrepe", "git_commit"}
    assert all(isinstance(x, str) and x for x in v.values())
    assert v["git_commit"] == "deadbeef" and v["torch"] == str(torch.__version__)


def test_infer_start_step() -> None:
    assert st.infer_start_step(None, 0) == 0
    assert st.infer_start_step("runs/x/ckpt_step_1250", 0) == 1250
    assert st.infer_start_step("runs/x/ckpt_step_1250", 700) == 700
    assert st.infer_start_step("runs/x/adapter", 0) == 0


def test_is_melody() -> None:
    assert st.is_melody("facebook/musicgen-melody") and not st.is_melody("facebook/musicgen-large")


# --- find_best_ckpt / require_adapter ----------------------------------------------

def _run_with_loss(tmp_path: Path, vals: dict[int, float], ckpts: list[int], name: str = "run", adapter: bool = True) -> Path:
    run = tmp_path / name
    run.mkdir()
    with open(run / "loss.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["step", "train_loss", "val_loss", "lr", "sec_per_step", "mps_driver_gb"])
        w.writerow([0, "", 4.5, 0.0, "", 8.0])
        for s, v in vals.items():
            w.writerow([s, "", v, "1e-5", "", 8.0])
    for s in ckpts:
        d = run / f"ckpt_step_{s:04d}"
        d.mkdir()
        if adapter:
            (d / "adapter_config.json").write_text("{}")
    return run


def test_find_best_ckpt_prefers_lowest_val(tmp_path: Path) -> None:
    run = _run_with_loss(tmp_path, {250: 4.4, 500: 4.2, 750: 4.3}, [250, 500, 750])
    assert find_best_ckpt(run).name == "ckpt_step_0500"


def test_find_best_ckpt_ignores_step0_and_falls_back_to_last(tmp_path: Path) -> None:
    run = _run_with_loss(tmp_path, {250: 4.4, 500: 4.2}, [250])  # best val step has no ckpt dir
    assert find_best_ckpt(run).name == "ckpt_step_0250"
    empty = tmp_path / "empty"
    empty.mkdir()
    assert find_best_ckpt(empty) == empty


def test_find_best_ckpt_only_counts_saved_checkpoints(tmp_path: Path) -> None:
    # the always-validated step 100 has no checkpoint: the best SAVED one (250) must win, not the last (500)
    run = _run_with_loss(tmp_path, {100: 4.0, 250: 4.2, 500: 4.4}, [250, 500])
    assert find_best_ckpt(run).name == "ckpt_step_0250"
    # no val row has a checkpoint at all -> last checkpoint
    run2 = _run_with_loss(tmp_path, {100: 4.0}, [250, 500], name="run2")
    assert find_best_ckpt(run2).name == "ckpt_step_0500"


def test_require_adapter(tmp_path: Path) -> None:
    run = _run_with_loss(tmp_path, {250: 4.4}, [250])
    assert se.require_adapter(run / "ckpt_step_0250", "x") == run / "ckpt_step_0250"
    bare = _run_with_loss(tmp_path, {250: 4.4}, [250], name="bare", adapter=False)
    with pytest.raises(SystemExit, match="no LoRA adapter"):
        se.require_adapter(bare / "ckpt_step_0250", "--run")
    with pytest.raises(SystemExit, match="no LoRA adapter"):
        se.require_adapter(find_best_ckpt(tmp_path / "nowhere"), "--headtohead-run")


# --- bootstrap / head-to-head -----------------------------------------------------

def test_bootstrap_ci_brackets_mean() -> None:
    m, lo, hi = bootstrap_ci([1.0, 2.0, 3.0, 4.0], n=500, seed=1)
    assert m == pytest.approx(2.5) and lo <= m <= hi and lo >= 1.0 and hi <= 4.0


def test_bootstrap_ci_rejects_empty() -> None:
    with pytest.raises(ValueError, match="no values"):
        bootstrap_ci([], n=5)


def test_headtohead_constant_difference_is_significant() -> None:
    rng = np.random.default_rng(3)
    this = {f"s{i}": float(v) for i, v in enumerate(rng.normal(4.0, 0.3, 30))}
    other = {s: v + 0.2 for s, v in this.items()}  # other adapter worse by 0.2 on every song
    h = headtohead_stats(this, other, n_boot=500, seed=0)
    d = h["difference_other_minus_this"]
    assert h["n_songs"] == 30
    assert d["mean"] == pytest.approx(0.2, abs=1e-3)
    assert d["ci95"][0] == pytest.approx(0.2, abs=1e-3) and d["ci95"][1] == pytest.approx(0.2, abs=1e-3)
    assert d["significant"] is True
    assert h["other"]["mean"] == pytest.approx(h["this"]["mean"] + 0.2, abs=1e-3)


def test_headtohead_noise_is_not_significant_and_uses_intersection() -> None:
    rng = np.random.default_rng(5)
    this = {f"s{i}": float(v) for i, v in enumerate(rng.normal(4.0, 0.3, 40))}
    other = {s: v + float(rng.normal(0.0, 0.05)) for s, v in this.items()}
    other["extra_song"] = 9.9  # not in `this`: must be ignored
    h = headtohead_stats(this, other, n_boot=500, seed=0)
    d = h["difference_other_minus_this"]
    assert h["n_songs"] == 40 and d["ci95"][0] <= d["mean"] <= d["ci95"][1]
    assert d["significant"] == (d["ci95"][0] > 0 or d["ci95"][1] < 0)
    with pytest.raises(ValueError):
        headtohead_stats({"a": 1.0}, {"b": 1.0})


def test_per_source_headtohead_splits_by_source() -> None:
    this = {"a1": 4.0, "a2": 4.2, "h1": 5.0, "h2": 5.1, "h3": 5.2}
    other = {"a1": 4.3, "a2": 4.5, "h1": 5.0, "h2": 5.1, "h3": 5.2, "zz": 1.0}
    src = {"a1": "ahmed_oud", "a2": "ahmed_oud", "h1": "harvard_full", "h2": "harvard_full", "h3": "harvard_full"}
    ps = se.per_source_headtohead(this, other, src, n_boot=200)
    assert set(ps) == {"ahmed_oud", "harvard_full"}
    assert ps["ahmed_oud"]["n_songs"] == 2 and ps["ahmed_oud"]["difference_other_minus_this"]["mean"] == pytest.approx(0.3, abs=1e-3)
    assert ps["harvard_full"]["n_songs"] == 3 and ps["harvard_full"]["difference_other_minus_this"]["mean"] == 0.0
    # a single song has no variance to resample: never "significant", CI collapsed on the point
    one = headtohead_stats({"s": 4.0}, {"s": 4.5}, n_boot=50)
    assert one["n_songs"] == 1 and one["difference_other_minus_this"] == {"mean": 0.5, "ci95": [0.5, 0.5], "significant": False}


# --- rows, sources and the head-to-head plan ---------------------------------------

def _row(src: str, i: int, split: str = "test", rights: str | None = None) -> dict:
    sha = f"{src}{i:02d}" * 8
    return {"clip_path": f"data/sets/{src}/clips/{split}/{src}_{sha[:12]}_seg{i % 3:03d}.wav",
            "caption": f"{src} caption {i}", "song_sha256": sha[:64], "split": split, "source": src,
            "rights": rights or ("harvard_research_only" if src.startswith("harvard") else "ahmed_ilkacase_consented")}


def _captions(path: Path, rows: list[dict]) -> Path:
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return path


def test_select_test_rows_and_source_counts() -> None:
    rows = [_row("ahmed_oud", i) for i in range(6)] + [_row("harvard_full", i) for i in range(4)]
    picked = se.select_test_rows(rows, n=5)
    assert len(picked) == 5 and [r["clip_path"] for r in picked] == sorted(r["clip_path"] for r in rows)[::2]
    counts = se.source_counts(rows)
    assert counts == {"ahmed_oud": {"clips": 6, "songs": 6}, "harvard_full": {"clips": 4, "songs": 4}}
    assert se.source_of({"rights": "harvard_raw"}) == "harvard_raw" and se.source_of({}) == "unlabelled"


def test_plan_headtohead_restricts_rows_to_shared_sources(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    combined = _captions(tmp_path / "combined.jsonl",
                         [_row("ahmed_oud", i, "train") for i in range(3)] + [_row("ahmed_oud", i) for i in range(4)]
                         + [_row("harvard_full", i, "train") for i in range(3)] + [_row("harvard_full", i) for i in range(20)])
    other_caps = _captions(tmp_path / "ahmed_only.jsonl", [_row("ahmed_oud", i, "train") for i in range(3)] + [_row("ahmed_oud", i) for i in range(4)])
    other = _run_with_loss(tmp_path, {250: 4.4, 500: 4.2}, [250, 500], name="ahmed_only_large")
    (other / "config.json").write_text(json.dumps({"model": "facebook/musicgen-large", "captions": str(other_caps)}))
    test = se.load_split(combined, "test")
    plan = se.plan_headtohead(combined, other, "facebook/musicgen-large", test)
    assert plan["other_ckpt"].name == "ckpt_step_0500" and plan["shared_sources"] == ["ahmed_oud"]
    assert plan["other_captions"] == other_caps
    assert {se.source_of(r) for r in plan["rows"]} == {"ahmed_oud"} and len(plan["rows"]) == 4
    # base-model mismatch, missing adapter, missing run, no shared source: all SystemExit before any model loads
    with pytest.raises(SystemExit, match="trained on 'facebook/musicgen-large'"):
        se.plan_headtohead(combined, other, "facebook/musicgen-medium", test)
    bare = _run_with_loss(tmp_path, {250: 4.4}, [250], name="bare", adapter=False)
    with pytest.raises(SystemExit, match="no LoRA adapter"):
        se.plan_headtohead(combined, bare, "facebook/musicgen-large", test)
    with pytest.raises(SystemExit, match="not a run directory"):
        se.plan_headtohead(combined, tmp_path / "nope", "facebook/musicgen-large", test)
    harvard_only = _captions(tmp_path / "h.jsonl", [_row("harvard_full", i) for i in range(2)])
    (other / "config.json").write_text(json.dumps({"model": "facebook/musicgen-large", "captions": str(harvard_only)}))
    ahmed_test = [r for r in test if r["source"] == "ahmed_oud"]
    with pytest.raises(SystemExit, match="no source in common"):
        se.plan_headtohead(_captions(tmp_path / "a.jsonl", ahmed_test), other, "facebook/musicgen-large", ahmed_test)
    (other / "config.json").write_text(json.dumps({"model": "facebook/musicgen-large", "captions": "gone.jsonl"}))
    with pytest.raises(SystemExit, match="captions file"):
        se.plan_headtohead(combined, other, "facebook/musicgen-large", test)


# --- melody references spread over songs -------------------------------------------

def test_song_key_strips_segment() -> None:
    assert se.song_key(Path("x/ahmed_oud_0123456789ab_seg007.wav")) == "ahmed_oud_0123456789ab"
    assert se.song_key(Path("x/ref000.wav")) == "ref000"


def test_melody_reference_clips_take_one_song_per_pair(tmp_path: Path) -> None:
    refs_dir = tmp_path / "test"
    refs_dir.mkdir()
    for song in ("aaa", "bbb", "ccc"):
        for seg in range(5):
            (refs_dir / f"ahmed_oud_{song}_seg{seg:03d}.wav").write_bytes(b"")
    refs = se.melody_reference_clips(tmp_path / "unused.jsonl", refs_dir, 16)
    assert len(refs) == 16
    songs = [s for s, _ in refs]
    assert songs[:3] == ["ahmed_oud_aaa", "ahmed_oud_bbb", "ahmed_oud_ccc"] and len(set(songs)) == 3
    assert [p.name for _, p in refs[:4]] == ["ahmed_oud_aaa_seg000.wav", "ahmed_oud_bbb_seg000.wav", "ahmed_oud_ccc_seg000.wav", "ahmed_oud_aaa_seg001.wav"]
    assert len({p for _, p in refs[:15]}) == 15  # 3 songs x 5 segments: no clip repeats before the pool is used up
    assert refs[15][1].name == "ahmed_oud_aaa_seg000.wav"  # only then a clip comes round again
    with pytest.raises(FileNotFoundError, match="no .wav"):
        se.melody_reference_clips(tmp_path / "unused.jsonl", tmp_path, 4)


def test_melody_reference_clips_fallback_groups_by_song_sha(tmp_path: Path) -> None:
    rows = [dict(_row("ahmed_oud", i), song_sha256="song_a" * 10) for i in range(3)] + [dict(_row("ahmed_oud", 9), song_sha256="song_b" * 10)]
    rows += [_row("harvard_full", 1)]
    caps = _captions(tmp_path / "c.jsonl", rows)
    refs = se.melody_reference_clips(caps, None, 4)
    assert [s[:6] for s, _ in refs] == ["song_a", "song_b", "song_a", "song_b"]
    assert refs[0][1] == se.resolve(rows[0]["clip_path"]) and refs[2][1] == se.resolve(rows[1]["clip_path"])
    with pytest.raises(FileNotFoundError, match="no ahmed_oud test clips"):
        se.melody_reference_clips(_captions(tmp_path / "h.jsonl", [_row("harvard_full", 1)]), None, 4)


# --- A/B caption seeding ------------------------------------------------------------

def test_ab_captions_rights_filter_and_cache(tmp_path: Path) -> None:
    caps = _captions(tmp_path / "c.jsonl", [_row("ahmed_oud", i) for i in range(6)] + [_row("harvard_full", i) for i in range(6)])
    cache = tmp_path / "ab.json"
    picked = se.ab_captions(caps, 4, cache, rights=["ahmed_ilkacase_consented"])
    assert len(picked) == 4 and all(c.startswith("ahmed_oud") for c in picked) and json.loads(cache.read_text()) == picked
    assert se.ab_captions(caps, 2, cache, rights=["nothing"]) == picked[:2]  # an existing cache is read as-is
    with pytest.raises(SystemExit, match="no test row"):
        se.ab_captions(caps, 4, tmp_path / "new.json", rights=["nothing"])
    assert not (tmp_path / "new.json").exists()
    unfiltered = se.ab_captions(caps, 12, tmp_path / "all.json")
    assert len(unfiltered) == 12 and any(c.startswith("harvard") for c in unfiltered)
    with pytest.raises(SystemExit, match="no test captions"):
        se.ab_captions(_captions(tmp_path / "e.jsonl", [_row("ahmed_oud", 1, "train")]), 4, tmp_path / "e.json")


def test_captions_sources_and_resolve_captions_arg(tmp_path: Path) -> None:
    caps = _captions(tmp_path / "c.jsonl", [_row("ahmed_oud", 1), {"clip_path": "x.wav", "split": "train", "rights": "harvard_raw", "song_sha256": "s"}])
    assert se.captions_sources(caps) == {"ahmed_oud", "harvard_raw"}
    assert se.resolve_captions_arg(str(caps)) == caps and se.resolve_captions_arg("missing.jsonl") is None and se.resolve_captions_arg(None) is None


def test_scorer_version_pins_pcs_source() -> None:
    v = scorer_version()
    assert v["pcs_hop"] == 320 and v["pcs_conf_thresh"] == 0.5
    assert len(v["pcs_file_sha256"]) == 64 and isinstance(v["torchcrepe"], str)


def test_config_round_trip_has_versions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(st, "git_commit", lambda: "cafebabe")
    cfg = {"model": "facebook/musicgen-medium", "versions": st.library_versions()}
    p = tmp_path / "config.json"
    p.write_text(json.dumps(cfg))
    assert json.loads(p.read_text())["versions"]["git_commit"] == "cafebabe"
