"""Unit tests for scripts/showcase_final.py: the fixed caption list (seeded
from consented test captions only, read back when it exists, its composition
persisted), the loudness normalisation on synthesised audio (target, peak
limit, the −70 LUFS gate, silence), the showcase build with a fake generator
and scorer (files, scores.json, README, resume), the research-only and
unverified-rights refusals and the registry / run target resolution incl.
register_adapter's repo-relative "run" spelling. No model, GPU, corpus or network."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import pytest
import soundfile as sf

from scripts import model_report as mr
from scripts import showcase_final as sfin

SR = 32000


def _rows(src: str, n: int, rights: str | None, split: str = "test", caption_prefix: str = "", seconds: float | None = 30.0) -> list[dict]:
    rows = [{"clip_path": f"data/sets/{src}/clips/{split}/{src}_{i:012d}_seg000.wav", "caption": f"{caption_prefix}{src} caption {i}",
             "source": src, "split": split, "song_sha256": f"{src}-{i}", "rights": rights} for i in range(n)]
    if seconds is not None:
        for r in rows:
            r["seconds"] = seconds
    return rows


@pytest.fixture
def captions_file(tmp_path: Path) -> Path:
    rows = (_rows("ahmed_oud", 20, "ahmed_ilkacase_consented") + _rows("ahmed_oud", 5, "ahmed_ilkacase_consented", "train", "train ")
            + _rows("harvard_full", 30, "harvard_research_only") + _rows("internet_oud", 3, "internet_cc"))
    rows.append(dict(rows[0]))  # a duplicate caption must not count twice
    p = tmp_path / "run_captions.jsonl"
    p.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return p


def _sine(seconds: float, dbfs: float = -30.0, hz: float = 220.0) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    return (10 ** (dbfs / 20) * np.sqrt(2) * np.sin(2 * np.pi * hz * t)).astype(np.float32)


def test_showcase_captions_seeded_from_consented_test_rows_only(tmp_path: Path, captions_file: Path) -> None:
    path = tmp_path / "showcase_captions_v2.json"
    caps = sfin.showcase_captions(path, captions_file, n=16)
    assert path.exists() and len(caps) == 16 == len(set(caps))
    assert all(("ahmed_oud" in c or "internet_oud" in c) and "harvard" not in c and "train" not in c for c in caps)
    # the composition is persisted next to the list and read back for README / scores.json
    assert sfin.meta_path(path) == tmp_path / "showcase_captions_v2.meta.json" and sfin.meta_path(path).exists()
    meta = sfin.captions_meta(path)
    assert meta["per_split"] == {"test": 16} and meta["seed"] == 1000 and meta["want"] == 16 and meta["source_captions_file"] == str(captions_file) and meta["created"]
    assert sfin.captions_meta(tmp_path / "no_such_list.json") == {}
    assert caps == sfin.showcase_captions(path, None, n=16)  # read back, no captions file needed
    assert sfin.showcase_captions(path, None, n=3) == caps[:3]
    # seeded: the same list again from scratch
    path.unlink()
    assert sfin.showcase_captions(path, captions_file, n=16) == caps
    # n below 16 still seeds the full 16-entry list
    path.unlink()
    assert sfin.showcase_captions(path, captions_file, n=1) == caps[:1] and len(json.loads(path.read_text())) == 16
    # a test split short of 16 distinct consented captions is topped up from val, then train; Harvard rows never count
    few = tmp_path / "few.jsonl"
    few.write_text("".join(json.dumps(r) + "\n" for r in _rows("ahmed_oud", 5, "ahmed_ilkacase_consented") + _rows("ahmed_oud", 8, "ahmed_ilkacase_consented", "val", "v ")
                           + _rows("ahmed_oud", 9, "ahmed_ilkacase_consented", "train", "t ") + _rows("harvard_full", 40, "harvard_research_only")
                           + _rows("harvard_full", 40, "harvard_research_only", "val")
                           + _rows("harvard_sep_oud", 40, None, "test", "hs ")))  # Harvard by source, no rights key: never a prompt
    notes: list[str] = []
    caps = sfin.showcase_captions(tmp_path / "x.json", few, log=notes.append)
    assert len(caps) == 16 == len(set(caps)) and all("harvard" not in c and not c.startswith("hs ") for c in caps)
    assert sum(c.startswith("ahmed_oud") for c in caps) == 5 and sum(c.startswith("v ") for c in caps) == 8 and sum(c.startswith("t ") for c in caps) == 3
    assert notes == ["caption list seeded from consented rows: test 5, val 8, train 3 (the test split alone had fewer than 16 distinct captions)"]
    picked, meta = sfin.seed_captions(few, 16, sfin.CAPTION_SEED, log=lambda s: None)
    assert caps == picked and meta["per_split"] == {"test": 5, "val": 8, "train": 3}  # seeded, composition recorded
    assert sfin.captions_meta(tmp_path / "x.json")["per_split"] == {"test": 5, "val": 8, "train": 3}
    assert sfin.composition_text({"test": 11, "val": 5}) == "test 11, val 5" and sfin.composition_text({}) == "not recorded"
    # too few consented captions in the whole file, a short existing list, or no file to seed from: errors
    tiny = tmp_path / "tiny.jsonl"
    tiny.write_text("".join(json.dumps(r) + "\n" for r in _rows("ahmed_oud", 5, "ahmed_ilkacase_consented") + _rows("harvard_full", 40, "harvard_research_only")))
    with pytest.raises(SystemExit, match="only 5 distinct consented captions over all splits"):
        sfin.showcase_captions(tmp_path / "y.json", tiny)
    (tmp_path / "short.json").write_text(json.dumps(["a", "b"]))
    with pytest.raises(SystemExit, match="needs at least 16"):
        sfin.showcase_captions(tmp_path / "short.json", None)
    with pytest.raises(SystemExit, match="no captions file"):
        sfin.showcase_captions(tmp_path / "z.json", None)


def test_normalise_loudness_hits_target_and_respects_peak_limit() -> None:
    meter = pyln.Meter(SR)
    quiet = _sine(3.0, -30.0)
    out, info = sfin.normalise_loudness(quiet, SR)
    assert abs(meter.integrated_loudness(out.astype(np.float64)) - (-14.0)) < 0.5 and abs(info["lufs_out"] + 14.0) < 0.5
    assert info["gain_db"] > 10 and not info["peak_limited"] and np.abs(out).max() <= 0.99 and out.dtype == np.float32
    loud = _sine(3.0, -3.0)
    out, info = sfin.normalise_loudness(loud, SR)
    assert info["gain_db"] < 0 and abs(info["lufs_out"] + 14.0) < 0.5
    # mostly silence with sparse clicks: the -14 LUFS gain would clip, so the 0.99 peak limit wins
    spiky = np.zeros(3 * SR, dtype=np.float32)
    spiky[::SR // 4] = 0.05
    out, info = sfin.normalise_loudness(spiky, SR)
    assert info["peak_limited"] and abs(np.abs(out).max() - 0.99) < 1e-3 and info["lufs_out"] < -14.0
    # digital silence and a too-short clip pass through unchanged
    out, info = sfin.normalise_loudness(np.zeros(2 * SR, dtype=np.float32), SR)
    assert info["note"] == "digital silence; unchanged" and not out.any()
    out, info = sfin.normalise_loudness(_sine(0.1), SR)
    assert info["note"].startswith("shorter") and len(out) == int(0.1 * SR)
    # a clip below pyloudnorm's -70 LUFS absolute gate (integrated loudness -inf, yet audible pitched content when amplified,
    # like a real generated clip at peak -54 dBFS) is peak-normalised to the limit and flagged, never shipped inaudible
    faint = _sine(3.0, -78.0)
    assert not np.isfinite(meter.integrated_loudness(faint.astype(np.float64)))
    out, info = sfin.normalise_loudness(faint, SR)
    assert info["note"].startswith("below the -70 LUFS absolute gate") and info["peak_limited"] and info["lufs_in"] is None
    assert abs(np.abs(out).max() - 0.99) < 1e-3 and info["gain_db"] > 40 and out.dtype == np.float32 and info["lufs_out"] is not None
    # the gate is not tripped by merely quiet audio: -60 dBFS is above it and hits the target as usual
    out, info = sfin.normalise_loudness(_sine(3.0, -60.0), SR)
    assert "note" not in info and abs(info["lufs_out"] + 14.0) < 0.5
    # stereo input is folded to mono
    out, _ = sfin.normalise_loudness(np.stack([quiet, quiet], axis=1), SR)
    assert out.ndim == 1


def _target(tmp_path: Path, research: bool = False, rights: str | None = None) -> sfin.Target:
    ck = tmp_path / "runs/some_run/ckpt_step_0250"
    ck.mkdir(parents=True, exist_ok=True)
    (ck / "adapter_config.json").write_text("{}")
    return sfin.Target(name="some_run", base="facebook/musicgen-medium", ckpt=ck, run_dir=ck.parent, research_only=research,
                       rights=rights or ("research-only" if research else "releasable"),
                       rights_reason="30 training rows are Harvard / research-only material" if research else "all 25 rows carry a consented tier",
                       corpus="ahmed_oud 25 clips (5.0 h)", kind="PEFT LoRA adapter")


def test_build_showcase_with_fake_generator_writes_clips_scores_and_readme(tmp_path: Path) -> None:
    calls: list[tuple[str, int, int]] = []

    def fake_generate(caption: str, seconds: int, seed: int) -> tuple[np.ndarray, int]:
        calls.append((caption, seconds, seed))
        return _sine(seconds, -28.0, 200.0 + seed), SR

    def fake_score(path: Path) -> dict:
        return {"scored": True, "pcs": 0.9, "voiced_fraction": 0.5, "tuning_offset_cents": 4.0, "tonic": "A"}

    caps = [f"caption {i}" for i in range(3)]
    caps_path = tmp_path / "data/showcase_captions_v2.json"
    caps_path.parent.mkdir(parents=True)
    sfin.meta_path(caps_path).write_text(json.dumps({"seed": 1000, "want": 16, "per_split": {"test": 11, "val": 5},
                                                     "source_captions_file": "data/sets/run_ahmed_only_captions.jsonl", "created": "2026-10-01T10:00:00"}))
    out = tmp_path / "data/showcase_final/some_run"
    t = _target(tmp_path)
    res = sfin.build_showcase(t, caps, out, 2, 3.0, fake_generate, fake_score, caps_path, {"torchcrepe": "0.0.24", "pcs_hop": 320}, log=lambda s: None)
    assert [c[2] for c in calls] == [1000, 1001, 1002] and all(c[1] == 2 for c in calls)
    assert sorted(p.name for p in out.iterdir()) == ["CAPTIONS.txt", "README.txt", "clip00.wav", "clip01.wav", "clip02.wav", "scores.json"]
    meter = pyln.Meter(SR)
    for i in range(3):
        audio, sr = sf.read(out / f"clip{i:02d}.wav", dtype="float32")
        assert sr == SR and abs(len(audio) / sr - 2.0) < 0.01 and abs(meter.integrated_loudness(audio.astype(np.float64)) + 14.0) < 0.5
    scores = json.loads((out / "scores.json").read_text())
    assert scores["adapter"] == "some_run" and scores["target_lufs"] == -14.0 and scores["peak_limit"] == 0.99 and scores["research_only"] is False
    assert scores["rights"] == "releasable" and scores["unnormalised_clips"] == [] and scores["captions_meta"]["per_split"] == {"test": 11, "val": 5}
    assert scores["scorer_version"] == {"torchcrepe": "0.0.24", "pcs_hop": 320} and len(scores["clips"]) == 3
    c0 = scores["clips"][0]
    assert c0["clip"] == "clip00.wav" and c0["seed"] == 1000 and c0["caption"] == "caption 0" and c0["scores"]["pcs"] == 0.9
    assert abs(c0["loudness"]["lufs_out"] + 14.0) < 0.5 and c0["loudness"]["gain_db"] > 0 and not c0["loudness"]["peak_limited"]
    readme = (out / "README.txt").read_text()
    assert readme.startswith("QaraamiGen v2 showcase — adapter 'some_run' (releasable: all 25 rows carry a consented tier)\n")
    assert ("Generated by facebook/musicgen-medium with the 'some_run' adapter (" in readme and "PEFT LoRA adapter), fine-tuned on ahmed_oud 25 clips (5.0 h). "
            "Source recordings are not distributed and are not served; every clip in this folder is model output." in readme)
    assert "Clips: 3 × 2 s, batch 1, CFG 3, seed 1000 + i for clipNN, max_new_tokens 100." in readme
    # the README states the recorded composition, not a fixed "seeded from test captions" sentence
    assert ("composition by split of the consented rows it was seeded from: test 11, val 5 (seed 1000, source data/sets/run_ahmed_only_captions.jsonl, "
            "created 2026-10-01T10:00:00).") in readme and "seeded from consented test captions" not in readme
    assert "normalised to -14 LUFS integrated (pyloudnorm) with a 0.99 peak limit that wins over the target." in readme and "torchcrepe 0.0.24, hop 320" in readme
    assert "RESEARCH-ONLY" not in readme and "UNVERIFIED" not in readme
    assert (out / "CAPTIONS.txt").read_text() == "clip00: caption 0\nclip01: caption 1\nclip02: caption 2\n"
    assert res["provenance"] == sfin.provenance_line(t)
    # a list without its .meta.json: the README says the composition is not recorded
    sfin.meta_path(caps_path).unlink()
    assert "composition not recorded (the list predates its .meta.json)." in sfin.readme_text(t, caps_path, 3, 2, 3.0, 1000, {}, False)
    # resume: existing clips are kept, only the new caption is generated; --force regenerates everything
    calls.clear()
    sfin.build_showcase(t, caps + ["caption 3"], out, 2, 3.0, fake_generate, fake_score, caps_path, log=lambda s: None)
    assert [c[2] for c in calls] == [1003]
    calls.clear()
    sfin.build_showcase(t, caps, out, 2, 3.0, fake_generate, fake_score, caps_path, force=True, log=lambda s: None)
    assert [c[2] for c in calls] == [1000, 1001, 1002]
    # a changed length is not "done": clip00 at 3 s is regenerated
    calls.clear()
    sfin.build_showcase(t, caps[:1], out, 3, 3.0, fake_generate, None, caps_path, log=lambda s: None)
    assert calls == [("caption 0", 3, 1000)] and "scores" not in json.loads((out / "scores.json").read_text())["clips"][0]


def test_research_only_is_refused_unless_allowed(tmp_path: Path) -> None:
    t = _target(tmp_path, research=True)
    caps_path = tmp_path / "caps.json"
    out = tmp_path / "out"

    def gen(caption: str, seconds: int, seed: int) -> tuple[np.ndarray, int]:
        return _sine(seconds), SR

    with pytest.raises(SystemExit, match="refusing: adapter 'some_run' is research-only"):
        sfin.build_showcase(t, ["c"], out, 1, 3.0, gen, None, caps_path)
    assert not out.exists()
    sfin.build_showcase(t, ["c"], out, 1, 3.0, gen, None, caps_path, allow_research=True, log=lambda s: None)
    readme = (out / "README.txt").read_text()
    assert readme.startswith("RESEARCH-ONLY — NOT FOR PUBLICATION.")
    assert "(research-only: 30 training rows are Harvard / research-only material)" in readme
    assert "RESEARCH-ONLY adapter: trained on Harvard Loeb Music Library material" in readme
    assert json.loads((out / "scores.json").read_text())["research_only"] is True


def test_unverified_rights_are_refused_unless_allowed_and_never_called_releasable(tmp_path: Path) -> None:
    t = _target(tmp_path, rights="unverified")
    t.rights_reason = "3 rows carry no recognised rights tier (not research-only, not verified consented)"
    out = tmp_path / "out"

    def gen(caption: str, seconds: int, seed: int) -> tuple[np.ndarray, int]:
        return _sine(seconds), SR

    with pytest.raises(SystemExit, match="refusing: adapter 'some_run' has unverified rights .*--allow-unverified-rights"):
        sfin.build_showcase(t, ["c"], out, 1, 3.0, gen, None, tmp_path / "caps.json")
    assert not out.exists()
    with pytest.raises(SystemExit, match="unverified rights"):  # --allow-research-only does not cover it
        sfin.build_showcase(t, ["c"], out, 1, 3.0, gen, None, tmp_path / "caps.json", allow_research=True)
    sfin.build_showcase(t, ["c"], out, 1, 3.0, gen, None, tmp_path / "caps.json", allow_unverified=True, log=lambda s: None)
    readme = (out / "README.txt").read_text()
    assert readme.startswith("RIGHTS UNVERIFIED — NOT CLEARED FOR PUBLICATION.")
    assert "(unverified: 3 rows carry no recognised rights tier" in readme and "releasable" not in readme.lower().replace("not releasable", "")
    assert "RIGHTS UNVERIFIED: the training rows' rights could not be read; not releasable until they are." in readme
    scores = json.loads((out / "scores.json").read_text())
    assert scores["rights"] == "unverified" and scores["research_only"] is False
    assert sfin.refuse_reason(_target(tmp_path), False, False) is None
    with pytest.raises(ValueError, match="rights must be one of"):
        sfin.Target(name="x", base="b", ckpt=tmp_path, rights="maybe")
    assert sfin.Target(name="x", base="b", ckpt=tmp_path, research_only=True).rights == "research-only"


def test_gated_clip_is_flagged_in_scores_readme_and_log(tmp_path: Path) -> None:
    notes: list[str] = []

    def gen(caption: str, seconds: int, seed: int) -> tuple[np.ndarray, int]:
        return _sine(seconds, -78.0 if seed == 1001 else -28.0), SR

    out = tmp_path / "out"
    res = sfin.build_showcase(_target(tmp_path), ["a", "b", "c"], out, 2, 3.0, gen, None, tmp_path / "caps.json", log=notes.append)
    assert res["unnormalised_clips"] == ["clip01.wav"] and res["clips"][1]["loudness"]["note"].startswith("below the -70 LUFS absolute gate")
    assert any("clip01.wav: WARNING loudness not normalised to target" in n for n in notes)
    audio, _ = sf.read(out / "clip01.wav", dtype="float32")
    assert abs(np.abs(audio).max() - 0.99) < 2e-3  # peak-normalised, audible, not shipped at -78 dBFS
    readme = (out / "README.txt").read_text()
    assert "1 clip(s) fell below pyloudnorm's -70 LUFS absolute gate and were peak-normalised to 0.99 instead (clip01.wav; see loudness.note in scores.json)." in readme


def test_targets_from_registry_and_run(tmp_path: Path, captions_file: Path) -> None:
    runs = tmp_path / "runs"
    data = tmp_path / "data"
    data.mkdir()
    ck = runs / "qaraami_large/ckpt_step_2750"
    ck.mkdir(parents=True)
    (ck / "adapter_config.json").write_text("{}")
    (runs / "qaraami_large/config.json").write_text(json.dumps({"model": "facebook/musicgen-large", "captions": str(captions_file)}))
    full = runs / "qaraami_medium_full/ckpt_step_1000"
    full.mkdir(parents=True)
    (full / "decoder.safetensors").write_bytes(b"\0")
    consented_only = tmp_path / "consented.jsonl"
    consented_only.write_text("".join(json.dumps(r) + "\n" for r in _rows("ahmed_oud", 4, "ahmed_ilkacase_consented")))
    (runs / "qaraami_medium_full/config.json").write_text(json.dumps({"model": "facebook/musicgen-medium", "captions": str(consented_only), "full_decoder": True}))
    # the registry in register_adapter.build_entry's exact shape: a list, "run" repo-relative ("runs/<run>")
    registry = tmp_path / "adapters.extra.json"
    registry.write_text(json.dumps([
        {"name": "qaraami_large", "kind": "lora", "path": str(ck), "base": "facebook/musicgen-large", "corpus": "", "trained": "x", "metrics": {},
         "listening_gate": "not yet performed", "rights": "releasable", "best_step": 2750, "run": "runs/qaraami_large", "eval_json": None,
         "trained_on_rights": {"ahmed_ilkacase_consented": 26}, "registered": "2026-10-01T00:00:00"},
        {"name": "qaraami_medium_full", "kind": "full_decoder", "path": str(full), "base": "facebook/musicgen-medium", "rights": "releasable",
         "run": str(runs / "qaraami_medium_full")},
        {"name": "ghost", "kind": "lora", "path": str(ck), "base": "facebook/musicgen-large", "rights": "releasable", "run": "runs/ghost"},   # no run dir
        {"name": "orphan", "kind": "lora", "path": str(tmp_path / "elsewhere/ckpt"), "base": "facebook/musicgen-large"},                     # no run, no rights
    ]))
    (tmp_path / "elsewhere/ckpt").mkdir(parents=True)
    (tmp_path / "elsewhere/ckpt/adapter_config.json").write_text("{}")
    # the registry says releasable, the captions rows say Harvard: the rows win (the repo-relative run IS found and read)
    t = sfin.target_from_registry("qaraami_large", registry, runs, data)
    assert t.run_dir == runs / "qaraami_large" and t.captions == captions_file
    assert t.research_only and t.rights == "research-only" and "Harvard" in t.rights_reason and t.kind == "PEFT LoRA adapter"
    assert t.corpus.startswith("ahmed_oud 26 clips") and "harvard_full 30 clips" in t.corpus
    t = sfin.target_from_registry("qaraami_medium_full", registry, runs, data)
    assert t.rights == "releasable" and not t.research_only and t.kind == "full decoder weights" and t.base == "facebook/musicgen-medium"
    assert t.rights_reason == "all 4 rows carry a consented tier"
    # no run on disk: the registry's own word is reported as such, with the reason saying where it came from
    t = sfin.target_from_registry("ghost", registry, runs, data)
    assert t.run_dir is None and t.rights == "releasable" and t.rights_reason.startswith("no captions file to read the rights from; the registry entry says releasable")
    t = sfin.target_from_registry("orphan", registry, runs, data)
    assert t.rights == "unverified" and t.rights_reason == "no captions file to read the rights from" and t.registry_rights is None
    with pytest.raises(SystemExit, match="not in .*registered: \\['ghost', 'orphan', 'qaraami_large', 'qaraami_medium_full'\\]"):
        sfin.target_from_registry("nope", registry, runs, data)
    with pytest.raises(SystemExit, match="registry .* does not exist"):
        sfin.target_from_registry("x", tmp_path / "absent.json", runs, data)
    # --run with an explicit checkpoint; the model comes from config.json
    t = sfin.target_from_run(runs / "qaraami_medium_full", full, None, data)
    assert t.name == "qaraami_medium_full" and t.base == "facebook/musicgen-medium" and t.ckpt == full
    t = sfin.target_from_run(runs / "qaraami_large", ck, "facebook/musicgen-large", data)
    assert t.research_only
    with pytest.raises(SystemExit, match="holds no LoRA adapter and no decoder weights"):
        sfin.target_from_run(runs / "qaraami_large", runs / "qaraami_large", None, data)
    with pytest.raises(SystemExit, match="not a run directory"):
        sfin.target_from_run(runs / "missing", None, None, data)
    # a run without a captions file: rights cannot be read -> unverified (never "releasable")
    bare = runs / "bare"
    (bare / "ckpt_step_0100").mkdir(parents=True)
    (bare / "ckpt_step_0100/adapter_config.json").write_text("{}")
    (bare / "config.json").write_text(json.dumps({"model": "facebook/musicgen-small"}))
    t = sfin.target_from_run(bare, bare / "ckpt_step_0100", None, data)
    assert t.rights == "unverified" and not t.research_only and t.rights_reason == "no captions file to read the rights from" and t.corpus.startswith("an unrecorded corpus")
    # rows with an unrecognised tier -> unverified; a Harvard row by SOURCE only -> research-only
    odd = tmp_path / "odd.jsonl"
    odd.write_text("".join(json.dumps(r) + "\n" for r in _rows("ahmed_oud", 4, "ahmed_ilkacase_consented") + _rows("band", 3, "band_qaraami")))
    assert sfin.rights_of(odd) == ("unverified", "3 rows carry no recognised rights tier (not research-only, not verified consented)")
    hs = tmp_path / "hs.jsonl"
    hs.write_text("".join(json.dumps(r) + "\n" for r in _rows("ahmed_oud", 4, "ahmed_ilkacase_consented") + _rows("harvard_sep_oud", 2, None)))
    assert sfin.rights_of(hs) == ("research-only", "2 training rows are Harvard / research-only material")
    assert sfin.rights_of(None) == (None, "no captions file to read the rights from")
    (tmp_path / "empty.jsonl").write_text("")
    assert sfin.rights_of(tmp_path / "empty.jsonl") == ("unverified", "the captions file has no rows")


def test_finish_uses_the_runs_clip_length_like_the_model_report(tmp_path: Path) -> None:
    """A 15 s run (config frames 750) whose rows carry no "seconds": the README's
    corpus hours must equal model_report's for the same run, not the 30 s default."""
    runs, data = tmp_path / "runs", tmp_path / "data"
    data.mkdir()
    ck = runs / "oud_small/ckpt_step_0500"
    ck.mkdir(parents=True)
    (ck / "adapter_config.json").write_text("{}")
    caps = tmp_path / "oud_captions.jsonl"
    caps.write_text("".join(json.dumps(r) + "\n" for r in _rows("oud", 40, "ahmed_ilkacase_consented", "train", seconds=None)))
    (runs / "oud_small/config.json").write_text(json.dumps({"model": "facebook/musicgen-small", "captions": str(caps), "frames": 750}))
    t = sfin.target_from_run(runs / "oud_small", ck, None, data)
    assert t.corpus == mr.corpus_of(caps, data, mr.run_clip_seconds({"frames": 750})).summary() == "oud 40 clips (~0.2 h)"
    assert t.corpus != mr.corpus_of(caps, data).summary()  # the 30 s default would say ~0.3 h


def test_load_generator_falls_back_without_load_checkpoint(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """scale_train.load_checkpoint is used when present (any signature this
    script knows), else the PEFT / safetensors fallback; nothing real is loaded."""
    import types

    seen: dict = {}
    fake_st = types.SimpleNamespace(load_checkpoint=lambda model_name, ckpt: seen.setdefault("lc", (model_name, ckpt)) and types.SimpleNamespace(eval=lambda: None))
    monkeypatch.setitem(__import__("sys").modules, "scripts.scale_train", fake_st)
    monkeypatch.setitem(__import__("sys").modules, "transformers", types.SimpleNamespace(AutoProcessor=types.SimpleNamespace(from_pretrained=lambda n: f"proc:{n}")))
    model, proc = sfin.load_generator("facebook/musicgen-medium", tmp_path / "ck")
    assert seen["lc"] == ("facebook/musicgen-medium", str(tmp_path / "ck")) and proc == "proc:facebook/musicgen-medium"
    # without load_checkpoint the fallback loader runs
    monkeypatch.setitem(__import__("sys").modules, "scripts.scale_train", types.SimpleNamespace())
    monkeypatch.setattr(sfin, "_load_fallback", lambda name, ck: types.SimpleNamespace(eval=lambda: None, fallback=(name, ck)))
    model, _ = sfin.load_generator("facebook/musicgen-medium", tmp_path / "ck")
    assert model.fallback == ("facebook/musicgen-medium", tmp_path / "ck")
