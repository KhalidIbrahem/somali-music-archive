"""Unit tests for scripts/model_report.py: the results table from fake eval
JSONs (a v2 run with the Phase 3 MERT / tuning blocks, a missing run, a
research-only run, a DPO v2 round, a prior small-model test_ce.json), the
corpus section, the fixed-wording rules of section (d), the Somali-ness
sentence with and without a Turing result, model cards from a registry and
from the runs, and the five figures. No corpus, GPU or network."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest

from scripts import model_report as mr

SET_CARD = """# Set card: ahmed_oud

- Rights: `ahmed_ilkacase_consented` — consented for training.
- Source audio: 5.01 h (manifest/inventory durations)
- Clips: 1036 × 30 s = 8.63 h (this run: 1036, kept from the previous build: 0)
- Clips per split: {"train": 699, "val": 232, "test": 105}
"""


def _rows(src: str, n: int, songs: int, rights: str, split: str = "train") -> list[dict]:
    """n rows over `songs` songs of one set and split; song ids are split-specific (song-level splits)."""
    sid = (lambda i: f"{src}-{i % songs}") if split == "train" else (lambda i: f"{src}-{split}-{i % songs}")
    return [{"clip_path": f"data/sets/{src}/clips/{split}/{src}_{i % songs:012d}_seg{i // songs:03d}.wav", "caption": f"{src} caption {i % 7}",
             "source": src, "split": split, "song_sha256": sid(i), "rights": rights, "seconds": 30.0} for i in range(n)]


def _eval(tag: str, base: float, adapter: float, mert: bool = True, tuning: bool = True, closer: bool = False,
          model: str = "facebook/musicgen-large") -> dict:
    d = base - adapter
    ev = {
        "tag": tag, "model": model, "run": f"/x/runs/{tag}", "best_ckpt": "ckpt_step_2750",
        "test_clips": 64, "test_songs": 9,
        "per_song_ce": {"n_songs": 9, "base": {"mean": base, "ci95": [base - 0.2, base + 0.2]},
                        "adapter": {"mean": adapter, "ci95": [adapter - 0.2, adapter + 0.2]},
                        "improvement_base_minus_adapter": {"mean": round(d, 4), "ci95": [round(d - 0.03, 4), round(d + 0.03, 4)], "significant": d - 0.03 > 0}},
        "ab": {"dir": str(mr.REPO / f"data/ab_{tag}"), "n": 16, "seconds": 30,
               "base": {"pcs_mean": 0.81, "voiced_fraction_mean": 0.41, "n_scored": 16},
               "adapter": {"pcs_mean": 0.78, "voiced_fraction_mean": 0.52, "n_scored": 16},
               "pairs": [{"pair": i, "caption": "x", "base": {"scored": True, "tuning_offset_cents": 3.0 + i}, "adapter": {"scored": True, "tuning_offset_cents": 10.0 + 2 * i}}
                         for i in range(16)]},
        "scorer_version": {"torchcrepe": "0.0.24", "pcs_hop": 320, "pcs_conf_thresh": 0.5, "pcs_file_sha256": "abcdef0123456789"},
    }
    if mert:
        ev["mert"] = {"n_real": 3, "n_gen": 16, "fad_adapter_real": 0.42 if closer else 0.55, "fad_base_real": 0.50, "fad_adapter_base": 0.2,
                      "cos_adapter": 0.85, "cos_base": 0.80, "nn_cos_adapter": 0.9, "nn_cos_base": 0.88, "delta_mean": 0.02, "delta_ci95": [0.01, 0.03],
                      "closer_to_real": closer, "mert_model": "m-a-p/MERT-v1-95M"}
    if tuning:
        ev["tuning"] = {"threshold_cents": 15.0, "real": {"n": 4, "mean": 19.5, "sd": 10.0, "frac_abs_ge_threshold": 0.75},
                        "base": {"n": 4, "mean": 6.5, "sd": 8.0, "frac_abs_ge_threshold": 0.25}, "adapter": {"n": 4, "mean": 14.5, "sd": 7.5, "frac_abs_ge_threshold": 0.75},
                        "ks_real_adapter": {"statistic": 0.25, "pvalue": 0.9}, "ks_real_base": None, "ks_base_adapter": None,
                        "offsets": {"real": [20.0, 25.0, 3.0, 30.0], "base": [1.0, 2.0, 3.0, 20.0], "adapter": [16.0, 18.0, 2.0, 22.0]}}
    return ev


def _write_run(runs: Path, name: str, ev: dict | None, captions: Path, model: str = "facebook/musicgen-large", steps: int = 3000,
               rank: int | None = 64, alpha: int | None = 128, extra_cfg: dict | None = None) -> Path:
    d = runs / name
    d.mkdir(parents=True)
    cfg = {"model": model, "captions": str(captions), "rank": rank, "alpha": alpha, "lr": 3e-5, "total_steps": steps, "seed": 42,
           "targets": ["q_proj", "k_proj", "v_proj", "out_proj", "fc1", "fc2"], "versions": {"torch": "2.14.0", "peft": "0.20.0"}}
    cfg.update(extra_cfg or {})
    (d / "config.json").write_text(json.dumps(cfg))
    lines = ["step,train_loss,val_loss,lr,sec_per_step,mps_driver_gb", "0,,4.50,0.0,,8.0"]
    for s in range(1, steps + 1):
        lines.append(f"{s},{4.5 - s / steps:.4f},,1e-5,10.0,12.0")
        if s % 250 == 0:
            lines.append(f"{s},,{4.5 - 0.1 * s / 250:.4f},1e-5,,12.0")
    (d / "loss.csv").write_text("\n".join(lines) + "\n")
    if ev is not None:
        (d / f"eval_{name}.json").write_text(json.dumps(ev))
        ck = d / ev["best_ckpt"]
        ck.mkdir()
        (ck / "adapter_config.json").write_text("{}")
        (ck / "adapter_model.safetensors").write_bytes(b"\0" * 1024)
    return d


@pytest.fixture
def tree(tmp_path: Path) -> tuple[Path, Path]:
    runs = tmp_path / "runs"
    data = tmp_path / "data"
    (data / "sets" / "ahmed_oud").mkdir(parents=True)
    (data / "sets" / "ahmed_oud" / "SET_CARD.md").write_text(SET_CARD)
    (data / "listening").mkdir()
    consented = data / "sets" / "run_qaraami_large_captions.jsonl"
    rows = _rows("ahmed_oud", 40, 4, "ahmed_ilkacase_consented") + _rows("ahmed_oud", 8, 2, "ahmed_ilkacase_consented", "test") \
        + _rows("sep_oud", 20, 2, "internet_cc") + _rows("sep_oud", 4, 1, "internet_cc", "val")
    consented.write_text("".join(json.dumps(r) + "\n" for r in rows))
    harvard = data / "sets" / "run_qaraami_large_all_captions.jsonl"
    harvard.write_text("".join(json.dumps(r) + "\n" for r in rows + _rows("harvard_full", 30, 3, "harvard_research_only")))
    # v2: a releasable large run with MERT + tuning (not closer) whose eval also built a Turing set,
    # a research-only run (closer) that stopped early, two not run
    ev_large = _eval("qaraami_large", 4.05, 3.90)
    ev_large["turing"] = {"dir": str(data / "ab_turing_qaraami_large"), "n": 16, "target_lufs": -18.0}
    _write_run(runs, "qaraami_large", ev_large, consented, extra_cfg={"early_stop_patience": 750, "early_stop_min_delta": 0.002, "full_decoder": False})
    _write_run(runs, "qaraami_large_all", _eval("qaraami_large_all", 4.02, 3.85, closer=True), harvard,
               extra_cfg={"early_stop_patience": 750, "early_stop_min_delta": 0.002})
    (runs / "qaraami_large_all" / "EARLY_STOP").write_text(json.dumps({"reason": "val loss not improved by more than 0.002 for 750 steps (patience 750)",
                                                                       "step": 2750, "best_step": 2000, "best_val": 3.7, "val_at_stop": 3.71,
                                                                       "patience": 750, "min_delta": 0.002, "time": "2026-10-01T00:00:00"}))
    # a full-decoder v2 run, recorded the way scale_train records it ("full_decoder": true with rank / alpha
    # still present); eval without MERT / tuning, checkpoint holds decoder.safetensors
    ev = _eval("qaraami_medium_full", 4.10, 4.00, mert=False, tuning=False, model="facebook/musicgen-medium")
    d = _write_run(runs, "qaraami_medium_full", ev, consented, model="facebook/musicgen-medium", rank=32, alpha=64, extra_cfg={"full_decoder": True})
    ck = d / ev["best_ckpt"]
    (ck / "adapter_config.json").unlink()
    (ck / "adapter_model.safetensors").unlink()
    (ck / "decoder.safetensors").write_bytes(b"\0" * 2048)
    # a full-decoder run whose checkpoint directory was pruned: only the config key can tell
    _write_run(runs, "qaraami_medium_full_pruned", _eval("qaraami_medium_full_pruned", 4.10, 4.05, mert=False, tuning=False, model="facebook/musicgen-medium"),
               consented, model="facebook/musicgen-medium", rank=32, alpha=64, extra_cfg={"full_decoder": True})
    for p in (runs / "qaraami_medium_full_pruned/ckpt_step_2750").iterdir():
        p.unlink()
    (runs / "qaraami_medium_full_pruned/ckpt_step_2750").rmdir()
    # a truncated eval (non-atomic write interrupted) and an empty one: both "not run", never a crash
    (runs / "qaraami_trunc").mkdir()
    (runs / "qaraami_trunc/eval_qaraami_trunc.json").write_text('{"tag": "qaraami_trunc", "model": "facebook/musicgen-large", "per_song_ce": {"n_songs": 3')
    (runs / "qaraami_trunc/config.json").write_text("{not json")
    (runs / "qaraami_empty").mkdir()
    (runs / "qaraami_empty/eval_qaraami_empty.json").write_text("{}")
    # a DPO v2 round on the large run, with dpo_train's candidate budget keys
    dpo = runs / "dpo_v2_large"
    dpo.mkdir()
    (dpo / "config.json").write_text(json.dumps({"model": "facebook/musicgen-large", "adapter": str(runs / "qaraami_large/ckpt_step_2750"),
                                                 "beta": 10.0, "lr": 2e-5, "rounds": 1, "seconds": 15, "captions": str(consented),
                                                 "prompts_per_round": 64, "samples_per_prompt": 4, "candidates_per_round": 256,
                                                 "candidates_note": "256 candidates per ROUND (prompts x samples); 256 per prompt is infeasible"}))
    (dpo / "eval_round_1.json").write_text(json.dumps({"round": 1, "held_out_oud_token_ce": {"before": 4.14, "after": 4.18, "clips": 64},
                                                       "before": {"pcs": 0.92, "voiced_fraction": 0.50}, "after": {"pcs": 0.93, "voiced_fraction": 0.55},
                                                       "fad_to_real_oud_test": {"before": 0.44, "after": 0.41}, "ab_dir": str(data / "ab_dpo_v2_large")}))
    # a prior small-model run with test_ce.json only
    hr = runs / "harvard_raw_3000"
    hr.mkdir()
    (hr / "config.json").write_text(json.dumps({"model": "facebook/musicgen-small", "captions": str(harvard), "frames": 750, "lora_r": 16, "lora_alpha": 32,
                                           "lora_targets": ["q_proj", "k_proj", "v_proj", "out_proj"]}))
    (hr / "test_ce.json").write_text(json.dumps({"test_ce": {"base": 4.8363, "step_2750": 4.7468}, "best_test_ckpt": "step_2750",
                                                 "val_ce": {"0": 4.6262, "2750": 4.5501}}))
    # a blind session on the large run's A/B set
    (data / "listening" / "ab_qaraami_large_khalid_20260930-120000.json").write_text(json.dumps({
        "set": "ab_qaraami_large", "listener": "khalid", "date": "2026-09-30T12:00:00", "pairs": [],
        "summary": {"n": 16, "adapter": 11, "base": 2, "none": 3, "adapter_rate": 0.6875, "wilson95": [0.4437, 0.8575]}}))
    # a listening file of another shape whose "set" matches a run's A/B dir (Turing counts): skipped, not a crash
    (data / "listening" / "ab_qaraami_medium_full_khalid_x.json").write_text(json.dumps({
        "set": "ab_qaraami_medium_full", "kind": "turing", "listener": "khalid", "date": "2026-10-02",
        "summary": {"n": 16, "model": 4, "real": 9, "none": 3}}))
    (data / "listening" / "ab_qaraami_medium_full_odd.json").write_text(json.dumps({"set": "ab_qaraami_medium_full", "summary": {"n": 16, "left": 4}}))
    return runs, data


def test_results_table_present_missing_prior_and_dpo_rows(tree: tuple[Path, Path]) -> None:
    runs, data = tree
    md, recs = mr.build_report(runs, data, log_path=data / "no_log.md")
    assert md.startswith("# QaraamiGen v2 — model report")
    assert ("| qaraami_large | v2 | musicgen-large (LoRA r64 α128 (q,k,v,out,fc1,fc2)) | ahmed_oud 48 clips (5.0 h), sep_oud 24 clips (~0.1 h) | ckpt_step_2750 | "
            "4.5000 → 3.4000 | 4.0500 → 3.9000 (Δ +0.150 [0.120, 0.180], n = 9 songs) | 0.410 → 0.520 | 0.8100 → 0.7800 | 0.550 / 0.500 | no | "
            "0.75 / 0.25 / 0.75 | `data/ab_qaraami_large/` (16 pairs, 30 s) | adapter 11 / base 2 / neither 3 of 16, rate 0.69 [0.44, 0.86] (khalid 2026-09-30) |") in md
    assert "| qaraami_large_all | v2 | musicgen-large (LoRA r64 α128 (q,k,v,out,fc1,fc2)) | ahmed_oud 48 clips (5.0 h), harvard_full 30 clips (~0.1 h), sep_oud 24 clips (~0.1 h) |" in md
    assert "| 0.420 / 0.500 | yes |" in md
    assert "| qaraami_medium_full | v2 | musicgen-medium (full decoder fine-tune) |" in md
    assert "| 0.8100 → 0.7800 | not run | not run | – / 0.25 / 0.81 | `data/ab_qaraami_medium_full/` (16 pairs, 30 s) | no blind session yet |" in md  # MERT not run; offsets from the A/B pairs; the Turing-shaped file skipped
    assert "| qaraami_medium_full_pruned | variant | musicgen-medium (full decoder fine-tune) |" in md  # from the config key alone
    assert "| qaraami_melody | v2 | not run |" in md
    assert "| qaraami_trunc | variant | not run |" in md and "| qaraami_empty | variant | not run |" in md
    assert "| oud_lora_r16_nodrop_20260809 | prior: oud (small) | not run |" in md
    assert "| harvard_raw_3000 | prior: harvard_raw (small) | musicgen-small (LoRA r16 α32 (q,k,v,out)) |" in md
    assert "4.6262 → 4.5501 | 4.8363 → 4.7468 (Δ +0.089, clip mean, no CI)" in md
    assert "| dpo_v2_large | variant | musicgen-large (DPO β10, lr 2e-05, 1 round(s), 256 candidates/round) |" in md
    assert "| round_1/adapter | not run | 4.1400 → 4.1800 (Δ -0.040, clip mean, no CI) | 0.500 → 0.550 | 0.9200 → 0.9300 | 0.410 / 0.440 | yes |" in md
    # the best run is ranked by scale_eval's FAD only; the DPO round's FAD is shown in its row but named as not ranked
    assert ("Best evaluated run by MERT-FAD to real (scale_eval design, 2 run(s) ranked): **qaraami_large_all** (research-only). "
            "Not ranked by FAD: dpo_v2_large (DPO round)") in md
    assert "Eval files read (eval_<run>.json first, else the newest eval_*.json): harvard_raw_3000 → `test_ce.json`;" in md
    assert "qaraami_large → `eval_qaraami_large.json`;" in md and "dpo_v2_large → `eval_round_1.json`" in md
    assert "Turing sets built by the evals (real recording vs model clip): qaraami_large → `" in md and "ab_turing_qaraami_large/` (16 pairs) — no session yet." in md
    by = {r.run: r for r in recs}
    assert by["qaraami_large"].rights == "releasable" and by["qaraami_large_all"].research_only
    assert by["harvard_raw_3000"].research_only  # harvard rows in its captions file
    assert by["dpo_v2_large"].kind == "dpo" and by["dpo_v2_large"].group == "variant"
    assert not by["qaraami_melody"].present and not by["qaraami_trunc"].present and not by["qaraami_empty"].present
    assert by["qaraami_large_all"].stop["kind"] == "early_stop" and by["qaraami_large_all"].stop["best_step"] == 2000
    assert mr.stop_text(by["qaraami_large_all"]) == "stopped early at step 2750 (best step 2000, best val 3.7; patience 750 steps, min Δ 0.002)"
    assert mr.stop_text(by["qaraami_large"]) == "ran to its total_steps (3000; no stop marker)"
    assert by["qaraami_large"].turing_set == {"dir": str(data / "ab_turing_qaraami_large"), "n": 16}
    assert by["qaraami_medium_full"].listening == []  # the Turing-shaped and the odd file are not base/adapter sessions
    assert by["dpo_v2_large"].mert["source"] == "dpo_round" and by["qaraami_large"].mert["source"] == "scale_eval"
    assert not mr.rankable_fad(by["dpo_v2_large"]) and mr.rankable_fad(by["qaraami_large"])


def test_corpus_section_and_hours(tree: tuple[Path, Path]) -> None:
    runs, data = tree
    md, recs = mr.build_report(runs, data, log_path=data / "no_log.md")
    # the card's 5.01 h of source audio and its 8.63 h window total both appear; sep_oud has no card → estimate
    assert ("| qaraami_large | `" in md and "ahmed_oud: 48 clips, 6 songs, 5.0 h, 8.6 h of 30 s windows; sep_oud: 24 clips, 3 songs, ~0.1 h |" in md)
    assert "| test 8 (2 songs), train 60 (6 songs), val 4 (1 songs) | ahmed_ilkacase_consented 48, internet_cc 24 → **releasable** |" in md
    assert "harvard_research_only 30, internet_cc 24 → **research-only** |" in md
    c = {r.run: r for r in recs}["qaraami_large"].corpus
    assert c.unique_songs == 9 and abs(c.unique_hours_est - mr.estimate_hours(72, 9)) < 1e-9
    # a captions file without rights rows: unverified, unless the run is one whose rights are known
    assert mr.rights_verdict({"unknown": 5}) == ("rights unverified", "5 rows carry no recognised rights tier")
    assert mr.rights_verdict({"consented": 5}) == ("releasable", "all 5 rows carry a consented tier")
    assert mr.rights_verdict({"consented": 5, "research_only": 1})[0] == "research-only"
    assert mr.rights_tier("contrib_abc_consented") == "consented" and mr.rights_tier("contrib_abc_research_only") == "research_only"
    assert mr.rights_tier("band_qaraami") == "unknown" and mr.rights_tier(None) == "unknown"
    # a whole row: a Harvard source with no rights key is research-only (scale_eval.is_harvard's rule)
    assert mr.rights_tier({"rights": None, "source": "harvard_full"}) == "research_only"
    assert mr.rights_tier({"rights": "ahmed_ilkacase_consented", "source": "ahmed_oud"}) == "consented"
    assert mr.rights_tier({"source": "sep_oud"}) == "unknown"
    assert c.split_overlap() == set()
    c.split_songs["test"].add(next(iter(c.split_songs["train"])))
    assert len(c.split_overlap()) == 1
    assert mr.run_clip_seconds({"frames": 750}) == 15.0 and mr.run_clip_seconds({}) == 30.0 and mr.run_clip_seconds(None) == 30.0


def test_fixed_wording_rules(tree: tuple[Path, Path]) -> None:
    runs, data = tree
    _, recs = mr.build_report(runs, data, log_path=data / "no_log.md")
    text = "\n".join(mr.findings(recs))
    assert "Every evaluated adapter with a CI (4) lowers held-out per-song token cross-entropy" in text
    assert "2 further run(s) report a test CE without a CI (harvard_raw_3000, dpo_v2_large): 1 below the comparison point, dpo_v2_large not." in text
    assert "Every evaluated adapter (5) produces more trackable melody" in text
    assert "Pentatonic conformity (PCS) falls against base in 4 of 5 evaluated runs (qaraami_medium_full, qaraami_large, qaraami_large_all, qaraami_medium_full_pruned) and rises in the others." in text
    assert "qaraami_large_all, dpo_v2_large have outputs closer to the real held-out qaraami clips in MERT space (MERT-FAD) than their base; qaraami_large do not." in text
    assert "In no measured run (2) is the adapter's share of clips more than 15 cents off A440 closer" not in text
    assert "In every measured run (2) the adapter's share of clips more than 15 cents off A440 is closer to the real recordings' share than the base's." in text
    assert ("Blind A/B, ab_qaraami_large (khalid, 2026-09-30): the adapter was preferred in 11 of 16 pairs, the base in 2, neither in 3; "
            "Wilson 95 % [0.44, 0.86], the interval includes one half, no preference established at this n.") in text
    assert "research-only adapters (Harvard rows in training): harvard_raw_3000, qaraami_large_all; releasable adapters: qaraami_medium_full, qaraami_large, dpo_v2_large, qaraami_medium_full_pruned" in text
    assert "at most 30 s of audio per request" in text
    # every run "not closer" → the fixed no-run-closer sentence; nothing evaluated → the empty sentence
    for r in recs:
        if r.present and r.mert.get("closer_to_real") is not None:
            r.mert["closer_to_real"] = False
    text = "\n".join(mr.findings(recs))
    assert "No adapter's outputs are closer to the real held-out qaraami clips in MERT space than its base's outputs (MERT-FAD, 3 run(s) measured)" in text
    for r in recs:
        r.mert = {}
        r.ab = None
    text = "\n".join(mr.findings(recs))
    assert "MERT-embedding distance to the real held-out qaraami clips: not run for any adapter." in text
    assert "Trackable melody (CREPE voiced fraction) has not been measured on any run's A/B clips." in text
    assert mr.findings([]) == ["No run has been evaluated yet; nothing can be said about what the adapters do."]


def test_somali_ness_sentence_variants(tree: tuple[Path, Path]) -> None:
    runs, data = tree
    _, recs = mr.build_report(runs, data, log_path=data / "no_log.md")
    # no Turing session: the fixed sentence from the best run by scale_eval's MERT-FAD (qaraami_large_all, 0.42, closer);
    # the DPO round's lower FAD (0.41, another design) is not ranked
    best, criterion, excluded = mr.best_run_ranking(recs)
    assert best is not None and best.run == "qaraami_large_all" and criterion.startswith("MERT-FAD to real (scale_eval design") and [r.run for r in excluded] == ["dpo_v2_large"]
    # qaraami_large's eval built a Turing set nobody has heard: the sentence says so, before the fixed wording
    s = mr.somali_ness_sentence([], recs)
    assert s.startswith("Turing set(s) built but not yet heard: `") and "ab_turing_qaraami_large/` (16 pairs, run qaraami_large). " in s
    assert s.endswith("No native-listener Turing result exists yet; the MERT distance says closer to the real recordings, which is not a perceptual claim.")
    for r in recs:
        r.turing_set = {}
    assert mr.somali_ness_sentence([], recs) == ("No native-listener Turing result exists yet; the MERT distance says closer to the real recordings, "
                                                 "which is not a perceptual claim.")
    for r in recs:
        if r.present:
            r.mert["closer_to_real"] = False
    assert "says not closer to the real recordings" in mr.somali_ness_sentence([], recs)
    for r in recs:
        r.mert = {}
    assert mr.somali_ness_sentence([], recs) == ("No native-listener Turing result exists yet, and no MERT distance to the real recordings has been "
                                                 "measured for the best run (qaraami_large_all); nothing here is a perceptual claim.")
    # without any rankable FAD the ranking falls back to the CE improvement
    best, criterion, _ = mr.best_run_ranking(recs)
    assert best.run == "qaraami_large_all" and criterion.startswith("per-song CE improvement (")
    # a Turing file (real vs model) drives the sentence
    (data / "listening" / "ab_turing_qaraami_large_khalid_20261001-090000.json").write_text(json.dumps({
        "set": "ab_turing_qaraami_large", "kind": "turing", "listener": "khalid", "date": "2026-10-01T09:00:00", "pairs": [],
        "question": "which of the two is the real recording?",
        "summary": {"n": 16, "model": 4, "real": 9, "none": 3, "model_as_real_rate": 0.25, "wilson95": [0.1002, 0.4945], "wilson95_on": "picked the model as real"}}))
    turing = mr.turing_sessions(data)
    assert len(turing) == 1 and turing[0]["model"] == 4 and turing[0]["real"] == 9
    s = mr.somali_ness_sentence(turing, recs)
    assert s.startswith("Turing check ab_turing_qaraami_large (khalid, 2026-10-01): asked which of a real held-out recording and a model clip is the real recording, "
                        "the listener took the model clip for the real one in 4 of 16 pairs, recognised the real recording in 9, could not tell in 3 "
                        "(model-as-real rate 0.25, Wilson 95 % [0.10, 0.49])")
    assert s.endswith("one listener, so this is one person's ear, not a population claim.")
    md, _ = mr.build_report(runs, data, log_path=data / "no_log.md")
    assert "## (e) Audible Somali-ness\n\nTuring check ab_turing_qaraami_large" in md
    assert "Turing set(s) built but not yet heard" not in md and "ab_turing_qaraami_large/` (16 pairs) — heard." in md


def test_improvement_log_included_or_not_run(tree: tuple[Path, Path], tmp_path: Path) -> None:
    runs, data = tree
    md, _ = mr.build_report(runs, data, log_path=tmp_path / "missing.md")
    assert "## (b) Improvement log\n\nnot run — `docs/eval/IMPROVEMENT_LOG.md` does not exist yet" in md
    log = tmp_path / "IMPROVEMENT_LOG.md"
    log.write_text("# Improvement log\n\n## Variant 1: lr 2e-5\n\nkept: CE better, MERT better.\n\n```\n# a python comment inside a fence\n  ## indented too\n```\n#hashtag, not a heading\n")
    md, _ = mr.build_report(runs, data, log_path=log)
    assert "*Included verbatim from `docs/eval/IMPROVEMENT_LOG.md`.*\n\n### Improvement log\n\n#### Variant 1: lr 2e-5\n\nkept: CE better, MERT better." in md
    # fenced lines and a bare "#word" are not headings and stay verbatim
    assert "```\n# a python comment inside a fence\n  ## indented too\n```\n#hashtag, not a heading" in md


def test_model_cards_from_registry(tree: tuple[Path, Path], tmp_path: Path) -> None:
    runs, data = tree
    registry = tmp_path / "adapters.extra.json"
    registry.write_text(json.dumps({
        "qaraami_large": {"path": str(runs / "qaraami_large/ckpt_step_2750"), "base": "facebook/musicgen-large", "research_only": False,
                          "corpus": "isolated oud sets", "trained": "2026-10-01, LoRA r128", "listening_gate": "not yet performed"},
        "qaraami_large_all": {"path": str(runs / "qaraami_large_all/ckpt_step_2750"), "base": "facebook/musicgen-large", "research_only": True},
        "qaraami_medium_full": {"path": str(runs / "qaraami_medium_full/ckpt_step_2750"), "base": "facebook/musicgen-medium", "run": "qaraami_medium_full"},
    }))
    _, recs = mr.build_report(runs, data, log_path=data / "no_log.md")
    cards = mr.write_cards(recs, runs, data, registry, tmp_path / "cards")
    assert [c.name for c in cards] == ["MODEL_CARD_qaraami_large.md", "MODEL_CARD_qaraami_large_all.md", "MODEL_CARD_qaraami_medium_full.md"]
    releasable = cards[0].read_text()
    assert releasable.startswith("# Model card — `qaraami_large` (QaraamiGen v2)\n\nReleasable adapter: all 72 rows carry a consented tier.")
    assert "**Artifact:** `" in releasable and "(PEFT LoRA adapter, 0.0 MB). Registered on the local service as `qaraami_large`, base `facebook/musicgen-large`." in releasable
    assert "| ahmed_oud | 48 | 6 | 5.0 h | consented |" in releasable and "| sep_oud | 24 | 3 | ~0.1 h | consented |" in releasable
    assert "— song-level: no song appears in two splits (checked over the rows' song ids)." in releasable
    # the disjointness is computed, not asserted: an overlapping song id changes the sentence
    rec = {r.run: r for r in recs}["qaraami_large"]
    rec.corpus.split_songs["test"].add(next(iter(rec.corpus.split_songs["train"])))
    entry = mr.load_registry(registry, runs)[0]
    assert "**1 song id(s) appear in more than one split** (checked over the rows' song ids)." in mr.model_card(entry, rec, data, runs)
    rec.corpus.split_songs["test"] = {s for s in rec.corpus.split_songs["test"] if s not in rec.corpus.split_songs["train"]}
    assert "- learning rate: `3e-05`" in releasable and "- LoRA rank: `64`" in releasable and "- library versions: torch 2.14.0, peft 0.20.0" in releasable
    assert "- early-stop patience (steps; 0 = off): `750`" in releasable and "- early-stop min Δ val loss: `0.002`" in releasable
    assert "- validation interval (loss.csv): every 250 steps; checkpoint interval (ckpt_step_* on disk): not recorded" in releasable
    assert "- stop: ran to its total_steps (3000; no stop marker)" in releasable
    assert "every 250 steps\"" not in releasable and "checkpoints + validation every 250 steps" not in releasable  # nothing asserted from memory
    assert "~0.04" not in releasable and "CFG 3" not in releasable
    assert "| per-song test CE | 4.0500 | 3.9000 |" in releasable and "| closer to real (MERT-FAD) | | no |" in releasable
    assert "| MERT cosine to the real centroid | 0.8000 | 0.8500 |" in releasable
    assert "| MERT nearest-real cosine (paired Δ adapter − base [95 % CI]) | 0.8800 | 0.9000 (Δ +0.020 [0.010, 0.030]) |" in releasable
    assert "adapter 11 / base 2 / neither 3 of 16, rate 0.69 [0.44, 0.86] (khalid 2026-09-30)" in releasable
    assert "Registry listening gate: not yet performed" in releasable
    assert "torchcrepe 0.0.24, hop 320, confidence gate 0.5, scripts/pcs.py sha256 abcdef012345" in releasable
    assert "PeftModel.from_pretrained(model, \"" in releasable and "## Provenance\n\nGenerated by facebook/musicgen-large with the 'qaraami_large' adapter" in releasable
    assert "fine-tuned on isolated oud sets. Source recordings are not distributed" in releasable
    research = cards[1].read_text()
    first_para = research.split("\n\n")[1]
    assert first_para.startswith("**RESEARCH-ONLY ADAPTER.**") and "never published" in first_para
    assert "**research-only** — 30 training rows are Harvard / research-only material." in research
    assert "Research-only adapter: trained on Harvard Loeb Music Library material" in research
    assert "- stop: stopped early at step 2750 (best step 2000, best val 3.7; patience 750 steps, min Δ 0.002)" in research
    full = cards[2].read_text()
    assert "(full decoder weights, 0.0 MB)" in full and "from scripts.scale_train import load_checkpoint" in full
    assert "| MERT-FAD to real held-out clips | – | – |" in full and "| closer to real (MERT-FAD) | | not run |" in full
    # scale_train's "full_decoder": true wins over the recorded rank / alpha: the mode line, no LoRA rows
    assert "- mode: full decoder fine-tune (no LoRA; rank / α / targets are recorded by the harness but unused)" in full
    assert "- LoRA rank" not in full and "- LoRA α" not in full and "- target modules" not in full
    assert "recipe: full decoder fine-tune." in full
    # registry given as a list, with a rights string instead of the flag
    registry.write_text(json.dumps([{"name": "x_large", "kind": "full_decoder", "path": "runs/qaraami_large/ckpt_step_2750", "base": "facebook/musicgen-large",
                                     "rights": "research_only", "best_step": 2750}]))
    entries = mr.load_registry(registry, runs)
    assert entries is not None and entries[0].name == "x_large" and entries[0].research_only is True and entries[0].kind == "full decoder weights"
    assert entries[0].path == mr.REPO / "runs/qaraami_large/ckpt_step_2750"  # repo-relative path, as the service reads it
    assert mr.load_registry(registry, runs) and mr._entry("y", {"path": str(runs / "qaraami_large/ckpt_step_2750"), "kind": "lora"}, runs).run == "qaraami_large"
    registry.write_text("[]")
    assert mr.load_registry(registry, runs) == [] and mr.write_cards(recs, runs, data, registry, tmp_path / "none") == []
    registry.write_text("[{truncated")
    assert mr.load_registry(registry, runs) == []  # unreadable registry: a warning, no cards, no crash


def test_model_cards_from_register_adapter_shaped_registry(tree: tuple[Path, Path], tmp_path: Path) -> None:
    """register_adapter.build_entry writes "run" repo-relative ("runs/<run>") and
    "path" repo-relative too; the card must still find the run record (metrics,
    recipe, rights from the rows) and the rights header must match the Rights section."""
    runs, data = tree
    registry = tmp_path / "adapters.extra.json"
    entries = [
        {"name": "qaraami_large", "kind": "lora", "path": str(runs / "qaraami_large/ckpt_step_2750"), "base": "facebook/musicgen-large",
         "corpus": "ahmed_oud 48 clips (5.0 h), sep_oud 24 clips (~0.1 h)", "trained": "2026-10-01, LoRA r64 α128", "metrics": {"ce_gain": 0.15},
         "listening_gate": "not yet performed", "rights": "releasable", "best_step": 2750, "run": "runs/qaraami_large",
         "eval_json": "runs/qaraami_large/eval_qaraami_large.json", "trained_on_rights": {"ahmed_ilkacase_consented": 48, "internet_cc": 24},
         "registered": "2026-10-01T12:00:00"},
        {"name": "qaraami_large_all", "kind": "lora", "path": str(runs / "qaraami_large_all/ckpt_step_2750"), "base": "facebook/musicgen-large",
         "rights": "research_only", "best_step": 2750, "run": str(runs / "qaraami_large_all")},                         # absolute run path
        {"name": "dpo_v2_large", "kind": "lora", "path": str(runs / "dpo_v2_large/round_1/adapter"), "base": "facebook/musicgen-large",
         "rights": "releasable", "run": "runs/dpo_v2_large"},
        {"name": "qaraami_melody", "kind": "lora", "path": str(runs / "qaraami_melody/ckpt_step_1000"), "base": "facebook/musicgen-melody",
         "rights": "releasable", "run": "runs/qaraami_melody"},                                                         # no run on disk
        {"name": "orphan", "kind": "lora", "path": str(runs / "orphan/ckpt_step_0100"), "base": "facebook/musicgen-small"},  # no run, no rights
    ]
    registry.write_text(json.dumps(entries))
    loaded = mr.load_registry(registry, runs)
    assert [e.run for e in loaded] == ["qaraami_large", "qaraami_large_all", "dpo_v2_large", "qaraami_melody", "orphan"]
    assert mr.find_run_dir("runs/qaraami_large", runs) == runs / "qaraami_large" and mr.find_run_dir(str(runs / "qaraami_large"), runs) == runs / "qaraami_large"
    assert mr.find_run_dir("qaraami_large", runs) == runs / "qaraami_large" and mr.find_run_dir("runs/nope", runs) is None and mr.find_run_dir("", runs) is None
    assert mr.run_name_of("runs/nope", runs) == "nope"
    _, recs = mr.build_report(runs, data, log_path=data / "no_log.md")
    cards = {c.name: c.read_text() for c in mr.write_cards(recs, runs, data, registry, tmp_path / "cards")}
    large = cards["MODEL_CARD_qaraami_large.md"]
    assert large.split("\n\n")[1] == "Releasable adapter: all 72 rows carry a consented tier. Weights may be published; the training audio may not."
    assert "**releasable** — all 72 rows carry a consented tier." in large
    assert "recipe: LoRA r64 α128 (q,k,v,out,fc1,fc2)." in large and "| per-song test CE | 4.0500 | 3.9000 |" in large
    assert "- config.json: not found" not in large and "| registry metrics | `{\"ce_gain\": 0.15}` | |" in large
    assert "adapter 11 / base 2 / neither 3 of 16" in large
    research = cards["MODEL_CARD_qaraami_large_all.md"]
    assert research.split("\n\n")[1].startswith("**RESEARCH-ONLY ADAPTER.**") and "| per-song test CE | 4.0200 | 3.8500 |" in research
    dpo = cards["MODEL_CARD_dpo_v2_large.md"]
    assert "- candidates per round: `256`" in dpo and "- candidate budget note: `256 candidates per ROUND" in dpo
    assert "- stop:" not in dpo  # a DPO round has no loss.csv and no early stop: no stop line
    assert "recipe: DPO β10, lr 2e-05, 1 round(s), 256 candidates/round." in dpo and "(DPO: `scripts/dpo_train.py`)" in dpo
    # no run record: the registry's own rights word is reported as such, never "unverified" under a "Releasable" header
    melody = cards["MODEL_CARD_qaraami_melody.md"]
    assert melody.split("\n\n")[1].startswith("Releasable adapter: the registry entry says releasable")
    assert "**releasable** — the registry entry says releasable" in melody and "rights unverified" not in melody
    assert "MusicgenMelodyForConditionalGeneration.from_pretrained(\"facebook/musicgen-melody\")" in melody and "input_features" in melody
    assert "MusicgenForConditionalGeneration.from_pretrained(\"facebook/musicgen-melody\")" not in melody
    orphan = cards["MODEL_CARD_orphan.md"]
    assert orphan.split("\n\n")[1].startswith("**Rights unverified:** no run record and no rights value in the registry entry.")
    assert "**rights unverified** — no run record" in orphan and "Releasable adapter" not in orphan
    assert "from transformers import MusicgenForConditionalGeneration" in orphan


def test_model_cards_without_registry_come_from_the_runs(tree: tuple[Path, Path], tmp_path: Path) -> None:
    runs, data = tree
    _, recs = mr.build_report(runs, data, log_path=data / "no_log.md")
    cards = mr.write_cards(recs, runs, data, tmp_path / "absent.json", tmp_path / "cards")
    assert sorted(c.name for c in cards) == ["MODEL_CARD_qaraami_large.md", "MODEL_CARD_qaraami_large_all.md", "MODEL_CARD_qaraami_medium_full.md",
                                             "MODEL_CARD_qaraami_medium_full_pruned.md"]
    card = (tmp_path / "cards/MODEL_CARD_qaraami_large_all.md").read_text()
    assert card.split("\n\n")[1].startswith("**RESEARCH-ONLY ADAPTER.**")
    assert "Not yet registered on the service (card derived from run `qaraami_large_all`), base `facebook/musicgen-large`." in card


def test_write_report_writes_markdown_figures_and_cards(tree: tuple[Path, Path], tmp_path: Path) -> None:
    runs, data = tree
    out, figs, cards = mr.write_report(runs, data, tmp_path / "docs/eval/QARAAMI_MODEL_REPORT.md", tmp_path / "docs/figures",
                                       tmp_path / "absent.json", log_path=tmp_path / "missing.md")
    assert out.exists() and "![validation and training loss per v2 run](../figures/v2_loss_curves.png)" in out.read_text()
    assert [p.name for p in figs] == list(mr.FIGURES) and all(p.stat().st_size > 1000 for p in figs)
    assert len(cards) == 4 and all(c.parent == out.parent for c in cards)
    # any other layout: the image links point at the figures actually written
    out2, figs2, _ = mr.write_report(runs, data, tmp_path / "alt/report/REPORT.md", tmp_path / "alt/figs", tmp_path / "absent.json",
                                     tmp_path / "alt/cards", log_path=tmp_path / "missing.md")
    text = out2.read_text()
    assert "(../figures/" not in text and "(../figs/v2_loss_curves.png)" in text
    for line in text.splitlines():
        if line.startswith("!["):
            target = line[line.index("](") + 2:-1]
            assert (out2.parent / target).resolve().exists(), target
    out3, _, _ = mr.write_report(runs, data, tmp_path / "flat/R.md", tmp_path / "flat/deep/figs", tmp_path / "absent.json", tmp_path / "flat/cards",
                                 log_path=tmp_path / "missing.md")
    assert "(deep/figs/v2_fad_bars.png)" in out3.read_text()


def test_eval_file_choice_and_tolerant_readers(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """eval_<run>.json first, else the NEWEST eval_*.json (register_adapter's
    rule, not the alphabetically first); malformed JSON is a warning, not a crash."""
    run = tmp_path / "runs/qaraami_x"
    run.mkdir(parents=True)
    old = run / "eval_aaa_old.json"
    old.write_text(json.dumps({"best_ckpt": "ckpt_step_0500", "per_song_ce": {"n_songs": 2, "base": {"mean": 4.5}, "adapter": {"mean": 4.4},
                                                                              "improvement_base_minus_adapter": {"mean": 0.1}}}))
    os.utime(old, (time.time() - 3600, time.time() - 3600))
    new = run / "eval_zzz_new.json"
    new.write_text(json.dumps({"best_ckpt": "ckpt_step_2000", "per_song_ce": {"n_songs": 2, "base": {"mean": 4.5}, "adapter": {"mean": 4.2},
                                                                              "improvement_base_minus_adapter": {"mean": 0.3}},
                               "mert": {"n_real": 5, "fad_adapter_real": 0.3, "fad_base_real": 0.4, "closer_to_real": True}}))
    (run / "eval_round_9.json").write_text("{}")  # a DPO-shaped name is never an SFT eval
    assert mr.pick_eval_file(run) == new
    ev, name = mr.read_eval_sft(run)
    assert name == "eval_zzz_new.json" and ev["best_ckpt"] == "ckpt_step_2000"
    (run / "eval_qaraami_x.json").write_text(json.dumps({"best_ckpt": "ckpt_step_0250", "per_song_ce": {"base": {"mean": 4.5}, "adapter": {"mean": 4.45}}}))
    assert mr.pick_eval_file(run).name == "eval_qaraami_x.json"
    (run / "eval_qaraami_x.json").write_text('{"best_ckpt": "ckpt_step_0250", "per_song_ce": {')
    assert mr.read_json_safe(run / "eval_qaraami_x.json") is None
    assert mr.read_json_safe(tmp_path / "absent.json") is None
    (tmp_path / "list.json").write_text("[1, 2]")
    assert mr.read_json_safe(tmp_path / "list.json") is None
    err = capsys.readouterr().err
    assert "eval_qaraami_x.json: unreadable JSON" in err and "list.json: not a JSON object" in err
    assert not mr.eval_usable({}) and not mr.eval_usable(None) and mr.eval_usable({"best_ckpt": "x"}) and mr.eval_usable({"per_song_ce": {"a": 1}})
    rec = mr.load_run(tmp_path / "runs", tmp_path / "data", "qaraami_x", "qaraami_x", "variant")
    assert not rec.present and rec.eval_file == "eval_qaraami_x.json"


def test_rel_is_repo_relative_whatever_the_cwd(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(mr.REPO / "apps/ai-service")
    assert mr.rel("../../data/oud_captions.jsonl") == "data/oud_captions.jsonl"
    assert mr.rel(str(mr.REPO / "runs/x/ckpt_step_0001")) == "runs/x/ckpt_step_0001"
    assert mr.rel("/nowhere/else/file.json") == "/nowhere/else/file.json"
    monkeypatch.chdir(mr.REPO)
    assert mr.rel("data/oud_captions.jsonl") == "data/oud_captions.jsonl"


def test_figures_render_with_nothing_evaluated(tmp_path: Path) -> None:
    runs = tmp_path / "runs"
    runs.mkdir()
    (tmp_path / "data").mkdir()
    md, recs = mr.build_report(runs, tmp_path / "data", log_path=tmp_path / "missing.md")
    assert all(not r.present for r in recs) and "No run has been evaluated yet" in md
    assert "No native-listener Turing result exists yet, and no MERT distance to the real recordings has been measured" in md
    figs = mr.write_figures(recs, tmp_path / "figs")
    assert all(p.exists() for p in figs)


def test_block_readers_are_tolerant() -> None:
    ev = {"mert_fad": {"base": 0.5, "adapter": 0.4}, "ab": {"pairs": [{"base": {"tuning_offset_cents": 20.0}, "adapter": {"tuning_offset_cents": 1.0}},
                                                                     {"base": {"tuning_offset_cents": -16.0}, "adapter": {"scored": False}}]}}
    m = mr.mert_block(ev)
    assert m["fad_base"] == 0.5 and m["fad_adapter"] == 0.4 and m["closer_to_real"] is True and m["cosine_adapter"] is None and m["source"] == "scale_eval"
    # the scale_eval spelling, with a real pool absent from the tuning block
    m = mr.mert_block({"mert": {"fad_adapter_real": 0.3, "fad_base_real": 0.6, "cos_adapter": 0.9, "cos_base": 0.8, "nn_cos_adapter": 0.95, "delta_ci95": [0.0, 0.1]}})
    assert (m["fad_adapter"], m["fad_base"], m["closer_to_real"], m["cosine_adapter"], m["cosine_base"], m["nn_cos_adapter"], m["nn_delta_ci95"]) == (0.3, 0.6, True, 0.9, 0.8, 0.95, [0.0, 0.1])
    # a DPO round's FAD is read but tagged with its design, so it is never ranked against scale_eval's
    m = mr.mert_block({"fad_to_real_oud_test": {"before": 0.44, "after": 0.41}})
    assert (m["fad_base"], m["fad_adapter"], m["closer_to_real"], m["source"], m["n_real"]) == (0.44, 0.41, True, "dpo_round", None)
    assert mr.mert_block({})["source"] is None
    # listening files of another shape never reach the cells
    assert mr.listening_cell([{"n": 16, "adapter": 4, "base": 2}]) == "adapter 4 / base 2 / neither 10 of 16, rate 0.25 [0.10, 0.49] ( )"
    assert mr.recipe_of({"full_decoder": True, "rank": 32, "alpha": 64, "targets": ["q_proj"]}, "sft") == "full decoder fine-tune"
    assert mr.recipe_of({"full_decoder": False, "rank": 32, "alpha": 64, "targets": ["q_proj"]}, "sft") == "LoRA r32 α64 (q)"
    t = mr.tuning_block({"tuning": {"real": None, "base": {"n": 2, "frac_abs_ge_threshold": 0.5}, "adapter": {"n": 1, "frac_abs_ge_threshold": 0.0},
                                    "offsets": {"real": None, "base": [1.0, 20.0], "adapter": [2.0]}}})
    assert t["frac"] == {"real": None, "base": 0.5, "adapter": 0.0} and t["offsets"]["base"] == [1.0, 20.0] and t["offsets"]["real"] is None
    t = mr.tuning_block(ev)
    assert t["offsets"]["base"] == [20.0, -16.0] and t["offsets"]["adapter"] == [1.0] and t["offsets"]["real"] is None
    assert t["frac"] == {"real": None, "base": 1.0, "adapter": 0.0}
    assert mr.mert_block({})["closer_to_real"] is None and mr.tuning_cell(mr.tuning_block({})) == "not run"
    # the logged interval is the most common gap: one early probe does not turn "every 250" into "every 150"
    assert mr._interval([0, 100, 250, 500, 750, 1000]) == 250 and mr._interval([250, 500]) == 250 and mr._interval([7]) is None and mr._interval([]) is None
    assert mr.wilson(11, 16) == (0.444, 0.8584) and mr.wilson(0, 0) == (0.0, 0.0)
    assert mr.pick({"a": {"b": 0}}, "a.b") == 0 and mr.pick({"a": {}}, "a.b", "c") is None
