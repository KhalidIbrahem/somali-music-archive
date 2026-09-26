"""Unit tests for the eval_v2 extensions of scripts/scale_eval.py: checkpoint kinds
and the lazy scale_train.load_checkpoint hand-off, the rights filters behind the
real MERT pool and the Turing pairs, the MERT distance block (deterministic fake
embeddings), the KS / bootstrap / tuning helpers, -14 LUFS loudness matching,
resumable generation jobs, and full main() passes on tmp_path with faked models,
generation, scoring and embeddings over 2 s synthesised clips (LoRA run, full-
decoder run, Turing refusal on Harvard rows). No corpus, GPU or network."""

from __future__ import annotations

import contextlib
import csv
import hashlib
import inspect
import json
import re
import types
import zlib
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import pytest
import soundfile as sf

from scripts import scale_eval as se
from scripts import scale_train as st

SR = 32000
TARGETS = ["q_proj", "k_proj", "v_proj", "out_proj", "fc1", "fc2"]


# --- fixtures -----------------------------------------------------------------------

def tone(path: Path, seconds: float = 2.0, freq: float = 220.0, amp: float = 0.3, sr: int = SR) -> Path:
    t = np.arange(int(seconds * sr)) / sr
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32), sr, subtype="PCM_16")
    return path


def _rows(clips: Path, src: str = "ahmed_oud", n: int = 8, split: str = "test", rights: str = "ahmed_ilkacase_consented",
          seconds: float = 2.0) -> list[dict]:
    """n rows, two clips per song, each clip a real 2 s wav under `clips` (absolute clip_path)."""
    rows = []
    for i in range(n):
        song = hashlib.sha256(f"{src} song {i // 2}".encode()).hexdigest()   # distinct sha per song
        stem = f"{src}_{song[:12]}_seg{i % 2:03d}"
        p = tone(clips / f"{stem}.wav", seconds, 200.0 + 10 * i)
        rows.append({"clip_path": str(p), "caption": f"{src} caption {i}, {100 + i} BPM", "song_sha256": song[:64],
                     "split": split, "source": src, "rights": rights, "seconds": seconds})
    return rows


def _captions(path: Path, rows: list[dict]) -> Path:
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return path


def _run(tmp_path: Path, name: str = "run", kind: str = "lora") -> Path:
    run = tmp_path / name
    run.mkdir()
    with open(run / "loss.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["step", "train_loss", "val_loss", "lr", "sec_per_step", "mps_driver_gb"])
        w.writerow([0, "", 4.5, 0.0, "", 8.0])
        w.writerow([250, "", 4.2, "1e-5", "", 8.0])
    ck = run / "ckpt_step_0250"
    ck.mkdir()
    if kind == "lora":
        (ck / "adapter_config.json").write_text("{}")
    elif kind == "full_decoder":
        (ck / "decoder.safetensors").write_bytes(b"\0" * 8)
        (ck / "ckpt_meta.json").write_text(json.dumps({"kind": "full_decoder", "model": "facebook/musicgen-medium", "step": 250}))
    return run


class FakeLora:
    name = "adapter"

    def disable_adapter(self):
        return contextlib.nullcontext()


class FakeFull:
    """A full-decoder model: no disable_adapter at all."""
    name = "full"


class FakeBase:
    name = "base"


def fake_generate(model, processor, caption, seconds, seed, out_path, ref_audio=None, ref_sr=32000, input_features=None) -> float:
    tone(Path(out_path), float(seconds), 300.0 + seed)
    return 0.01


def fake_score(path: Path) -> dict:
    """Deterministic tuning offsets by pool: base clips far off A440, adapter close, real closest."""
    name = Path(path).name
    k = int(re.search(r"(\d{3})", name).group(1)) % 3 if re.search(r"(\d{3})", name) else 0
    if name.endswith("_base.wav"):
        off, pcs = 20.0 + k, 0.55
    elif name.endswith("_adapter.wav") or name.endswith("_model.wav"):
        off, pcs = 4.0 + k, 0.75
    else:
        off, pcs = 1.0 + k, 0.8
    return {"scored": True, "pcs": pcs, "voiced_fraction": 0.5, "tuning_offset_cents": off, "tonic": "A"}


def fake_embed(paths, *args, **kwargs) -> np.ndarray:
    """Real and adapter clips near e0, base clips near e1, small deterministic noise."""
    out = []
    for p in paths:
        name = Path(p).name
        rng = np.random.default_rng(zlib.crc32(name.encode()))
        v = np.zeros(768)
        v[1 if name.endswith("_base.wav") else 0] = 1.0
        v += 0.05 * rng.standard_normal(768)
        out.append(v / np.linalg.norm(v))
    return np.stack(out).astype(np.float32)


def fake_per_song_ce(model, tok, rows, tokens_dir, melody=False, chroma_dir=None) -> dict[str, float]:
    level = 4.0 if getattr(model, "name", "") == "base" else 3.6
    return {r["song_sha256"]: level + 0.01 * (i % 4) for i, r in enumerate(rows)}


class FakeProcessor:
    @staticmethod
    def from_pretrained(name):
        return types.SimpleNamespace(tokenizer=None)


def _patch_models(monkeypatch: pytest.MonkeyPatch, tuned):
    monkeypatch.setattr(se, "AutoProcessor", FakeProcessor)
    monkeypatch.setattr(se, "build_model", lambda *a, **k: FakeBase() if a[-1] is None else FakeLora())
    monkeypatch.setattr(se, "load_base", lambda name: FakeBase())
    monkeypatch.setattr(se, "load_eval_model", lambda *a, **k: tuned)
    monkeypatch.setattr(se, "per_song_ce", fake_per_song_ce)
    monkeypatch.setattr(se, "generate", fake_generate)
    monkeypatch.setattr(se, "score_clip", fake_score)
    monkeypatch.setattr(se, "embed_mert", fake_embed)


# --- checkpoint kinds -----------------------------------------------------------------

def test_ckpt_kind_lora_full_marker_and_none(tmp_path: Path) -> None:
    lora = _run(tmp_path, "lora") / "ckpt_step_0250"
    full = _run(tmp_path, "full", "full_decoder") / "ckpt_step_0250"
    assert se.ckpt_kind(lora) == "lora" and se.ckpt_kind(full) == "full_decoder"
    marker = tmp_path / "marker_only"
    marker.mkdir()
    (marker / "ckpt_meta.json").write_text(json.dumps({"kind": "full_decoder"}))
    assert se.ckpt_kind(marker) == "full_decoder"           # marker without weights still names the kind ...
    with pytest.raises(SystemExit, match="half-written"):     # ... but scale_train cannot load it: refused up front
        se.require_checkpoint(marker, "--run")
    weights = tmp_path / "weights_only"
    weights.mkdir()
    (weights / "model.safetensors").write_bytes(b"")
    assert se.ckpt_kind(weights) is None                    # bare weights are never guessed to be a checkpoint
    partial = tmp_path / "partial_lora"
    partial.mkdir()
    (partial / "adapter_model.safetensors").write_bytes(b"\0" * 8)
    assert se.ckpt_kind(partial) is None and st.ckpt_kind(partial) is None   # a LoRA save a battery kill cut short
    with pytest.raises(SystemExit, match="no LoRA adapter"):
        se.require_checkpoint(partial, "--run")
    empty = tmp_path / "empty"
    empty.mkdir()
    assert se.ckpt_kind(empty) is None and se.ckpt_kind(tmp_path / "absent") is None
    assert se.require_checkpoint(lora, "x") == (lora, "lora")
    assert se.require_checkpoint(full, "x") == (full, "full_decoder")
    with pytest.raises(SystemExit, match="no LoRA adapter"):
        se.require_checkpoint(empty, "--run")


def test_find_best_ckpt_skips_half_written_dirs(tmp_path: Path) -> None:
    run = _run(tmp_path, "r")                               # ckpt_step_0250, val 4.2
    with open(run / "loss.csv", "a", newline="") as fh:
        csv.writer(fh).writerow([500, "", 4.0, "1e-5", "", 8.0])   # better val ...
    half = run / "ckpt_step_0500"
    half.mkdir()
    (half / "adapter_model.safetensors").write_bytes(b"\0" * 8)   # ... but the save died before adapter_config.json
    assert se.find_best_ckpt(run).name == "ckpt_step_0250"
    (half / "adapter_config.json").write_text("{}")               # completed: now it wins
    assert se.find_best_ckpt(run).name == "ckpt_step_0500"
    bare = tmp_path / "bare"
    (bare / "ckpt_step_0100").mkdir(parents=True)
    assert se.find_best_ckpt(bare) == bare                        # nothing loadable: the run dir, for require_checkpoint


def test_ckpt_kind_falls_back_when_scale_train_has_no_helper(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delattr(st, "ckpt_kind", raising=False)
    lora = _run(tmp_path, "lora") / "ckpt_step_0250"
    full = _run(tmp_path, "full", "full_decoder") / "ckpt_step_0250"
    assert se.ckpt_kind(lora) == "lora" and se.ckpt_kind(full) == "full_decoder"


def test_load_eval_model_hands_off_to_scale_train_loader(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = []
    monkeypatch.setattr(st, "load_checkpoint", lambda *a: calls.append(a) or "model", raising=False)
    ck = _run(tmp_path, "full", "full_decoder") / "ckpt_step_0250"
    assert se.load_eval_model("facebook/musicgen-medium", ck, "full_decoder", TARGETS, 64, 128) == "model"
    assert calls == [("facebook/musicgen-medium", str(ck), TARGETS, 64, 128)]


def test_load_eval_model_falls_back_to_peft_without_loader(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delattr(st, "load_checkpoint", raising=False)
    built = []
    monkeypatch.setattr(se, "build_model", lambda *a: built.append(a) or "peft")
    ck = _run(tmp_path, "lora") / "ckpt_step_0250"
    assert se.load_eval_model("facebook/musicgen-medium", ck, "lora", TARGETS, 32, 64) == "peft"
    assert built == [("facebook/musicgen-medium", TARGETS, 32, 64, str(ck))]
    with pytest.raises(SystemExit, match="load_checkpoint"):
        se.load_eval_model("facebook/musicgen-medium", ck, "full_decoder", TARGETS, 32, 64)


def test_load_base_prefers_scale_train_loader(monkeypatch: pytest.MonkeyPatch) -> None:
    class M:
        def __init__(self):
            self.dev, self.evaled = None, False

        def to(self, dev):
            self.dev = dev
            return self

        def eval(self):
            self.evaled = True
            return self

        def modules(self):
            return []
    monkeypatch.setattr(st, "load_base", lambda name: M(), raising=False)
    m = se.load_base("facebook/musicgen-medium")
    assert m.dev == se.DEVICE and m.evaled


# --- stratified test rows -----------------------------------------------------------------

def _mix_rows(clips: Path, n_mix: int = 60, n_oud: int = 10) -> list[dict]:
    """A B/C-shaped test split: full mixes (whose clip_paths sort first) outnumber isolated oud six to one."""
    mix = [dict(r, content="full_mix", caption=f"Somali song, led by vocals {i}") for i, r in enumerate(_rows(clips / "a_mix", "ahmed_mix", n_mix))]
    oud = [dict(r, content="oud") for r in _rows(clips / "b_oud", "ahmed_oud", n_oud)]
    return mix + oud


def test_allocate_caps_equal_share_with_water_filling() -> None:
    assert se.allocate_caps({"mix": 651, "oud": 105}, 128) == {"mix": 64, "oud": 64}
    assert se.allocate_caps({"mix": 651, "oud": 20}, 128) == {"mix": 108, "oud": 20}          # small source's leftover moves
    assert se.allocate_caps({"a": 6, "b": 4}, 5) == {"a": 3, "b": 2}                            # remainder to the largest
    assert se.allocate_caps({"a": 2, "b": 2, "c": 2}, 100) == {"a": 2, "b": 2, "c": 2}          # capped at the rows
    assert se.allocate_caps({"a": 10, "b": 10, "c": 10}, 2) == {"a": 1, "b": 1, "c": 0}
    assert se.allocate_caps({}, 5) == {} and se.allocate_caps({"a": 3}, 0) == {"a": 0}


def test_stratified_test_rows_keeps_isolated_oud_in_the_ce_set(tmp_path: Path) -> None:
    rows = _mix_rows(tmp_path / "c")
    plain = se.select_test_rows(rows, 16)
    assert se.source_counts(plain)["ahmed_mix"]["clips"] >= 15              # the old picker: all but (at most) one clip a mix
    strat = se.stratified_test_rows(rows, 16)
    counts = se.source_counts(strat)
    assert counts["ahmed_mix"]["clips"] == 8 and counts["ahmed_oud"]["clips"] == 8 and len(strat) == 16
    assert [r["clip_path"] for r in strat] == sorted(r["clip_path"] for r in strat)
    assert len({r["clip_path"] for r in strat}) == 16
    # one source reduces to select_test_rows; a cap above the rows takes them all
    oud = [r for r in rows if r["source"] == "ahmed_oud"]
    assert se.stratified_test_rows(oud, 4) == se.select_test_rows(oud, 4)
    assert len(se.stratified_test_rows(rows, 500)) == 70


def test_content_helpers_and_filters(tmp_path: Path) -> None:
    rows = _mix_rows(tmp_path / "c", 8, 4)
    assert se.content_of(rows[0]) == "full_mix" and se.content_of(rows[-1]) == "oud"
    assert se.content_of({"source": "ahmed_oud"}) == "oud" and se.content_of({"source": "contrib_x_oud"}) == "oud"
    assert se.content_of({"source": "harvard_full"}) == "unknown" and se.content_of({"content": "sep_oud"}) == "sep_oud"
    assert se.content_ok(rows[0], None) and se.content_ok(rows[0], ["any"]) and not se.content_ok(rows[0], ["oud", "sep_oud"])
    # the real pool and the Turing rows default to isolated oud in main; the helpers take the filter explicitly
    real = se.pick_real_rows(rows, 10, ["ahmed_ilkacase_consented"], False, ["oud", "sep_oud"])
    assert len(real) == 4 and {r["source"] for r in real} == {"ahmed_oud"}
    assert {r["source"] for r in se.pick_real_rows(rows, 10, None, False)} == {"ahmed_mix", "ahmed_oud"}   # no filter
    tur = se.pick_turing_rows(rows, 6, None, ["oud"])
    assert len(tur) == 4 and all(r["content"] == "oud" for r in tur)
    assert len(se.pick_turing_rows(rows, 6, None, ["any"])) == 6
    with pytest.raises(SystemExit, match="--real-content"):
        se.pick_turing_rows([r for r in rows if r["source"] == "ahmed_mix"], 2, None, ["oud"])
    with pytest.raises(SystemExit, match="rights / content filter"):
        se.pick_real_rows(rows, 4, None, False, ["voice"])
    caps = _captions(tmp_path / "c.jsonl", rows)
    extra = se.extra_captions(caps, 3, set(), None, False, content=["oud"])
    assert len(extra) == 3 and all(c.startswith("ahmed_oud") for c in extra)


# --- rights: real pool and Turing rows ------------------------------------------------------

def test_rights_predicates() -> None:
    ahmed = {"rights": "ahmed_ilkacase_consented", "source": "ahmed_oud"}
    harv = {"rights": "harvard_research_only", "source": "harvard_full"}
    contrib = {"rights": "contrib_xyz_consented", "source": "contrib_xyz"}
    cc = {"rights": "internet_cc", "source": "internet_cc"}
    assert se.is_harvard(harv) and not se.is_harvard(ahmed) and se.is_harvard({"source": "harvard_sep_oud"})
    assert se.is_consented(ahmed) and se.is_consented(contrib) and not se.is_consented(cc) and not se.is_consented(harv)
    assert se.rights_ok(ahmed, None, False) and not se.rights_ok(harv, None, False) and se.rights_ok(harv, None, True)
    assert se.rights_ok(ahmed, ["ahmed_ilkacase_consented"], False) and not se.rights_ok(cc, ["ahmed_ilkacase_consented"], False)
    assert not se.rights_ok(harv, ["harvard_research_only"], False)  # Harvard never for a releasable run, even if asked


def test_run_is_research_only(tmp_path: Path) -> None:
    clips = tmp_path / "clips"
    a = _captions(tmp_path / "a.jsonl", _rows(clips, n=2))
    h = _captions(tmp_path / "h.jsonl", _rows(clips, n=2) + _rows(clips, "harvard_full", 2, "train", "harvard_research_only"))
    assert not se.run_is_research_only(a) and se.run_is_research_only(h)


def test_spread_rows_over_songs_round_robin_no_repeats(tmp_path: Path) -> None:
    rows = _rows(tmp_path / "c", n=6)                         # 3 songs x 2 clips
    rows.append(dict(rows[0], clip_path=rows[0]["clip_path"].replace("seg000", "seg009")))  # song 0 gets a third clip
    picked = se.spread_rows_over_songs(rows, 5)
    songs = [r["song_sha256"][:16] for r in picked]
    assert len(picked) == 5 and len({r["clip_path"] for r in picked}) == 5
    assert songs[:3] == sorted(set(songs)) and songs[3:5] == songs[:2]  # every song before any repeats
    assert len(se.spread_rows_over_songs(rows, 50)) == 7                  # capped at the rows available, none twice


def test_pick_real_rows_filters_and_refuses(tmp_path: Path) -> None:
    clips = tmp_path / "clips"
    test = _rows(clips, n=4) + _rows(clips, "harvard_full", 4, "test", "harvard_research_only")
    real = se.pick_real_rows(test, 6, None, research_only=False)
    assert len(real) == 4 and all(r["source"] == "ahmed_oud" for r in real)
    real_ro = se.pick_real_rows(test, 6, None, research_only=True)
    assert len(real_ro) == 6 and {r["source"] for r in real_ro} == {"ahmed_oud", "harvard_full"}
    only_ahmed = se.pick_real_rows(test, 6, ["ahmed_ilkacase_consented"], research_only=True)
    assert all(r["source"] == "ahmed_oud" for r in only_ahmed)
    with pytest.raises(SystemExit, match="no test row passes the rights / content filter"):
        se.pick_real_rows(test, 6, ["nothing"], research_only=True)


def test_pick_turing_rows_consented_only_and_harvard_refusal(tmp_path: Path) -> None:
    clips = tmp_path / "clips"
    harv = _rows(clips, "harvard_full", 4, "test", "harvard_research_only")
    ahmed = _rows(clips, n=4)
    picked = se.pick_turing_rows(ahmed + harv, 3, None)
    assert len(picked) == 3 and all(se.is_consented(r) for r in picked)
    assert len({r["song_sha256"] for r in picked[:2]}) == 2
    with pytest.raises(SystemExit, match="refusing to build a Turing set from harvard"):
        se.pick_turing_rows(harv, 2, None)
    with pytest.raises(SystemExit, match="no consented test row"):
        se.pick_turing_rows(_rows(clips, "internet", 2, "test", "internet_cc"), 2, None)
    with pytest.raises(SystemExit, match="no consented test row"):
        se.pick_turing_rows(ahmed, 2, ["contrib_x_consented"])


def test_extra_captions_excludes_ab_list_and_cycles(tmp_path: Path) -> None:
    caps = _captions(tmp_path / "c.jsonl", _rows(tmp_path / "clips", n=4))
    ab = {"ahmed_oud caption 0, 100 BPM", "ahmed_oud caption 1, 101 BPM"}
    extra = se.extra_captions(caps, 2, ab, None, False)
    assert set(extra) == {"ahmed_oud caption 2, 102 BPM", "ahmed_oud caption 3, 103 BPM"}
    assert len(se.extra_captions(caps, 5, ab, None, False)) == 5          # cycled: only two distinct captions remain
    assert se.extra_captions(caps, 0, ab, None, False) == []
    assert se.extra_captions(caps, 2, ab, None, False) == se.extra_captions(caps, 2, ab, None, False)  # seeded


def test_ab_captions_cache_size_rules(tmp_path: Path) -> None:
    caps = _captions(tmp_path / "c.jsonl", _mix_rows(tmp_path / "clips", 8, 20))
    cache = tmp_path / "ab.json"
    # --n-ab 0 never writes a cache (an empty one would cap every later eval at zero pairs)
    assert se.ab_captions(caps, 0, cache) == [] and not cache.exists()
    # a probe's --n-ab 2 still seeds at least min_seed captions, from the asked content only
    two = se.ab_captions(caps, 2, cache, rights=["ahmed_ilkacase_consented"], content=["oud"], min_seed=16)
    cached = json.loads(cache.read_text())
    assert len(two) == 2 and len(cached) == 16 and cached[:2] == two and all(c.startswith("ahmed_oud") for c in cached)
    assert se.ab_captions(caps, 16, cache) == cached                    # the later 16-pair eval gets its sixteen
    # a cache shorter than --n-ab is refused, not silently truncated
    with pytest.raises(SystemExit, match="holds 16 captions, --n-ab 20"):
        se.ab_captions(caps, 20, cache)
    # without min_seed the seeding is exactly n (the older callers' contract)
    three = se.ab_captions(caps, 3, tmp_path / "three.json")
    assert len(three) == 3 and json.loads((tmp_path / "three.json").read_text()) == three
    with pytest.raises(SystemExit, match="--real-content"):
        se.ab_captions(caps, 2, tmp_path / "v.json", content=["voice"])
    assert not (tmp_path / "v.json").exists()


# --- MERT block -------------------------------------------------------------------------------------

def test_mert_metrics_with_fake_embeddings(tmp_path: Path) -> None:
    real = [tmp_path / f"real{i:03d}.wav" for i in range(6)]
    base = [tmp_path / f"pair{i:03d}_base.wav" for i in range(6)]
    adapter = [tmp_path / f"pair{i:03d}_adapter.wav" for i in range(6)]
    m, embs = se.mert_metrics(real, base, adapter, embed_fn=fake_embed, n_boot=300)
    assert m["n_real"] == 6 and m["n_gen"] == 6 and embs["real"].shape == (6, 768)
    assert m["fad_adapter_real"] < m["fad_base_real"] and m["fad_adapter_base"] > m["fad_adapter_real"]
    assert m["cos_adapter"] > m["cos_base"] and m["nn_cos_adapter"] > m["nn_cos_base"]
    assert m["delta_ci95"][0] > 0 and m["delta_ci95"][0] <= m["delta_mean"] <= m["delta_ci95"][1]
    assert m["closer_to_real"] is True
    # the module attribute is what mert_metrics uses by default, so a monkeypatch on se.embed_mert takes effect
    assert se.fad_or_none(embs["real"][:1], embs["base"]) is None


def test_nearest_real_cosine_and_fad_helpers() -> None:
    real = np.eye(3)[:2]
    gen = np.array([[0.9, 0.1, 0.0], [0.0, 0.0, 1.0]])
    nn = se.nearest_real_cosine(gen, real)
    assert nn[0] == pytest.approx(0.9 / np.hypot(0.9, 0.1)) and nn[1] == pytest.approx(0.0)
    rng = np.random.default_rng(0)
    a = rng.normal(size=(40, 8))
    assert se.fad_or_none(a, a) == pytest.approx(0.0, abs=1e-6)
    assert se.fad_or_none(a, a + 3.0) > 0


# --- KS / tuning ----------------------------------------------------------------------------------------

def test_ks_stat_and_tuning_stats() -> None:
    same = se.ks_stat([1.0, 2.0, 3.0], [1.0, 2.0, 3.0])
    assert same["statistic"] == 0.0 and same["pvalue"] == 1.0 and same["n_a"] == 3
    assert se.ks_stat([1.0, 2.0], [10.0, 11.0])["statistic"] == 1.0
    assert se.ks_stat([], [1.0]) is None and se.ks_stat([1.0], []) is None
    ts = se.tuning_stats([0.0, 10.0, -20.0, 30.0])
    assert ts == {"n": 4, "mean": 5.0, "sd": pytest.approx(18.03, abs=0.01), "frac_abs_ge_threshold": 0.5}
    assert se.tuning_stats([]) == {"n": 0, "mean": None, "sd": None, "frac_abs_ge_threshold": None}


def test_tuning_block_with_and_without_real() -> None:
    real = [{"scored": True, "tuning_offset_cents": v} for v in (1.0, 2.0, 3.0)]
    base = [{"scored": True, "tuning_offset_cents": v} for v in (20.0, 22.0)] + [{"scored": False}]
    adapter = [{"scored": True, "tuning_offset_cents": v} for v in (2.0, 4.0)]
    tb = se.tuning_block(real, base, adapter)
    assert tb["real"]["n"] == 3 and tb["base"]["n"] == 2 and tb["base"]["frac_abs_ge_threshold"] == 1.0
    assert tb["ks_real_base"]["statistic"] == 1.0 and tb["ks_real_adapter"]["statistic"] < 1.0
    assert tb["offsets"] == {"real": [1.0, 2.0, 3.0], "base": [20.0, 22.0], "adapter": [2.0, 4.0]}
    tb2 = se.tuning_block(None, base, adapter)
    assert tb2["real"] is None and tb2["ks_real_adapter"] is None and tb2["ks_base_adapter"]["statistic"] == 1.0


# --- loudness matching -----------------------------------------------------------------------------------

def test_loudness_match_hits_minus_14_lufs(tmp_path: Path) -> None:
    quiet = tone(tmp_path / "q.wav", 2.0, 220.0, amp=0.02)
    audio, sr = se.load_wav_mono(quiet)
    out, lufs_in, gain_db = se.loudness_match(audio, sr)
    assert lufs_in < -30 and gain_db > 0
    assert pyln.Meter(sr).integrated_loudness(out.astype(np.float64)) == pytest.approx(-14.0, abs=0.5)
    loud = tone(tmp_path / "l.wav", 2.0, 220.0, amp=0.95)
    audio, sr = se.load_wav_mono(loud)
    out, lufs_in, gain_db = se.loudness_match(audio, sr)
    assert gain_db < 0 and float(np.abs(out).max()) <= 0.99
    silence = np.zeros(2 * SR, dtype=np.float32)
    out, lufs_in, gain_db = se.loudness_match(silence, SR)
    assert not np.isfinite(lufs_in) and gain_db == 0.0 and not out.any()
    info = se.write_loudness_matched(quiet, tmp_path / "out" / "m.wav")
    assert (tmp_path / "out" / "m.wav").exists() and info["lufs_out"] == pytest.approx(-14.0, abs=0.5) and info["seconds"] == 2.0


def spiky(path: Path, seconds: float = 2.0, sr: int = SR) -> Path:
    """A quiet tone with full-scale clicks: high crest factor, so it cannot reach -14 LUFS without clipping."""
    t = np.arange(int(seconds * sr)) / sr
    x = 0.01 * np.sin(2 * np.pi * 220.0 * t)
    x[::sr // 4] = 0.95
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, x.astype(np.float32), sr, subtype="PCM_16")
    return path


def test_turing_pair_shares_one_level_even_when_peaks_forbid_minus_14(tmp_path: Path) -> None:
    real = tone(tmp_path / "real.wav", 2.0, 220.0, amp=0.3)
    model = spiky(tmp_path / "model.wav")
    a, sr = se.load_wav_mono(model)
    assert se.achievable_lufs(a, sr) < -14.0                       # the spiky side cannot reach the target cleanly
    b, _ = se.load_wav_mono(real)
    assert se.achievable_lufs(b, sr) == -14.0                      # the tone can
    m = se.write_turing_pair(real, model, tmp_path / "p_real.wav", tmp_path / "p_model.wav")
    assert m["below_target"] is True and m["target_lufs"] < -14.0
    meter = pyln.Meter(sr)
    lr = meter.integrated_loudness(se.load_wav_mono(tmp_path / "p_real.wav")[0].astype(np.float64))
    lm = meter.integrated_loudness(se.load_wav_mono(tmp_path / "p_model.wav")[0].astype(np.float64))
    assert lr == pytest.approx(m["target_lufs"], abs=0.5) and lm == pytest.approx(m["target_lufs"], abs=0.5)
    assert abs(lr - lm) < 0.5                                       # no level cue between the two sides
    assert float(np.abs(se.load_wav_mono(tmp_path / "p_model.wav")[0]).max()) <= 0.99
    # two low-crest sides both land on -14
    m2 = se.write_turing_pair(real, tone(tmp_path / "m2.wav", 2.0, 330.0, amp=0.05), tmp_path / "q_real.wav", tmp_path / "q_model.wav")
    assert m2["below_target"] is False and m2["target_lufs"] == -14.0 and m2["model"]["lufs_out"] == pytest.approx(-14.0, abs=0.5)
    assert se.achievable_lufs(np.zeros(2 * SR, dtype=np.float32), SR) == -14.0   # silence: no constraint


# --- resumable generation ------------------------------------------------------------------------------------

def test_run_jobs_skips_done_clips_unless_fresh(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = []
    monkeypatch.setattr(se, "generate", lambda *a, **k: calls.append(a[5]) or fake_generate(*a, **k))
    jobs = [se.GenJob("c", 2.0, 42, tmp_path / "a.wav"), se.GenJob("c", 2.0, 43, tmp_path / "b.wav")]
    tone(tmp_path / "a.wav", 2.0)                       # already there with the right length
    tone(tmp_path / "b.wav", 1.0)                       # wrong length: regenerated
    assert se.job_done(jobs[0]) and not se.job_done(jobs[1]) and se.wav_seconds(tmp_path / "none.wav") is None
    assert se.run_jobs(None, None, jobs, fresh=False, label="t") == 1 and calls == [tmp_path / "b.wav"]
    assert se.run_jobs(None, None, jobs, fresh=True, label="t") == 2
    assert se.wav_seconds(tmp_path / "b.wav") == pytest.approx(2.0)


def test_run_jobs_conditions_a_melody_job_on_its_chroma_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    seen = []

    def gen(model, processor, caption, seconds, seed, out_path, ref_audio=None, ref_sr=32000, input_features=None):
        seen.append((ref_audio is not None, None if input_features is None else tuple(input_features.shape)))
        return fake_generate(model, processor, caption, seconds, seed, out_path)
    monkeypatch.setattr(se, "generate", gen)
    npy = tmp_path / "chroma_midi" / "x.npy"
    npy.parent.mkdir()
    np.save(npy, np.zeros((235, 12), dtype=np.float16))
    wav = tone(tmp_path / "ref.wav")
    jobs = [se.GenJob("c", 2.0, 42, tmp_path / "a.wav", chroma=npy), se.GenJob("c", 2.0, 43, tmp_path / "b.wav", ref=wav),
            se.GenJob("c", 2.0, 44, tmp_path / "c.wav", ref=wav, chroma=npy)]   # a chroma file wins over a wav
    assert se.run_jobs(None, None, jobs, fresh=True, label="t") == 3
    assert seen == [(False, (1, 235, 12)), (True, None), (False, (1, 235, 12))]
    assert jobs[0].ref_name == "x.npy" and jobs[1].ref_name == "ref.wav" and se.GenJob("c", 1.0, 1, tmp_path / "d.wav").ref_name is None


class FakeCache:
    def __init__(self, n: int) -> None:
        self.n = n

    def get_seq_length(self) -> int:
        return self.n


class FakeMelody:
    """The transformers 4.57 behaviour: the conditioning prefix is dropped whenever ANY cache object is passed,
    and generate() passes an empty one at the first step."""
    config = types.SimpleNamespace(model_type="musicgen_melody")

    def prepare_inputs_for_generation(self, decoder_input_ids, encoder_hidden_states=None, past_key_values=None,
                                      attention_mask=None, **kwargs):
        return {"decoder_input_ids": decoder_input_ids, "past_key_values": past_key_values, "attention_mask": attention_mask,
                "encoder_hidden_states": None if past_key_values is not None else encoder_hidden_states, **kwargs}


class FakePeft:
    def __init__(self, inner) -> None:
        self.inner = inner

    def get_base_model(self):
        return self.inner


def test_patch_melody_generation_keeps_the_prefix_at_step_one() -> None:
    m = FakeMelody()
    empty, filled = FakeCache(0), FakeCache(5)
    assert m.prepare_inputs_for_generation("ids", "prefix", empty)["encoder_hidden_states"] is None      # the regression
    assert se.patch_melody_generation(m) is True and se.patch_melody_generation(m) is False                # idempotent
    out = m.prepare_inputs_for_generation("ids", "prefix", empty, attention_mask="am", guidance_scale=3.0)
    assert out["encoder_hidden_states"] == "prefix" and out["past_key_values"] is empty                     # prefix kept, cache handed back
    assert out["attention_mask"] == "am" and out["guidance_scale"] == 3.0
    assert m.prepare_inputs_for_generation("ids", "prefix", filled)["encoder_hidden_states"] is None       # later steps untouched
    assert m.prepare_inputs_for_generation("ids", "prefix", None)["encoder_hidden_states"] == "prefix"
    assert "kwargs" in inspect.signature(m.prepare_inputs_for_generation).parameters                       # generate()'s kwarg validation
    # under a PEFT wrapper the transformers model underneath is patched; a plain musicgen is left alone
    inner = FakeMelody()
    assert se.patch_melody_generation(FakePeft(inner)) is True and inner._qg_melody_prefix_fix is True
    plain = types.SimpleNamespace(config=types.SimpleNamespace(model_type="musicgen"), prepare_inputs_for_generation=lambda *a, **k: {})
    assert se.patch_melody_generation(plain) is False and not hasattr(plain, "_qg_melody_prefix_fix")
    assert se.patch_melody_generation(object()) is False


def test_melody_chroma_refs_from_rows(tmp_path: Path) -> None:
    rows = _rows(tmp_path / "clips", n=4)                 # 2 songs x 2 clips
    cdir = tmp_path / "chroma_midi"
    cdir.mkdir()
    for r in rows[:3]:
        np.save(cdir / (Path(r["clip_path"]).stem + ".npy"), np.zeros((235, 12), dtype=np.float16))
    refs = se.melody_chroma_refs(rows, cdir, 4)
    assert len(refs) == 4 and all(p.suffix == ".npy" and p.exists() for _, p in refs)
    assert refs[0][0] != refs[1][0] and refs[2][0] == refs[0][0]      # spread over songs before repeating
    assert se.melody_chroma_refs(rows, None, 4) == []                  # no chroma known: the caller falls back to audio
    rows_own = [dict(r, chroma_dir=str(cdir)) for r in rows]           # the row's own chroma_dir wins
    assert se.melody_chroma_refs(rows_own, None, 2)[0][1].parent == cdir


# --- provenance stamps -----------------------------------------------------------------------------------------

def test_stamp_helpers(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    d = tmp_path / "ab_x"
    assert se.read_stamp(d) is None
    new = {"model": "m", "run": "/r", "best_ckpt": "ckpt_step_0500", "ckpt_kind": "lora", "seconds": 2.0, "seed_base": 42,
           "captions_sha256": se.digest(["a", "b"]), "melody_refs_sha256": None}
    assert se.stale_reasons(None, new, se.BASE_STAMP_KEYS) == [f"no {se.STAMP_FILE} (clips of unknown provenance)"]
    se.write_stamp(d, new)
    old = se.read_stamp(d)
    assert old["best_ckpt"] == "ckpt_step_0500" and "written" in old
    assert se.stale_reasons(old, new, se.ADAPTER_STAMP_KEYS) == []
    moved = dict(new, best_ckpt="ckpt_step_1000")
    assert se.stale_reasons(old, moved, se.BASE_STAMP_KEYS) == []                        # base clips do not depend on the ckpt
    assert se.stale_reasons(old, moved, se.ADAPTER_STAMP_KEYS) == ["best_ckpt: 'ckpt_step_0500' -> 'ckpt_step_1000'"]
    assert se.stale_reasons(old, dict(new, captions_sha256="zz"), se.BASE_STAMP_KEYS) == [f"captions_sha256: {new['captions_sha256']!r} -> 'zz'"]
    (d / "GENERATED_BY.json").write_text("not json")
    assert se.read_stamp(d) is None
    # reconcile_side: a stale side loses its clips (and says so); a matching one keeps them; nothing to clear stays quiet
    jobs = [se.GenJob("c", 2.0, 42, d / "pair000_adapter.wav"), se.GenJob("c", 2.0, 43, d / "pair001_adapter.wav")]
    tone(jobs[0].out, 2.0)
    rec = se.reconcile_side(d, "adapter", jobs, ["best_ckpt: a -> b"], fresh=False)
    assert rec == {"existing": 1, "cleared": 1, "reasons": ["best_ckpt: a -> b"]} and not jobs[0].out.exists()
    assert "regenerated: best_ckpt: a -> b" in capsys.readouterr().out
    tone(jobs[0].out, 2.0)
    assert se.reconcile_side(d, "adapter", jobs, [], fresh=False) == {"existing": 1, "cleared": 0, "reasons": []} and jobs[0].out.exists()
    assert se.reconcile_side(d, "adapter", jobs, [], fresh=True) == {"existing": 1, "cleared": 1, "reasons": ["--fresh"]}
    assert se.reconcile_side(d, "adapter", jobs, ["x"], fresh=False) == {"existing": 0, "cleared": 0, "reasons": []}
    assert capsys.readouterr().out.count("regenerated") == 1


def _main_args(run: Path, caps: Path, tag: str, tmp_path: Path, *extra: str) -> list[str]:
    return ["--run", str(run), "--model", "facebook/musicgen-medium", "--captions", str(caps), "--tag", tag,
            "--n-ab", "2", "--ab-seconds", "2", "--mert-real", "4", "--turing", "2",
            "--ab-captions", str(tmp_path / f"ab_{tag}.json"), "--ab-rights", "ahmed_ilkacase_consented",
            "--out-dir", str(tmp_path / "out"), "--ab-root", str(tmp_path / "abroot"), *extra]


def test_main_regenerates_model_clips_when_the_best_checkpoint_moves(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    clips = tmp_path / "clips"
    caps = _captions(tmp_path / "caps.jsonl", _rows(clips, n=8) + _rows(clips, n=2, split="train"))
    run = _run(tmp_path, "r")
    _patch_models(monkeypatch, FakeLora())
    calls: list[str] = []
    monkeypatch.setattr(se, "generate", lambda *a, **k: calls.append(Path(a[5]).name) or fake_generate(*a, **k))
    se.main(_main_args(run, caps, "mv", tmp_path))
    r1 = json.loads((tmp_path / "out" / "eval_mv.json").read_text())
    assert r1["best_ckpt"] == "ckpt_step_0250" and len(calls) == 10                       # 4 + 4 + 2 Turing
    g1 = r1["generation"]
    assert g1["base"] == {"existing": 0, "cleared": 0, "reasons": [], "generated": 4}
    assert g1["adapter"]["generated"] == 4 and g1["turing"]["generated"] == 2
    stamp = json.loads((tmp_path / "abroot" / "ab_mv" / "GENERATED_BY.json").read_text())
    assert stamp["best_ckpt"] == "ckpt_step_0250" and stamp["model"] == "facebook/musicgen-medium" and stamp["n_gen"] == 4
    assert stamp["captions_sha256"] == se.digest([c["caption"] for c in r1["ab"]["pairs"]] + [c["caption"] for c in r1["mert_gen"]["clips"]])
    t_stamp = json.loads((tmp_path / "abroot" / "ab_turing_mv" / "GENERATED_BY.json").read_text())
    assert t_stamp["best_ckpt"] == "ckpt_step_0250" and t_stamp["n"] == 2
    old_adapter = (tmp_path / "abroot" / "ab_mv" / "pair000_adapter.wav").read_bytes()
    # training continued: a better checkpoint appears under the same run and tag
    with open(run / "loss.csv", "a", newline="") as fh:
        csv.writer(fh).writerow([500, "", 4.0, "1e-5", "", 8.0])
    (run / "ckpt_step_0500").mkdir()
    (run / "ckpt_step_0500" / "adapter_config.json").write_text("{}")
    calls.clear()
    se.main(_main_args(run, caps, "mv", tmp_path))
    r2 = json.loads((tmp_path / "out" / "eval_mv.json").read_text())
    assert r2["best_ckpt"] == "ckpt_step_0500"
    # base clips (same model, captions, seeds) are reused; every adapter and Turing model clip is regenerated
    assert sorted(calls) == sorted(["pair000_adapter.wav", "pair001_adapter.wav", "gen002_adapter.wav", "gen003_adapter.wav",
                                    "pair000_model.wav", "pair001_model.wav"])
    g2 = r2["generation"]
    assert g2["base"] == {"existing": 4, "cleared": 0, "reasons": [], "generated": 0}
    assert g2["adapter"]["cleared"] == 4 and g2["adapter"]["reasons"] == ["best_ckpt: 'ckpt_step_0250' -> 'ckpt_step_0500'"]
    assert g2["turing"]["cleared"] == 2 and g2["turing"]["reasons"] == ["best_ckpt: 'ckpt_step_0250' -> 'ckpt_step_0500'"]
    assert json.loads((tmp_path / "abroot" / "ab_mv" / "GENERATED_BY.json").read_text())["best_ckpt"] == "ckpt_step_0500"
    # (the fake generator is seeded by name, so the bytes coincide; what matters is that the file was rewritten)
    assert (tmp_path / "abroot" / "ab_mv" / "pair000_adapter.wav").read_bytes() == old_adapter
    # a third pass with nothing changed generates nothing
    calls.clear()
    se.main(_main_args(run, caps, "mv", tmp_path))
    assert calls == []
    # clips with no stamp at all (an eval before stamps existed) are never trusted
    (tmp_path / "abroot" / "ab_mv" / "GENERATED_BY.json").unlink()
    calls.clear()
    se.main(_main_args(run, caps, "mv", tmp_path))
    assert len(calls) == 8 and json.loads((tmp_path / "out" / "eval_mv.json").read_text())["generation"]["base"]["reasons"] == \
        ["no GENERATED_BY.json (clips of unknown provenance)"]
    # a different base model under the same tag regenerates the base side too
    calls.clear()
    se.main([a if a != "facebook/musicgen-medium" else "facebook/musicgen-large" for a in _main_args(run, caps, "mv", tmp_path)])
    assert len(calls) == 10
    # --fresh regenerates everything and says so
    calls.clear()
    se.main(_main_args(run, caps, "mv", tmp_path, "--fresh"))
    assert len(calls) == 10 and json.loads((tmp_path / "out" / "eval_mv.json").read_text())["generation"]["adapter"]["reasons"] == ["--fresh"]


# --- main(): LoRA run with MERT, tuning and Turing on tmp_path ------------------------------------------------

def test_main_lora_run_writes_mert_tuning_and_turing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    clips = tmp_path / "clips"
    rows = _rows(clips, n=8) + _rows(clips, n=2, split="train")
    caps = _captions(tmp_path / "caps.jsonl", rows)
    run = _run(tmp_path, "ahmed_fx")
    _patch_models(monkeypatch, FakeLora())
    out_dir, ab_root = tmp_path / "out", tmp_path / "abroot"
    se.main(["--run", str(run), "--model", "facebook/musicgen-medium", "--captions", str(caps), "--tag", "fx",
             "--n-ab", "2", "--ab-seconds", "2", "--mert-real", "4", "--turing", "2",
             "--ab-captions", str(tmp_path / "ab.json"), "--ab-rights", "ahmed_ilkacase_consented",
             "--out-dir", str(out_dir), "--ab-root", str(ab_root)])
    out = capsys.readouterr().out
    assert "plan: 8 test clips over 4 songs" in out and "2 A/B pairs + 2 extra generations per side at 2 s; 4 real clips" in out
    assert out.index("plan:") < out.index("n_songs")                # printed before any model work
    res = json.loads((out_dir / "eval_fx.json").read_text())
    assert res["ckpt_kind"] == "lora" and res["best_ckpt"] == "ckpt_step_0250"
    assert res["rights"] == {"research_only": False, "ab_rights": ["ahmed_ilkacase_consented"], "real_content": ["oud", "sep_oud"]}
    assert res["per_song_ce"]["improvement_base_minus_adapter"]["significant"] is True
    assert len(json.loads((tmp_path / "ab.json").read_text())) == 8     # seeded with every caption up to 16, not the probe's 2
    # A/B pairs + two extra generations per side under mert_gen/
    ab = ab_root / "ab_fx"
    assert {p.name for p in ab.glob("pair*.wav")} == {"pair000_base.wav", "pair000_adapter.wav", "pair001_base.wav", "pair001_adapter.wav"}
    assert {p.name for p in (ab / "mert_gen").glob("*.wav")} == {"gen002_base.wav", "gen002_adapter.wav", "gen003_base.wav", "gen003_adapter.wav"}
    assert (ab / "mert_gen" / "CAPTIONS.txt").read_text().startswith("gen002: ")
    assert res["mert_gen"]["n"] == 2 and res["ab"]["n"] == 2
    m = res["mert"]
    assert m["n_real"] == 4 and m["n_gen"] == 4 and m["closer_to_real"] is True
    assert m["fad_adapter_real"] < m["fad_base_real"] and m["delta_ci95"][0] > 0
    assert m["real_rights"] == ["ahmed_ilkacase_consented"] and m["real_songs"] == 4 and len(m["real_files"]) == 4
    assert m["real_content"] == ["oud"] and m["real_sources"] == {"ahmed_oud": {"clips": 4, "songs": 4}}
    # the embeddings of consented recordings sit next to the generated clips (git-ignored), never in the run / out dir
    assert Path(m["embeddings_file"]) == ab / "mert_fx.npz" and not list(out_dir.glob("*.npz")) and not list(run.glob("*.npz"))
    npz = np.load(ab / "mert_fx.npz")
    assert npz["real"].shape == (4, 768) and npz["base"].shape == (4, 768) and npz["adapter"].shape == (4, 768)
    assert [Path(str(p)).name for p in npz["adapter_files"]][:2] == ["pair000_adapter.wav", "pair001_adapter.wav"]
    t = res["tuning"]
    assert t["real"]["n"] == 4 and t["base"]["n"] == 4 and t["adapter"]["n"] == 4
    assert t["base"]["frac_abs_ge_threshold"] == 1.0 and t["adapter"]["frac_abs_ge_threshold"] == 0.0
    assert t["ks_real_base"]["statistic"] == 1.0 and t["ks_real_adapter"]["statistic"] <= 1.0
    # Turing pairs: real copies + model clips at -14 LUFS, captions, README with the question
    td = Path(res["turing_dir"])
    assert td == ab_root / "ab_turing_fx" and res["turing"]["n"] == 2
    assert {p.name for p in td.glob("pair*.wav")} == {"pair000_real.wav", "pair000_model.wav", "pair001_real.wav", "pair001_model.wav"}
    readme = (td / "README.txt").read_text()
    assert "Question: which of the two is the real recording?" in readme and "consented" in readme and "harvard" not in readme.lower()
    assert "consented recordings of Ahmed Ilkacase" in readme and "content oud, sep_oud" in readme
    assert res["turing"]["rights_holders"] == "Ahmed Ilkacase" and res["turing"]["content"] == ["oud"]
    assert res["turing"]["sources"] == {"ahmed_oud": {"clips": 2, "songs": 2}}
    assert (td / "CAPTIONS.txt").read_text().startswith("pair000: ahmed_oud caption")
    for p in td.glob("pair*.wav"):
        a, sr = se.load_wav_mono(p)
        assert pyln.Meter(sr).integrated_loudness(a.astype(np.float64)) == pytest.approx(-14.0, abs=0.5)
    p0 = res["turing"]["pairs"][0]
    assert p0["target_lufs"] == -14.0 and p0["below_target"] is False
    assert p0["real"]["lufs_out"] == pytest.approx(-14.0, abs=0.5) and p0["model"]["lufs_out"] == pytest.approx(-14.0, abs=0.5)
    assert "the same integrated level" in readme and "target_lufs" in readme
    assert res["turing"]["pairs"][0]["seed"] == 42 and res["turing"]["pairs"][1]["seed"] == 43
    # nothing landed under the repo's data/ or runs/
    assert not (se.REPO / "data" / "ab_fx").exists() and not (se.REPO / "data" / "ab_turing_fx").exists()
    assert not (run / "eval_fx.json").exists()
    # a second pass reuses every clip (resumable) and rewrites the same JSON
    calls = []
    monkeypatch.setattr(se, "generate", lambda *a, **k: calls.append(a[5]) or fake_generate(*a, **k))
    se.main(["--run", str(run), "--model", "facebook/musicgen-medium", "--captions", str(caps), "--tag", "fx",
             "--n-ab", "2", "--ab-seconds", "2", "--mert-real", "4", "--turing", "2",
             "--ab-captions", str(tmp_path / "ab.json"), "--ab-rights", "ahmed_ilkacase_consented",
             "--out-dir", str(out_dir), "--ab-root", str(ab_root)])
    assert calls == []


def test_main_full_decoder_run_uses_pristine_base(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    clips = tmp_path / "clips"
    caps = _captions(tmp_path / "caps.jsonl", _rows(clips, n=4))
    run = _run(tmp_path, "full_fx", "full_decoder")
    _patch_models(monkeypatch, FakeFull())
    monkeypatch.setattr(se, "build_model", lambda *a, **k: pytest.fail("a full-decoder run must not build a LoRA model"))
    loaded = []
    monkeypatch.setattr(se, "load_base", lambda name: loaded.append(name) or FakeBase())
    out_dir, ab_root = tmp_path / "out", tmp_path / "abroot"
    se.main(["--run", str(run), "--model", "facebook/musicgen-medium", "--captions", str(caps), "--tag", "full",
             "--n-ab", "2", "--ab-seconds", "2", "--ab-captions", str(tmp_path / "ab.json"),
             "--out-dir", str(out_dir), "--ab-root", str(ab_root)])          # no --mert-real: opt-in, default 0
    res = json.loads((out_dir / "eval_full.json").read_text())
    assert res["ckpt_kind"] == "full_decoder" and loaded == ["facebook/musicgen-medium"]
    assert "mert" not in res and res["tuning"]["real"] is None and res["tuning"]["ks_real_adapter"] is None
    assert res["generation"]["base"]["generated"] == 2 and res["generation"]["adapter"]["generated"] == 2 and "turing" not in res["generation"]
    assert res["tuning"]["base"]["n"] == 2 and res["tuning"]["ks_base_adapter"]["statistic"] == 1.0
    assert "turing_dir" not in res and not (ab_root / "ab_turing_full").exists()
    assert (ab_root / "ab_full" / "pair001_base.wav").exists() and not (ab_root / "ab_full" / "mert_gen").exists()


def test_main_refuses_turing_on_harvard_rows_before_loading(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    clips = tmp_path / "clips"
    caps = _captions(tmp_path / "h.jsonl", _rows(clips, "harvard_full", 4, "test", "harvard_research_only"))
    run = _run(tmp_path, "h_run")
    for name in ("build_model", "load_base", "load_eval_model"):
        monkeypatch.setattr(se, name, lambda *a, **k: pytest.fail("no model may load before the Turing refusal"))
    monkeypatch.setattr(se, "AutoProcessor", FakeProcessor)
    with pytest.raises(SystemExit, match="refusing to build a Turing set from harvard"):
        se.main(["--run", str(run), "--model", "facebook/musicgen-medium", "--captions", str(caps), "--tag", "h",
                 "--n-ab", "2", "--ab-seconds", "2", "--mert-real", "0", "--turing", "2",
                 "--ab-captions", str(tmp_path / "ab.json"), "--out-dir", str(tmp_path / "out"), "--ab-root", str(tmp_path / "ab")])
    assert not (tmp_path / "ab.json").exists()   # refused before the caption cache was seeded
    # a research-only run may measure MERT against its Harvard test clips, but still gets no Turing set
    with pytest.raises(SystemExit, match="no test row passes the rights / content filter"):
        se.main(["--run", str(run), "--model", "facebook/musicgen-medium", "--captions", str(caps), "--tag", "h",
                 "--n-ab", "2", "--mert-real", "4", "--ab-captions", str(tmp_path / "ab.json"),
                 "--ab-rights", "ahmed_ilkacase_consented", "--out-dir", str(tmp_path / "out"), "--ab-root", str(tmp_path / "ab")])


def test_main_mix_dominated_split_scores_oud_and_keeps_mixes_out_of_the_real_pool(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A B/C-shaped test split (full mixes led by vocals outnumbering isolated oud): the CE set holds both
    sources, the real MERT pool, the Turing real side and the A/B seed captions are isolated oud only."""
    rows = _mix_rows(tmp_path / "clips", 30, 6) + _rows(tmp_path / "clips" / "tr", n=2, split="train")
    caps = _captions(tmp_path / "caps.jsonl", rows)
    run = _run(tmp_path, "mixrun")
    _patch_models(monkeypatch, FakeLora())
    se.main(_main_args(run, caps, "mix", tmp_path))
    res = json.loads((tmp_path / "out" / "eval_mix.json").read_text())
    assert res["test_sources"] == {"ahmed_mix": {"clips": 30, "songs": 15}, "ahmed_oud": {"clips": 6, "songs": 3}}   # all fit under 128
    assert res["mert"]["real_sources"] == {"ahmed_oud": {"clips": 4, "songs": 3}} and res["mert"]["real_content"] == ["oud"]
    assert all(p["caption"].startswith("ahmed_oud") for p in res["ab"]["pairs"])
    assert all(c["caption"].startswith("ahmed_oud") for c in res["mert_gen"]["clips"])
    assert res["turing"]["content"] == ["oud"] and all(p["caption"].startswith("ahmed_oud") for p in res["turing"]["pairs"])
    assert all(c.startswith("ahmed_oud") for c in json.loads((tmp_path / "ab_mix.json").read_text()))
    # --real-content any lifts the filter (a new tag / cache): mixes may then stand in the real pool
    se.main(_main_args(run, caps, "mixany", tmp_path, "--real-content", "any", "--mert-real", "8"))
    res2 = json.loads((tmp_path / "out" / "eval_mixany.json").read_text())
    assert "ahmed_mix" in res2["mert"]["real_sources"] and res2["rights"]["real_content"] is None


def test_main_melody_run_conditions_every_generation_on_the_rows_chroma(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Recipe D: A/B pairs, mert_gen extras and the Turing model clip take the rows' chroma files (input_features),
    the Turing clip the real row's own; --melody-refs (audio) is only the fallback."""
    clips = tmp_path / "clips"
    rows = _rows(clips, n=8) + _rows(clips, n=2, split="train")
    cdir = tmp_path / "chroma_midi"
    cdir.mkdir()
    for r in rows:
        np.save(cdir / (Path(r["clip_path"]).stem + ".npy"), np.zeros((235, 12), dtype=np.float16))
        r["chroma_dir"] = str(cdir)
    caps = _captions(tmp_path / "caps.jsonl", rows)
    run = _run(tmp_path, "mel")
    _patch_models(monkeypatch, FakeLora())
    calls: dict[str, tuple] = {}

    def gen(model, processor, caption, seconds, seed, out_path, ref_audio=None, ref_sr=32000, input_features=None):
        calls[Path(out_path).name] = (ref_audio is not None, None if input_features is None else tuple(input_features.shape))
        return fake_generate(model, processor, caption, seconds, seed, out_path)
    monkeypatch.setattr(se, "generate", gen)
    wavdir = tmp_path / "refwavs"
    tone(wavdir / "ahmed_oud_zzzz_seg000.wav")
    se.main([*_main_args(run, caps, "mel", tmp_path), "--model", "facebook/musicgen-melody", "--melody-refs", str(wavdir)])
    res = json.loads((tmp_path / "out" / "eval_mel.json").read_text())
    assert res["melody_refs"]["chroma_source"] == "chroma_midi" and res["melody_refs"]["dir"] == str(cdir)
    assert all(f.endswith(".npy") for f in res["melody_refs"]["files"]) and res["melody_refs"]["n_songs"] == 4
    assert res["ab"]["pairs"][0]["melody_ref"].endswith(".npy")
    assert len(calls) == 10 and all(v == (False, (1, 235, 12)) for v in calls.values())     # chroma, never audio
    t0 = res["turing"]["pairs"][0]
    assert calls["pair000_model.wav"] == (False, (1, 235, 12))
    assert Path(res["turing"]["pairs"][0]["real"]["src"]).stem == Path(t0["real"]["src"]).stem
    stamp = json.loads((tmp_path / "abroot" / "ab_mel" / "GENERATED_BY.json").read_text())
    assert stamp["chroma_source"] == "chroma_midi" and stamp["melody_refs_sha256"]
    # base and adapter of a pair share the reference
    assert res["ab"]["pairs"][0]["melody_ref"] == res["ab"]["pairs"][0]["melody_ref"] and res["ab"]["pairs"][1]["melody_ref_song"] != res["ab"]["pairs"][0]["melody_ref_song"]


def test_turing_readme_names_question_and_rights(tmp_path: Path) -> None:
    txt = se.turing_readme(tmp_path / "runs" / "r", "t", tmp_path / "ckpt_step_0250", "facebook/musicgen-large", 16,
                           ["ahmed_ilkacase_consented"])
    assert "Question: which of the two is the real recording?" in txt
    assert "consented recordings of Ahmed Ilkacase" in txt and "-14 LUFS" in txt and "16 pairs" in txt
    both = se.turing_readme(tmp_path / "r", "t", tmp_path / "c", "m", 4, ["contrib_hodan_consented", "ahmed_ilkacase_consented"], ["oud"])
    assert "consented recordings of Ahmed Ilkacase, contributor hodan" in both and "content oud" in both
    assert se.rights_holders(["contrib_x_consented"]) == "contributor x" and se.rights_holders(["odd_tier"]) == "odd_tier"
