"""Unit tests for scripts/register_adapter.py: rights derivation from captions
(Harvard rows and unknown labels -> research_only, the releasable set, the
--rights override that never passes Harvard), checkpoint choice (the eval's
best_ckpt first, then scale_eval.find_best_ckpt), kind detection, metrics from
loss.csv / eval JSON (val CE, per-song test CE, MERT closer_to_real, A/B, tuning),
the entry shape, idempotent atomic registry updates, the kickstart command, and
the /health wait + pre-warm with the HTTP calls faked. No corpus, GPU, network or
service: nothing here restarts anything."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pytest

from scripts import register_adapter as ra

ROW = {"clip_path": "data/sets/ahmed_oud/clips/test/ahmed_oud_abc_seg000.wav", "caption": "qaraami, oud", "song_sha256": "a" * 64,
       "split": "test", "source": "ahmed_oud", "rights": "ahmed_ilkacase_consented", "seconds": 30.0}


def _captions(path: Path, rights: list[str], sources: list[str] | None = None) -> Path:
    rows = []
    for i, r in enumerate(rights):
        row = dict(ROW, rights=r, song_sha256=f"{i:064d}", clip_path=f"data/x/clip{i}.wav")
        if sources:
            row["source"] = sources[i]
        rows.append(row)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return path


def _eval(best_ckpt: str = "ckpt_step_0500", mert: bool = True) -> dict:
    ev = {
        "tag": "demo", "model": "facebook/musicgen-large", "best_ckpt": best_ckpt, "test_clips": 64, "test_songs": 9,
        "per_song_ce": {"n_songs": 9, "base": {"mean": 4.1, "ci95": [3.9, 4.3]}, "adapter": {"mean": 3.9, "ci95": [3.7, 4.1]},
                        "improvement_base_minus_adapter": {"mean": 0.2, "ci95": [0.15, 0.25], "significant": True}},
        "ab": {"dir": "/x/ab_demo", "n": 16, "seconds": 30, "base": {"pcs_mean": 0.81, "voiced_fraction_mean": 0.41, "n_scored": 16},
               "adapter": {"pcs_mean": 0.85, "voiced_fraction_mean": 0.52, "n_scored": 16}, "pairs": []},
        "tuning": {"threshold_cents": 15.0, "real": {"n": 10, "mean": -3.0}, "base": {"n": 16, "mean": 1.0}, "adapter": {"n": 16, "mean": -2.0},
                   "ks_real_adapter": {"statistic": 0.2}, "ks_real_base": {"statistic": 0.4}, "offsets": {"real": [1.0], "base": [2.0], "adapter": [3.0]}},
        "scorer_version": {"torchcrepe": "0.0.24"},
    }
    if mert:
        ev["mert"] = {"n_real": 64, "n_gen": 64, "fad_adapter_real": 0.31, "fad_base_real": 0.52, "fad_adapter_base": 0.2,
                      "cos_adapter": 0.71, "cos_base": 0.63, "nn_cos_adapter": 0.8, "nn_cos_base": 0.75, "delta_mean": 0.05,
                      "delta_ci95": [0.01, 0.09], "closer_to_real": True, "embeddings": "x.npz"}
    return ev


def _run(tmp_path: Path, name: str = "qaraami_large", kind: str = "lora", vals: dict[int, float] | None = None,
         ckpts: tuple[int, ...] = (250, 500, 750), ev: dict | None = None, rights: list[str] | None = None,
         captions: Path | None = None) -> Path:
    run = tmp_path / "runs" / name
    run.mkdir(parents=True)
    vals = vals if vals is not None else {250: 4.4, 500: 4.2, 750: 4.3}
    lines = ["step,train_loss,val_loss,lr,sec_per_step,mps_driver_gb", "0,,4.5,0.0,,8.0"]
    for s in sorted(vals):
        lines.append(f"{s},3.9,,1e-5,10.0,12.0")
        lines.append(f"{s},,{vals[s]},1e-5,,12.0")
    (run / "loss.csv").write_text("\n".join(lines) + "\n")
    for s in ckpts:
        d = run / f"ckpt_step_{s:04d}"
        d.mkdir()
        if kind == "lora":
            (d / "adapter_config.json").write_text("{}")
        else:
            (d / "decoder.safetensors").write_bytes(b"")
            (d / "ckpt_meta.json").write_text(json.dumps({"kind": "full_decoder", "step": s, "val_loss": vals.get(s)}))
    caps = captions or _captions(tmp_path / f"{name}_captions.jsonl", rights or ["ahmed_ilkacase_consented"] * 3)
    cfg = {"model": "facebook/musicgen-medium" if kind == "full_decoder" else "facebook/musicgen-large", "lr": 3e-5, "total_steps": 6000,
           "rank": 128, "alpha": 256, "targets": ["q_proj", "k_proj", "v_proj", "out_proj", "fc1", "fc2"], "captions": str(caps)}
    (run / "config.json").write_text(json.dumps(cfg))
    if ev is not None:
        (run / f"eval_{name}.json").write_text(json.dumps(ev))
    return run


# --- rights -------------------------------------------------------------------------------------

def test_releasable_labels() -> None:
    assert ra.releasable_label("ahmed_ilkacase_consented") and ra.releasable_label("ahmed_oud") and ra.releasable_label("internet_cc")
    assert ra.releasable_label("contrib_hodan_consented")
    assert not ra.releasable_label("contrib_hodan") and not ra.releasable_label("harvard_research_only") and not ra.releasable_label("band_qaraami")
    assert not ra.releasable_label("oud_ilkacase") and not ra.releasable_label("internet_unknown")


def test_derive_rights_ahmed_internet_contrib_is_releasable(tmp_path: Path) -> None:
    caps = _captions(tmp_path / "c.jsonl", ["ahmed_ilkacase_consented", "internet_cc", "contrib_x_consented", "ahmed_ilkacase_consented"])
    hist = ra.rights_histogram(caps)
    assert hist == Counter({"ahmed_ilkacase_consented": 2, "internet_cc": 1, "contrib_x_consented": 1})
    rights, reasons = ra.derive_rights(hist)
    assert rights == "releasable" and reasons == {"harvard": [], "unknown": []}
    assert ra.decide_rights(hist, None) == "releasable" and ra.decide_rights(hist, "research_only") == "research_only"


def test_derive_rights_any_harvard_row_is_research_only(tmp_path: Path) -> None:
    caps = _captions(tmp_path / "c.jsonl", ["ahmed_ilkacase_consented"] * 50 + ["harvard_research_only"])
    hist = ra.rights_histogram(caps)
    rights, reasons = ra.derive_rights(hist)
    assert rights == "research_only" and reasons["harvard"] == ["harvard_research_only"]
    with pytest.raises(SystemExit, match="refused"):
        ra.decide_rights(hist, "releasable")  # the flag never passes Harvard rows
    assert ra.decide_rights(hist, "research_only") == "research_only"


def test_derive_rights_harvard_by_source_without_rights_label(tmp_path: Path) -> None:
    caps = tmp_path / "c.jsonl"
    caps.write_text(json.dumps({**ROW, "rights": None, "source": "harvard_full"}) + "\n")
    rights, reasons = ra.derive_rights(ra.rights_histogram(caps))
    assert rights == "research_only" and reasons["harvard"] == ["harvard"]


def test_derive_rights_unknown_label_is_conservative_but_overridable(tmp_path: Path) -> None:
    caps = _captions(tmp_path / "c.jsonl", ["oud_ilkacase", "band_qaraami", "oud_ilkacase"])
    hist = ra.rights_histogram(caps)
    rights, reasons = ra.derive_rights(hist)
    assert rights == "research_only" and reasons == {"harvard": [], "unknown": ["band_qaraami", "oud_ilkacase"]}
    assert ra.decide_rights(hist, "releasable") == "releasable"  # unknown labels may be overridden by hand


# --- checkpoint choice / kind ------------------------------------------------------------------------

def test_best_checkpoint_prefers_the_evaluated_one_then_find_best_ckpt(tmp_path: Path) -> None:
    run = _run(tmp_path)  # lowest val is step 500
    assert ra.best_checkpoint(run, {"best_ckpt": "ckpt_step_0750"}).name == "ckpt_step_0750"  # the eval measured 750: serve that
    assert ra.best_checkpoint(run, {"best_ckpt": "ckpt_step_9999"}).name == "ckpt_step_0500"  # pruned away -> best saved by val
    assert ra.best_checkpoint(run, {}).name == "ckpt_step_0500"
    empty = tmp_path / "runs" / "empty"
    empty.mkdir()
    with pytest.raises(SystemExit, match="no ckpt_step_"):
        ra.best_checkpoint(empty, {})


def test_detect_kind_auto_and_explicit(tmp_path: Path) -> None:
    lora = _run(tmp_path, "l") / "ckpt_step_0500"
    full = _run(tmp_path, "f", kind="full_decoder") / "ckpt_step_0500"
    assert ra.detect_kind(lora, "auto") == "lora" and ra.detect_kind(full, "auto") == "full_decoder"
    assert ra.detect_kind(lora, "lora") == "lora" and ra.detect_kind(full, "full_decoder") == "full_decoder"
    with pytest.raises(SystemExit, match="holds a full_decoder"):
        ra.detect_kind(full, "lora")
    bare = tmp_path / "bare"
    bare.mkdir()
    with pytest.raises(SystemExit, match="not a checkpoint"):
        ra.detect_kind(bare, "auto")
    with pytest.raises(SystemExit, match="not a checkpoint"):
        ra.detect_kind(bare, "lora")  # an explicit --kind never registers a directory that is not a checkpoint
    with pytest.raises(SystemExit, match="not a checkpoint"):
        ra.detect_kind(bare, "full_decoder")
    with pytest.raises(SystemExit, match="expected auto"):
        ra.detect_kind(lora, "flash")
    assert ra.step_of(lora) == 500 and ra.step_of(bare) is None


# --- metrics ------------------------------------------------------------------------------------------

def test_metrics_from_loss_csv_and_eval(tmp_path: Path) -> None:
    run = _run(tmp_path, ev=_eval())
    ckpt = run / "ckpt_step_0500"
    m = ra.build_metrics(run, ckpt, _eval())
    assert m["val_ce"] == {"base": 4.5, "adapter": 4.2}
    assert m["test_ce"] == {"base": 4.1, "adapter": 3.9, "n_songs": 9, "improvement": 0.2, "improvement_ci95": [0.15, 0.25], "significant": True}
    assert m["mert"]["closer_to_real"] is True and m["mert"]["fad_adapter_real"] == 0.31 and "embeddings" not in m["mert"]
    assert m["ab"] == {"n": 16, "seconds": 30, "base": {"pcs_mean": 0.81, "voiced_fraction_mean": 0.41, "n_scored": 16},
                       "adapter": {"pcs_mean": 0.85, "voiced_fraction_mean": 0.52, "n_scored": 16}}
    assert m["tuning"]["adapter"] == {"n": 16, "mean": -2.0} and "offsets" not in m["tuning"]
    assert m["scorer_version"] == {"torchcrepe": "0.0.24"}


def test_metrics_without_eval_and_full_decoder_meta_fallback(tmp_path: Path) -> None:
    run = _run(tmp_path, "f", kind="full_decoder")
    ckpt = run / "ckpt_step_0750"
    m = ra.build_metrics(run, ckpt, {})
    assert m == {"val_ce": {"base": 4.5, "adapter": 4.3}}
    # loss.csv without the checkpoint's val row: ckpt_meta.json val_loss stands in
    (run / "loss.csv").write_text("step,train_loss,val_loss,lr,sec_per_step,mps_driver_gb\n0,,4.5,0.0,,8.0\n")
    assert ra.val_ce(run, ckpt) == {"base": 4.5, "adapter": 4.3}
    (run / "loss.csv").unlink()
    (ckpt / "ckpt_meta.json").unlink()
    assert ra.val_ce(run, ckpt) is None
    assert ra.test_ce({}) is None and ra.mert_summary({"mert": "n/a"}) is None and ra.ab_summary({}) is None and ra.tuning_summary({}) is None


# --- entry text / shape --------------------------------------------------------------------------------

def test_corpus_and_trained_text(tmp_path: Path) -> None:
    caps = _captions(tmp_path / "c.jsonl", ["ahmed_ilkacase_consented"] * 3 + ["internet_cc"], sources=["ahmed_oud", "ahmed_oud", "ahmed_mix", "internet_oud"])
    text = ra.corpus_text(caps)
    assert text == "ahmed_mix (1 clips, 1 songs), ahmed_oud (2 clips, 2 songs), internet_oud (1 clips, 1 songs) — 0.0 h"
    run = _run(tmp_path)
    cfg = json.loads((run / "config.json").read_text())
    t = ra.trained_text(cfg, "lora", run / "ckpt_step_0500")
    assert "LoRA r=128 α=256 on decoder q/k/v/out/fc1/fc2" in t and "lr 3e-05 cosine, up to 6,000 steps, best checkpoint step 500" in t
    f = ra.trained_text(cfg, "full_decoder", run / "ckpt_step_0750")
    assert "full fine-tune of the decoder (no LoRA)" in f and f.endswith("best checkpoint step 750")


def test_trained_text_reads_old_harness_keys_and_unknown_targets(tmp_path: Path) -> None:
    ckpt = _run(tmp_path) / "ckpt_step_0500"
    old = {"model": "facebook/musicgen-small", "lora_r": 16, "lora_alpha": 32, "lora_targets": ["q_proj", "k_proj", "v_proj", "out_proj"],
           "lr": 0.0001, "schedule": "cosine", "total_steps": 3000}  # runs/harvard_raw_3000 and runs/oud_lora_r16_nodrop_20260809 config.json
    t = ra.trained_text(old, "lora", ckpt)
    assert "LoRA r=16 α=32 on decoder q/k/v/out, lr 0.0001 cosine, up to 3,000 steps, best checkpoint step 500" in t
    bare = ra.trained_text({"lr": 1e-4}, "lora", ckpt)
    assert "LoRA r=? α=? on decoder projections, lr 0.0001 cosine, best checkpoint step 500" in bare and "decoder decoder" not in bare
    assert ra.dpo_parent(old) is None and not ra.is_dpo_run(old)


DPO_CFG = {  # the shape scripts.dpo_train writes to runs/dpo_<tag>/config.json (runs/dpo_large)
    "model": "facebook/musicgen-large", "adapter": "/abs/runs/qaraami_large_r32/ckpt_step_2750", "tag": "large", "reward": "full",
    "rounds": 2, "prompts_per_round": 64, "samples_per_prompt": 4, "candidates_per_round": 256, "seconds": 15, "margin": 0.5,
    "epochs": 2, "beta": 10.0, "lr": 2e-05, "warmup": 10, "sft_weight": 0.5, "start_adapter": str(ra.REPO / "runs/qaraami_large_r32/ckpt_step_2750"),
}


def test_trained_text_for_a_dpo_run(tmp_path: Path) -> None:
    ckpt = _run(tmp_path) / "ckpt_step_0500"
    assert ra.is_dpo_run(DPO_CFG) and ra.dpo_parent(DPO_CFG) == "runs/qaraami_large_r32/ckpt_step_2750"
    t = ra.trained_text(DPO_CFG, "lora", ckpt)
    assert "DPO 2 round(s) of 64x4 = 256 candidates at 15 s, beta 10.0, lr 2e-05, from runs/qaraami_large_r32/ckpt_step_2750, best checkpoint step 500" in t
    assert "LoRA r=" not in t and "cosine" not in t
    assert "DPO 1 round(s)" in ra.trained_text(DPO_CFG, "lora", ckpt, summary={"rounds_done": 1, "complete": False})  # rounds actually done win
    assert "= ? candidates" in ra.trained_text({"start_adapter": "/x", "rounds": 1}, "lora", ckpt)
    # the 2026-09-08 dpo_train layout (runs/dpo_large/config.json): the start adapter sits under "adapter", no start_adapter key
    old_dpo = {k: v for k, v in DPO_CFG.items() if k != "start_adapter"}
    assert ra.is_dpo_run(old_dpo) and ra.dpo_parent(old_dpo) == "/abs/runs/qaraami_large_r32/ckpt_step_2750"
    assert "DPO 2 round(s) of 64x4 = 256 candidates" in ra.trained_text(old_dpo, "lora", ckpt)
    assert not ra.is_dpo_run({"adapter": "/x", "rounds": 1})  # an SFT-style config that merely names an adapter is not a DPO run
    assert ra.trained_text({"lr": 1e-4}, "lora", tmp_path / "no_step").endswith("checkpoint step unknown")


def test_repo_relative(tmp_path: Path) -> None:
    assert ra.repo_relative(tmp_path / "runs/x/ckpt_step_0250", repo=tmp_path) == "runs/x/ckpt_step_0250"
    assert ra.repo_relative(tmp_path / "runs/x", repo=tmp_path / "elsewhere") == str((tmp_path / "runs/x").resolve())
    assert ra.repo_relative(ra.REPO / "runs/qaraami_large/ckpt_step_2750") == "runs/qaraami_large/ckpt_step_2750"


def test_build_entry_shape(tmp_path: Path) -> None:
    run = _run(tmp_path, ev=_eval())
    ckpt = run / "ckpt_step_0500"
    cfg = json.loads((run / "config.json").read_text())
    hist = ra.rights_histogram(Path(cfg["captions"]))
    e = ra.build_entry("qaraami_large", run, ckpt, "lora", cfg["model"], "releasable", "corpus text", cfg, _eval(), run / "eval_qaraami_large.json", hist, None)
    assert set(e) == {"name", "kind", "path", "base", "corpus", "trained", "parent", "metrics", "listening_gate", "rights", "best_step", "run",
                      "eval_json", "trained_on_rights", "registered"}
    assert e["parent"] is None  # an SFT run has no DPO parent
    assert e["name"] == "qaraami_large" and e["kind"] == "lora" and e["base"] == "facebook/musicgen-large" and e["rights"] == "releasable"
    assert e["path"] == str(ckpt.resolve()) and e["best_step"] == 500 and e["listening_gate"] is None
    assert e["trained_on_rights"] == {"ahmed_ilkacase_consented": 3} and e["eval_json"].endswith("eval_qaraami_large.json")
    assert e["metrics"]["mert"]["closer_to_real"] is True
    json.dumps(e)  # serialisable


# --- registry file ------------------------------------------------------------------------------------

def _entry(name: str, **over) -> dict:
    return {"name": name, "kind": "lora", "path": f"runs/{name}/ckpt_step_0500", "base": "facebook/musicgen-large", "corpus": "c", "trained": "t",
            "metrics": {"val_ce": {"base": 4.5, "adapter": 4.2}}, "listening_gate": None, "rights": "releasable", "best_step": 500, **over}


def test_upsert_is_idempotent_and_keeps_order_and_gate() -> None:
    entries = ra.upsert_entry([], _entry("a"))
    entries = ra.upsert_entry(entries, _entry("b"))
    assert [e["name"] for e in entries] == ["a", "b"] and entries[0]["listening_gate"] == "not yet performed"
    entries[0]["listening_gate"] = "passed (Khalid, 2026-10)"
    again = ra.upsert_entry(entries, _entry("a", metrics={"val_ce": {"base": 4.5, "adapter": 4.0}}, best_step=750))
    assert [e["name"] for e in again] == ["a", "b"] and len(again) == 2
    assert again[0]["metrics"]["val_ce"]["adapter"] == 4.0 and again[0]["best_step"] == 750
    assert again[0]["listening_gate"] == "passed (Khalid, 2026-10)"  # a performed gate survives re-registration
    explicit = ra.upsert_entry(again, _entry("a", listening_gate="failed (2026-11)"))
    assert explicit[0]["listening_gate"] == "failed (2026-11)"
    assert ra.upsert_entry(again, _entry("a")) is not again  # the input list is not mutated
    assert again[0]["best_step"] == 750


def test_write_and_load_registry_atomic(tmp_path: Path) -> None:
    reg = tmp_path / "svc" / "adapters.extra.json"
    assert ra.load_registry(reg) == []
    ra.write_registry(reg, [_entry("a")])
    ra.write_registry(reg, ra.upsert_entry(ra.load_registry(reg), _entry("a")))
    assert [p.name for p in reg.parent.iterdir()] == ["adapters.extra.json"]  # no temp file left behind
    assert json.loads(reg.read_text())[0]["name"] == "a" and reg.read_text().endswith("\n")
    reg.write_text("{not json")
    with pytest.raises(SystemExit, match="not valid JSON"):
        ra.load_registry(reg)
    reg.write_text(json.dumps({"name": "dict"}))
    with pytest.raises(SystemExit, match="JSON list"):
        ra.load_registry(reg)


# --- restart helpers -------------------------------------------------------------------------------------

def test_kickstart_command_and_service_env(tmp_path: Path) -> None:
    assert ra.kickstart_command(501) == ["launchctl", "kickstart", "-k", "gui/501/com.qaraamigen.musicgen-api"]
    assert ra.kickstart_command()[3].startswith("gui/")
    env = tmp_path / "svc.env"
    env.write_text('# comment\nMUSICGEN_API_TOKEN="abc"\nMUSICGEN_API_PORT=8765\n\nbroken line\n')
    assert ra.service_env(env) == {"MUSICGEN_API_TOKEN": "abc", "MUSICGEN_API_PORT": "8765"}
    assert ra.service_env(tmp_path / "absent.env") == {}


def _health(state: str, loaded: bool, engine: str = "facebook/musicgen-large::x", error: str | None = None) -> dict:
    return {"ok": True, "adapter_details": [{"id": "base", "loaded": True, "engine_state": "ready", "engine": "facebook/musicgen-small"},
                                            {"id": "x", "loaded": loaded, "engine_state": state, "engine": engine}],
            "engines": {engine: {"state": state, "error": error}}}


def test_wait_for_ready_polls_until_loaded() -> None:
    replies = iter([OSError("connection refused"), _health("loading", False), _health("ready", True)])
    slept: list[float] = []
    ticks = iter([0.0, 0.0, 5.0, 10.0, 10.0])

    def fetch(url, **kw):
        r = next(replies)
        if isinstance(r, Exception):
            raise r
        return r

    out = ra.wait_for_ready("http://127.0.0.1:1", "x", timeout_s=600, poll_s=5, fetch=fetch, sleep=slept.append, clock=lambda: next(ticks))
    assert out["polls"] == 3 and slept == [5, 5] and out["waited_seconds"] == 10.0 and out["health"]["adapter_details"][1]["loaded"] is True


def test_wait_for_ready_failed_engine_and_timeout_and_unknown_adapter() -> None:
    with pytest.raises(RuntimeError, match="failed to load .*boom"):
        ra.wait_for_ready("http://h", "x", fetch=lambda url, **kw: _health("failed", False, error="boom"), sleep=lambda s: None)
    # the engine is ready without the adapter (weights missing at load): waiting cannot help, fail at once
    ready_without = _health("ready", False)
    ready_without["adapter_details"][1]["error"] = "adapter weights missing: /runs/x/ckpt_step_0500"
    with pytest.raises(RuntimeError, match="ready but the adapter did not load .*weights missing: /runs/x"):
        ra.wait_for_ready("http://h", "x", fetch=lambda url, **kw: ready_without, sleep=lambda s: pytest.fail("must not poll again"))
    with pytest.raises(RuntimeError, match="did not load"):  # an older service without the error column: still no point waiting
        ra.wait_for_ready("http://h", "x", fetch=lambda url, **kw: _health("ready", False), sleep=lambda s: pytest.fail("must not poll again"))
    ticks = iter([0.0, 700.0])
    with pytest.raises(TimeoutError, match="not loaded after 600 s .*loading"):
        ra.wait_for_ready("http://h", "x", timeout_s=600, fetch=lambda url, **kw: _health("loading", False), sleep=lambda s: None, clock=lambda: next(ticks))
    with pytest.raises(RuntimeError, match="does not list adapter 'y'"):
        ra.wait_for_ready("http://h", "y", fetch=lambda url, **kw: _health("ready", True), sleep=lambda s: None)


def test_prewarm_posts_a_short_generation_on_the_adapter() -> None:
    seen = {}

    def fetch(url, token=None, body=None, timeout=None):
        seen.update(url=url, token=token, body=body)
        return {"id": "abc123", "generation_seconds": 4.2, "total_seconds": 4.5, "seconds_generated": 5.0}

    ticks = iter([0.0, 4.6])
    out = ra.prewarm("http://127.0.0.1:8765", "tok", "x", seconds=5, fetch=fetch, clock=lambda: next(ticks))
    assert seen["url"].endswith("/generate") and seen["token"] == "tok"
    assert seen["body"]["adapter"] == "x" and seen["body"]["duration"] == 5 and seen["body"]["score"] is False
    assert out == {"adapter": "x", "id": "abc123", "generation_seconds": 4.2, "total_seconds": 4.5, "seconds_generated": 5.0, "round_trip_seconds": 4.6}


# --- main -----------------------------------------------------------------------------------------------------

def test_main_registers_idempotently_and_prints_kickstart(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    run = _run(tmp_path, ev=_eval(best_ckpt="ckpt_step_0750"))
    reg = tmp_path / "adapters.extra.json"
    args = ["--run", str(run), "--name", "qaraami_large", "--registry", str(reg)]
    first = ra.main(args)
    assert first["kind"] == "lora" and first["base"] == "facebook/musicgen-large" and first["rights"] == "releasable"
    assert first["path"].endswith("ckpt_step_0750") and first["best_step"] == 750  # the evaluated checkpoint
    assert first["metrics"]["val_ce"] == {"base": 4.5, "adapter": 4.3} and first["metrics"]["test_ce"]["adapter"] == 3.9
    assert first["listening_gate"] == "not yet performed" and "ahmed_oud (3 clips, 3 songs)" in first["corpus"]
    out = capsys.readouterr().out
    assert "launchctl kickstart -k gui/" in out and "com.qaraamigen.musicgen-api" in out
    entries = json.loads(reg.read_text())
    assert [e["name"] for e in entries] == ["qaraami_large"]
    entries[0]["listening_gate"] = "passed (Khalid, 2026-10)"
    reg.write_text(json.dumps(entries))
    second = ra.main(args + ["--corpus", "hand-written corpus"])
    entries = json.loads(reg.read_text())
    assert len(entries) == 1 and second["corpus"] == "hand-written corpus" and entries[0]["listening_gate"] == "passed (Khalid, 2026-10)"


def test_main_full_decoder_auto_kind_and_research_only_run(tmp_path: Path) -> None:
    run = _run(tmp_path, "qaraami_medium_full", kind="full_decoder", rights=["ahmed_ilkacase_consented", "harvard_research_only"])
    reg = tmp_path / "adapters.extra.json"
    e = ra.main(["--run", str(run), "--name", "qaraami_medium_full", "--registry", str(reg)])
    assert e["kind"] == "full_decoder" and e["base"] == "facebook/musicgen-medium" and e["rights"] == "research_only"
    assert e["trained_on_rights"] == {"ahmed_ilkacase_consented": 1, "harvard_research_only": 1}
    with pytest.raises(SystemExit, match="refused"):
        ra.main(["--run", str(run), "--name", "qaraami_medium_full", "--registry", str(reg), "--rights", "releasable"])


def test_main_dry_run_writes_nothing_and_validates_name(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    run = _run(tmp_path)
    reg = tmp_path / "adapters.extra.json"
    ra.main(["--run", str(run), "--name", "qaraami_large", "--registry", str(reg), "--dry-run"])
    assert not reg.exists() and "dry run" in capsys.readouterr().out
    with pytest.raises(SystemExit, match="--name"):
        ra.main(["--run", str(run), "--name", "base", "--registry", str(reg)])
    with pytest.raises(SystemExit, match="--name"):
        ra.main(["--run", str(run), "--name", "bad name!", "--registry", str(reg)])
    # exactly the service's NAME_RE: the old isalnum() check let these through and the service dropped them silently
    for bad in (".hidden", "_under", "-x", "qaraamié", "a" * 41, "", "ok\n"):
        assert not ra.valid_name(bad)
        with pytest.raises(SystemExit, match="--name"):
            ra.main(["--run", str(run), f"--name={bad}", "--registry", str(reg), "--dry-run"])  # --name=-x: argparse would read -x as a flag
    for good in ("qaraami_large", "Ok.name-1", "7up", "a" * 40):
        assert ra.valid_name(good)
    assert ra.main(["--run", str(run), "--name", "Ok.name-1", "--registry", str(reg), "--dry-run"])["name"] == "Ok.name-1"
    assert not reg.exists()
    with pytest.raises(SystemExit, match="not a directory"):
        ra.main(["--run", str(tmp_path / "nope"), "--name", "x", "--registry", str(reg)])


def test_main_tolerates_non_object_registry_entries(tmp_path: Path) -> None:
    run = _run(tmp_path)
    reg = tmp_path / "adapters.extra.json"
    reg.write_text(json.dumps(["junk string entry", {"name": "other", "kind": "lora", "path": "runs/o/ckpt_step_0250", "base": "b"}]))
    e = ra.main(["--run", str(run), "--name", "uni_lora", "--registry", str(reg)])
    assert e["name"] == "uni_lora"
    entries = json.loads(reg.read_text())
    assert entries[0] == "junk string entry" and [x["name"] for x in entries[1:]] == ["other", "uni_lora"]  # left for the service to skip, not a crash


def test_main_dpo_run_gets_a_dpo_line_and_a_parent(tmp_path: Path) -> None:
    """runs/dpo_<tag>: round_N/adapter plus a ckpt_step_NNNN symlink alias (dpo_train.alias_checkpoint),
    a dpo-style config.json and summary.json, no loss.csv."""
    run = tmp_path / "runs" / "dpo_v2_qaraami_large"
    adapter = run / "round_1" / "adapter"
    adapter.mkdir(parents=True)
    (adapter / "adapter_config.json").write_text("{}")
    (run / "ckpt_step_0062").symlink_to(Path("round_1/adapter"), target_is_directory=True)
    caps = _captions(tmp_path / "dpo_caps.jsonl", ["ahmed_ilkacase_consented"] * 2)
    parent = tmp_path / "runs" / "qaraami_large" / "ckpt_step_2750"
    (run / "config.json").write_text(json.dumps({**DPO_CFG, "rounds": 1, "start_adapter": str(parent), "captions": str(caps)}))
    (run / "summary.json").write_text(json.dumps({"rounds_done": 1, "complete": True, "adapter": str(adapter), "ckpt_alias": "ckpt_step_0062"}))
    e = ra.main(["--run", str(run), "--name", "dpo_v2_qaraami_large", "--registry", str(tmp_path / "reg.json")])
    assert e["kind"] == "lora" and e["best_step"] == 62 and e["rights"] == "releasable"
    assert e["path"].endswith("round_1/adapter")  # the alias symlink is resolved: the entry survives the alias being repointed by a later round
    assert e["parent"] == str(parent.resolve()) and "DPO 1 round(s) of 64x4 = 256 candidates at 15 s, beta 10.0, lr 2e-05, from " in e["trained"]
    assert e["trained"].endswith("best checkpoint step 62") and "metrics" in e and "val_ce" not in e["metrics"]  # no loss.csv in a DPO run


def test_best_checkpoint_dpo_run_without_alias_falls_back_to_rounds(tmp_path: Path) -> None:
    """Older dpo_train layouts (runs/dpo_large): round_N/adapter only, no ckpt_step_* alias."""
    run = tmp_path / "runs" / "dpo_old"
    for n in (1, 2):
        (run / f"round_{n}" / "adapter").mkdir(parents=True)
        (run / f"round_{n}" / "adapter" / "adapter_config.json").write_text("{}")
    (run / "round_3" / "adapter").mkdir(parents=True)  # a round that never saved (no adapter_config.json) is not a checkpoint
    assert ra.dpo_round_adapters(run) == [run / "round_1/adapter", run / "round_2/adapter"]
    assert ra.best_checkpoint(run, {}) == run / "round_2/adapter"  # last saved round
    (run / "summary.json").write_text(json.dumps({"rounds_done": 1, "adapter": str(run / "round_1/adapter")}))
    assert ra.best_checkpoint(run, {}) == run / "round_1/adapter"  # the summary's final adapter wins
    (run / "summary.json").write_text(json.dumps({"adapter": str(run / "round_9/adapter")}))  # gone: back to the last round
    assert ra.best_checkpoint(run, {}) == run / "round_2/adapter"
    t = ra.trained_text({**DPO_CFG, "rounds": 1}, "lora", run / "round_2/adapter")
    assert t.endswith("final round adapter") and "step None" not in t
    assert ra.step_of(run / "round_2/adapter") is None


def test_main_without_captions_needs_rights_and_corpus(tmp_path: Path) -> None:
    run = _run(tmp_path)
    cfg = json.loads((run / "config.json").read_text())
    cfg["captions"] = str(tmp_path / "gone.jsonl")
    (run / "config.json").write_text(json.dumps(cfg))
    reg = tmp_path / "adapters.extra.json"
    with pytest.raises(SystemExit, match="no readable captions"):
        ra.main(["--run", str(run), "--name", "x", "--registry", str(reg)])
    e = ra.main(["--run", str(run), "--name", "x", "--registry", str(reg), "--rights", "research_only", "--corpus", "manual"])
    assert e["rights"] == "research_only" and e["corpus"] == "manual" and e["trained_on_rights"] == {}


def test_pick_eval_json(tmp_path: Path) -> None:
    run = _run(tmp_path, "r")
    assert ra.pick_eval_json(run, None) is None
    (run / "eval_old.json").write_text("{}")
    assert ra.pick_eval_json(run, None).name == "eval_old.json"
    (run / "eval_r.json").write_text("{}")
    assert ra.pick_eval_json(run, None).name == "eval_r.json"
    assert ra.pick_eval_json(run, "old").name == "eval_old.json" and ra.pick_eval_json(run, "missing") is None
