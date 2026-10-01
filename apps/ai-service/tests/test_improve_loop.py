"""Unit tests for scripts/improve_loop.py (the Phase 4 improvement loop): the
keep/reject decision, caption transforms, plan expansion and composition after
a kept change, state persistence and resume, the Markdown log, dry-run command
generation from a fake best run, and one full attempt driven by a fake
subprocess.run that plays tmux, scale_train and scale_eval. No tmux, no models,
no corpus, no network."""

from __future__ import annotations

import json
import shlex
import shutil
import subprocess
from pathlib import Path

import pytest

from scripts import improve_loop as il

MODEL = "facebook/musicgen-large"
CAPTION = "qaraami, Somali traditional song, led by the oud (kaban), moderate at 100 BPM, pentatonic melody rooted on A, studio recording, clean, performed by Ahmed Ilkacase"


# --------------------------------------------------------------------------- fixtures

def _eval(ce_imp: float, fad: float, key: str = "improvement_base_minus_adapter") -> dict:
    return {"tag": "x", "model": MODEL, "best_ckpt": "ckpt_step_1500",
            "per_song_ce": {"n_songs": 9, "base": {"mean": 4.1}, "adapter": {"mean": 4.1 - ce_imp},
                            key: {"mean": ce_imp, "ci95": [ce_imp - 0.02, ce_imp + 0.02], "significant": True}},
            "mert": {"fad_base_real": 0.7, "fad_adapter_real": fad, "n_real": 64},
            "ab": {"n": 8, "seconds": 30, "pairs": []}}


def _rows(set_name: str, content: str, n: int, root: str = "data/sets") -> list[dict]:
    rows = []
    for i in range(n):
        split = "test" if i % 5 == 4 else ("val" if i % 5 == 3 else "train")
        rows.append({"clip_path": f"{root}/{set_name}/clips/{split}/{set_name}_{i:012x}_seg000.wav", "caption": CAPTION,
                     "song_sha256": f"{set_name}{i:060x}", "song_group": f"{set_name}_g{i}", "split": split, "source": set_name,
                     "rights": "ahmed_ilkacase_consented", "content": content, "tokens_dir": f"{root}/{set_name}/tokens",
                     "seconds": 30.0, "caption_version": 1})
    return rows


def _write_rows(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A fake repo: runs/best (config.json + eval), data/sets/ahmed_oud and ahmed_mix captions,
    a merged run captions file of ahmed_oud only, and the apps/ai-service dir the commands cd into."""
    (tmp_path / "apps/ai-service").mkdir(parents=True)
    oud = _rows("ahmed_oud", "oud", 20)
    mix = _rows("ahmed_mix", "full_mix", 10)
    _write_rows(tmp_path / "data/sets/ahmed_oud/captions.jsonl", oud)
    _write_rows(tmp_path / "data/sets/ahmed_mix/captions.jsonl", mix)
    _write_rows(tmp_path / "data/sets/run_best_captions.jsonl", oud)
    run = tmp_path / "runs/best"
    run.mkdir(parents=True)
    (run / "config.json").write_text(json.dumps({
        "model": MODEL, "lr": 3e-5, "total_steps": 6000, "warmup": 100, "batch_size": 1, "grad_accum": 4, "rank": 128, "alpha": 256,
        "targets": il.DEFAULT_TARGETS, "captions": str(tmp_path / "data/sets/run_best_captions.jsonl"),
        "tokens_dir": str(tmp_path / "data/sets/ahmed_oud/tokens"), "chroma_dir": None}))
    (run / "eval_best.json").write_text(json.dumps(_eval(0.12, 0.50)))
    return tmp_path


def _loop(repo: Path, dry_run: bool = False, **kw) -> il.Loop:
    out: list[str] = []
    loop = il.Loop(repo, repo / il.STATE_REL, repo / il.LOG_REL, "/fake/python", dry_run=dry_run, out=out.append, **kw)
    loop.lines = out  # type: ignore[attr-defined]
    return loop


def _best(repo: Path) -> il.Config:
    return il.config_from_run(repo / "runs/best", repo / "runs/best/eval_best.json", repo)


# --------------------------------------------------------------------------- decision (pure)

def test_decide_keeps_only_when_both_improve() -> None:
    before = {"fad": 0.50, "ce_improvement": 0.12}
    both = il.decide(before, {"fad": 0.45, "ce_improvement": 0.15})
    assert both["keep"] and both["d_fad"] == -0.05 and both["d_ce"] == 0.03 and "both better" in both["reason"]
    fad_only = il.decide(before, {"fad": 0.45, "ce_improvement": 0.10})
    assert not fad_only["keep"] and fad_only["reason"] == "CE improvement not better"
    ce_only = il.decide(before, {"fad": 0.55, "ce_improvement": 0.15})
    assert not ce_only["keep"] and ce_only["reason"] == "FAD not better"
    neither = il.decide(before, {"fad": 0.55, "ce_improvement": 0.10})
    assert not neither["keep"] and neither["reason"] == "FAD and CE improvement not better"
    # ties are not improvements
    assert not il.decide(before, {"fad": 0.50, "ce_improvement": 0.15})["keep"]
    assert not il.decide(before, {"fad": 0.45, "ce_improvement": 0.12})["keep"]


def test_decide_never_keeps_on_missing_metric() -> None:
    v = il.decide({"fad": 0.5, "ce_improvement": 0.1}, {"fad": None, "ce_improvement": 0.2})
    assert not v["keep"] and v["d_fad"] is None and "fad after" in v["reason"]


def test_read_metrics_accepts_both_ce_keys_and_dpo_fad() -> None:
    m = il.read_metrics(_eval(0.12, 0.5))
    assert m["ce_improvement"] == 0.12 and m["fad"] == 0.5 and m["fad_base"] == 0.7 and m["n_songs"] == 9
    m2 = il.read_metrics(_eval(0.2, 0.4, key="improvement"))
    assert m2["ce_improvement"] == 0.2
    dpo = {"per_song_ce": {"improvement": {"mean": 0.05}}, "fad_to_real_oud_test": {"before": 0.44, "after": 0.49}}
    m3 = il.read_metrics(dpo)
    assert m3["fad"] == 0.49 and m3["fad_base"] == 0.44
    assert il.read_metrics({})["fad"] is None and il.read_metrics({})["ce_improvement"] is None


# --------------------------------------------------------------------------- captions

def test_strip_genre_removes_tag_and_tradition_phrase_only() -> None:
    assert il.strip_genre(CAPTION) == ("led by the oud (kaban), moderate at 100 BPM, pentatonic melody rooted on A, "
                                       "studio recording, clean, performed by Ahmed Ilkacase")
    assert il.strip_genre("Heello, Somali traditional song, led by vocals") == "led by vocals"
    plain = "Somali song, led by vocals, the oud (kaban) and hand drums, fast at 140 BPM"
    assert il.strip_genre(plain) == plain  # no genre word, no phrase: untouched


def test_sets_of_and_uses_mix() -> None:
    oud, mix = _rows("ahmed_oud", "oud", 3), _rows("ahmed_mix", "full_mix", 2)
    assert il.sets_of(oud + mix) == ("data/sets", ["ahmed_oud", "ahmed_mix"])
    assert il.sets_of(_rows("ahmed_oud", "oud", 2, root="data/sets_45s")) == ("data/sets_45s", ["ahmed_oud"])
    assert il.sets_of(oud + [{"clip_path": "data/clips/train/x.wav"}]) is None
    assert il.sets_of(oud + _rows("ahmed_oud", "oud", 1, root="data/sets_10s")) is None  # two roots
    assert il.uses_mix(oud + mix) and not il.uses_mix(oud)


def test_materialise_transforms(repo: Path) -> None:
    base = "data/sets/run_best_captions.jsonl"
    s = il.materialise(base, ["nogenre"], "data/sets/run_best_nogenre_captions.jsonl", repo)
    rows = il.read_rows(repo / s["out"])
    assert s["rows"] == 20 and all(not r["caption"].startswith("qaraami") and "Somali traditional song" not in r["caption"] for r in rows)
    assert rows[0]["tokens_dir"] == "data/sets/ahmed_oud/tokens"  # every other field kept
    s = il.materialise(base, ["plus_mix"], "data/sets/run_best_plus_mix_captions.jsonl", repo)
    assert s["rows"] == 30 and il.uses_mix(il.read_rows(repo / s["out"]))
    s = il.materialise("data/sets/run_best_plus_mix_captions.jsonl", ["oud_only"], "data/sets/x.jsonl", repo)
    assert s["rows"] == 20
    with pytest.raises(il.Skip, match="already present"):
        il.materialise("data/sets/run_best_plus_mix_captions.jsonl", ["plus_mix"], "data/sets/y.jsonl", repo)


def test_plus_mix_refuses_song_leakage(repo: Path) -> None:
    mix = il.read_rows(repo / "data/sets/ahmed_mix/captions.jsonl")
    oud = il.read_rows(repo / "data/sets/ahmed_oud/captions.jsonl")
    mix[0]["song_sha256"] = oud[0]["song_sha256"]      # same song in a different split
    mix[0]["split"] = "test" if oud[0]["split"] != "test" else "train"
    _write_rows(repo / "data/sets/ahmed_mix/captions.jsonl", mix)
    with pytest.raises(il.Skip, match="leakage"):
        il.materialise("data/sets/run_best_captions.jsonl", ["plus_mix"], "data/sets/z.jsonl", repo)


def test_derived_captions_path_follows_the_spec() -> None:
    assert il.derived_captions_path("data/sets/run_ahmed_only_captions.jsonl", "ahmed_only", ["nogenre"]) == "data/sets/run_ahmed_only_nogenre_captions.jsonl"
    assert il.derived_captions_path("data/sets_45s/run_clip45_captions.jsonl", "clip45", ["oud_only", "nogenre"]) == "data/sets_45s/run_clip45_oud_only_nogenre_captions.jsonl"


# --------------------------------------------------------------------------- plan

def test_expand_plan_default_and_only() -> None:
    names = [a["variant"] for a in il.expand_plan(il.DEFAULT_PLAN)]
    assert names == ["clip45", "caption_ablation", "data", "lora_rank_x2", "lora_rank_half", "lr_x2", "lr_half", "dpo_round2"]
    assert [a["variant"] for a in il.expand_plan(il.DEFAULT_PLAN, only=["lr"])] == ["lr_x2", "lr_half"]
    # naming one data direction pins it; naming the group (or both directions) leaves it to resolve at run time
    assert [a["variant"] for a in il.expand_plan(il.DEFAULT_PLAN, only=["lr_half", "data_oud_only"])] == ["data_oud_only", "lr_half"]
    assert [a["variant"] for a in il.expand_plan(il.DEFAULT_PLAN, only=["data"])] == ["data"]
    assert [a["variant"] for a in il.expand_plan(il.DEFAULT_PLAN, only=["data_oud_only", "data_oud_plus_mix"])] == ["data"]
    assert [a["variant"] for a in il.expand_plan(["lr_x2", "data_oud_plus_mix"])] == ["lr_x2", "data_oud_plus_mix"]
    assert il.matches_only("data", "data", ["data_oud_plus_mix"]) and il.matches_only("lr_x2", "lr", ["lr"]) and il.matches_only("x", "y", None)
    assert not il.matches_only("lr_x2", "lr", ["lr_half"]) and not il.matches_only("data", "data", ["lr"])
    assert il.matches_only("data_oud_only", "data", ["data"]) and not il.matches_only("data_oud_plus_mix", "data", ["data_oud_only"])
    assert [a["variant"] for a in il.expand_plan(["data_oud_plus_mix", "lr_x2"], only=["data_oud_only"])] == []
    with pytest.raises(SystemExit, match="unknown plan item"):
        il.expand_plan(["bogus"])
    assert il.parse_plan(["clip45,lr", "dpo_round2"]) == ["clip45", "lr", "dpo_round2"]


def test_compose_pending_drops_the_sibling_after_a_keep() -> None:
    attempts = il.expand_plan(il.DEFAULT_PLAN)
    attempts[5]["status"] = "kept"  # lr_x2
    dropped = il.compose_pending(attempts, "lr")
    assert dropped == ["lr_half"] and attempts[6]["status"] == "dropped" and attempts[5]["status"] == "kept"
    assert all(a["status"] == "pending" for a in attempts if a["group"] not in ("lr",))


def test_derive_composes_on_the_current_best(repo: Path) -> None:
    loop = _loop(repo, dry_run=True)
    best = _best(repo)
    loop.init_state(best, il.DEFAULT_PLAN, None, 1500, None)
    att = {"variant": "lr_x2", "group": "lr", "status": "pending"}
    d = loop.derive(att, best)
    assert d.cfg.lr == pytest.approx(6e-5) and d.change == "lr 3e-5 → 6e-5" and d.run_id == "lr_x2"
    # after keeping lr_x2 and caption_ablation, a rank change starts from the composed config
    kept = il.replace(d.cfg, transforms=["nogenre"], captions="data/sets/run_best_nogenre_captions.jsonl", changes=["lr_x2", "caption_ablation"])
    d2 = loop.derive({"variant": "lora_rank_half", "group": "lora_rank", "status": "pending"}, kept)
    assert d2.cfg.rank == 64 and d2.cfg.alpha == 128 and d2.cfg.lr == pytest.approx(6e-5)
    assert d2.cfg.captions == "data/sets/run_best_nogenre_captions.jsonl" and d2.change == "LoRA rank 128 → 64 (α 256 → 128)"
    argv = loop.train_argv(d2.cfg, d2.run_id, 1500)
    assert "--rank" in argv and argv[argv.index("--rank") + 1] == "64" and argv[argv.index("--lr") + 1] == "6e-5"
    assert argv[argv.index("--captions") + 1] == str(repo / "data/sets/run_best_nogenre_captions.jsonl")
    # the data direction follows what the best trained on
    d3 = loop.derive({"variant": "data", "group": "data", "status": "pending"}, best)
    assert d3.variant == "data_oud_plus_mix" and d3.cfg.transforms == ["plus_mix"]
    plus = il.replace(best, captions="data/sets/run_best_plus_mix_captions.jsonl", transforms=["plus_mix"])
    il.materialise(best.base_captions, ["plus_mix"], plus.captions, repo)
    d4 = loop.derive({"variant": "data", "group": "data", "status": "pending"}, plus)
    assert d4.variant == "data_oud_only"
    # nogenre twice is a skip; a full-decoder best has no rank to change
    with pytest.raises(il.Skip, match="already carry no genre"):
        loop.derive({"variant": "caption_ablation", "group": "caption_ablation", "status": "pending"}, kept)
    full = il.replace(best, rank=None, alpha=None)
    with pytest.raises(il.Skip, match="full-decoder"):
        loop.derive({"variant": "lora_rank_x2", "group": "lora_rank", "status": "pending"}, full)
    assert loop.lora_args(full) == [il.FULL_DECODER_FLAG] == ["--full-decoder"]


def test_full_decoder_best_run_commands(repo: Path) -> None:
    cfg = json.loads((repo / "runs/best/config.json").read_text())
    cfg.update({"full_decoder": True, "rank": 32, "alpha": 64})   # the harness records its LoRA defaults even for a full run
    (repo / "runs/best/config.json").write_text(json.dumps(cfg))
    best = _best(repo)
    assert best.full and best.rank is None and best.alpha is None
    loop = _loop(repo, dry_run=True)
    loop.init_state(best, il.DEFAULT_PLAN, None, 1500, None)
    d = loop.derive({"variant": "lr_x2", "group": "lr", "status": "pending"}, best)
    train = loop.train_argv(d.cfg, d.run_id, 1500)
    assert "--full-decoder" in train and "--rank" not in train and "--alpha" not in train
    probe = loop.probe_argv(d.cfg, d.run_id, 1500)
    assert "--full-decoder" in probe and "--rank" not in probe
    ev = loop.eval_argv(d.cfg, d.run_id, "runs/lr_x2")
    assert "--rank" not in ev and "--mert-real" in ev
    with pytest.raises(il.Skip, match="full-decoder"):
        loop.derive({"variant": "lora_rank_half", "group": "lora_rank", "status": "pending"}, best)


def test_derive_clip45_prep_and_skips(repo: Path) -> None:
    loop = _loop(repo, dry_run=True)
    best = _best(repo)
    loop.init_state(best, ["clip45"], None, 1500, None)
    d = loop.derive({"variant": "clip45", "group": "clip45", "status": "pending"}, best)
    kinds = [s.kind for s in d.prep]
    assert kinds == ["fg", "fg", "probe", "fg", "fg", "fg"]          # partial build, tokens, probe, full build, tokens, merge
    assert d.prep[2].cap_gb == il.CLIP45_CAP_GB
    assert d.prep[0].argv[:7] == ["scripts.build_sets", "--set", "ahmed_oud", "--seconds", "45", "--out-root", "data/sets_45s"]
    assert "--limit" in d.prep[0].argv and "--limit" not in d.prep[3].argv
    assert d.prep[-1].argv[:2] == ["scripts.build_sets", "--merge"] and d.prep[-1].argv[-1] == "data/sets_45s/run_clip45_captions.jsonl"
    assert d.cfg.seconds == 45 and d.cfg.captions == "data/sets_45s/run_clip45_captions.jsonl" and d.cfg.tokens_dir == "data/sets_45s/ahmed_oud/tokens"
    # with a kept captions transform the 45 s merge is transformed too
    kept = il.replace(best, transforms=["nogenre"], captions="data/sets/run_best_nogenre_captions.jsonl")
    d2 = loop.derive({"variant": "clip45", "group": "clip45", "status": "pending"}, kept)
    assert d2.prep[-1].kind == "py" and d2.cfg.captions == "data/sets_45s/run_clip45_nogenre_captions.jsonl"
    with pytest.raises(il.Skip, match="already 45"):
        loop.derive({"variant": "clip45", "group": "clip45", "status": "pending"}, il.replace(best, seconds=45.0))
    with pytest.raises(il.Skip, match="melody"):
        loop.derive({"variant": "clip45", "group": "clip45", "status": "pending"}, il.replace(best, model="facebook/musicgen-melody", chroma_dir="data/sets/ahmed_oud/chroma_midi"))


def _dpo_run(repo: Path, name: str, model: str, fad: float, start: str, key: str = "start_adapter", captions: str | None = None) -> Path:
    """A finished dpo_train run dir: config.json (start adapter under `key`), round_1/adapter, eval_round_1.json."""
    d = repo / "runs" / name
    (d / "round_1" / "adapter").mkdir(parents=True)
    (d / "round_1" / "adapter" / "adapter_config.json").write_text(json.dumps({"r": 128, "lora_alpha": 256}))
    (d / "config.json").write_text(json.dumps({"model": model, key: start, "beta": 10.0, "lr": 2e-5, "logp_norm": "mean", "sft_weight": 0.5,
                                               "seconds": 15, "samples_per_prompt": 4, "captions": captions}))
    (d / "eval_round_1.json").write_text(json.dumps({"fad_to_real_oud_test": {"before": 0.5, "after": fad}}))
    return d


def test_derive_dpo_round2_picks_the_lowest_fad_round_of_the_lineage(repo: Path) -> None:
    _dpo_run(repo, "dpo_a", MODEL, 0.49, str(repo / "runs/best/ckpt_step_1500"))                      # descends from the origin
    _dpo_run(repo, "dpo_b", MODEL, 0.41, "../../runs/best/ckpt_step_1000", key="adapter")             # older config key, apps/ai-service-relative
    _dpo_run(repo, "dpo_foreign", MODEL, 0.10, str(repo / "runs/qaraami_large_r32/ckpt_step_2750"))   # lowest FAD, other lineage: never picked
    _dpo_run(repo, "dpo_other", "facebook/musicgen-medium", 0.05, str(repo / "runs/best/ckpt_step_1500"))  # other base: ignored
    loop = _loop(repo, dry_run=True)
    best = _best(repo)
    loop.init_state(best, ["dpo_round2"], None, 1500, None)
    d = loop.derive({"variant": "dpo_round2", "group": "dpo_round2", "status": "pending"}, best)
    assert d.kind == "dpo" and d.dpo_source == "runs/dpo_b/round_1/adapter" and d.cfg.adapter == "runs/dpo_round2/round_1/adapter"
    assert "dpo_b recipe" in d.change
    argv = loop.dpo_argv(d)
    assert argv[:7] == ["scripts.dpo_train", "--model", MODEL, "--adapter", str(repo / "runs/dpo_b/round_1/adapter"), "--tag", "dpo_round2"]
    assert "--prompts-per-round" in argv and argv[argv.index("--prompts-per-round") + 1] == "64"
    assert argv[argv.index("--beta") + 1] == "10.0" and argv[argv.index("--logp-norm") + 1] == "mean" and argv[argv.index("--samples-per-prompt") + 1] == "4"
    # the eval goes through runs/<run id> (dpo_train's ckpt_step alias), never into the adapter directory
    assert loop.eval_run_arg(d) == "runs/dpo_round2"
    assert loop.eval_json_path(d) == repo / "runs/dpo_round2/eval_dpo_round2.json"
    assert "--run runs/dpo_round2 " in shlex.join(loop.eval_argv(d.cfg, d.run_id, loop.eval_run_arg(d)))
    # a kept variant extends the lineage
    loop.state["attempts"].append({"variant": "lr_x2", "group": "lr", "status": "kept", "run_id": "lr_x2"})
    _dpo_run(repo, "dpo_c", MODEL, 0.30, str(repo / "runs/lr_x2/ckpt_step_1500"))
    assert loop.derive({"variant": "dpo_round2", "group": "dpo_round2", "status": "pending"}, best).dpo_source == "runs/dpo_c/round_1/adapter"
    # --dpo-run pins a round explicitly, lineage or not
    pinned = _loop(repo, dry_run=True, dpo_run="runs/dpo_foreign")
    pinned.init_state(best, ["dpo_round2"], None, 1500, None)
    assert pinned.derive({"variant": "dpo_round2", "group": "dpo_round2", "status": "pending"}, best).dpo_source == "runs/dpo_foreign/round_1/adapter"
    # a source whose captions carry harvard rows must not change the rights of a releasable lineage
    harvard = [dict(r, rights="harvard_research_only", source="harvard_full") for r in _rows("harvard_full", "full_mix", 5)]
    _write_rows(repo / "data/sets/run_h_captions.jsonl", harvard)
    shutil.rmtree(repo / "runs/dpo_c")
    _dpo_run(repo, "dpo_h", MODEL, 0.20, str(repo / "runs/best/ckpt_step_1500"), captions=str(repo / "data/sets/run_h_captions.jsonl"))
    with pytest.raises(il.Skip, match="research-only but the best run is releasable"):
        loop.derive({"variant": "dpo_round2", "group": "dpo_round2", "status": "pending"}, best)
    for n in ("dpo_a", "dpo_b", "dpo_h"):
        shutil.rmtree(repo / "runs" / n)
    with pytest.raises(il.Skip, match=r"no DPO round for .* descends from runs/best \(other lineage, skipped: dpo_foreign\)"):
        loop.derive({"variant": "dpo_round2", "group": "dpo_round2", "status": "pending"}, best)


# --------------------------------------------------------------------------- state

def test_state_roundtrip_and_resume(repo: Path) -> None:
    loop = _loop(repo)
    loop.init_state(_best(repo), il.DEFAULT_PLAN, None, 1500, 3)
    loop.state["attempts"][0].update({"status": "skipped", "note": "probe peak 70 GB > cap 60 GB"})
    loop.state["attempts"][1].update({"status": "training", "stage": "train", "run_id": "caption_ablation", "launches": 1})
    loop.save()
    assert (repo / il.STATE_REL).exists() and not (repo / il.STATE_REL).with_suffix(".json.tmp").exists()
    loop2 = _loop(repo)
    assert loop2.load_state()
    assert loop2.best == _best(repo) and loop2.state["steps"] == 1500 and loop2.state["max_attempts"] == 3
    assert loop2.state["attempts"][1]["stage"] == "train" and loop2.state["attempts"][1]["launches"] == 1
    assert [a["variant"] for a in loop2.state["attempts"] if a["status"] not in il.TERMINAL][:2] == ["caption_ablation", "data"]
    (repo / il.STATE_REL).write_text(json.dumps({"version": 99}))
    with pytest.raises(SystemExit, match="state version"):
        _loop(repo).load_state()


def test_dry_run_writes_nothing(repo: Path) -> None:
    loop = _loop(repo, dry_run=True)
    loop.init_state(_best(repo), il.DEFAULT_PLAN, None, 1500, None)
    loop.save(); loop.write_log()
    assert not (repo / il.STATE_REL).exists() and not (repo / il.LOG_REL).exists()


# --------------------------------------------------------------------------- log rendering

def test_render_log_table(repo: Path) -> None:
    loop = _loop(repo)
    loop.init_state(_best(repo), il.DEFAULT_PLAN, None, 1500, None)
    a = loop.state["attempts"]
    a[0].update({"status": "skipped", "run_id": "clip45", "change": "clip length 30 s → 45 s", "note": "probe peak 71.3 GB > cap 60 GB",
                 "probe": {"peak_driver_gb": 71.3}, "hours": 0.4})
    a[1].update({"status": "kept", "run_id": "caption_ablation", "change": "captions without the genre tag", "steps": 1500, "steps_trained": 1250,
                 "before": {"ce_improvement": 0.12, "fad": 0.5}, "after": {"ce_improvement": 0.14, "fad": 0.45}, "d_ce": 0.02, "d_fad": -0.05,
                 "note": "FAD -0.0500 and CE improvement +0.0200: both better", "hours": 9.5, "vs": "best", "research_only": False})
    a[5].update({"status": "rejected", "run_id": "lr_x2", "change": "lr 3e-5 → 6e-5", "steps": 1500, "steps_trained": 1500,
                 "before": {"ce_improvement": 0.14, "fad": 0.45}, "after": {"ce_improvement": 0.11, "fad": 0.44}, "d_ce": -0.03, "d_fad": -0.01,
                 "note": "CE improvement | not better", "hours": 10.0, "vs": "caption_ablation", "research_only": True})
    a[6].update({"status": "dropped", "note": "sibling of the kept lr change"})
    loop.state["stopped"] = "plan exhausted"
    md = il.render_log(loop.state, repo)
    assert "| # | change | run id | steps | CE improvement before → after | FAD before → after | decision | rights | wall-clock | note |" in md
    assert "| 1 | clip length 30 s → 45 s | `clip45` | — | — | — | skipped | — | 0.4 h | probe peak 71.3 GB > cap 60 GB |" in md
    assert "| 2 | captions without the genre tag | `caption_ablation` | 1500 (stopped at 1250) | 0.1200 → 0.1400 (+0.0200) | 0.5000 → 0.4500 (-0.0500) | **kept** (vs `best`) | releasable | 9.5 h |" in md
    assert "| 6 | lr 3e-5 → 6e-5 | `lr_x2` | 1500 | 0.1400 → 0.1100 (-0.0300) | 0.4500 → 0.4400 (-0.0100) | rejected (vs `caption_ablation`) | research-only | 10.0 h | CE improvement \\| not better |" in md
    assert "| 7 | lr_half | — | — | — | — | dropped | — | — | sibling of the kept lr change |" in md
    assert "| 8 | dpo_round2 | — | — | — | — | pending | — | — |  |" in md
    assert "status: **plan exhausted**" in md and "nothing here is typed by hand" in md
    assert "**Origin.** `runs/best` (facebook/musicgen-large, rights: releasable): CE improvement 0.1200, FAD to real 0.5000" in md
    assert "rights: releasable, captions `data/sets/run_best_captions.jsonl`" in md
    assert "scored on the origin's captions file `data/sets/run_best_captions.jsonl`" in md and "rejected on the numbers or failed" in md
    loop.write_log()
    written = (repo / il.LOG_REL).read_text()
    assert written.splitlines()[0] == md.splitlines()[0] and written.count("\n| ") == md.count("\n| ")


# --------------------------------------------------------------------------- dry run through main()

def test_dry_run_prints_commands_and_touches_nothing(repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    calls: list[list[str]] = []

    def fake_run(argv, *a, **k):
        calls.append(list(argv))
        raise AssertionError(f"dry run must not launch anything: {argv}")

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    ev = repo / "fake_eval.json"
    ev.write_text(json.dumps(_eval(0.12, 0.50)))
    il.main(["--best-run", "runs/best", "--eval-json", str(ev), "--dry-run", "--repo", str(repo), "--python", "/fake/python"])
    out = capsys.readouterr().out
    assert calls == [] and not (repo / il.STATE_REL).exists() and not (repo / il.LOG_REL).exists()
    assert "best: runs/best  facebook/musicgen-large  LoRA r128 α256  lr 3e-5  30 s clips  rights releasable" in out
    assert "CE improvement 0.1200, FAD to real 0.5000" in out
    assert "every variant is scored on data/sets/run_best_captions.jsonl" in out
    for v in ("1. clip45 -> runs/clip45", "2. caption_ablation -> runs/caption_ablation", "3. data_oud_plus_mix -> runs/data_oud_plus_mix",
              "4. lora_rank_x2 -> runs/lora_rank_x2: LoRA rank 128 → 256 (α 256 → 512)", "5. lora_rank_half", "6. lr_x2 -> runs/lr_x2: lr 3e-5 → 6e-5",
              "7. lr_half -> runs/lr_half: lr 3e-5 → 1.5e-5", "8. dpo_round2: SKIP — no DPO round"):
        assert v in out, v
    train = next(line for line in out.splitlines() if "tmux new-session -d -s lr_x2 " in line)
    inner = shlex.split(train)[-1]
    assert inner.startswith("caffeinate -s -i env HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false /fake/python -u -m scripts.scale_train --model facebook/musicgen-large --run-id lr_x2 --lr 6e-5 --total-steps 1500 --ckpt-every 250 --early-stop-patience 750 --batch-size 1 --grad-accum 4 --rank 128 --alpha 256 --captions ")
    assert "--sample-seconds 15 --mem-cap-gb 85" in inner and inner.endswith("2>&1; echo RUN_EXIT=$? >> " + shlex.quote(str(repo / "runs/lr_x2/train.log")))
    assert f"-c {repo / 'apps/ai-service'}" in train
    ev_line = next(line for line in out.splitlines() if "tmux new-session -d -s lr_x2_eval " in line)
    inner_ev = shlex.split(ev_line)[-1]
    assert "-m scripts.scale_eval --run runs/lr_x2 --model facebook/musicgen-large --tag lr_x2 --captions " in inner_ev
    assert "--rank 128 --alpha 256 --n-ab 16 --ab-seconds 30 --mert-real 64 --ab-captions data/ab_captions_ahmed.json --ab-rights ahmed_ilkacase_consented" in inner_ev
    assert "echo EVAL_EXIT=$?" in inner_ev
    # every variant trains on ITS captions but is scored on the origin's (pinned yardstick): caption_ablation and clip45
    origin_caps = str(repo / "data/sets/run_best_captions.jsonl")
    for run, train_caps in (("caption_ablation", str(repo / "data/sets/run_best_nogenre_captions.jsonl")),
                            ("clip45", str(repo / "data/sets_45s/run_clip45_captions.jsonl"))):
        tr = shlex.split(shlex.split(next(line for line in out.splitlines() if f"tmux new-session -d -s {run} " in line))[-1].split(" >> ")[0])
        ev_ = shlex.split(shlex.split(next(line for line in out.splitlines() if f"tmux new-session -d -s {run}_eval " in line))[-1].split(" >> ")[0])
        assert tr[tr.index("--captions") + 1] == train_caps, run
        assert ev_[ev_.index("--captions") + 1] == origin_caps and ev_[ev_.index("--tokens-dir") + 1] == str(repo / "data/sets/ahmed_oud/tokens"), run
    clip45_train = shlex.split(shlex.split(next(line for line in out.splitlines() if "tmux new-session -d -s clip45 " in line))[-1].split(" >> ")[0])
    assert clip45_train[clip45_train.index("--tokens-dir") + 1] == str(repo / "data/sets_45s/ahmed_oud/tokens")
    probe = next(line for line in out.splitlines() if "--run-id lr_x2_probe --smoke 20" in line)
    assert "--sample-seconds 5 --mem-cap-gb 85" in probe and "[skip if peak_driver_gb > 85]" in probe
    clip45_probe = next(line for line in out.splitlines() if "--run-id clip45_probe --smoke 20" in line)
    assert "[skip if peak_driver_gb > 60]" in clip45_probe and "data/sets_45s/ahmed_oud/captions.jsonl" in clip45_probe
    assert "scripts.build_sets --set ahmed_oud --seconds 45 --out-root data/sets_45s --limit 6" in out
    assert "scripts.scale_tokens --captions" in out and "--seconds 45" in out
    assert "scripts.build_sets --merge run_clip45 --sets ahmed_oud --out-root data/sets_45s --out data/sets_45s/run_clip45_captions.jsonl" in out
    assert "wait: tmux has-session -t =lr_x2" in out and "wait: tmux has-session -t =lr_x2_eval" in out
    assert "keep iff mert.fad_adapter_real < 0.5000 and per_song_ce.improvement.mean > 0.1200" in out
    assert "(dry run: nothing launched, nothing written" in out


def test_main_requires_best_run_without_state(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(shutil, "which", lambda name: None)
    with pytest.raises(SystemExit):
        il.main(["--dry-run", "--repo", str(repo)])


# --------------------------------------------------------------------------- one full attempt with a fake tmux / scale_train / scale_eval

class FakeProcesses:
    """subprocess.run stand-in: 'tmux new-session' immediately plays the launched
    scale_train / dpo_train / scale_eval command (log markers, checkpoint dir,
    eval JSON from a scripted metrics table); 'tmux has-session' says no session
    is live; foreground probes write a smoke report to their log."""

    def __init__(self, repo: Path, results: dict[str, tuple[float, float]], probe_peak: float = 20.0, fail_train: set[str] | None = None,
                 eval_exit: int | None = None, train_exit: int | None = None, probe_memcap: bool = False) -> None:
        """eval_exit: every scale_eval exits with that code and writes no JSON (its pre-checks);
        train_exit: every scale_train exits with that code before any checkpoint; probe_memcap: the
        foreground probe aborts on --mem-cap-gb (MEM_CAP_EXCEEDED line, exit 3, no report)."""
        self.repo, self.results, self.probe_peak, self.fail_train = repo, results, probe_peak, fail_train or set()
        self.eval_exit, self.train_exit, self.probe_memcap = eval_exit, train_exit, probe_memcap
        self.calls: list[list[str]] = []
        self.launched: list[str] = []

    def __call__(self, argv, *a, **k):
        argv = list(argv)
        self.calls.append(argv)
        if argv[:2] == ["tmux", "has-session"]:
            return subprocess.CompletedProcess(argv, 1)
        if argv[:2] == ["tmux", "new-session"]:
            name, shell = argv[argv.index("-s") + 1], argv[-1]
            self.launched.append(name)
            self.play(shell)
            return subprocess.CompletedProcess(argv, 0, "", "")
        if "--smoke" in argv:  # foreground probe under caffeinate
            if self.probe_memcap:
                k["stdout"].write("step 10/20 loss=3.1 mps_driver=86.2GB\nMEM_CAP_EXCEEDED driver=86.2GB > cap 85.0GB — aborting cleanly at step 11\n")
                return subprocess.CompletedProcess(argv, 3)
            k["stdout"].write(json.dumps({"peak_driver_gb": self.probe_peak, "est_full_run_hours": 1.0}) + "\nSCALE_TRAIN_DONE\n")
            return subprocess.CompletedProcess(argv, 0)
        return subprocess.CompletedProcess(argv, 0)

    def play(self, shell: str) -> None:
        cmd, _, rest = shell.partition(" >> ")
        argv = shlex.split(cmd)
        log = Path(shlex.split(rest.split(" 2>&1")[0])[0])
        log.parent.mkdir(parents=True, exist_ok=True)
        module = argv[argv.index("-m") + 1]
        if module == "scripts.scale_train":
            run_id = argv[argv.index("--run-id") + 1]
            if run_id in self.fail_train:
                log.write_text("MEM_CAP_EXCEEDED driver=90GB\nRUN_EXIT=3\n")
                return
            if self.train_exit is not None:
                with open(log, "a") as fh:
                    fh.write(f"Traceback (most recent call last):\n  ...\nFileNotFoundError: tokens missing\nRUN_EXIT={self.train_exit}\n")
                return
            steps = int(argv[argv.index("--total-steps") + 1])
            ck = self.repo / "runs" / run_id / f"ckpt_step_{steps:04d}"
            ck.mkdir(parents=True, exist_ok=True)
            if "--full-decoder" in argv:
                (ck / "decoder.safetensors").write_bytes(b"")
            else:
                (ck / "adapter_config.json").write_text("{}")
            log.write_text("step 1/1500 loss=3.1\nSCALE_TRAIN_DONE\nRUN_EXIT=0\n")
        elif module == "scripts.dpo_train":
            run_id = argv[argv.index("--run-id") + 1]
            ad = self.repo / "runs" / run_id / "round_1" / "adapter"
            ad.mkdir(parents=True, exist_ok=True)
            (ad / "adapter_config.json").write_text("{}")
            (ad.parent.parent / "ckpt_step_0040").symlink_to(Path("round_1/adapter"), target_is_directory=True)  # dpo_train's alias
            log.write_text("DPO_TRAIN_DONE\nRUN_EXIT=0\n")
        elif module == "scripts.scale_eval":
            tag = argv[argv.index("--tag") + 1]
            run_arg = argv[argv.index("--run") + 1]
            if self.eval_exit is not None:
                with open(log, "a") as fh:
                    fh.write(f"SystemExit: --ab-rights ['ahmed_ilkacase_consented']: no test row carries these rights; refusing to seed\nEVAL_EXIT={self.eval_exit}\n")
                return
            assert (self.repo / run_arg / "ckpt_step_1500").exists() or any((self.repo / run_arg).glob("ckpt_step_*")), f"{run_arg}: no checkpoint for scale_eval"
            ce, fad = self.results[tag]
            (self.repo / run_arg / f"eval_{tag}.json").write_text(json.dumps(_eval(ce, fad)))
            log.write_text("SCALE_EVAL_DONE\nEVAL_EXIT=0\n")
        else:
            raise AssertionError(f"unexpected module {module}")


def test_full_loop_keeps_composes_and_stops_after_two_failures(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeProcesses(repo, {"caption_ablation": (0.15, 0.45),   # better on both -> kept
                                "lr_x2": (0.16, 0.47),              # FAD worse than the new best 0.45 -> rejected
                                "lr_half": (0.10, 0.40),            # CE worse -> rejected -> two consecutive failures
                                "lora_rank_x2": (0.5, 0.1)})        # never reached
    monkeypatch.setattr(subprocess, "run", fake)
    monkeypatch.setattr(il, "sleep", lambda s: None)
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    il.main(["--best-run", "runs/best", "--plan", "caption_ablation,lr,lora_rank", "--repo", str(repo), "--python", "/fake/python"])
    state = json.loads((repo / il.STATE_REL).read_text())
    by = {a["variant"]: a for a in state["attempts"]}
    assert by["caption_ablation"]["status"] == "kept" and by["caption_ablation"]["d_fad"] == -0.05 and by["caption_ablation"]["d_ce"] == 0.03
    assert (repo / "data/sets/run_best_nogenre_captions.jsonl").exists()
    assert by["lr_x2"]["status"] == "rejected" and by["lr_x2"]["before"] == {"ce_improvement": 0.15, "fad": 0.45} and by["lr_x2"]["vs"] == "caption_ablation"
    assert by["lr_half"]["status"] == "rejected" and by["lr_half"]["before"]["fad"] == 0.45
    assert by["lora_rank_x2"]["status"] == "pending" and by["lora_rank_half"]["status"] == "pending"
    assert state["stopped"] == "2 consecutive failures" and state["consecutive_failures"] == 2
    best = state["best"]
    assert best["run"] == "caption_ablation" and best["transforms"] == ["nogenre"] and best["changes"] == ["caption_ablation"]
    assert best["captions"] == "data/sets/run_best_nogenre_captions.jsonl" and best["eval_json"] == "runs/caption_ablation/eval_caption_ablation.json"
    # the rejected lr runs trained on the composed (nogenre) captions with the composed run as the yardstick,
    # but every eval scored on the ORIGIN captions (pinned test split / real pool)
    lr_cmd = next(c for c in by["lr_x2"]["commands"] if "scale_train" in c)
    assert "run_best_nogenre_captions.jsonl" in lr_cmd and "--lr 6e-5" in lr_cmd and "--early-stop-patience 750" in lr_cmd
    for v in ("caption_ablation", "lr_x2", "lr_half"):
        ev_cmd = next(c for c in by[v]["commands"] if "scale_eval" in c)
        assert f"--captions {repo / 'data/sets/run_best_captions.jsonl'} " in ev_cmd and "nogenre" not in ev_cmd, v
        assert by[v]["research_only"] is False
    assert state["origin"]["eval_captions"] == "data/sets/run_best_captions.jsonl" and state["best"]["research_only"] is False
    assert fake.launched == ["caption_ablation", "caption_ablation_eval", "lr_x2", "lr_x2_eval", "lr_half", "lr_half_eval"]
    # every tmux check used exact-name matching
    assert all(c[3].startswith("=") for c in fake.calls if c[:2] == ["tmux", "has-session"])
    md = (repo / il.LOG_REL).read_text()
    assert "**kept** (vs `best`) | releasable |" in md and "status: **2 consecutive failures**" in md and "| `lr_half` |" in md
    assert "Current best.** `runs/caption_ablation`" in md and "transforms: nogenre" in md


def test_loop_marks_probe_over_cap_skipped_and_mem_cap_failed(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeProcesses(repo, {"lr_half": (0.2, 0.3)}, probe_peak=88.0)
    monkeypatch.setattr(subprocess, "run", fake)
    monkeypatch.setattr(il, "sleep", lambda s: None)
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    il.main(["--best-run", "runs/best", "--plan", "lr", "--repo", str(repo), "--python", "/fake/python", "--max-attempts", "5"])
    state = json.loads((repo / il.STATE_REL).read_text())
    by = {a["variant"]: a for a in state["attempts"]}
    assert by["lr_x2"]["status"] == "skipped" and "probe peak 88.0 GB > cap 85 GB" in by["lr_x2"]["note"]
    assert by["lr_half"]["status"] == "skipped" and fake.launched == []  # nothing trained, nothing counted as a failure
    assert state["consecutive_failures"] == 0 and state["stopped"] == "plan exhausted"

    for d in ("runs/_improve", "runs/lr_x2", "runs/lr_half"):   # a fresh loop; run dirs left behind would get a _2 suffix
        shutil.rmtree(repo / d)
    fake2 = FakeProcesses(repo, {"lr_half": (0.2, 0.3)}, fail_train={"lr_x2"})
    monkeypatch.setattr(subprocess, "run", fake2)
    il.main(["--best-run", "runs/best", "--plan", "lr", "--repo", str(repo), "--python", "/fake/python"])
    state = json.loads((repo / il.STATE_REL).read_text())
    by = {a["variant"]: a for a in state["attempts"]}
    assert by["lr_x2"]["status"] == "failed" and "memory cap (90 GB > 85 GB" in by["lr_x2"]["note"] and by["lr_x2"]["launches"] == 1
    assert by["lr_half"]["status"] == "kept" and state["best"]["run"] == "lr_half" and state["best"]["lr"] == pytest.approx(1.5e-5)
    assert state["consecutive_failures"] == 0   # the failure counted (1), the keep reset it


def test_resume_picks_up_a_finished_training_without_relaunching(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeProcesses(repo, {"lr_x2": (0.2, 0.3)})
    monkeypatch.setattr(subprocess, "run", fake)
    monkeypatch.setattr(il, "sleep", lambda s: None)
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    # a previous invocation launched lr_x2, which finished while the loop was away
    loop = _loop(repo)
    loop.init_state(_best(repo), ["lr_x2"], None, 1500, None)
    att = loop.state["attempts"][0]
    att.update({"status": "training", "stage": "train", "run_id": "lr_x2", "launches": 1, "started": il.now(), "prep_done": 1,
                "probe": {"peak_driver_gb": 30.0, "cap_gb": 85.0}})
    ck = repo / "runs/lr_x2/ckpt_step_1500"
    ck.mkdir(parents=True)
    (ck / "adapter_config.json").write_text("{}")
    (repo / "runs/lr_x2/train.log").write_text("SCALE_TRAIN_DONE\nRUN_EXIT=0\n")
    loop.save()
    il.main(["--repo", str(repo), "--python", "/fake/python"])          # no --best-run: resumes from state
    assert fake.launched == ["lr_x2_eval"]                             # training not relaunched, eval was
    state = json.loads((repo / il.STATE_REL).read_text())
    assert state["attempts"][0]["status"] == "kept" and state["attempts"][0]["steps_trained"] == 1500 and state["best"]["run"] == "lr_x2"


def test_resume_from_last_checkpoint_after_a_kill(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeProcesses(repo, {"lr_x2": (0.2, 0.3)})
    monkeypatch.setattr(subprocess, "run", fake)
    monkeypatch.setattr(il, "sleep", lambda s: None)
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    ck = repo / "runs/lr_x2/ckpt_step_0750"
    ck.mkdir(parents=True)
    (ck / "adapter_config.json").write_text("{}")
    (repo / "runs/lr_x2/train.log").write_text("step 760/1500 loss=3.0\n")      # killed: no RUN_EXIT
    (repo / "runs/lr_x2/probe.log").write_text(json.dumps({"peak_driver_gb": 30.0, "est_full_run_hours": 1}))
    loop = _loop(repo)
    loop.init_state(_best(repo), ["lr_x2"], None, 1500, None)
    loop.state["attempts"][0].update({"status": "training", "stage": "train", "run_id": "lr_x2", "launches": 1, "started": il.now(), "prep_done": 1})
    loop.save()
    il.main(["--repo", str(repo), "--python", "/fake/python"])
    resume_cmd = next(c[-1] for c in fake.calls if c[:2] == ["tmux", "new-session"] and "scale_train" in c[-1])
    assert f"--resume-from {repo / 'runs/lr_x2/ckpt_step_0750'} --start-step 750" in resume_cmd
    state = json.loads((repo / il.STATE_REL).read_text())
    assert state["attempts"][0]["launches"] == 2 and state["attempts"][0]["status"] == "kept"


def test_paused_run_is_resumed_from_its_checkpoint(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeProcesses(repo, {"lr_x2": (0.2, 0.3)})
    monkeypatch.setattr(subprocess, "run", fake)
    monkeypatch.setattr(il, "sleep", lambda s: None)
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    ck = repo / "runs/lr_x2/ckpt_step_0500"
    ck.mkdir(parents=True)
    (ck / "adapter_config.json").write_text("{}")
    (repo / "runs/lr_x2/train.log").write_text("MAX_HOURS_STOP step=500 elapsed_hours=20.0\nSCALE_TRAIN_PAUSED\nRUN_EXIT=0\n")
    loop = _loop(repo)
    loop.init_state(_best(repo), ["lr_x2"], None, 1500, None)
    loop.state["attempts"][0].update({"status": "training", "stage": "train", "run_id": "lr_x2", "launches": 1, "started": il.now(), "prep_done": 1})
    loop.save()
    il.main(["--repo", str(repo), "--python", "/fake/python"])
    resume_cmd = next(c[-1] for c in fake.calls if c[:2] == ["tmux", "new-session"] and "scale_train" in c[-1])
    assert f"--resume-from {repo / 'runs/lr_x2/ckpt_step_0500'} --start-step 500" in resume_cmd
    state = json.loads((repo / il.STATE_REL).read_text())
    assert state["attempts"][0]["status"] == "kept" and state["attempts"][0]["launches"] == 2


def test_helpers_mirror_the_orchestrator(tmp_path: Path) -> None:
    run = tmp_path / "run"
    (run / "ckpt_step_0250").mkdir(parents=True)
    (run / "ckpt_step_1000").mkdir()
    assert il.last_ckpt_step(run) == 1000 and not il.has_checkpoint(run)
    (run / "ckpt_step_1000" / "adapter_config.json").write_text("{}")
    assert il.has_checkpoint(run)
    full = tmp_path / "full"
    (full / "ckpt_step_0500").mkdir(parents=True)
    (full / "ckpt_step_0500" / "decoder.safetensors").write_bytes(b"")     # a full-decoder checkpoint counts too
    assert il.has_checkpoint(full)
    log = run / "train.log"
    assert il.last_exit(log, "RUN_EXIT") is None and not il.train_done(log, il.TRAIN_DONE)
    log.write_text("x\nRUN_EXIT=3\nresumed\nRUN_EXIT=0\n")
    assert il.last_exit(log, "RUN_EXIT") == 0 and il.last_exit(log, "EVAL_EXIT") is None
    assert not il.train_done(log, il.TRAIN_DONE)                              # exit 0 without the marker is not done
    log.write_text("MAX_HOURS_STOP step=500\nSCALE_TRAIN_PAUSED\nRUN_EXIT=0\n")
    assert not il.train_done(log, il.TRAIN_DONE)                              # a pause is resumed, not concluded
    log.write_text("EARLY_STOP step=1000 best_step=750\nSCALE_TRAIN_DONE\nRUN_EXIT=0\n")
    assert il.train_done(log, il.TRAIN_DONE)
    probe = run / "probe.log"
    probe.write_text('step 1/20 loss=3.4\n{\n  "model": "m",\n  "peak_driver_gb": 11.2,\n  "est_full_run_hours": 8.11\n}\nSCALE_TRAIN_DONE\n')
    assert il.probe_metrics(probe) == {"model": "m", "peak_driver_gb": 11.2, "est_full_run_hours": 8.11}
    assert il.probe_metrics(run / "missing.log") is None
    assert il.fmt_lr(3e-5) == "3e-5" and il.fmt_lr(6e-5) == "6e-5" and il.fmt_lr(1.5e-5) == "1.5e-5"
    assert il.fmt_lr(2.5e-5) == "2.5e-5" and il.fmt_lr(1e-4) == "1e-4" and il.fmt_lr(2e-5) == "2e-5"
    assert float(il.fmt_lr(2.5e-5)) == 2.5e-5  # the command line carries the exact value
    assert il.hours_between("2026-09-26T10:00:00", "2026-09-26T13:30:00") == pytest.approx(3.5)
    # relaunch policy: killed / paused -> up to MAX_LAUNCHES, exited with an error -> one retry
    assert il.may_relaunch(0, None) and il.may_relaunch(2, None) and not il.may_relaunch(3, None)
    assert il.may_relaunch(1, 0) and il.may_relaunch(1, 1) and not il.may_relaunch(2, 1)
    probe.write_text("step 10/20 loss=3.1\nMEM_CAP_EXCEEDED driver=86.2GB > cap 85.0GB — aborting cleanly at step 11\n")
    assert il.mem_cap_hit(probe) == 86.2 and il.mem_cap_hit(run / "missing.log") is None


# --------------------------------------------------------------------------- reviewer findings

def _no_launch(*a, **k):
    raise AssertionError(f"must not launch anything: {a[0] if a else k}")


def test_main_refuses_a_yardstick_without_both_numbers(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(subprocess, "run", _no_launch)
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    old = _eval(0.1016, 0.5)
    del old["mert"]                                   # a pre-Phase-3 eval (e.g. runs/qaraami_medium_r32/eval_medium.json)
    (repo / "runs/best/eval_best.json").write_text(json.dumps(old))
    with pytest.raises(SystemExit, match=r"no fad \(.*mert\.fad_adapter_real\).*--mert-real 64 on runs/best"):
        il.main(["--best-run", "runs/best", "--repo", str(repo), "--python", "/fake/python"])
    no_ce = _eval(0.1, 0.5)
    del no_ce["per_song_ce"]
    (repo / "runs/best/eval_best.json").write_text(json.dumps(no_ce))
    with pytest.raises(SystemExit, match="no ce_improvement"):
        il.main(["--best-run", "runs/best", "--repo", str(repo), "--python", "/fake/python", "--dry-run"])
    assert not (repo / il.STATE_REL).exists() and not (repo / il.LOG_REL).exists()


def test_two_failed_attempts_stop_the_loop(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(il, "sleep", lambda s: None)
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    # scale_eval fails its pre-checks every time (EVAL_EXIT=1, no JSON): one retry, then failed; two failed attempts stop the loop
    fake = FakeProcesses(repo, {}, eval_exit=1)
    monkeypatch.setattr(subprocess, "run", fake)
    il.main(["--best-run", "runs/best", "--plan", "caption_ablation,lr,lora_rank", "--repo", str(repo), "--python", "/fake/python"])
    state = json.loads((repo / il.STATE_REL).read_text())
    by = {a["variant"]: a for a in state["attempts"]}
    assert by["caption_ablation"]["status"] == "failed" and by["caption_ablation"]["eval_launches"] == 2
    assert "last EVAL_EXIT=1" in by["caption_ablation"]["note"]
    assert by["lr_x2"]["status"] == "failed" and by["lr_half"]["status"] == "pending" and by["lora_rank_x2"]["status"] == "pending"
    assert state["stopped"] == "2 consecutive failures" and state["consecutive_failures"] == 2
    assert fake.launched == ["caption_ablation", "caption_ablation_eval", "caption_ablation_eval", "lr_x2", "lr_x2_eval", "lr_x2_eval"]
    assert "| failed |" in (repo / il.LOG_REL).read_text()
    # scale_train crashes before its first checkpoint (RUN_EXIT=1): one retry, then failed
    for d in ("runs/_improve", "runs/caption_ablation", "runs/lr_x2"):
        shutil.rmtree(repo / d)
    fake2 = FakeProcesses(repo, {}, train_exit=1)
    monkeypatch.setattr(subprocess, "run", fake2)
    il.main(["--best-run", "runs/best", "--plan", "lr,lora_rank", "--repo", str(repo), "--python", "/fake/python"])
    state = json.loads((repo / il.STATE_REL).read_text())
    by = {a["variant"]: a for a in state["attempts"]}
    assert by["lr_x2"]["status"] == "failed" and by["lr_x2"]["launches"] == 2 and "last RUN_EXIT=1" in by["lr_x2"]["note"]
    assert by["lr_half"]["status"] == "failed" and by["lora_rank_x2"]["status"] == "pending"
    assert state["stopped"] == "2 consecutive failures" and fake2.launched == ["lr_x2", "lr_x2", "lr_half", "lr_half"]


def test_probe_mem_cap_abort_is_a_skip_with_the_peak(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeProcesses(repo, {}, probe_memcap=True)
    monkeypatch.setattr(subprocess, "run", fake)
    monkeypatch.setattr(il, "sleep", lambda s: None)
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    il.main(["--best-run", "runs/best", "--plan", "lr", "--repo", str(repo), "--python", "/fake/python"])
    state = json.loads((repo / il.STATE_REL).read_text())
    by = {a["variant"]: a for a in state["attempts"]}
    for v in ("lr_x2", "lr_half"):
        assert by[v]["status"] == "skipped" and by[v]["note"] == "probe hit the memory cap (86.2 GB > 85 GB)"
        assert by[v]["probe"] == {"peak_driver_gb": 86.2, "cap_gb": 85.0, "mem_cap_exceeded": True}
    assert state["consecutive_failures"] == 0 and state["stopped"] == "plan exhausted" and fake.launched == []
    md = (repo / il.LOG_REL).read_text()
    assert "| skipped | — | " in md and "probe hit the memory cap (86.2 GB > 85 GB) |" in md and md.count("86.2") == 2


def test_config_from_run_understands_legacy_lora_and_dpo_products(repo: Path) -> None:
    ev = repo / "runs/best/eval_best.json"
    # a LoRA run whose config.json predates the "rank" key: the checkpoint's adapter_config.json knows
    legacy = repo / "runs/legacy_r16"
    (legacy / "ckpt_step_0500").mkdir(parents=True)
    (legacy / "config.json").write_text(json.dumps({"model": "facebook/musicgen-small", "lr": 1e-4, "captions": str(repo / "data/sets/run_best_captions.jsonl")}))
    with pytest.raises(SystemExit, match='no "rank" and no adapter checkpoint'):
        il.config_from_run(legacy, ev, repo)
    (legacy / "ckpt_step_0500/adapter_config.json").write_text(json.dumps({"r": 16, "lora_alpha": 32, "target_modules": ["q_proj", "v_proj"]}))
    cfg = il.config_from_run(legacy, ev, repo)
    assert not cfg.full and cfg.rank == 16 and cfg.alpha == 32 and cfg.targets == ["q_proj", "v_proj"] and cfg.adapter is None
    loop = _loop(repo, dry_run=True)
    loop.init_state(cfg, ["lr", "lora_rank"], None, 1500, None)
    argv = loop.train_argv(loop.derive({"variant": "lr_x2", "group": "lr", "status": "pending"}, cfg).cfg, "lr_x2", 1500)
    assert "--full-decoder" not in argv and argv[argv.index("--rank") + 1] == "16" and argv[argv.index("--targets"):argv.index("--targets") + 3] == ["--targets", "q_proj", "v_proj"]
    assert loop.derive({"variant": "lora_rank_half", "group": "lora_rank", "status": "pending"}, cfg).cfg.rank == 8
    # a DPO product: the recipe is the source SFT run's (lr 3e-5, r128), the adapter its latest round
    dpo = _dpo_run(repo, "dpo_x", MODEL, 0.40, str(repo / "runs/best/ckpt_step_1500"), key="adapter")
    (dpo / "round_2" / "adapter").mkdir(parents=True)
    (dpo / "round_2" / "adapter" / "adapter_config.json").write_text(json.dumps({"r": 128, "lora_alpha": 256}))
    cfg = il.config_from_run(dpo, ev, repo)
    assert cfg.run == "dpo_x" and cfg.lr == pytest.approx(3e-5) and cfg.rank == 128 and cfg.alpha == 256 and not cfg.full
    assert cfg.adapter == "runs/dpo_x/round_2/adapter" and cfg.captions == "data/sets/run_best_captions.jsonl"
    loop = _loop(repo, dry_run=True)
    loop.init_state(cfg, ["lr", "dpo_round2"], None, 1500, None)
    d = loop.derive({"variant": "lr_x2", "group": "lr", "status": "pending"}, cfg)
    assert d.cfg.adapter is None and d.cfg.lr == pytest.approx(6e-5) and "--full-decoder" not in loop.train_argv(d.cfg, d.run_id, 1500)
    d2 = loop.derive({"variant": "dpo_round2", "group": "dpo_round2", "status": "pending"}, cfg)
    assert d2.dpo_source == "runs/dpo_x/round_1/adapter"      # the origin DPO run is its own lineage
    # a DPO product whose source run has no config.json is refused instead of guessed at
    (dpo / "config.json").write_text(json.dumps({"model": MODEL, "start_adapter": str(repo / "runs/gone/ckpt_step_0100"), "lr": 2e-5}))
    with pytest.raises(SystemExit, match="DPO product .* start the loop from the SFT run"):
        il.config_from_run(dpo, ev, repo)
    # a full-decoder run is full only when config.json says so
    (legacy / "config.json").write_text(json.dumps({"model": "facebook/musicgen-small", "lr": 1e-4, "full_decoder": True, "rank": 32,
                                                    "captions": str(repo / "data/sets/run_best_captions.jsonl")}))
    assert il.config_from_run(legacy, ev, repo).full


def test_relative_config_paths_resolve_against_apps_ai_service(repo: Path) -> None:
    run = repo / "runs/relcap"
    run.mkdir()
    (run / "config.json").write_text(json.dumps({"model": MODEL, "lr": 3e-5, "rank": 32, "alpha": 64,
                                                 "captions": "../../data/sets/run_best_captions.jsonl", "tokens_dir": "../../data/sets/ahmed_oud/tokens"}))
    cfg = il.config_from_run(run, repo / "runs/best/eval_best.json", repo)
    assert cfg.captions == "data/sets/run_best_captions.jsonl" and cfg.tokens_dir == "data/sets/ahmed_oud/tokens" and cfg.seconds == 30.0
    loop = _loop(repo, dry_run=True)
    loop.init_state(cfg, ["caption_ablation"], None, 1500, None)
    d = loop.derive({"variant": "caption_ablation", "group": "caption_ablation", "status": "pending"}, cfg)
    assert d.cfg.captions == "data/sets/run_relcap_nogenre_captions.jsonl"
    assert loop.train_argv(d.cfg, d.run_id, 1500)[loop.train_argv(d.cfg, d.run_id, 1500).index("--tokens-dir") + 1] == str(repo / "data/sets/ahmed_oud/tokens")
    (run / "config.json").write_text(json.dumps({"model": MODEL, "lr": 3e-5, "rank": 32, "alpha": 64, "captions": "../../data/missing.jsonl"}))
    with pytest.raises(SystemExit, match="captions '../../data/missing.jsonl' not found"):
        il.config_from_run(run, repo / "runs/best/eval_best.json", repo)
    assert il.run_name_of("../../runs/best/ckpt_step_0500", repo) == "best" and il.run_name_of(str(repo / "runs/x/ckpt_step_1"), repo) == "x"
    assert il.run_name_of("/elsewhere/runs/x/ckpt", repo) is None and il.run_name_of(None, repo) is None


def test_materialise_refuses_a_file_without_train_or_test_rows(repo: Path) -> None:
    oud = [r for r in _rows("ahmed_oud", "oud", 20) if r["split"] != "test"]           # oud rows only in train / val
    mix = [dict(r, split="test") for r in _rows("ahmed_mix", "full_mix", 5)]         # test rows only in the mixes
    _write_rows(repo / "data/sets/run_mixtest_captions.jsonl", oud + mix)
    with pytest.raises(il.Skip, match="run_mixtest_oud_only.jsonl: no test rows after oud_only"):
        il.materialise("data/sets/run_mixtest_captions.jsonl", ["oud_only"], "data/sets/run_mixtest_oud_only.jsonl", repo)
    assert not (repo / "data/sets/run_mixtest_oud_only.jsonl").exists()
    _write_rows(repo / "data/sets/run_testonly_captions.jsonl", [dict(r, split="test") for r in _rows("ahmed_oud", "oud", 4)])
    with pytest.raises(il.Skip, match="no train rows"):
        il.materialise("data/sets/run_testonly_captions.jsonl", ["nogenre"], "data/sets/run_testonly_nogenre.jsonl", repo)


def test_oud_only_keeps_separated_oud_stems(repo: Path) -> None:
    rows = (_rows("ahmed_oud", "oud", 5) + _rows("sep_oud", "sep_oud", 5) + _rows("harvard_sep_oud", "sep_oud", 5)
            + _rows("ahmed_mix", "full_mix", 5) + _rows("ahmed_vocal", "voice", 3) + _rows("internet_oud", "oud", 2))
    kept = il.apply_transform(rows, "oud_only", repo)
    assert len(kept) == 17 and {r["content"] for r in kept} == {"oud", "sep_oud"}
    assert {r["source"] for r in kept} == {"ahmed_oud", "sep_oud", "harvard_sep_oud", "internet_oud"}


def test_resume_only_keeps_an_unresolved_data_attempt(repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    monkeypatch.setattr(subprocess, "run", _no_launch)
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    loop = _loop(repo)
    loop.init_state(_best(repo), il.DEFAULT_PLAN, None, 1500, None)
    loop.save()
    il.main(["--repo", str(repo), "--only", "data_oud_only", "--dry-run", "--python", "/fake/python"])
    out = capsys.readouterr().out
    assert "1 attempts pending" in out and "1. data_oud_only -> runs/data_oud_only" in out     # not dropped, direction pinned
    il.main(["--repo", str(repo), "--only", "data", "--dry-run", "--python", "/fake/python"])
    out = capsys.readouterr().out
    assert "1 attempts pending" in out and "1. data_oud_plus_mix -> runs/data_oud_plus_mix" in out  # group named: resolved against the best
    il.main(["--repo", str(repo), "--only", "lr_x2", "--dry-run", "--python", "/fake/python"])
    assert "1 attempts pending" in capsys.readouterr().out


def test_clip45_builds_the_mix_set_after_a_kept_plus_mix(repo: Path) -> None:
    best = _best(repo)
    il.materialise(best.base_captions, ["plus_mix"], "data/sets/run_best_plus_mix_captions.jsonl", repo)
    plus = il.replace(best, transforms=["plus_mix"], captions="data/sets/run_best_plus_mix_captions.jsonl")
    loop = _loop(repo, dry_run=True)
    loop.init_state(plus, ["clip45"], None, 1500, None)
    d = loop.derive({"variant": "clip45", "group": "clip45", "status": "pending"}, plus)
    builds = [s.argv for s in d.prep if s.kind == "fg" and s.argv[:2] == ["scripts.build_sets", "--set"] and "--limit" not in s.argv]
    assert [b[2] for b in builds] == ["ahmed_oud", "ahmed_mix"] and all(b[3:5] == ["--seconds", "45"] for b in builds)
    toks = [s.argv for s in d.prep if s.argv and s.argv[0] == "scripts.scale_tokens"]
    assert any("data/sets_45s/ahmed_mix/captions.jsonl" in a for t in toks for a in t)
    merge = next(s.argv for s in d.prep if s.argv and s.argv[:2] == ["scripts.build_sets", "--merge"])
    assert merge[merge.index("--sets") + 1:merge.index("--out-root")] == ["ahmed_oud"]      # the transform re-adds ahmed_mix
    assert d.prep[-1].kind == "py" and d.cfg.captions == "data/sets_45s/run_clip45_plus_mix_captions.jsonl"
    # without the kept transform ahmed_mix is not built
    d0 = loop.derive({"variant": "clip45", "group": "clip45", "status": "pending"}, best)
    assert [s.argv[2] for s in d0.prep if s.kind == "fg" and s.argv[:2] == ["scripts.build_sets", "--set"]] == ["ahmed_oud", "ahmed_oud"]


def test_dpo_round2_runs_end_to_end_through_the_ckpt_alias(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _dpo_run(repo, "dpo_lin", MODEL, 0.45, str(repo / "runs/best/ckpt_step_1500"))
    fake = FakeProcesses(repo, {"dpo_round2": (0.2, 0.3)})
    monkeypatch.setattr(subprocess, "run", fake)
    monkeypatch.setattr(il, "sleep", lambda s: None)
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    il.main(["--best-run", "runs/best", "--plan", "dpo_round2", "--repo", str(repo), "--python", "/fake/python"])
    state = json.loads((repo / il.STATE_REL).read_text())
    att = state["attempts"][0]
    assert att["status"] == "kept" and att["eval_json"] == "runs/dpo_round2/eval_dpo_round2.json" and att["kind"] == "dpo"
    assert (repo / "runs/dpo_round2/ckpt_step_0040").is_symlink() and not (repo / "runs/dpo_round2/round_1/adapter/eval_dpo_round2.json").exists()
    ev_cmd = next(c for c in att["commands"] if "scale_eval" in c)
    assert "--run runs/dpo_round2 " in ev_cmd and f"--captions {repo / 'data/sets/run_best_captions.jsonl'} " in ev_cmd
    assert state["best"]["adapter"] == "runs/dpo_round2/round_1/adapter" and state["best"]["changes"] == ["dpo_round2"]
    assert "DPO round" in (repo / il.LOG_REL).read_text()


def test_rights_follow_the_training_rows(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    mix = [dict(r, rights="harvard_research_only", source="harvard_full") for r in il.read_rows(repo / "data/sets/ahmed_mix/captions.jsonl")]
    _write_rows(repo / "data/sets/ahmed_mix/captions.jsonl", mix)         # the mixes this fixture adds are research-only
    fake = FakeProcesses(repo, {"data_oud_plus_mix": (0.2, 0.3)})
    monkeypatch.setattr(subprocess, "run", fake)
    monkeypatch.setattr(il, "sleep", lambda s: None)
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    il.main(["--best-run", "runs/best", "--plan", "data", "--repo", str(repo), "--python", "/fake/python"])
    state = json.loads((repo / il.STATE_REL).read_text())
    assert state["origin"]["research_only"] is False and state["attempts"][0]["research_only"] is True and state["best"]["research_only"] is True
    md = (repo / il.LOG_REL).read_text()
    assert "**kept** (vs `best`) | research-only |" in md and "rights: research-only, captions `data/sets/run_best_plus_mix_captions.jsonl`" in md
    assert "(facebook/musicgen-large, rights: releasable)" in md         # the origin stays releasable
