"""Unit tests for the Phase 2 extensions in scripts/scale_train.py: checkpoint
kinds and the full-decoder save/load round trip (on a tiny MusicGen built from a
config), the early-stop decision, --keep-last pruning, the --max-hours helper,
the chroma frame check, the loss.csv val history and the SCALE_RUNS_DIR
override. No corpus, GPU, HF cache or network: everything runs on CPU on
synthesised tensors."""

from __future__ import annotations

import csv
import json
import sys
import time
from pathlib import Path

import numpy as np
import pytest
import torch
from safetensors.torch import load_file
from transformers import (
    EncodecConfig,
    MusicgenConfig,
    MusicgenDecoderConfig,
    MusicgenForConditionalGeneration,
    MusicgenMelodyConfig,
    MusicgenMelodyDecoderConfig,
    MusicgenMelodyForConditionalGeneration,
    T5Config,
)

from scripts import scale_train as st

TINY_TARGETS = ["q_proj", "k_proj", "v_proj", "out_proj", "fc1", "fc2"]


# --- tiny models (a few hundred K parameters, built in milliseconds) -----------------

def _sub_configs():
    # T5 d_model (24) != decoder hidden (16) so the real models' enc_to_dec_proj exists here too
    tc = T5Config(vocab_size=64, d_model=24, d_kv=4, d_ff=32, num_layers=1, num_heads=2, relative_attention_num_buckets=4)
    ac = EncodecConfig(hidden_size=8, num_filters=2, num_residual_layers=1, upsampling_ratios=[2, 2], codebook_size=2048,
                       codebook_dim=8, target_bandwidths=[1.5], sampling_rate=32000, num_lstm_layers=1)
    return tc, ac


def tiny_musicgen(seed: int = 0) -> MusicgenForConditionalGeneration:
    torch.manual_seed(seed)
    tc, ac = _sub_configs()
    dc = MusicgenDecoderConfig(vocab_size=2048, max_position_embeddings=64, num_hidden_layers=1, ffn_dim=32,
                               num_attention_heads=2, hidden_size=16, num_codebooks=4)
    m = MusicgenForConditionalGeneration(MusicgenConfig.from_sub_models_config(tc, ac, dc))
    m.config.decoder.decoder_start_token_id = st.BOS
    m.decoder.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    return m


def tiny_melody(seed: int = 0) -> MusicgenMelodyForConditionalGeneration:
    torch.manual_seed(seed)
    tc, ac = _sub_configs()
    dc = MusicgenMelodyDecoderConfig(vocab_size=2048, max_position_embeddings=64, num_hidden_layers=1, ffn_dim=32,
                                     num_attention_heads=2, hidden_size=16, num_codebooks=4)
    cfg = MusicgenMelodyConfig.from_sub_models_config(tc, ac, dc, num_chroma=st.NUM_CHROMA, chroma_length=st.CHROMA_FRAMES_30S)
    m = MusicgenMelodyForConditionalGeneration(cfg)
    m.config.decoder.decoder_start_token_id = st.BOS
    m.decoder.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    return m


def _fake_tok(text: str, return_tensors: str = "pt") -> dict[str, torch.Tensor]:
    ids = torch.tensor([[3, 4, 5, 6]])
    return {"input_ids": ids, "attention_mask": torch.ones_like(ids)}


def _batch(seed: int = 0) -> dict[str, torch.Tensor]:
    g = torch.Generator().manual_seed(seed)
    ids = torch.tensor([[3, 4, 5]])
    return {"input_ids": ids, "attention_mask": torch.ones_like(ids), "labels": torch.randint(0, 2048, (1, 10, 4), generator=g)}


@torch.no_grad()
def _loss(model, batch: dict[str, torch.Tensor]) -> float:
    model.eval()
    return float(model(**batch).loss)


# --- checkpoint kinds -----------------------------------------------------------------

def test_ckpt_kind_detection(tmp_path: Path) -> None:
    full = tmp_path / "ckpt_step_0250"
    full.mkdir()
    (full / st.DECODER_WEIGHTS).write_bytes(b"")
    lora = tmp_path / "ckpt_step_0500"
    lora.mkdir()
    (lora / st.ADAPTER_CONFIG).write_text("{}")
    empty = tmp_path / "ckpt_step_0750"
    empty.mkdir()
    assert st.is_full_decoder_ckpt(full) and st.is_full_decoder_ckpt(str(full)) and not st.is_lora_ckpt(full)
    assert st.is_lora_ckpt(lora) and not st.is_full_decoder_ckpt(lora)
    assert st.ckpt_kind(full) == "full_decoder" and st.ckpt_kind(lora) == "lora"
    assert st.ckpt_kind(empty) is None and st.ckpt_kind(tmp_path / "missing") is None
    assert not st.is_full_decoder_ckpt(tmp_path / "missing")
    (tmp_path / "samples").mkdir()
    (tmp_path / "ckpt_step_x").mkdir()
    assert st.ckpt_steps(tmp_path) == {250: full, 500: lora, 750: empty}


# --- full-decoder trainability and the save/load round trip ---------------------------

def test_set_full_decoder_trainable_freezes_everything_else() -> None:
    m = tiny_musicgen()
    trainable, total = st.set_full_decoder_trainable(m)
    assert trainable == sum(p.numel() for p in m.decoder.parameters())
    assert total == sum(p.numel() for p in m.parameters()) and trainable < total
    assert all(p.requires_grad for p in m.decoder.parameters())
    assert not any(p.requires_grad for p in m.text_encoder.parameters())
    assert not any(p.requires_grad for p in m.audio_encoder.parameters())
    assert not any(p.requires_grad for p in m.enc_to_dec_proj.parameters())
    assert st.frozen_parts(m) == ["text_encoder", "audio_encoder", "enc_to_dec_proj"]
    mm = tiny_melody()
    assert "audio_enc_to_dec_proj" in st.frozen_parts(mm) and "decoder" not in st.frozen_parts(mm)


def test_full_decoder_checkpoint_round_trip_on_tiny_model(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(st, "DEVICE", "cpu")
    m = tiny_musicgen(seed=1)
    st.set_full_decoder_trainable(m)
    with torch.no_grad():  # move the decoder away from its init so a reload is provably from disk
        for p in m.decoder.parameters():
            p.add_(0.05)
    batch = _batch()
    loss_saved = _loss(m, batch)

    ckpt = st.save_checkpoint(m, tmp_path / "ckpt_step_0003", True, model_name="tiny", step=3, val_loss=1.234)
    assert ckpt == tmp_path / "ckpt_step_0003" and st.ckpt_kind(ckpt) == "full_decoder"
    assert not (ckpt / (st.DECODER_WEIGHTS + ".tmp")).exists() and not (ckpt / st.ADAPTER_CONFIG).exists()
    meta = json.loads((ckpt / st.CKPT_META).read_text())
    assert meta["kind"] == "full_decoder" and meta["model"] == "tiny" and meta["step"] == 3 and meta["val_loss"] == 1.234
    assert meta["frozen"] == ["text_encoder", "audio_encoder", "enc_to_dec_proj"] and meta["trainable"] == "decoder"
    sd = load_file(str(ckpt / st.DECODER_WEIGHTS))
    assert set(sd) == set(m.decoder.state_dict()) and all(v.dtype == torch.float32 for v in sd.values())
    assert meta["n_tensors"] == len(sd) and meta["n_params"] == sum(v.numel() for v in sd.values())

    # load_checkpoint: a fresh base (same seed -> same frozen parts) gets the saved decoder
    monkeypatch.setattr(st, "load_base", lambda name: tiny_musicgen(seed=1))
    m2 = st.load_checkpoint("tiny", ckpt, TINY_TARGETS, 4, 8)
    assert not hasattr(m2, "peft_config")
    for k, a in m.decoder.state_dict().items():
        assert torch.equal(a, m2.decoder.state_dict()[k]), k
    assert all(p.requires_grad for p in m2.decoder.parameters()) and not any(p.requires_grad for p in m2.text_encoder.parameters())
    assert _loss(m2, batch) == pytest.approx(loss_saved, abs=1e-6)
    fresh = tiny_musicgen(seed=1).decoder.state_dict()  # the reload is provably from disk, not the seed-1 init
    assert any(not torch.equal(fresh[k], m2.decoder.state_dict()[k]) for k in fresh)

    # resume through build_model works the same way; a LoRA dir is refused in full mode and vice versa
    m3 = st.build_model("tiny", TINY_TARGETS, 4, 8, str(ckpt), full_decoder=True)
    assert _loss(m3, batch) == pytest.approx(loss_saved, abs=1e-6)
    lora = tmp_path / "ckpt_step_0004"
    lora.mkdir()
    (lora / st.ADAPTER_CONFIG).write_text("{}")
    with pytest.raises(SystemExit, match="a LoRA adapter dir"):
        st.build_model("tiny", TINY_TARGETS, 4, 8, str(lora), full_decoder=True)
    with pytest.raises(SystemExit, match="pass --full-decoder"):
        st.build_model("tiny", TINY_TARGETS, 4, 8, str(ckpt), full_decoder=False)
    with pytest.raises(FileNotFoundError, match="not a checkpoint"):
        st.load_checkpoint("tiny", tmp_path / "ckpt_step_0009")


def test_lora_checkpoint_path_unchanged_and_load_checkpoint_dispatches(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(st, "DEVICE", "cpu")
    monkeypatch.setattr(st, "load_base", lambda name: tiny_musicgen(seed=3))
    model = st.build_model("tiny", TINY_TARGETS, 2, 4, None)  # the default LoRA path
    assert hasattr(model, "peft_config")
    ckpt = st.save_checkpoint(model, tmp_path / "ckpt_step_0002", False, model_name="tiny", step=2, val_loss=0.5)
    assert st.ckpt_kind(ckpt) == "lora" and not (ckpt / st.CKPT_META).exists() and not (ckpt / st.DECODER_WEIGHTS).exists()
    reloaded = st.load_checkpoint("tiny", ckpt, TINY_TARGETS, 2, 4)
    assert hasattr(reloaded, "peft_config")
    batch = _batch()
    assert _loss(reloaded, batch) == pytest.approx(_loss(model, batch), abs=1e-6)

    calls: list[tuple] = []
    monkeypatch.setattr(st, "build_model", lambda *a, **k: calls.append((a, k)) or "model")
    assert st.load_checkpoint("m", ckpt) == "model"
    assert calls[-1] == (("m", st.DEFAULT_TARGETS, 32, 64, str(ckpt)), {"full_decoder": False})
    full = tmp_path / "ckpt_step_0003"
    full.mkdir()
    (full / st.DECODER_WEIGHTS).write_bytes(b"")
    st.load_checkpoint("m", str(full), ["q_proj"], 8, 16)
    assert calls[-1] == (("m", ["q_proj"], 8, 16, str(full)), {"full_decoder": True})


def test_save_checkpoint_lora_calls_save_pretrained_only(tmp_path: Path) -> None:
    class Fake:
        def __init__(self) -> None:
            self.saved: list[Path] = []

        def save_pretrained(self, path: Path) -> None:
            self.saved.append(Path(path))

    fake = Fake()
    out = st.save_checkpoint(fake, tmp_path / "ckpt_step_0250", False, model_name="x", step=250, val_loss=1.0)
    assert fake.saved == [tmp_path / "ckpt_step_0250"] and out == tmp_path / "ckpt_step_0250"
    assert not (tmp_path / "ckpt_step_0250").exists()  # nothing else was written


# --- the melody path: a (235, 12) float16 chroma row trains ------------------------------

def test_melody_row_with_235x12_float16_chroma_trains(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(st, "DEVICE", "cpu")
    tokens = tmp_path / "tokens"
    chroma = tmp_path / "chroma_midi"
    tokens.mkdir()
    chroma.mkdir()
    np.save(tokens / "clip_seg000.npy", np.random.default_rng(0).integers(0, 2048, (4, 20)).astype(np.int16))
    np.save(chroma / "clip_seg000.npy", np.random.default_rng(1).random((235, 12)).astype(np.float16))
    row = {"clip_path": "data/sets/x/clips/train/clip_seg000.wav", "caption": "qaraami oud", "seconds": 30.0,
           "tokens_dir": str(tokens), "chroma_dir": str(chroma)}
    m = tiny_melody()
    st.set_full_decoder_trainable(m)
    m.train()
    loss = st.micro_step(m, _fake_tok, row, None, True, None)
    assert torch.isfinite(loss)
    loss.backward()
    assert any(p.grad is not None and torch.isfinite(p.grad).all() for p in m.decoder.parameters())
    assert all(p.grad is None for p in m.text_encoder.parameters())
    assert st.check_chroma_frames(row, None) == 235


def test_expected_chroma_frames_and_check(tmp_path: Path) -> None:
    assert st.expected_chroma_frames(30.0) == 235 and st.expected_chroma_frames(10.0) == 79
    assert st.expected_chroma_frames(15.0) == 1 + (15 * 32000) // 4096
    np.save(tmp_path / "a_seg000.npy", np.zeros((235, 12), dtype=np.float16))
    np.save(tmp_path / "b_seg000.npy", np.zeros((1, 79, 12), dtype=np.float16))
    row_a = {"clip_path": "x/a_seg000.wav"}  # no "seconds": 30 s assumed
    row_b = {"clip_path": "x/b_seg000.wav", "seconds": 10.0}
    assert st.check_chroma_frames(row_a, tmp_path) == 235 and st.check_chroma_frames(row_b, tmp_path) == 79
    with pytest.raises(ValueError, match="has 235 frames, expected 79"):
        st.check_chroma_frames(dict(row_a, seconds=10.0), tmp_path)
    with pytest.raises(FileNotFoundError, match="no chroma"):
        st.check_chroma_frames({"clip_path": "x/c_seg000.wav"}, tmp_path)
    with pytest.raises(FileNotFoundError, match="no chroma"):
        st.check_chroma_frames(row_a, None)


# --- early stop (pure) ------------------------------------------------------------------

def test_early_stop_off_or_empty_never_stops() -> None:
    assert st.early_stop_decision([(0, 4.5), (250, 4.5), (5000, 4.5)], 0, 0.002) == (False, -1, float("inf"), 0)
    assert st.early_stop_decision([], 750, 0.002).stop is False


def test_early_stop_flat_for_patience_steps() -> None:
    hist = [(0, 4.5), (100, 4.2), (250, 4.1), (500, 4.099), (750, 4.0985), (1000, 4.0995)]
    d = st.early_stop_decision(hist, 750, 0.002)
    assert d == (True, 250, 4.1, 750)  # the < 0.002 wobbles after step 250 never count as improvements
    assert st.early_stop_decision(hist[:-1], 750, 0.002) == (False, 250, 4.1, 500)
    assert st.early_stop_decision(hist, 1000, 0.002).stop is False
    # with min_delta 0 every decrease counts: best moves to 750 and the run goes on
    d0 = st.early_stop_decision(hist, 750, 0.0)
    assert d0 == (False, 750, 4.0985, 250)


def test_early_stop_resets_on_real_improvement_and_ignores_order() -> None:
    hist = [(0, 4.5), (250, 4.0), (500, 3.9), (750, 3.8), (1000, 3.7), (1250, 3.7), (1500, 3.7)]
    assert st.early_stop_decision(hist, 750, 0.002) == (False, 1000, 3.7, 500)
    assert st.early_stop_decision([*hist, (1750, 3.71)], 750, 0.002) == (True, 1000, 3.7, 750)
    shuffled = [hist[3], hist[0], hist[5], hist[1], hist[6], hist[2], hist[4], (1750, 3.71)]
    assert st.early_stop_decision(shuffled, 750, 0.002) == (True, 1000, 3.7, 750)


# --- keep-last pruning (pure + on disk) ---------------------------------------------------

def test_prune_candidates_keeps_best_and_last_n() -> None:
    vals = {250: 4.4, 500: 4.1, 750: 4.2, 1000: 4.3}
    assert st.prune_candidates([250, 500, 750, 1000], vals, 0) == []
    assert st.prune_candidates([250, 500, 750, 1000], vals, -1) == []
    assert st.prune_candidates([250, 500, 750, 1000], vals, 2) == [250]  # 500 is best, 750/1000 are the last two
    assert st.prune_candidates([250, 500, 750, 1000], vals, 1) == [250, 750]
    assert st.prune_candidates([1000, 250, 750, 500], {1000: 3.0, **{k: v for k, v in vals.items() if k != 1000}}, 2) == [250, 500]
    assert st.prune_candidates([250, 500, 750], {}, 1) == [250, 500]  # no val known: only the last N survive
    # a tie -> the EARLIER step is the best, as scale_eval.find_best_ckpt (strict <) and early_stop_decision resolve it
    assert st.prune_candidates([250, 500, 1000], {250: 4.0, 500: 4.0}, 1) == [500]
    assert st.prune_candidates([250], {250: 4.0}, 1) == []
    assert st.prune_candidates([250, 500], {250: 4.0, 500: 4.5, 999: 0.0}, 5) == []  # keep_last larger than the set
    # protect: the early-stop best (within min_delta of the plain minimum) survives as well
    assert st.prune_candidates([250, 500, 750, 1000], {250: 4.1, 500: 4.099, 750: 4.2, 1000: 4.3}, 1) == [250, 750]
    assert st.prune_candidates([250, 500, 750, 1000], {250: 4.1, 500: 4.099, 750: 4.2, 1000: 4.3}, 1, protect=(250,)) == [750]
    assert st.prune_candidates([250, 500], {250: 4.1, 500: 4.0}, 1, protect=(999,)) == [250]  # an unknown protect step is ignored


def test_scheduled_history_keeps_only_saved_checkpoint_validations() -> None:
    hist = [(0, 4.30), (100, 4.45), (250, 4.40), (500, 4.35), (612, 4.34), (750, 4.31)]
    assert st.scheduled_history(hist, 250) == [(250, 4.40), (500, 4.35), (750, 4.31)]
    assert st.scheduled_history(reversed(hist), 250) == [(250, 4.40), (500, 4.35), (750, 4.31)]
    assert st.scheduled_history(hist, 0) == sorted(hist)  # no schedule: everything
    assert st.scheduled_history([], 250) == []
    # the brief's case: val improving but not yet below the base by > min_delta -> NOT flat, no stop
    assert st.early_stop_decision(hist, 750, 0.002).stop is True  # anchored on the base it would stop
    assert st.early_stop_decision(st.scheduled_history(hist, 250), 750, 0.002) == (False, 750, 4.31, 0)


def test_prune_checkpoints_removes_only_selected_ckpt_dirs(tmp_path: Path) -> None:
    for s in (250, 500, 750, 1000):
        d = tmp_path / f"ckpt_step_{s:04d}"
        d.mkdir()
        (d / st.DECODER_WEIGHTS).write_bytes(b"x")
    (tmp_path / "samples").mkdir()
    (tmp_path / "ckpt_step_bad").mkdir()
    assert st.prune_checkpoints(tmp_path, {250: 4.0}, 0) == []
    assert sorted(p.name for p in tmp_path.iterdir()) == ["ckpt_step_0250", "ckpt_step_0500", "ckpt_step_0750", "ckpt_step_1000", "ckpt_step_bad", "samples"]
    removed = st.prune_checkpoints(tmp_path, {250: 4.4, 500: 4.1, 750: 4.2, 1000: 4.3}, 1)
    assert [p.name for p in removed] == ["ckpt_step_0250", "ckpt_step_0750"]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["ckpt_step_0500", "ckpt_step_1000", "ckpt_step_bad", "samples"]


# --- max-hours, val history, markers, probe flags, runs dir --------------------------------

def test_max_hours_helpers() -> None:
    assert st.hours_elapsed(0.0, 7200.0) == 2.0
    assert st.max_hours_exceeded(0.0, 0.0, 1e9) is False  # off
    assert st.max_hours_exceeded(0.0, -1.0, 1e9) is False
    assert st.max_hours_exceeded(0.0, 1.0, 3599.0) is False
    assert st.max_hours_exceeded(0.0, 1.0, 3600.0) is True
    assert st.max_hours_exceeded(1000.0, 0.5, 1000.0 + 1800.0) is True
    assert st.max_hours_exceeded(time.time(), 1.0) is False  # now: a run that just started
    assert st.hours_elapsed(0.0) > 1.0  # now since 1970


def test_val_history_reads_loss_csv(tmp_path: Path) -> None:
    p = tmp_path / "loss.csv"
    assert st.val_history(p) == []
    with open(p, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["step", "train_loss", "val_loss", "lr", "sec_per_step", "mps_driver_gb"])
        w.writerow([0, "", 4.5, 0.0, "", 8.0])
        w.writerow([1, 4.4, "", "1e-5", 2.0, 8.0])
        w.writerow([100, "", 4.3, "1e-5", "", 8.0])
        w.writerow([250, "", 4.2, "1e-5", "", 8.0])
        w.writerow(["x", "", "nan?", "", "", ""])
        w.writerow([500, "", 4.25, "1e-5", "", 8.0])
    assert st.val_history(p) == [(0, 4.5), (100, 4.3), (250, 4.2), (500, 4.25)]
    assert st.val_history(p, upto_step=250) == [(0, 4.5), (100, 4.3), (250, 4.2)]
    assert st.early_stop_decision(st.val_history(p), 250, 0.002) == (True, 250, 4.2, 250)


def test_write_stop_marker(tmp_path: Path) -> None:
    p = st.write_stop_marker(tmp_path, st.EARLY_STOP_FILE, {"reason": "flat", "step": 1000, "best_step": 250})
    assert p == tmp_path / "EARLY_STOP"
    data = json.loads(p.read_text())
    assert data["reason"] == "flat" and data["step"] == 1000 and data["best_step"] == 250 and "time" in data
    assert st.write_stop_marker(tmp_path, st.MAX_HOURS_FILE, {"step": 3}).name == "MAX_HOURS"


def test_probe_flags() -> None:
    assert st.probe_flags(31.5) == {"under_60gb": True, "under_90gb": True, "fits_under_60gb": True}
    assert st.probe_flags(60.0) == {"under_60gb": False, "under_90gb": True, "fits_under_60gb": False}
    assert st.probe_flags(95.0) == {"under_60gb": False, "under_90gb": False, "fits_under_60gb": False}


def test_runs_dir_env_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SCALE_RUNS_DIR", raising=False)
    assert st.runs_dir() == st.REPO / "runs"
    monkeypatch.setenv("SCALE_RUNS_DIR", str(tmp_path / "scratch_runs"))
    assert st.runs_dir() == tmp_path / "scratch_runs"


def test_peak_tracker_folds_every_reading(monkeypatch: pytest.MonkeyPatch) -> None:
    readings = iter([(1.0, 8.0), (2.0, 31.0), (0.5, 12.0)])
    monkeypatch.setattr(st, "mps_mem_gb", lambda: next(readings))
    st.reset_peak()
    assert st.peak_driver_gb() == 0.0
    assert st.note_peak() == (1.0, 8.0) and st.peak_driver_gb() == 8.0
    assert st.note_peak() == (2.0, 31.0) and st.peak_driver_gb() == 31.0
    assert st.note_peak() == (0.5, 12.0) and st.peak_driver_gb() == 31.0  # a lower reading never lowers the peak
    st.reset_peak()
    assert st.peak_driver_gb() == 0.0


def test_resume_from_a_non_checkpoint_is_refused_before_the_base_loads(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def never(name: str):
        raise AssertionError("load_base must not run for a bad --resume-from")

    monkeypatch.setattr(st, "load_base", never)
    with pytest.raises(SystemExit, match="not a checkpoint"):  # LoRA mode, missing dir (was a raw PEFT/HF traceback)
        st.build_model("tiny", TINY_TARGETS, 4, 8, str(tmp_path / "nope" / "ckpt_step_0500"))
    truncated = tmp_path / "ckpt_step_0001"  # a kill mid-save leaves only the .tmp file
    truncated.mkdir()
    (truncated / (st.DECODER_WEIGHTS + ".tmp")).write_bytes(b"")
    with pytest.raises(SystemExit, match="not a checkpoint"):
        st.build_model("tiny", TINY_TARGETS, 4, 8, str(truncated), full_decoder=True)
    with pytest.raises(SystemExit, match="not a checkpoint"):
        st.build_model("tiny", TINY_TARGETS, 4, 8, str(truncated))
    lora = tmp_path / "ckpt_step_0002"
    lora.mkdir()
    (lora / st.ADAPTER_CONFIG).write_text("{}")
    with pytest.raises(SystemExit, match="a LoRA adapter dir"):  # the mode mismatch is caught before the base loads too
        st.build_model("tiny", TINY_TARGETS, 4, 8, str(lora), full_decoder=True)


# --- main() end to end on the tiny CPU model: the stop / pause / prune / config wiring --------

class _FakeAutoProcessor:
    """AutoProcessor stand-in: main() only needs .tokenizer (generate_sample is stubbed)."""
    tokenizer = staticmethod(_fake_tok)

    @staticmethod
    def from_pretrained(name: str) -> _FakeAutoProcessor:
        return _FakeAutoProcessor()


def _stub_generate(model, processor, caption, seconds, out_path: Path, melody) -> float:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(b"")
    return 0.0


def _write_captions(root: Path, n_train: int = 2, n_val: int = 2) -> Path:
    tokens = root / "tokens"
    tokens.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(0)
    rows = []
    for split, n in (("train", n_train), ("val", n_val)):
        for i in range(n):
            stem = f"{split}_seg{i:03d}"
            np.save(tokens / f"{stem}.npy", rng.integers(0, 2048, (4, 20)).astype(np.int16))
            rows.append({"clip_path": f"data/sets/fx/clips/{split}/{stem}.wav", "caption": "qaraami oud", "split": split,
                         "tokens_dir": str(tokens), "seconds": 30.0})
    cap = root / "captions.jsonl"
    cap.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return cap


@pytest.fixture
def harness(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    """(runs dir, captions path, run(*argv) -> (stdout, outcome)) with the tiny model in
    place of the HF base, a fake processor, stubbed sample generation and
    SCALE_RUNS_DIR under tmp_path. outcome is "ok" or the SystemExit."""
    monkeypatch.setattr(st, "DEVICE", "cpu")
    monkeypatch.setattr(st, "load_base", lambda name: tiny_musicgen(seed=1))
    monkeypatch.setattr(st, "AutoProcessor", _FakeAutoProcessor)
    monkeypatch.setattr(st, "generate_sample", _stub_generate)
    runs = tmp_path / "runs"
    monkeypatch.setenv("SCALE_RUNS_DIR", str(runs))
    captions = _write_captions(tmp_path / "data")

    def run(*argv: str) -> tuple[str, object]:
        monkeypatch.setattr(sys, "argv", ["scale_train", "--model", "tiny/musicgen", "--captions", str(captions),
                                          "--val-clips", "2", "--sample-seconds", "1", "--warmup", "0", *argv])
        outcome: object = "ok"
        try:
            st.main()
        except SystemExit as exc:
            outcome = exc
        return capsys.readouterr().out, outcome

    return runs, captions, run


def _strict_json(path: Path) -> dict:
    """json.loads that refuses NaN / Infinity (what jq and JSON.parse do)."""
    return json.loads(path.read_text(), parse_constant=lambda c: pytest.fail(f"{path.name} holds non-strict JSON constant {c}"))


def test_main_early_stop_counts_patience_from_the_first_saved_checkpoint(harness) -> None:
    runs, _, run = harness
    # lr 0: every validation is identical, so the run is "flat" from its first checkpoint on
    out, outcome = run("--full-decoder", "--run-id", "es", "--lr", "0", "--total-steps", "5", "--ckpt-every", "1",
                       "--early-stop-patience", "1", "--keep-last", "1")
    assert outcome == "ok" and out.rstrip().endswith("SCALE_TRAIN_DONE")
    run_dir = runs / "es"
    # the step-0 base val is in loss.csv (CE tables) but did NOT anchor the stop: stop at step 2, best = step 1
    assert "EARLY_STOP step=2 best_step=1" in out and "step 0 (base) val_loss=" in out
    marker = _strict_json(run_dir / st.EARLY_STOP_FILE)
    assert marker["step"] == 2 and marker["best_step"] == 1 and marker["patience"] == 1
    assert marker["best_val"] == marker["val_at_stop"]
    assert not (run_dir / st.MAX_HOURS_FILE).exists()
    vals = st.val_history(run_dir / "loss.csv")
    assert [s for s, _ in vals] == [0, 1, 2] and marker["best_val"] == vals[1][1]  # same 4-dp precision throughout
    # --keep-last 1 kept the best (step 1, protected: on a tie the earlier step is best) and the last (step 2)
    assert sorted(st.ckpt_steps(run_dir)) == [1, 2]
    assert st.ckpt_kind(run_dir / "ckpt_step_0001") == "full_decoder"
    assert _strict_json(run_dir / "ckpt_step_0002" / st.CKPT_META)["val_loss"] == marker["val_at_stop"]
    cfg = _strict_json(run_dir / "config.json")
    assert cfg["full_decoder"] is True and cfg["rank"] is None and cfg["alpha"] is None and cfg["targets"] is None
    assert cfg["keep_last"] == 1 and cfg["early_stop_patience"] == 1 and "resume_history" not in cfg


def test_main_does_not_stop_a_run_that_improves_without_beating_the_base(harness, monkeypatch: pytest.MonkeyPatch) -> None:
    runs, _, run = harness
    # base 4.30, then every checkpoint is WORSE than the base but still improving: not flat -> no stop at
    # patience; then two flat checkpoints (4.31, 4.3095: within min_delta) -> stop with best_step 3
    seq = iter([4.30, 4.40, 4.35, 4.31, 4.31, 4.3095, 4.31, 4.31])
    monkeypatch.setattr(st, "val_loss", lambda *a, **k: next(seq))
    out, outcome = run("--full-decoder", "--run-id", "improving", "--total-steps", "8", "--ckpt-every", "1",
                       "--early-stop-patience", "2")
    assert outcome == "ok" and "SCALE_TRAIN_DONE" in out
    assert "EARLY_STOP step=5 best_step=3 best_val=4.3100 val=4.3095" in out
    marker = _strict_json(runs / "improving" / st.EARLY_STOP_FILE)
    assert marker == {**marker, "step": 5, "best_step": 3, "best_val": 4.31, "val_at_stop": 4.3095}
    assert (runs / "improving" / f"ckpt_step_{marker['best_step']:04d}" / st.DECODER_WEIGHTS).is_file()
    assert sorted(st.ckpt_steps(runs / "improving")) == [1, 2, 3, 4, 5]  # no --keep-last: nothing deleted


def test_main_max_hours_pauses_then_the_resume_finishes_and_clears_the_marker(harness) -> None:
    runs, _, run = harness
    out, outcome = run("--full-decoder", "--run-id", "mh", "--total-steps", "3", "--ckpt-every", "250", "--max-hours", "1e-9")
    assert outcome == "ok"
    assert "MAX_HOURS_STOP step=1" in out and out.rstrip().endswith("SCALE_TRAIN_PAUSED") and "SCALE_TRAIN_DONE" not in out
    run_dir = runs / "mh"
    pause = _strict_json(run_dir / st.MAX_HOURS_FILE)
    assert pause["step"] == 1 and pause["max_hours"] == 1e-9 and "ckpt_step_0001" in pause["reason"]
    assert st.ckpt_kind(run_dir / "ckpt_step_0001") == "full_decoder"
    assert st.val_history(run_dir / "loss.csv") == [(0, pytest.approx(pause["val_loss"], abs=1e-3)), (1, pause["val_loss"])]
    original = _strict_json(run_dir / "config.json")
    assert original["max_hours"] == 1e-9 and original["keep_last"] == 0 and original["total_steps"] == 3

    out, outcome = run("--full-decoder", "--run-id", "mh", "--resume-from", str(run_dir / "ckpt_step_0001"),
                       "--total-steps", "3", "--ckpt-every", "1", "--keep-last", "2", "--early-stop-patience", "9", "--lr", "1e-5")
    assert outcome == "ok" and out.rstrip().endswith("SCALE_TRAIN_DONE")
    assert "removed the stale MAX_HOURS marker (resuming)" in out and "2 earlier validations read back" in out
    assert not (run_dir / st.MAX_HOURS_FILE).exists() and not (run_dir / st.EARLY_STOP_FILE).exists()
    assert sorted(st.ckpt_steps(run_dir)) == [1, 2, 3]  # keep-last 2 + best: nothing to prune yet
    cfg = _strict_json(run_dir / "config.json")
    assert cfg["lr"] == original["lr"] and cfg["total_steps"] == 3 and cfg["full_decoder"] is True  # the launch record
    assert cfg["keep_last"] == 2 and cfg["early_stop_patience"] == 9 and cfg["max_hours"] == 0.0  # the latest policy
    (entry,) = cfg["resume_history"]
    assert entry["start_step"] == 1 and entry["resumed_from"] == str(run_dir / "ckpt_step_0001")
    assert entry["keep_last"] == 2 and entry["early_stop_patience"] == 9 and entry["max_hours"] == 0.0
    assert entry["lr"] == 1e-5 and entry["total_steps"] == 3 and entry["ckpt_every"] == 1 and entry["full_decoder"] is True
    assert [s for s, _ in st.val_history(run_dir / "loss.csv")] == [0, 1, 2, 3]


def test_main_refuses_an_empty_val_split_and_a_nan_validation(harness, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    runs, captions, run = harness
    rows = [json.loads(l) for l in captions.read_text().splitlines()]
    no_val = tmp_path / "no_val.jsonl"
    no_val.write_text("".join(json.dumps(r) + "\n" for r in rows if r["split"] == "train"))
    monkeypatch.setattr(st, "load_base", lambda name: pytest.fail("the base must not load for a captions file without val rows"))
    _, outcome = run("--captions", str(no_val), "--run-id", "novalrows", "--total-steps", "1")
    assert isinstance(outcome, SystemExit) and "no 'val' rows" in str(outcome.code)
    assert not (runs / "novalrows").exists()

    monkeypatch.setattr(st, "load_base", lambda name: tiny_musicgen(seed=1))
    monkeypatch.setattr(st, "val_loss", lambda *a, **k: float("nan"))
    out, outcome = run("--full-decoder", "--run-id", "nanval", "--total-steps", "2", "--ckpt-every", "1", "--early-stop-patience", "1")
    assert isinstance(outcome, SystemExit) and "validation loss is nan" in str(outcome.code)
    assert "SCALE_TRAIN_DONE" not in out and "EARLY_STOP" not in out
    assert not (runs / "nanval" / st.EARLY_STOP_FILE).exists() and st.ckpt_steps(runs / "nanval") == {}


def test_main_smoke_json_covers_validation_and_records_the_mode(harness) -> None:
    runs, _, run = harness
    out, outcome = run("--full-decoder", "--run-id", "smk_full", "--smoke", "2", "--smoke-ckpt", "--grad-accum", "1", "--total-steps", "6000")
    assert outcome == "ok" and out.rstrip().endswith("SCALE_TRAIN_DONE")
    report = json.loads(out[out.index("{"): out.rindex("}") + 1])
    assert report["mode"] == "full_decoder" and report["smoke_steps"] == 2
    assert {"peak_driver_gb", "est_full_run_hours", "under_60gb", "under_90gb", "fits_under_60gb"} <= set(report)
    assert isinstance(report["smoke_val_loss"], float) and np.isfinite(report["smoke_val_loss"])  # every smoke validates
    ckpt = Path(report["smoke_ckpt"])
    assert st.ckpt_kind(ckpt) == "full_decoder" and _strict_json(ckpt / st.CKPT_META)["val_loss"] == report["smoke_val_loss"]
    assert st.val_history(runs / "smk_full" / "loss.csv") == [(2, report["smoke_val_loss"])]
    assert (runs / "smk_full" / "smoke_sample.wav").exists()

    out, outcome = run("--run-id", "smk_lora", "--smoke", "2", "--rank", "2", "--alpha", "4", "--grad-accum", "1")
    assert outcome == "ok"
    report = json.loads(out[out.index("{"): out.rindex("}") + 1])
    assert report["mode"] == "lora" and report["smoke_ckpt"] is None and isinstance(report["smoke_val_loss"], float)
    cfg = _strict_json(runs / "smk_lora" / "config.json")
    assert cfg["rank"] == 2 and cfg["alpha"] == 4 and cfg["targets"] == TINY_TARGETS and cfg["full_decoder"] is False
    assert st.ckpt_steps(runs / "smk_lora") == {}
