"""Unit tests for the qaraami-v2 extensions of scripts/dpo_train.py: the
full-decoder refusal, tokens_dir-aware row selection for the CE guard, the
--prompts-from prompt bank with its grammar fallback, the checkpoint alias and
the summary.json register_adapter reads; plus the bash helpers of
runs/_tools/recipes_v2.sh and orchestrate_v2.sh (sourced under /bin/bash 3.2
with ORCHESTRATE_V2_LIB=1 and REPO pointing at a tmp_path fixture: nothing is
launched). Fixtures only: synthesised token files in tmp_path, no model, GPU,
corpus, tmux or network."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from scripts import dpo_train as dpo

AI_DIR = Path(__file__).resolve().parents[1]
TOOLS = Path(__file__).resolve().parents[3] / "runs" / "_tools"
BASH = "/bin/bash"


def bash(script: str, repo: Path, env: dict[str, str] | None = None, lib: bool = True, dry: bool = False) -> subprocess.CompletedProcess:
    """Run `script` under /bin/bash (3.2 on macOS) after sourcing the orchestrator as
    a library (or only the recipes with lib=False), REPO = the fixture, PY = this
    interpreter, dry = the orchestrator's --dry-run (ORCHESTRATE_V2_DRY); cwd
    apps/ai-service so the inline python imports scripts.*."""
    src = f". {TOOLS}/orchestrate_v2.sh" if lib else f". {TOOLS}/recipes_v2.sh"
    full_env = {**os.environ, "REPO": str(repo), "PY": sys.executable, "ORCHESTRATE_V2_LIB": "1", "ORCHESTRATE_V2_DRY": "1" if dry else "0",
                "HF_HUB_OFFLINE": "1", "TOKENIZERS_PARALLELISM": "false", **(env or {})}
    return subprocess.run([BASH, "-c", f"{src}\n{script}"], cwd=AI_DIR, env=full_env, capture_output=True, text=True, timeout=600)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A fixture checkout: runs/_tools (the log), data/sets, apps/ai-service/scripts (existence checks only)."""
    for d in ("runs/_tools", "data/sets", "apps/ai-service/scripts"):
        (tmp_path / d).mkdir(parents=True)
    (tmp_path / "apps/ai-service/scripts/register_adapter.py").write_text("# fixture: existence is all the orchestrator checks\n")
    return tmp_path


def write_set(repo: Path, name: str, rights: str, n: int = 2, content: str = "oud", split: str = "train") -> Path:
    """data/sets/<name>/captions.jsonl under the fixture; rows carry an ABSOLUTE tokens_dir
    (a repo-relative one would resolve against the real checkout, scale_train.REPO)."""
    d = repo / "data" / "sets" / name
    d.mkdir(parents=True, exist_ok=True)
    rows = [row(name, i, split, rights, content, CAP_OUD, str(d / "tokens")) for i in range(n)]
    (d / "captions.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    return d

CAP_OUD = "qaraami, Somali traditional song, led by the oud (kaban), moderate at 100 BPM, pentatonic melody rooted on A, studio recording"
CAP_MIX = "qaraami, Somali traditional song, led by vocals and ensemble, lively at 130 BPM, pentatonic melody rooted on D"
CAP_HARVARD = "Somali song, led by vocals, moderate at 110 BPM, vintage archival cassette recording, performed by X"
CAP_CONTRIB = "qaraami, Somali traditional song, led by the oud (kaban), slow at 72 BPM, pentatonic melody rooted on E, home recording"


def row(set_name: str, i: int, split: str, rights: str, content: str, caption: str, tokens_dir: str | None) -> dict:
    r = {"clip_path": f"data/sets/{set_name}/clips/{split}/{set_name}_{i:012x}_seg000.wav", "caption": caption,
         "song_sha256": f"{i:064x}", "split": split, "source": set_name, "rights": rights, "content": content}
    if tokens_dir:
        r["tokens_dir"] = tokens_dir
    return r


@pytest.fixture
def corpus(tmp_path: Path) -> tuple[Path, list[dict]]:
    """A merged run captions file (rows carry absolute tokens_dir under tmp_path) plus token files."""
    tok = tmp_path / "tok"
    tok.mkdir()
    rows = []
    for i in range(6):
        rows.append(row("ahmed_oud", i, "test", "ahmed_ilkacase_consented", "oud", f"{CAP_OUD} {i % 3}", str(tok)))
    for i in range(6, 9):
        rows.append(row("ahmed_oud", i, "train", "ahmed_ilkacase_consented", "oud", CAP_OUD, str(tok)))
    rows.append(row("ahmed_mix", 20, "test", "ahmed_ilkacase_consented", "full_mix", CAP_MIX, str(tok)))
    rows.append(row("harvard_full", 30, "test", "harvard_research_only", "full_mix", CAP_HARVARD, str(tok)))
    rows.append(row("contrib_amina_oud", 40, "test", "contrib_amina_consented", "oud", CAP_CONTRIB, str(tok)))
    rows.append(row("contrib_bob_oud", 41, "test", "contrib_bob_research_only", "oud", CAP_CONTRIB + " b", str(tok)))
    for r in rows:
        np.save(tok / (Path(r["clip_path"]).stem + ".npy"), np.zeros((4, 12), dtype=np.int16))
    cap = tmp_path / "run_captions.jsonl"
    cap.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return cap, rows


# --- rights / row classification -----------------------------------------------

def test_is_consented_rights() -> None:
    assert dpo.is_consented("ahmed_ilkacase_consented")
    assert dpo.is_consented("internet_cc")
    assert dpo.is_consented("contrib_amina_consented")
    assert not dpo.is_consented("harvard_research_only")
    assert not dpo.is_consented("contrib_bob_research_only")
    assert not dpo.is_consented(None)
    assert not dpo.is_consented("")


def test_is_oud_row_new_sets_and_legacy_source() -> None:
    assert dpo.is_oud_row({"source": "ahmed_oud", "content": "oud"})
    assert dpo.is_oud_row({"source": "sep_oud", "content": "oud"})
    assert dpo.is_oud_row({"source": "oud_ilkacase"})                 # legacy scale captions
    assert dpo.is_oud_row({"source": "contrib_amina_oud"})
    assert not dpo.is_oud_row({"source": "ahmed_mix", "content": "full_mix"})
    assert not dpo.is_oud_row({"source": "harvard_full"})


# --- (c) prompt bank from consented test captions ------------------------------

def test_prompts_from_captions_consented_distinct_test_only(corpus) -> None:
    cap, _ = corpus
    bank = dpo.prompts_from_captions(cap)
    assert bank == sorted(bank) and len(bank) == len(set(bank))
    assert {f"{CAP_OUD} 0", f"{CAP_OUD} 1", f"{CAP_OUD} 2", CAP_MIX, CAP_CONTRIB} == set(bank)
    assert CAP_HARVARD not in bank and CAP_CONTRIB + " b" not in bank   # research-only rows never become prompts
    assert CAP_OUD not in bank                                           # train rows are not in the bank


def test_build_prompt_bank_uses_captions_else_grammar(corpus, tmp_path: Path) -> None:
    cap, _ = corpus
    bank, source = dpo.build_prompt_bank(cap)
    assert source == f"captions:{cap}" and len(bank) == 5
    only_harvard = tmp_path / "h.jsonl"
    only_harvard.write_text(json.dumps(row("harvard_full", 1, "test", "harvard_research_only", "full_mix", CAP_HARVARD, None)) + "\n")
    bank, source = dpo.build_prompt_bank(only_harvard)
    assert source == "grammar" and bank == dpo.prompt_bank()
    bank, source = dpo.build_prompt_bank(None)
    assert source == "grammar" and bank == dpo.prompt_bank()
    with pytest.raises(SystemExit, match="file not found"):
        dpo.build_prompt_bank(tmp_path / "nope.jsonl")


def test_split_prompts_custom_bank_disjoint_and_clipped() -> None:
    bank = [f"p{i}" for i in range(10)]
    train, ev = dpo.split_prompts(3, seed=1, bank=bank)
    assert not set(train) & set(ev) and set(train) | set(ev) == set(bank) and len(ev) == 3
    train, ev = dpo.split_prompts(50, seed=1, bank=bank)     # eval clipped to half the bank
    assert len(ev) == 5 and len(train) == 5
    train, ev = dpo.split_prompts(4, bank=["solo"])          # a one-prompt bank trains and evaluates on it
    assert train == ["solo"] and ev == ["solo"]
    t1, e1 = dpo.split_prompts(32)
    t2, e2 = dpo.split_prompts(32)
    assert (t1, e1) == (t2, e2) and len(e1) == 32 and set(t1) | set(e1) == set(dpo.prompt_bank())


# --- (a) full-decoder checkpoints are refused ----------------------------------

def test_adapter_kind_and_require_lora_adapter(tmp_path: Path) -> None:
    lora = tmp_path / "ckpt_step_0250"
    lora.mkdir()
    (lora / "adapter_config.json").write_text("{}")
    (lora / "adapter_model.safetensors").write_bytes(b"x")
    full = tmp_path / "full" / "ckpt_step_0500"
    full.mkdir(parents=True)
    (full / "model.safetensors").write_bytes(b"x")
    (full / "config.json").write_text("{}")
    harness_full = tmp_path / "harness" / "ckpt_step_0750"          # scale_train --full-decoder layout
    harness_full.mkdir(parents=True)
    (harness_full / "decoder.safetensors").write_bytes(b"x")
    (harness_full / "ckpt_meta.json").write_text(json.dumps({"kind": "full_decoder", "step": 750}))
    assert dpo.adapter_kind(lora) == "lora"
    assert dpo.adapter_kind(full) == "full"
    assert dpo.adapter_kind(harness_full) == "full"
    assert dpo.adapter_kind(tmp_path / "missing") == "missing"
    with pytest.raises(SystemExit, match="decoder.safetensors"):
        dpo.require_lora_adapter(harness_full)
    assert dpo.require_lora_adapter(lora) == lora
    with pytest.raises(SystemExit, match="FULL-DECODER checkpoint"):
        dpo.require_lora_adapter(full)
    with pytest.raises(SystemExit, match="LoRA policies"):
        dpo.require_lora_adapter(full)
    with pytest.raises(SystemExit, match="no checkpoint"):
        dpo.require_lora_adapter(tmp_path / "missing")


def test_main_refuses_full_decoder_before_loading_any_model(tmp_path: Path, monkeypatch) -> None:
    full = tmp_path / "ckpt_step_0500"
    full.mkdir()
    (full / "pytorch_model.bin").write_bytes(b"x")
    monkeypatch.setattr(dpo, "RUNS_DIR", tmp_path / "runs")

    def boom(*a, **k):
        raise AssertionError("a model was loaded before the adapter check")
    monkeypatch.setattr(dpo.AutoProcessor, "from_pretrained", boom)
    monkeypatch.setattr(dpo, "load_policy", boom)
    monkeypatch.setattr("sys.argv", ["dpo_train", "--model", "facebook/musicgen-medium", "--adapter", str(full), "--tag", "t"])
    with pytest.raises(SystemExit, match="FULL-DECODER"):
        dpo.main()


# --- (b) rows with tokens_dir --------------------------------------------------

def test_resolve_tokens_dir(tmp_path: Path, monkeypatch, corpus) -> None:
    cap, rows = corpus
    assert dpo.resolve_tokens_dir(cap, str(tmp_path / "cli"), rows) == tmp_path / "cli"   # the CLI dir wins
    assert dpo.resolve_tokens_dir(cap, None, rows) is None                                 # every row carries tokens_dir
    legacy = tmp_path / "scale_captions.jsonl"
    legacy.write_text(json.dumps(row("oud_ilkacase", 1, "test", "oud_ilkacase", None, CAP_OUD, None)) + "\n")
    monkeypatch.setattr(dpo, "LEGACY_CAPTIONS", legacy)
    legacy_rows = [json.loads(legacy.read_text())]
    assert dpo.resolve_tokens_dir(legacy, None, legacy_rows) == dpo.LEGACY_TOKENS
    with pytest.raises(SystemExit, match="no tokens_dir"):
        dpo.resolve_tokens_dir(cap, None, rows + legacy_rows)


def test_guard_rows_oud_test_rows_sorted_and_strided(corpus) -> None:
    _, rows = corpus
    test = [r for r in rows if r["split"] == "test"]
    picked = dpo.guard_rows(test, 64)
    assert all(dpo.is_oud_row(r) for r in picked)
    assert {r["source"] for r in picked} == {"ahmed_oud", "contrib_amina_oud", "contrib_bob_oud"}   # the guard is CE only: rights do not matter
    assert [r["clip_path"] for r in picked] == sorted(r["clip_path"] for r in picked)
    assert len(dpo.guard_rows(test, 4)) == 4
    assert dpo.guard_rows([r for r in test if r["source"] == "ahmed_mix"], 8) == []
    assert dpo.guard_rows(test, 0) == []


def test_check_tokens_uses_row_tokens_dir(corpus, tmp_path: Path) -> None:
    cap, rows = corpus
    dpo.check_tokens(rows, None)                          # every row resolves through its own tokens_dir
    orphan = row("ahmed_oud", 99, "test", "ahmed_ilkacase_consented", "oud", CAP_OUD, str(tmp_path / "tok"))
    with pytest.raises(SystemExit, match="token files missing"):
        dpo.check_tokens(rows + [orphan], None)
    no_dir = row("ahmed_oud", 98, "test", "ahmed_ilkacase_consented", "oud", CAP_OUD, None)
    with pytest.raises(SystemExit, match="tokens_dir"):
        dpo.check_tokens([no_dir], None)


def test_main_checks_rows_and_records_config_before_models_load(tmp_path: Path, monkeypatch, corpus) -> None:
    """--captions with tokens_dir rows, --prompts-from and the candidate budget all
    land in config.json; the run stops at the (monkeypatched) model load."""
    cap, _ = corpus
    lora = tmp_path / "ckpt_step_0250"
    lora.mkdir()
    (lora / "adapter_config.json").write_text("{}")
    monkeypatch.setattr(dpo, "RUNS_DIR", tmp_path / "runs")
    monkeypatch.setattr(dpo, "DATA", tmp_path / "data")

    class Stop(Exception):
        pass

    def stop(*a, **k):
        raise Stop
    monkeypatch.setattr(dpo.AutoProcessor, "from_pretrained", stop)
    monkeypatch.setattr("sys.argv", ["dpo_train", "--model", "facebook/musicgen-large", "--adapter", str(lora), "--tag", "v2_t",
                                     "--captions", str(cap), "--prompts-from", str(cap), "--prompts-per-round", "2",
                                     "--samples-per-prompt", "4", "--eval-prompts", "2", "--ce-clips", "3"])
    with pytest.raises(Stop):
        dpo.main()
    cfg = json.loads((tmp_path / "runs" / "dpo_v2_t" / "config.json").read_text())
    assert cfg["candidates_per_round"] == 8 and "per ROUND" in cfg["candidates_note"]
    assert cfg["prompt_bank_source"] == f"captions:{cap}" and cfg["prompt_bank"] == 5
    assert cfg["tokens_dir"] is None and cfg["start_adapter"] == str(lora)
    prompts = json.loads((tmp_path / "runs" / "dpo_v2_t" / "prompts.json").read_text())
    assert len(prompts["eval"]) == 2 and not set(prompts["eval"]) & set(prompts["train"])
    assert CAP_HARVARD not in prompts["train"] + prompts["eval"]


# --- checkpoint alias -------------------------------------------------------------

def test_alias_checkpoint_symlink_is_relative_and_replaced(tmp_path: Path) -> None:
    run = tmp_path / "dpo_x"
    adapter = run / "round_1" / "adapter"
    adapter.mkdir(parents=True)
    (adapter / "adapter_config.json").write_text("{}")
    alias = dpo.alias_checkpoint(run, adapter, 62)
    assert alias == run / "ckpt_step_0062" and alias.is_symlink()
    assert not Path(alias.readlink()).is_absolute() and (alias / "adapter_config.json").exists()
    adapter2 = run / "round_2" / "adapter"
    adapter2.mkdir(parents=True)
    assert dpo.alias_checkpoint(run, adapter2, 62).resolve() == adapter2.resolve()   # re-pointed, not duplicated
    real = run / "ckpt_step_0100"
    real.mkdir()
    assert dpo.alias_checkpoint(run, adapter2, 100) == real and not real.is_symlink()  # a real dir is left alone


# --- (d) summary.json ------------------------------------------------------------

def round_summary(rnd: int, ce_before: float, ce_after: float, fad_before: float, fad_after: float) -> dict:
    return {"round": rnd, "prompts": 64, "samples": 256, "pairs": 60, "steps": 60,
            "held_out_oud_token_ce": {"before": ce_before, "after": ce_after, "clips": 64},
            "before": {"reward": -0.5, "oud_dist": 5.1, "pcs": 0.92, "voiced_fraction": 0.5},
            "after": {"reward": 0.5, "oud_dist": 4.1, "pcs": 0.93, "voiced_fraction": 0.55},
            "fad_to_real_oud_test": {"before": fad_before, "after": fad_after},
            "ab_dir": "/repo/data/ab_dpo_v2_qaraami_large", "adapter": f"/repo/runs/dpo_v2_qaraami_large/round_{rnd}/adapter",
            "ckpt_alias": f"ckpt_step_{60 * rnd:04d}"}


def test_ce_guard() -> None:
    assert dpo.ce_guard(4.10, 4.12)["passed"] is True
    g = dpo.ce_guard(4.10, 4.30, tolerance=0.05)
    assert g["passed"] is False and g["delta"] == 0.2 and g["tolerance"] == 0.05
    assert dpo.ce_guard(None, 4.0)["passed"] is None


def test_write_summary_shape_and_guard(tmp_path: Path) -> None:
    run = tmp_path / "dpo_v2_qaraami_large"
    run.mkdir()
    meta = {"tag": "v2_qaraami_large", "model": "facebook/musicgen-large", "start_adapter": "/repo/runs/qaraami_large/ckpt_step_4000",
            "candidates_per_round": 256, "candidates_note": dpo.CANDIDATES_NOTE, "ab_dir": "/repo/data/ab_dpo_v2_qaraami_large",
            "prompt_bank_source": "captions:/repo/data/sets/run_qaraami_large_captions.jsonl", "reward_version": 2}
    r1 = round_summary(1, 4.14, 4.16, 0.44, 0.40)
    partial = dpo.write_summary(run, meta, [r1], complete=False)
    assert partial["complete"] is False and partial["rounds_done"] == 1
    r2 = round_summary(2, 4.16, 4.30, 0.40, 0.38)
    s = dpo.write_summary(run, meta, [r1, r2], complete=True)
    on_disk = json.loads((run / "summary.json").read_text())
    assert on_disk == s and s["complete"] is True and s["rounds_done"] == 2
    assert s["before"] == r1["before"] and s["after"] == r2["after"]                       # first start, last end
    assert s["fad_to_real_oud_test"] == {"before": 0.44, "after": 0.38}
    guard = s["held_out_oud_token_ce"]
    assert guard["before"] == 4.14 and guard["after"] == 4.30 and guard["passed"] is False and guard["clips"] == 64
    assert s["ab_dir"] == meta["ab_dir"] and s["adapter"].endswith("round_2/adapter") and s["ckpt_alias"] == "ckpt_step_0120"
    assert s["candidates_per_round"] == 256 and s["tag"] == "v2_qaraami_large" and s["model"] == "facebook/musicgen-large"
    assert [r["round"] for r in s["rounds"]] == [1, 2] and "written_at" in s


def test_write_summary_without_rounds_is_incomplete(tmp_path: Path) -> None:
    s = dpo.write_summary(tmp_path, {"tag": "t", "ab_dir": "/x"}, [], complete=False)
    assert s["complete"] is False and s["adapter"] is None and s["ab_dir"] == "/x"
    assert s["held_out_oud_token_ce"]["passed"] is None and s["stopped"] is None


def test_write_summary_is_never_complete_without_an_adapter(tmp_path: Path) -> None:
    """A run whose first round yields no pairs asks for complete=True at the end
    (the loop fell through): the summary must still say false, name the reason,
    and never match an orchestrator's '"complete": true' grep."""
    s = dpo.write_summary(tmp_path, {"tag": "t", "ab_dir": "/x"}, [], complete=True, stopped="round 1: no pairs above the margin 0.5")
    on_disk = (tmp_path / "summary.json").read_text()
    assert s["complete"] is False and s["rounds_done"] == 0 and s["adapter"] is None
    assert s["stopped"].startswith("round 1: no pairs") and '"complete": true' not in on_disk
    no_adapter = round_summary(1, 4.1, 4.1, 0.4, 0.4) | {"adapter": None, "ckpt_alias": None}
    assert dpo.write_summary(tmp_path, {"tag": "t"}, [no_adapter], complete=True)["complete"] is False
    ok = dpo.write_summary(tmp_path, {"tag": "t"}, [round_summary(1, 4.1, 4.1, 0.4, 0.4)], complete=True, stopped="round 2: no pairs above the margin 0.5")
    assert ok["complete"] is True and ok["rounds_done"] == 1 and ok["stopped"].startswith("round 2")   # the round-1 adapter stands


# --- the policy's LoRA recipe and SFT parent in config.json -------------------------

def sft_fixture(tmp_path: Path) -> Path:
    """runs/qaraami_large/{config.json, ckpt_step_4000/adapter_config.json} under tmp_path."""
    run = tmp_path / "runs" / "qaraami_large"
    ckpt = run / "ckpt_step_4000"
    ckpt.mkdir(parents=True)
    (run / "config.json").write_text(json.dumps({"model": "facebook/musicgen-large", "lr": 3e-5, "total_steps": 6000, "rank": 128, "alpha": 256}))
    (ckpt / "adapter_config.json").write_text(json.dumps({"r": 128, "lora_alpha": 256, "peft_type": "LORA",
                                                          "target_modules": ["v_proj", "q_proj", "k_proj", "out_proj", "fc1", "fc2"]}))
    return ckpt


def test_policy_recipe_and_sft_parent(tmp_path: Path) -> None:
    ckpt = sft_fixture(tmp_path)
    assert dpo.policy_recipe(ckpt) == {"rank": 128, "alpha": 256, "targets": ["fc1", "fc2", "k_proj", "out_proj", "q_proj", "v_proj"]}
    parent = dpo.sft_parent(ckpt, repo=tmp_path)
    assert parent == {"sft_run": "runs/qaraami_large", "sft_lr": 3e-5, "sft_total_steps": 6000, "sft_model": "facebook/musicgen-large"}
    bare = tmp_path / "bare" / "ckpt_step_0001"
    bare.mkdir(parents=True)
    assert dpo.policy_recipe(bare) == {"rank": None, "alpha": None, "targets": None}
    assert dpo.sft_parent(bare, repo=tmp_path) == {"sft_run": None, "sft_lr": None, "sft_total_steps": None, "sft_model": None}
    (bare / "adapter_config.json").write_text("not json")
    assert dpo.policy_recipe(bare)["rank"] is None                       # unreadable -> None, never a crash
    outside = dpo.sft_parent(ckpt, repo=tmp_path / "elsewhere")
    assert Path(outside["sft_run"]).is_absolute()                         # a run outside the repo keeps its absolute path


def test_main_records_the_policy_recipe_and_sft_parent(tmp_path: Path, monkeypatch, corpus) -> None:
    cap, _ = corpus
    ckpt = sft_fixture(tmp_path)
    monkeypatch.setattr(dpo, "RUNS_DIR", tmp_path / "runs")
    monkeypatch.setattr(dpo, "DATA", tmp_path / "data")
    monkeypatch.setattr(dpo, "REPO", tmp_path)

    class Stop(Exception):
        pass

    def stop(*a, **k):
        raise Stop
    monkeypatch.setattr(dpo.AutoProcessor, "from_pretrained", stop)
    monkeypatch.setattr("sys.argv", ["dpo_train", "--model", "facebook/musicgen-large", "--adapter", str(ckpt), "--tag", "v2_qaraami_large",
                                     "--captions", str(cap), "--prompts-per-round", "2", "--eval-prompts", "2", "--ce-clips", "3"])
    with pytest.raises(Stop):
        dpo.main()
    cfg = json.loads((tmp_path / "runs" / "dpo_v2_qaraami_large" / "config.json").read_text())
    assert cfg["stage"] == "dpo" and cfg["rank"] == 128 and cfg["alpha"] == 256 and cfg["targets"] == ["fc1", "fc2", "k_proj", "out_proj", "q_proj", "v_proj"]
    assert cfg["sft_run"] == "runs/qaraami_large" and cfg["sft_lr"] == 3e-5 and cfg["sft_total_steps"] == 6000
    assert cfg["lr"] == 1e-5 and cfg["start_adapter"] == str(ckpt) and "rounds" in cfg   # the DPO lr stays the DPO lr; register_adapter's DPO detection keys stay


# --- recipes_v2.sh -----------------------------------------------------------------

def test_dpo_names_keep_the_two_ab_directories_apart(repo: Path) -> None:
    """dpo_train writes data/ab_dpo_<tag>/ (before/after at 15 s); the orchestrator's
    scale_eval of the DPO run writes data/ab_<eval tag>/ (base vs DPO at 30 s):
    the eval tag must never be dpo_<tag>, or the eval overwrites the first set."""
    for best in ("qaraami_large", "qaraami_large_all"):
        r = bash(f"dpo_names {best}; echo $DPO_TAG $DPO_NAME $DPO_RUN_REL $DPO_EVAL_TAG $DPO_TRAIN_AB $DPO_EVAL_AB", repo, lib=False)
        assert r.returncode == 0, r.stderr
        tag, name, run_rel, eval_tag, train_ab, eval_ab = r.stdout.split()
        assert tag == f"v2_{best}" and name == f"dpo_{tag}" and run_rel == f"runs/{name}"
        assert eval_tag != name and eval_tag.startswith(name)
        assert train_ab == f"data/ab_dpo_{tag}" and eval_ab == f"data/ab_{eval_tag}" and train_ab != eval_ab
        # dpo_train's own set (DATA / ab_dpo_<tag>) vs scale_eval's ab_<eval tag> and ab_turing_<eval tag>
        assert (dpo.DATA / f"ab_dpo_{tag}").name == Path(train_ab).name
        assert len({Path(train_ab).name, f"ab_{eval_tag}", f"ab_turing_{eval_tag}", f"ab_turing_{best}", f"ab_{best}"}) == 5


def test_oud_sets_exclude_research_only_and_unlabelled_contributors(repo: Path) -> None:
    write_set(repo, "contrib_amina_oud", "contrib_amina_consented")
    write_set(repo, "contrib_bob_oud", "contrib_bob_research_only")
    write_set(repo, "contrib_dahir_oud", "contrib_dahir_consented")
    (repo / "data/sets/contrib_dahir_oud/captions.jsonl").open("a").write(json.dumps(row("contrib_dahir_oud", 9, "train", "contrib_dahir_research_only", "oud", CAP_OUD, None)) + "\n")
    write_set(repo, "contrib_eva_oud", "")                                # rows without a rights label
    (repo / "data/sets/contrib_fatima_oud").mkdir()                       # being built: no captions yet
    write_set(repo, "ahmed_oud", "ahmed_ilkacase_consented")
    r = bash("echo \"oud=$(oud_sets)\"; echo \"research=$(contrib_research_sets)\"; "
             "for d in contrib_amina_oud contrib_bob_oud contrib_dahir_oud contrib_eva_oud contrib_fatima_oud; do echo \"$d=$(contrib_tier $SETS_ROOT/$d)\"; done; "
             "recipe_v2 qaraami_large; echo \"B=$SETS\"; recipe_v2 qaraami_medium_full; echo \"A=$SETS\"; echo \"have=$(existing_sets $SETS 2>/dev/null)\"", repo, lib=False)
    assert r.returncode == 0, r.stderr
    out = dict(line.split("=", 1) for line in r.stdout.strip().splitlines())
    assert out["oud"].split() == ["ahmed_oud", "sep_oud", "internet_oud", "contrib_amina_oud", "contrib_fatima_oud"]
    assert out["research"].split() == ["contrib_bob_oud", "contrib_dahir_oud", "contrib_eva_oud"]   # one research-only row taints the set
    assert (out["contrib_amina_oud"], out["contrib_bob_oud"], out["contrib_dahir_oud"], out["contrib_eva_oud"], out["contrib_fatima_oud"]) == \
        ("consented", "research_only", "research_only", "unknown", "unbuilt")
    assert "contrib_bob_oud" not in out["B"] and "contrib_bob_oud" not in out["A"] and "contrib_amina_oud" in out["A"]
    assert out["have"].split() == ["ahmed_oud", "contrib_amina_oud"]     # the unbuilt one is filtered (and logged) by existing_sets


# --- orchestrate_v2.sh helpers (sourced as a library) ----------------------------

def test_orchestrator_library_mode_runs_nothing(repo: Path) -> None:
    r = bash("echo loaded; type has_ckpt dpo_complete pick_best check_rights ensure_tokens >/dev/null && echo helpers", repo, dry=True)
    assert r.returncode == 0 and r.stdout.split() == ["loaded", "helpers"], r.stderr
    assert not (repo / "runs/_tools/orchestrate_v2.log").exists() and not (repo / "runs/_tools/orchestrate_v2.status").exists()


def test_has_ckpt_sees_full_decoder_and_lora_checkpoints(repo: Path) -> None:
    full = repo / "runs/fullrun/ckpt_step_0500"
    full.mkdir(parents=True)
    (full / "decoder.safetensors").write_bytes(b"x")
    (full / "ckpt_meta.json").write_text(json.dumps({"kind": "full_decoder", "step": 500}))
    lora = repo / "runs/lorarun/ckpt_step_0250"
    lora.mkdir(parents=True)
    (lora / "adapter_config.json").write_text("{}")
    other = repo / "runs/otherrun/ckpt_step_0100"
    other.mkdir(parents=True)
    (other / "pytorch_model.bin").write_bytes(b"x")
    (repo / "runs/emptyrun/ckpt_step_0100").mkdir(parents=True)
    (repo / "runs/norun").mkdir()
    r = bash('for run in fullrun lorarun otherrun emptyrun norun; do has_ckpt "$REPO/runs/$run" && echo "$run=yes" || echo "$run=no"; done', repo)
    assert r.returncode == 0, r.stderr
    assert r.stdout.split() == ["fullrun=yes", "lorarun=yes", "otherrun=yes", "emptyrun=no", "norun=no"]


def test_dpo_complete_needs_the_flag_and_an_adapter_alias(repo: Path) -> None:
    d = repo / "runs/dpo_v2_qaraami_large"
    d.mkdir(parents=True)
    (d / "summary.json").write_text(json.dumps({"complete": True, "rounds_done": 0, "adapter": None, "stopped": "round 1: no pairs above the margin 0.5"}))
    r = bash('dpo_complete "$REPO/runs/dpo_v2_qaraami_large" && echo yes || echo no; dpo_stopped "$REPO/runs/dpo_v2_qaraami_large"', repo)
    assert r.stdout.split("\n")[0] == "no" and "round 1: no pairs" in r.stdout                      # the flag alone is not enough
    adapter = d / "round_1" / "adapter"
    adapter.mkdir(parents=True)
    (adapter / "adapter_config.json").write_text("{}")
    dpo.alias_checkpoint(d, adapter, 60)
    assert bash('dpo_complete "$REPO/runs/dpo_v2_qaraami_large" && echo yes || echo no', repo).stdout.strip() == "yes"
    (d / "summary.json").write_text(json.dumps({"complete": False, "rounds_done": 1}))
    r = bash('dpo_complete "$REPO/runs/dpo_v2_qaraami_large" && echo yes || echo no; dpo_stopped "$REPO/runs/dpo_v2_qaraami_large"; echo "[end]"', repo)
    assert r.stdout.split("\n")[0] == "no" and r.stdout.split("\n")[1] == ""                       # no stopped reason -> empty line


def test_pick_best_treats_an_unreadable_eval_json_as_missing(repo: Path) -> None:
    b = repo / "runs/qaraami_large"
    c = repo / "runs/qaraami_large_all"
    b.mkdir(parents=True)
    c.mkdir(parents=True)
    (b / "eval_qaraami_large.json").write_text("not json")
    (c / "eval_qaraami_large_all.json").write_text(json.dumps({"mert": {"fad_adapter_real": 0.41}, "per_song_ce": {"improvement_base_minus_adapter": {"mean": 0.12}}}))
    r = bash('pick_best; echo "BEST_RUN=[$BEST_RUN]"', repo)
    assert r.returncode == 0, r.stderr
    assert "BEST_RUN=[qaraami_large_all]" in r.stdout and "eval_qaraami_large.json unreadable" in r.stdout and "Traceback" not in r.stderr
    best = json.loads((repo / "runs/_tools/best_v2.json").read_text())
    assert best["best"] == "qaraami_large_all" and best["fad_adapter_real"] == {"qaraami_large": None, "qaraami_large_all": 0.41}
    (repo / "runs/_tools/best_v2.json").unlink()
    (c / "eval_qaraami_large_all.json").write_text("{")
    r = bash('pick_best; echo "BEST_RUN=[$BEST_RUN]"', repo)
    assert "BEST_RUN=[none]" in r.stdout and not (repo / "runs/_tools/best_v2.json").exists()     # never an empty best, never a bogus file
    # a python failure (no interpreter) still yields "none", not ""
    r = bash('pick_best; echo "BEST_RUN=[$BEST_RUN]"', repo, env={"PY": "/nonexistent/python"})
    assert "BEST_RUN=[none]" in r.stdout and "could not read" in r.stdout


def test_pick_best_tie_break_notes_a_research_only_b(repo: Path) -> None:
    b = repo / "runs/qaraami_large"
    c = repo / "runs/qaraami_large_all"
    b.mkdir(parents=True)
    c.mkdir(parents=True)
    ev = lambda fad, ce: json.dumps({"mert": {"fad_adapter_real": fad}, "per_song_ce": {"improvement_base_minus_adapter": {"mean": ce}}})  # noqa: E731
    (b / "eval_qaraami_large.json").write_text(ev(0.45, 0.20))     # B: better CE
    (c / "eval_qaraami_large_all.json").write_text(ev(0.40, 0.10))  # C: better FAD
    r = bash('pick_best; echo "BEST_RUN=[$BEST_RUN]"', repo)
    assert "BEST_RUN=[qaraami_large]" in r.stdout and "the releasable B is preferred" in r.stdout
    (b / "rights.txt").write_text("research_only\n")
    r = bash('pick_best; echo "BEST_RUN=[$BEST_RUN]"', repo)
    assert "BEST_RUN=[qaraami_large]" in r.stdout and "NOTE its captions derive research_only" in r.stdout


def test_decide_mode_dry_run_writes_no_train_mode(repo: Path) -> None:
    run = repo / "runs/qaraami_medium_full"
    run.mkdir(parents=True)
    (run / "probe_full.log").write_text('smoke done\n{"peak_driver_gb": 48.2, "est_full_run_hours": 31.0, "fits_under_60gb": true, "steps": 20}\n')
    r = bash('recipe_v2 qaraami_medium_full; decide_mode qaraami_medium_full; echo "MODE=$MODE"', repo, dry=True)
    assert r.returncode == 0 and "MODE=full" in r.stdout, r.stderr
    assert not (run / "train_mode").exists() and "No such file" not in r.stderr
    r = bash('recipe_v2 qaraami_medium_full; decide_mode qaraami_medium_full; echo "MODE=$MODE"', repo, dry=False)
    assert "MODE=full" in r.stdout and (run / "train_mode").read_text().strip() == "full"
    (run / "train_mode").write_text("lora\n")
    r = bash('recipe_v2 qaraami_medium_full; decide_mode qaraami_medium_full; echo "MODE=$MODE"', repo, dry=True)
    assert "MODE=lora" in r.stdout and "remembered" in r.stdout


def test_ensure_tokens_fails_on_a_broken_token_check(repo: Path) -> None:
    d = write_set(repo, "badset", "ahmed_ilkacase_consented")
    (d / "captions.jsonl").open("a").write("{not json\n")
    r = bash('HAVE=badset; ensure_tokens testrun; echo "rc=$?"', repo, dry=True)   # dry: never launch scale_tokens from a test
    assert "rc=1" in r.stdout and "token check for badset FAILED" in r.stdout and "tokens complete" not in r.stdout
    good = write_set(repo, "goodset", "ahmed_ilkacase_consented", n=2)
    tok = repo / "data/sets/goodset/tokens"
    tok.mkdir()
    for line in (good / "captions.jsonl").read_text().splitlines():
        np.save(tok / (Path(json.loads(line)["clip_path"]).stem + ".npy"), np.zeros((4, 8), dtype=np.int16))
    r = bash('HAVE=goodset; ensure_tokens testrun; echo "rc=$?"', repo, dry=True)
    assert "rc=0" in r.stdout and "tokens complete for goodset" in r.stdout and "DRY" not in r.stdout, r.stdout + r.stderr
    (tok / (Path(json.loads(good.joinpath("captions.jsonl").read_text().splitlines()[0])["clip_path"]).stem + ".npy")).unlink()
    r = bash('HAVE=goodset; ensure_tokens testrun; echo "rc=$?"', repo, dry=True)
    assert "goodset has 1 clips without tokens" in r.stdout and "scripts.scale_tokens" in r.stdout and "rc=0" in r.stdout


def test_check_rights_only_tightens_the_recipe(repo: Path) -> None:
    write_set(repo, "contrib_bob_oud", "contrib_bob_research_only")
    mixed = repo / "data/sets/run_qaraami_large_captions.jsonl"
    mixed.write_text(json.dumps(row("ahmed_oud", 1, "train", "ahmed_ilkacase_consented", "oud", CAP_OUD, None)) + "\n"
                     + json.dumps(row("contrib_bob_oud", 2, "train", "contrib_bob_research_only", "oud", CAP_OUD, None)) + "\n")
    r = bash('recipe_v2 qaraami_large; check_rights qaraami_large; echo "RIGHTS=$RIGHTS"', repo)
    assert r.returncode == 0, r.stderr
    assert "RIGHTS=research_only" in r.stdout and "WARNING" in r.stdout and "contrib_bob_research_only" in r.stdout
    assert "never merged into a releasable run: contrib_bob_oud" in r.stdout
    assert (repo / "runs/qaraami_large/rights.txt").read_text().strip() == "research_only"
    clean = repo / "data/sets/run_qaraami_large_all_captions.jsonl"
    clean.write_text(json.dumps(row("ahmed_oud", 1, "train", "ahmed_ilkacase_consented", "oud", CAP_OUD, None)) + "\n")
    r = bash('recipe_v2 qaraami_large_all; check_rights qaraami_large_all; echo "RIGHTS=$RIGHTS"', repo)
    assert "RIGHTS=research_only" in r.stdout and "never loosened" in r.stdout        # C without Harvard rows stays research-only
    mixed.write_text(clean.read_text())
    r = bash('recipe_v2 qaraami_large; check_rights qaraami_large; echo "RIGHTS=$RIGHTS"', repo)
    assert "RIGHTS=releasable" in r.stdout and "confirmed by the captions" in r.stdout
    mixed.unlink()
    r = bash('recipe_v2 qaraami_large; check_rights qaraami_large; echo "RIGHTS=$RIGHTS"', repo, dry=True)
    assert "RIGHTS=releasable" in r.stdout and "waits for the merge" in r.stdout
    mixed.write_text(clean.read_text())
    r = bash('recipe_v2 qaraami_large; check_rights qaraami_large; echo "RIGHTS=$RIGHTS"', repo, env={"PY": "/nonexistent/python"})
    assert "RIGHTS=releasable" in r.stdout and "could not be derived" in r.stdout    # a failed derivation keeps the recipe, and says so


def test_register_run_passes_the_eval_tag_and_rights(repo: Path) -> None:
    r = bash('register_run dpo_v2_qaraami_large runs/dpo_v2_qaraami_large releasable dpo_v2_qaraami_large_vs_base; echo "rc=$?"; '
             'register_run qaraami_large_all runs/qaraami_large_all research_only; echo "rc=$?"', repo, dry=True)
    assert r.returncode == 0, r.stderr
    lines = [line for line in r.stdout.splitlines() if line.startswith("DRY")]
    assert "--name dpo_v2_qaraami_large --tag dpo_v2_qaraami_large_vs_base --restart" in lines[0] and "--rights" not in lines[0]
    assert "--name qaraami_large_all --rights research_only --restart" in lines[1] and "--tag" not in lines[1]
    assert r.stdout.count("rc=0") == 2
    (repo / "apps/ai-service/scripts/register_adapter.py").unlink()
    r = bash('register_run qaraami_large runs/qaraami_large releasable; echo "rc=$?"', repo, dry=True)
    assert "rc=1" in r.stdout and "registration skipped" in r.stdout                  # a missing registrar is not a finished run
