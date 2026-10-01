"""Scaled fine-tune of MusicGen (medium / large / melody) on the Somali
30-second scale dataset, under the FIXED harness (functional dropout zeroed).

Generalises phase2_train.py:
  * --model facebook/musicgen-{medium,large,melody}
  * LoRA rank 32 on ALL attention AND FFN projections
    (q/k/v/out + fc1/fc2), default targets below
  * frames inferred from the token .npy shape (30 s → 1500), not hardcoded
  * --batch-size (grad-accum keeps the effective batch), lr, total-steps,
    ckpt-every, val-clips, sample-seconds all configurable
  * peak MPS memory printed every log line; a --mem-cap-gb guard aborts the
    run cleanly if the driver allocation crosses the cap (before macOS kills it)

Stage 3-4 extensions (the Ahmed Ilkacase corpus). Captions files of the old runs
carry none of the new keys and train exactly as before:
  * a captions row may name its own "tokens_dir" / "chroma_dir" (repo-relative,
    resolved against the repo root); they win over the CLI --tokens-dir /
    --chroma-dir, so one run's captions file can be the concatenation of several
    sets' captions (data/sets/<set>/captions.jsonl)
  * musicgen-melody trains melody-conditioned: every micro step passes the
    clip's chroma (data/sets/<set>/chroma/<clip stem>.npy, float16 (T, 12)) as
    input_features next to input_ids / attention_mask / labels. A row without
    chroma is an error, never a silent text-only step.
  * --resume-from <ckpt dir> [--start-step N] continues a killed run from a
    saved checkpoint. Only the weights come back: the AdamW moments restart
    from zero and the cosine schedule is fast-forwarded to N (inferred from the
    checkpoint name when --start-step is 0). loss.csv is appended.
  * config.json records the library versions (torch, transformers, peft,
    torchcrepe) and the git commit under "versions"

Phase 2 extensions (QaraamiGen recipes A-D). Every default keeps a LoRA run
byte-for-byte on the Stage 3-4 behaviour:
  * --full-decoder: no LoRA. Every parameter of model.decoder (the MusicGen LM:
    codebook embeddings, all transformer layers, the lm heads) trains; the T5
    text encoder, enc_to_dec_proj (and audio_enc_to_dec_proj on melody) and the
    EnCodec audio encoder stay frozen. Same AdamW (weight_decay 0.0), same
    gradient checkpointing, same functional-dropout fix, same --grad-accum.
    Checkpoints are runs/<run>/ckpt_step_NNNN/decoder.safetensors (the decoder
    state_dict, fp32) + ckpt_meta.json {kind, model, step, val_loss}; LoRA
    checkpoints stay PEFT adapter dirs. load_checkpoint() returns a ready model
    for either kind (scale_eval / dpo_train / the service call it).
  * --keep-last N (default 0 = keep everything): a full-decoder checkpoint is the
    fp32 decoder state_dict, 4 bytes x decoder params: 7.35 GB on musicgen-medium
    (1.84 B decoder params), 1.68 GB on small; with N > 0 only the best-val
    checkpoint and the last N survive each save. Nothing is ever deleted by
    default, and never for LoRA. config.json records rank/alpha/targets as null
    in this mode (no LoRA was used).
  * --early-stop-patience STEPS (default 0 = off): "stop when validation is flat
    for STEPS steps". Only the validations of SCHEDULED checkpoints count (step
    > 0 and a multiple of --ckpt-every): the step-0 base validation and the
    always-run step-100 validation stay in loss.csv for the CE tables but never
    anchor the decision, so a run whose val is still improving (even one that
    has not yet beaten the base) is never stopped, and best_step always names a
    saved checkpoint. The best val is updated only by an improvement of more
    than --early-stop-min-delta (default 0.002); when the latest checkpoint is
    STEPS past the best one, a final checkpoint is saved (if the step is not one
    already), runs/<run>/EARLY_STOP records the reason, the log shows
    "EARLY_STOP step=N best_step=M" and the run ends with SCALE_TRAIN_DONE,
    exit 0. The val history of a resumed run is read back from loss.csv (4 dp,
    the same precision the live validations are kept at).
  * --max-hours H (default 0 = off): a battery / sleep safety. When the wall
    clock passes H the run validates, saves a checkpoint at the current step,
    writes runs/<run>/MAX_HOURS, prints "MAX_HOURS_STOP step=N elapsed_hours=X"
    and exits 0 with SCALE_TRAIN_PAUSED (NOT SCALE_TRAIN_DONE: the run is meant
    to be resumed with --resume-from that checkpoint). A resumed run removes the
    stale MAX_HOURS / EARLY_STOP markers, records the flags it actually ran with
    (lr, total_steps, keep_last, early_stop_*, max_hours, ...) in config.json's
    resume_history and overwrites the top-level stop / retention keys with them.
  * A captions file with no "val" rows is refused (validation, early stop and
    --keep-last need them), and a non-finite validation loss ends the run with
    exit 1 instead of steering early stop / pruning / the stop markers with NaN.
  * --chroma-frames-check (melody): asserts the first train row's chroma frame
    count equals round(seconds * 235 / 30) before any model loads.
  * --smoke also reports "mode", "fits_under_60gb" and "peak_driver_gb": the
    running peak of the MPS driver allocation over the smoke steps AND the
    validation pass AND the sample generation (every smoke validates once, so
    the memory verdict covers what a real run does every --ckpt-every steps);
    --smoke-ckpt also saves one checkpoint at the last smoke step for a
    save/load round-trip check.
  * SCALE_RUNS_DIR in the environment relocates runs/ (fixtures, scratch probes).

The dropout fix (37 functional attributes zeroed) is the whole reason the
earlier runs turned positive; it is applied identically here.

Usage (from apps/ai-service):
  python -m scripts.scale_train --model facebook/musicgen-medium \
     --run-id qaraami_medium_r32 --lr 5e-5 --total-steps 3000 --ckpt-every 250 \
     --batch-size 1 --grad-accum 8 --captions ../../data/scale_captions.jsonl \
     --tokens-dir ../../data/scale_tokens --mem-cap-gb 60
  python -m scripts.scale_train --smoke ...   # 30 steps + timing + memory
  python -m scripts.scale_train --model facebook/musicgen-melody --run-id ahmed_melody \
     --captions ../../data/sets/ahmed_oud/captions.jsonl \
     --chroma-dir ../../data/sets/ahmed_oud/chroma --lr 5e-5 --total-steps 3000
  python -m scripts.scale_train ... --run-id ahmed_only \
     --resume-from ../../runs/ahmed_only/ckpt_step_1250 --start-step 1250
  python -m scripts.scale_train --model facebook/musicgen-medium --full-decoder \
     --run-id qaraami_medium_full --lr 2e-5 --total-steps 6000 --ckpt-every 250 \
     --early-stop-patience 750 --keep-last 3 --max-hours 20 --captions ...
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import time
from collections.abc import Iterable, Mapping, Sequence
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import NamedTuple

import numpy as np
import soundfile as sf
import torch
from peft import LoraConfig, get_peft_model
from safetensors.torch import load_file, save_file
from transformers import (
    AutoProcessor,
    MusicgenForConditionalGeneration,
    MusicgenMelodyForConditionalGeneration,
    get_cosine_schedule_with_warmup,
)

REPO = Path(__file__).resolve().parents[3]


def runs_dir() -> Path:
    """runs/ under the repo, or $SCALE_RUNS_DIR (fixtures and scratch probes)."""
    env = os.environ.get("SCALE_RUNS_DIR")
    return Path(env).expanduser() if env else REPO / "runs"


RUNS_DIR = runs_dir()
BOS = 2048
NUM_CHROMA = 12  # musicgen-melody conditions on a 12-bin chroma per frame
CHROMA_FRAMES_30S = 235  # musicgen-melody's chroma_length: frames per 30 s clip
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

DEFAULT_TARGETS = ["q_proj", "k_proj", "v_proj", "out_proj", "fc1", "fc2"]

DECODER_WEIGHTS = "decoder.safetensors"  # full-decoder checkpoint: the decoder state_dict, fp32
CKPT_META = "ckpt_meta.json"
ADAPTER_CONFIG = "adapter_config.json"  # what makes a directory a PEFT (LoRA) checkpoint
EARLY_STOP_FILE = "EARLY_STOP"
MAX_HOURS_FILE = "MAX_HOURS"
CKPT_RE = re.compile(r"^ckpt_step_(\d+)$")


def zero_functional_dropout(model) -> int:
    zeroed = 0
    for module in model.modules():
        for attr in ("dropout", "activation_dropout", "attention_dropout"):
            value = getattr(module, attr, None)
            if isinstance(value, float) and value > 0:
                setattr(module, attr, 0.0)
                zeroed += 1
    return zeroed


def load_split(captions: Path, split: str) -> list[dict]:
    return [json.loads(l) for l in open(captions) if json.loads(l)["split"] == split]


def resolve_repo_path(path: str | Path) -> Path:
    """A captions-row path is repo-relative unless absolute."""
    p = Path(path)
    return p if p.is_absolute() else REPO / p


def token_path(tokens_dir: Path | str | None, row: dict) -> Path:
    """<tokens dir>/<clip stem>.npy. The row's own "tokens_dir" (repo-relative)
    wins over the CLI dir; with neither, the row cannot be trained on."""
    stem = Path(row["clip_path"]).stem + ".npy"
    if row.get("tokens_dir"):
        return resolve_repo_path(row["tokens_dir"]) / stem
    if tokens_dir is None:
        raise ValueError(f"no tokens dir for {row['clip_path']}: the row has no tokens_dir and --tokens-dir was not given")
    return Path(tokens_dir) / stem


def chroma_path(chroma_dir: Path | str | None, row: dict) -> Path | None:
    """<chroma dir>/<clip stem>.npy, the row's own "chroma_dir" first; None when
    neither the row nor the CLI names a chroma dir."""
    stem = Path(row["clip_path"]).stem + ".npy"
    if row.get("chroma_dir"):
        return resolve_repo_path(row["chroma_dir"]) / stem
    if chroma_dir is None:
        return None
    return Path(chroma_dir) / stem


def load_chroma(path: Path) -> torch.Tensor:
    """Chroma saved as float16 (T, 12) or (1, T, 12) -> float32 (1, T, 12) CPU tensor,
    the shape musicgen-melody takes as input_features."""
    arr = np.load(path).astype(np.float32)
    if arr.ndim == 2:
        arr = arr[None]
    if arr.ndim != 3 or arr.shape[-1] != NUM_CHROMA:
        raise ValueError(f"{path}: expected chroma shape (T, {NUM_CHROMA}) or (1, T, {NUM_CHROMA}), got {arr.shape}")
    return torch.from_numpy(np.ascontiguousarray(arr))


def melody_features(chroma_dir: Path | str | None, row: dict) -> torch.Tensor:
    """The clip's chroma on DEVICE. Refuses to train text-only: a melody step
    without chroma is an error, not a fallback."""
    p = chroma_path(chroma_dir, row)
    if p is None:
        raise RuntimeError(f"melody model needs chroma for {row['clip_path']}: the row has no chroma_dir and "
                           "--chroma-dir was not given (refusing a text-only step)")
    if not p.exists():
        raise FileNotFoundError(f"melody model needs chroma for {row['clip_path']}: {p} does not exist "
                                "(refusing a text-only step)")
    return load_chroma(p).to(DEVICE)


CHROMA_SR = 32000
CHROMA_HOP = 4096


def expected_chroma_frames(seconds: float) -> int:
    """Chroma frames musicgen-melody's processor returns for `seconds` of 32 kHz
    audio: a centred STFT with hop 4096 gives 1 + n_samples // 4096 (235 at 30 s,
    79 at 10 s; the linear rule round(seconds * 235 / 30) is off by one away from
    30 s). Same rule as scripts.melody_midi.chroma_frames."""
    return 1 + int(round(seconds * CHROMA_SR)) // CHROMA_HOP


def check_chroma_frames(row: dict, chroma_dir: Path | str | None) -> int:
    """--chroma-frames-check: the row's chroma frame count must equal
    round(seconds * 235 / 30) (seconds from the row, 30 when absent). Returns the
    frame count; raises FileNotFoundError / ValueError otherwise."""
    p = chroma_path(chroma_dir, row)
    if p is None or not p.exists():
        raise FileNotFoundError(f"chroma frames check: no chroma for {row['clip_path']} ({p})")
    frames = int(load_chroma(p).shape[1])
    want = expected_chroma_frames(float(row.get("seconds", 30.0)))
    if frames != want:
        raise ValueError(f"chroma frames check: {p} has {frames} frames, expected {want} for {row.get('seconds', 30.0)} s")
    return frames


def delayed_labels(npy_path: Path) -> torch.Tensor:
    codes = np.load(npy_path)
    k, t = codes.shape
    lab = np.full((t + k - 1, k), -100, dtype=np.int64)
    for cb in range(k):
        lab[cb:cb + t, cb] = codes[cb]
    return torch.from_numpy(lab)


def git_commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True).stdout.strip()
    except OSError:
        return "unknown"


def library_versions() -> dict[str, str]:
    """Harness / scorer provenance for config.json: interpreter, torch, transformers,
    peft, torchcrepe (the PCS scorer's pitch tracker) and the git commit."""
    out = {"python": sys.version.split()[0], "torch": str(torch.__version__)}
    for pkg in ("transformers", "peft", "torchcrepe"):
        try:
            out[pkg] = version(pkg)
        except PackageNotFoundError:
            out[pkg] = "not installed"
    out["git_commit"] = git_commit()
    return out


def is_melody(model_name: str) -> bool:
    return "melody" in model_name


def infer_start_step(resume_from: str | None, start_step: int) -> int:
    """--start-step wins; otherwise the step in a ckpt_step_NNNN directory name; else 0."""
    if start_step:
        return start_step
    if resume_from:
        m = re.search(r"ckpt_step_(\d+)", Path(resume_from).name)
        if m:
            return int(m.group(1))
    return 0


# --- checkpoint kinds ---------------------------------------------------------------

def is_full_decoder_ckpt(path: Path | str) -> bool:
    """A full-decoder checkpoint directory: it holds decoder.safetensors."""
    return (Path(path) / DECODER_WEIGHTS).is_file()


def is_lora_ckpt(path: Path | str) -> bool:
    """A PEFT adapter directory (adapter_config.json present)."""
    return (Path(path) / ADAPTER_CONFIG).is_file()


def ckpt_kind(path: Path | str) -> str | None:
    """"full_decoder", "lora" or None (not a checkpoint). decoder.safetensors wins."""
    if is_full_decoder_ckpt(path):
        return "full_decoder"
    if is_lora_ckpt(path):
        return "lora"
    return None


def ckpt_steps(run_dir: Path) -> dict[int, Path]:
    """{step: ckpt dir} for every runs/<run>/ckpt_step_NNNN directory."""
    out: dict[int, Path] = {}
    for p in Path(run_dir).glob("ckpt_step_*"):
        m = CKPT_RE.match(p.name)
        if m and p.is_dir():
            out[int(m.group(1))] = p
    return out


def frozen_parts(model) -> list[str]:
    """Top-level sub-models that stay frozen in full-decoder mode: everything but
    the decoder (text_encoder, audio_encoder, enc_to_dec_proj, and
    audio_enc_to_dec_proj on melody)."""
    return [n for n, _ in model.named_children() if n != "decoder"]


def set_full_decoder_trainable(model) -> tuple[int, int]:
    """Freeze every parameter, then unfreeze model.decoder. Returns
    (trainable, total) parameter counts."""
    for p in model.parameters():
        p.requires_grad_(False)
    for p in model.decoder.parameters():
        p.requires_grad_(True)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    return trainable, total


def decoder_state_fp32(model) -> dict[str, torch.Tensor]:
    """The decoder state_dict as contiguous fp32 CPU tensors (what safetensors
    stores). Moving off MPS also un-shares any aliased storage."""
    return {k: v.detach().to("cpu", dtype=torch.float32).contiguous() for k, v in model.decoder.state_dict().items()}


def save_checkpoint(model, ckpt_dir: Path, full_decoder: bool, *, model_name: str = "", step: int = 0,
                    val_loss: float | None = None) -> Path:
    """LoRA: the PEFT adapter dir (model.save_pretrained), exactly as before.
    Full decoder: <ckpt_dir>/decoder.safetensors (fp32 decoder state_dict, written
    to a .tmp name first so a kill never leaves a truncated file under the real
    name) + ckpt_meta.json {kind, model, step, val_loss, ...}."""
    ckpt_dir = Path(ckpt_dir)
    if not full_decoder:
        model.save_pretrained(ckpt_dir)
        return ckpt_dir
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    state = decoder_state_fp32(model)
    tmp = ckpt_dir / (DECODER_WEIGHTS + ".tmp")
    save_file(state, str(tmp), metadata={"format": "pt", "kind": "full_decoder", "model": model_name, "step": str(step)})
    tmp.replace(ckpt_dir / DECODER_WEIGHTS)
    meta = {
        "kind": "full_decoder", "model": model_name, "step": step, "val_loss": val_loss,
        "dtype": "float32", "trainable": "decoder", "frozen": frozen_parts(model),
        "n_tensors": len(state), "n_params": int(sum(v.numel() for v in state.values())),
        "time": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    (ckpt_dir / CKPT_META).write_text(json.dumps(meta, indent=2))
    return ckpt_dir


def load_decoder_weights(model, ckpt_dir: Path | str) -> None:
    """Load a full-decoder checkpoint's decoder.safetensors into model.decoder
    (strict: every tensor must match the base architecture)."""
    state = load_file(str(Path(ckpt_dir) / DECODER_WEIGHTS))
    model.decoder.load_state_dict(state, strict=True)


def load_base(model_name: str):
    """The base model every mode starts from: fp32, BOS as the decoder start
    token, gradient checkpointing on the decoder, still on CPU."""
    cls = MusicgenMelodyForConditionalGeneration if is_melody(model_name) else MusicgenForConditionalGeneration
    model = cls.from_pretrained(model_name, dtype=torch.float32)
    model.config.decoder.decoder_start_token_id = BOS
    model.decoder.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    return model


def build_model(model_name: str, targets: list[str], rank: int, alpha: int, resume_from: str | None,
                full_decoder: bool = False):
    """LoRA (default, unchanged): PEFT wrapping, or PeftModel.from_pretrained(resume_from).
    full_decoder=True: no PEFT; the decoder trains, the rest is frozen; resume_from
    must then be a full-decoder checkpoint (and a LoRA run must not be given one).
    A resume_from that is not a checkpoint of the right kind is a SystemExit
    before the (multi-GB) base loads, in both modes."""
    if resume_from:
        kind = ckpt_kind(resume_from)
        if kind is None:
            raise SystemExit(f"{'--full-decoder ' if full_decoder else ''}--resume-from {resume_from}: neither "
                             f"{DECODER_WEIGHTS} nor {ADAPTER_CONFIG} there (not a checkpoint)")
        if full_decoder and kind != "full_decoder":
            raise SystemExit(f"--full-decoder --resume-from {resume_from}: no {DECODER_WEIGHTS} there (a LoRA adapter dir)")
        if not full_decoder and kind == "full_decoder":
            raise SystemExit(f"--resume-from {resume_from} holds a full-decoder checkpoint; pass --full-decoder")
    model = load_base(model_name)
    if full_decoder:
        if resume_from:
            load_decoder_weights(model, resume_from)
        trainable, total = set_full_decoder_trainable(model)
        n_zeroed = zero_functional_dropout(model)
        model.to(DEVICE)
        print(f"model={model_name} device={DEVICE} mode=full_decoder functional_dropout_zeroed={n_zeroed} "
              f"trainable=decoder {trainable/1e6:.1f}M / {total/1e6:.1f}M frozen={frozen_parts(model)}", flush=True)
        return model
    if resume_from:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, resume_from, is_trainable=True)
    else:
        lcfg = LoraConfig(r=rank, lora_alpha=alpha, lora_dropout=0.05, target_modules=targets, bias="none")
        model = get_peft_model(model, lcfg)
    n_zeroed = zero_functional_dropout(model)
    model.to(DEVICE)
    lora_a = sum(1 for n, _ in model.named_modules() if n.endswith("lora_A"))
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"model={model_name} device={DEVICE} functional_dropout_zeroed={n_zeroed} "
          f"lora_sites={lora_a} trainable={trainable/1e6:.2f}M / {total/1e6:.1f}M targets={targets}", flush=True)
    return model


def load_checkpoint(model_name: str, ckpt_dir: Path | str, targets: Sequence[str] = DEFAULT_TARGETS,
                    rank: int = 32, alpha: int = 64):
    """A ready model (on DEVICE, dropout fix applied) from EITHER checkpoint kind:
    a PEFT adapter dir (adapter_config.json) or a full-decoder dir
    (decoder.safetensors). For scale_eval, dpo_train and the service."""
    kind = ckpt_kind(ckpt_dir)
    if kind is None:
        raise FileNotFoundError(f"{ckpt_dir}: neither {ADAPTER_CONFIG} nor {DECODER_WEIGHTS} found (not a checkpoint)")
    return build_model(model_name, list(targets), rank, alpha, str(ckpt_dir), full_decoder=(kind == "full_decoder"))


# --- stopping rules and checkpoint retention (pure) -----------------------------------

class StopDecision(NamedTuple):
    stop: bool
    best_step: int
    best_val: float
    steps_since_best: int


def early_stop_decision(history: Iterable[tuple[int, float]], patience: int, min_delta: float) -> StopDecision:
    """Over (step, val_loss) pairs (any order): the best val is updated only by an
    improvement of MORE than min_delta; stop when the latest validated step is
    at least `patience` steps past the best one. patience <= 0 never stops."""
    hist = sorted(history)
    if patience <= 0 or not hist:
        return StopDecision(False, -1, float("inf"), 0)
    best_step, best_val = hist[0]
    for step, v in hist[1:]:
        if v < best_val - min_delta:
            best_step, best_val = step, v
    since = hist[-1][0] - best_step
    return StopDecision(since >= patience, best_step, best_val, since)


def scheduled_history(history: Iterable[tuple[int, float]], ckpt_every: int) -> list[tuple[int, float]]:
    """The (step, val) pairs early stop may look at: validations of SCHEDULED
    checkpoints only (step > 0 and a multiple of ckpt_every). The step-0 base
    validation, the always-run step-100 validation and a --max-hours pause
    validation at an odd step are excluded, so patience is counted from the first
    saved checkpoint and best_step names a checkpoint that was saved."""
    if ckpt_every <= 0:
        return sorted(history)
    return sorted((s, v) for s, v in history if s > 0 and s % ckpt_every == 0)


def prune_candidates(steps: Iterable[int], val_by_step: Mapping[int, float], keep_last: int,
                     protect: Iterable[int] = ()) -> list[int]:
    """Checkpoint steps to delete under --keep-last N: everything except the last N,
    the best-val step (lowest val among steps that have one; ties -> the EARLIER
    step, as scale_eval.find_best_ckpt and early_stop_decision resolve them) and
    any `protect` steps (the early-stop best, so EARLY_STOP's best_step always
    names a checkpoint that still exists). keep_last <= 0 -> nothing, ever."""
    if keep_last <= 0:
        return []
    ordered = sorted(set(steps))
    keep = set(ordered[-keep_last:]) | set(protect)
    with_val = [s for s in ordered if s in val_by_step]
    if with_val:
        keep.add(min(with_val, key=lambda s: (val_by_step[s], s)))
    return [s for s in ordered if s not in keep]


def prune_checkpoints(run_dir: Path, val_by_step: Mapping[int, float], keep_last: int,
                      protect: Iterable[int] = ()) -> list[Path]:
    """Apply prune_candidates to runs/<run>/ckpt_step_NNNN dirs; returns what was removed."""
    existing = ckpt_steps(run_dir)
    removed: list[Path] = []
    for step in prune_candidates(existing, val_by_step, keep_last, protect):
        p = existing[step]
        if CKPT_RE.match(p.name) and p.is_dir():  # only ever a checkpoint directory of this run
            shutil.rmtree(p)
            removed.append(p)
    return removed


def hours_elapsed(start: float, now: float | None = None) -> float:
    return ((time.time() if now is None else now) - start) / 3600.0


def max_hours_exceeded(start: float, max_hours: float, now: float | None = None) -> bool:
    """--max-hours: True once the wall clock since `start` reaches max_hours (> 0)."""
    return max_hours > 0 and hours_elapsed(start, now) >= max_hours


def val_history(csv_path: Path, upto_step: int | None = None) -> list[tuple[int, float]]:
    """(step, val_loss) rows of a loss.csv, optionally only up to a step (a resumed
    run seeds its early-stop history from the killed run's validations)."""
    out: list[tuple[int, float]] = []
    if not Path(csv_path).exists():
        return out
    with open(csv_path, newline="") as fh:
        for row in csv.DictReader(fh):
            if not row.get("val_loss"):
                continue
            try:
                step, v = int(row["step"]), float(row["val_loss"])
            except (KeyError, ValueError):
                continue
            if upto_step is None or step <= upto_step:
                out.append((step, v))
    return out


def write_stop_marker(run_dir: Path, name: str, reason: dict) -> Path:
    """runs/<run>/EARLY_STOP or MAX_HOURS: the reason as JSON (with a timestamp)."""
    p = Path(run_dir) / name
    p.write_text(json.dumps({**reason, "time": time.strftime("%Y-%m-%dT%H:%M:%S")}, indent=2) + "\n")
    return p


def probe_flags(peak_driver_gb: float) -> dict[str, bool]:
    """The memory verdicts of a --smoke probe (fits_under_60gb decides recipe A:
    full decoder vs the LoRA fallback)."""
    return {"under_60gb": peak_driver_gb < 60, "under_90gb": peak_driver_gb < 90, "fits_under_60gb": peak_driver_gb < 60}


def mps_mem_gb() -> tuple[float, float]:
    if DEVICE != "mps":
        return (0.0, 0.0)
    return (torch.mps.current_allocated_memory() / 2**30, torch.mps.driver_allocated_memory() / 2**30)


_PEAK = {"driver_gb": 0.0}  # running max of the MPS driver allocation seen by note_peak()


def note_peak() -> tuple[float, float]:
    """mps_mem_gb(), also folded into the process-wide driver peak. val_loss and
    generate_sample call it right before they empty the MPS cache, so the --smoke
    verdict (peak_driver_gb / fits_under_60gb) covers the validation pass and the
    sample generation, not only the training steps."""
    cur, drv = mps_mem_gb()
    _PEAK["driver_gb"] = max(_PEAK["driver_gb"], drv)
    return cur, drv


def peak_driver_gb() -> float:
    return _PEAK["driver_gb"]


def reset_peak() -> None:
    _PEAK["driver_gb"] = 0.0


def micro_step(model, tok, row, tokens_dir, melody: bool, chroma_dir: Path | str | None = None) -> torch.Tensor:
    """One clip's loss. For musicgen-melody the clip's chroma rides along as
    input_features (1, T, 12); text-only melody steps are refused."""
    text = tok(row["caption"], return_tensors="pt")
    labels = delayed_labels(token_path(tokens_dir, row))[None].to(DEVICE)
    kwargs = dict(input_ids=text["input_ids"].to(DEVICE), attention_mask=text["attention_mask"].to(DEVICE), labels=labels)
    if melody:
        kwargs["input_features"] = melody_features(chroma_dir, row)
    return model(**kwargs).loss


@torch.no_grad()
def val_loss(model, tok, rows, tokens_dir, melody, chroma_dir: Path | str | None = None) -> float:
    model.eval()
    losses = [micro_step(model, tok, r, tokens_dir, melody, chroma_dir).item() for r in rows]
    model.train()
    note_peak()
    if DEVICE == "mps":
        torch.mps.empty_cache()
    return float(np.mean(losses)) if losses else float("nan")


@torch.no_grad()
def generate_sample(model, processor, caption, seconds, out_path, melody) -> float:
    model.eval()
    if melody:
        from scripts.scale_eval import (
            patch_melody_generation,  # transformers 4.57 drops the melody prefix at step 1
        )

        patch_melody_generation(model)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    inputs = processor(text=[caption], padding=True, return_tensors="pt").to(DEVICE)
    t0 = time.time()
    audio = model.generate(**inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=int(seconds * 50))
    sr = model.config.audio_encoder.sampling_rate
    sf.write(out_path, audio[0].cpu().numpy().squeeze(), sr, subtype="PCM_16")
    model.train()
    note_peak()
    if DEVICE == "mps":
        torch.mps.empty_cache()
    return time.time() - t0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="facebook/musicgen-medium")
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--captions", required=True)
    ap.add_argument("--tokens-dir", default=None, help="fallback for rows without their own tokens_dir")
    ap.add_argument("--chroma-dir", default=None, help="musicgen-melody: fallback for rows without their own chroma_dir")
    ap.add_argument("--lr", type=float, default=5e-5)
    ap.add_argument("--total-steps", type=int, default=3000)
    ap.add_argument("--ckpt-every", type=int, default=250)
    ap.add_argument("--warmup", type=int, default=100)
    ap.add_argument("--batch-size", type=int, default=1)
    ap.add_argument("--grad-accum", type=int, default=8)
    ap.add_argument("--rank", type=int, default=32)
    ap.add_argument("--alpha", type=int, default=64)
    ap.add_argument("--targets", nargs="*", default=DEFAULT_TARGETS)
    ap.add_argument("--val-clips", type=int, default=48)
    ap.add_argument("--sample-seconds", type=int, default=15)
    ap.add_argument("--mem-cap-gb", type=float, default=85.0)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--smoke", type=int, default=0, help="N smoke steps + timing/memory report")
    ap.add_argument("--smoke-ckpt", action="store_true", help="--smoke: also save a checkpoint at the last smoke step")
    ap.add_argument("--resume-from", default=None, help="ckpt dir to continue from (optimizer state is not restored)")
    ap.add_argument("--start-step", type=int, default=0, help="step the resumed run continues after (0 = from the ckpt name)")
    ap.add_argument("--full-decoder", action="store_true", help="no LoRA: train every decoder parameter (text/audio encoders frozen)")
    ap.add_argument("--keep-last", type=int, default=0, help="full-decoder: keep only the best-val and the last N checkpoints (0 = keep all)")
    ap.add_argument("--early-stop-patience", type=int, default=0, help="stop when val has not improved for N steps (0 = off)")
    ap.add_argument("--early-stop-min-delta", type=float, default=0.002, help="a val improvement must exceed this to count")
    ap.add_argument("--max-hours", type=float, default=0.0, help="pause with a checkpoint after this many wall-clock hours (0 = off)")
    ap.add_argument("--chroma-frames-check", action="store_true", help="melody: assert the first train row's chroma has round(seconds*235/30) frames")
    args = ap.parse_args()
    captions = Path(args.captions)
    tokens_dir = Path(args.tokens_dir) if args.tokens_dir else None
    chroma_dir = Path(args.chroma_dir) if args.chroma_dir else None
    melody = is_melody(args.model)
    start_step = infer_start_step(args.resume_from, args.start_step)
    if args.keep_last > 0 and not args.full_decoder:
        print(f"--keep-last {args.keep_last} applies to full-decoder checkpoints only; LoRA checkpoints are all kept", flush=True)
    if args.full_decoder and (args.rank != 32 or args.alpha != 64 or args.targets != DEFAULT_TARGETS):
        print(f"--full-decoder ignores --rank {args.rank} --alpha {args.alpha} --targets {args.targets} (no LoRA in this mode)", flush=True)

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)
    reset_peak()

    train_rows = load_split(captions, "train")
    val_all = load_split(captions, "val")
    if not train_rows:
        raise SystemExit(f"{captions}: no 'train' rows")
    if not val_all:
        raise SystemExit(f"{captions}: no 'val' rows (validation, early stop, --keep-last and the smoke verdict need them)")
    stride = max(1, len(val_all) // args.val_clips)
    val_rows = sorted(val_all, key=lambda r: r["clip_path"])[::stride][: args.val_clips]
    rng = random.Random(args.seed)
    rng.shuffle(train_rows)
    if args.chroma_frames_check:
        n_frames = check_chroma_frames(train_rows[0], chroma_dir)
        print(f"chroma frames check: {train_rows[0]['clip_path']} has {n_frames} frames "
              f"(expected {expected_chroma_frames(float(train_rows[0].get('seconds', 30.0)))})", flush=True)

    processor = AutoProcessor.from_pretrained(args.model)
    tok = processor.tokenizer
    model = build_model(args.model, args.targets, args.rank, args.alpha, args.resume_from, full_decoder=args.full_decoder)

    n_steps = args.smoke if args.smoke else args.total_steps
    run_id = args.run_id or ("smoke" if args.smoke else time.strftime("scale_%Y%m%d_%H%M%S"))
    run_dir = runs_dir() / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    cfg_path = run_dir / "config.json"
    stop_keys = ("keep_last", "early_stop_patience", "early_stop_min_delta", "max_hours")  # the latest launch's policy
    config = {
        "model": args.model, "lr": args.lr, "total_steps": args.total_steps, "warmup": args.warmup,
        "batch_size": args.batch_size, "grad_accum": args.grad_accum,
        # no LoRA in full-decoder mode: null, so report scripts never print an unused "r32 α64"
        "rank": None if args.full_decoder else args.rank, "alpha": None if args.full_decoder else args.alpha,
        "targets": None if args.full_decoder else args.targets,
        "captions": str(captions), "tokens_dir": str(tokens_dir) if tokens_dir else None,
        "chroma_dir": str(chroma_dir) if chroma_dir else None,
        "train_clips": len(train_rows), "val_clips_used": len(val_rows), "sample_seconds": args.sample_seconds,
        "seed": args.seed, "git_commit": git_commit(), "device": DEVICE, "smoke": bool(args.smoke),
        "versions": library_versions(), "resumed_from": args.resume_from, "start_step": start_step,
        "full_decoder": args.full_decoder, "keep_last": args.keep_last,
        "early_stop_patience": args.early_stop_patience, "early_stop_min_delta": args.early_stop_min_delta,
        "max_hours": args.max_hours, "runs_dir": str(run_dir.parent),
    }
    if args.resume_from and cfg_path.exists():
        # keep the original run's record (model, lr, total_steps, ...); append this continuation, with the
        # flags it actually runs with, to the history; the stop / retention policy is the latest launch's
        prev = json.loads(cfg_path.read_text())
        history = list(prev.get("resume_history", []))
        history.append({"resumed_from": args.resume_from, "start_step": start_step,
                        "git_commit": config["git_commit"], "time": time.strftime("%Y-%m-%dT%H:%M:%S"),
                        **{k: config[k] for k in ("lr", "total_steps", "warmup", "grad_accum", "full_decoder", "captions", *stop_keys)},
                        "ckpt_every": args.ckpt_every, "val_clips_used": len(val_rows)})
        config = {**prev, "resumed_from": args.resume_from, "start_step": start_step,
                  "versions": config["versions"], "resume_history": history, **{k: config[k] for k in stop_keys}}
    cfg_path.write_text(json.dumps(config, indent=2))
    if start_step:
        for marker in (MAX_HOURS_FILE, EARLY_STOP_FILE):  # a resumed run is neither paused nor finished
            if (run_dir / marker).exists():
                (run_dir / marker).unlink()
                print(f"removed the stale {marker} marker (resuming)", flush=True)

    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=0.0)
    sched = get_cosine_schedule_with_warmup(opt, args.warmup, args.total_steps)
    for _ in range(start_step):  # fast-forward the cosine schedule; AdamW moments restart from zero
        sched.step()
    csv_path = run_dir / "loss.csv"
    vals: list[tuple[int, float]] = val_history(csv_path, upto_step=start_step) if start_step else []
    loss_csv = open(csv_path, "a", newline="")
    writer = csv.writer(loss_csv)
    if csv_path.stat().st_size == 0:
        writer.writerow(["step", "train_loss", "val_loss", "lr", "sec_per_step", "mps_driver_gb"])

    sample_caption = val_all[0]["caption"] if val_all else "Somali qaraami led by the oud (kaban), moderate at 100 BPM, pentatonic melody rooted on A, intimate recording"
    (run_dir / "sample_caption.txt").write_text(sample_caption + "\n")

    def validate(step: int) -> float:
        """val loss at 4 dp (the precision loss.csv keeps, so a resumed run's read-back
        history and the live one compare like with like); a non-finite value ends
        the run (exit 1) rather than steering early stop / pruning / the markers."""
        v = round(val_loss(model, tok, val_rows, tokens_dir, melody, chroma_dir), 4)
        if not math.isfinite(v):
            loss_csv.close()
            raise SystemExit(f"step {step}: validation loss is {v} over {len(val_rows)} val rows; refusing to continue")
        return v

    def record_val(step: int) -> float:
        v = validate(step)
        writer.writerow([step, "", v, f"{sched.get_last_lr()[0]:.2e}", "", round(mps_mem_gb()[1], 2)])
        loss_csv.flush()
        vals.append((step, v))
        return v

    def stop_decision() -> StopDecision:
        # only saved (scheduled) checkpoints anchor the decision: never the step-0 base or step-100 val
        return early_stop_decision(scheduled_history(vals, args.ckpt_every), args.early_stop_patience, args.early_stop_min_delta)

    def save_ckpt(step: int, v: float | None) -> Path:
        ckpt = save_checkpoint(model, run_dir / f"ckpt_step_{step:04d}", args.full_decoder,
                               model_name=args.model, step=step, val_loss=v)
        if args.full_decoder and args.keep_last > 0:
            best = stop_decision().best_step if args.early_stop_patience > 0 else -1
            for gone in prune_checkpoints(run_dir, dict(vals), args.keep_last, protect=(best,) if best >= 0 else ()):
                print(f"[keep-last {args.keep_last}] removed {gone.name}", flush=True)
        return ckpt

    if start_step:
        print(f"resuming from {args.resume_from} at step {start_step} (optimizer state not restored, "
              f"schedule fast-forwarded, lr={sched.get_last_lr()[0]:.2e}, {len(vals)} earlier validations read back)", flush=True)
    if not args.smoke and not start_step:
        v0 = validate(0)
        writer.writerow([0, "", v0, 0.0, "", round(mps_mem_gb()[1], 2)])
        loss_csv.flush()
        vals.append((0, v0))  # in loss.csv for the CE tables; never an early-stop anchor (scheduled_history)
        print(f"step 0 ({'base' if args.full_decoder else 'base+init LoRA'}) val_loss={v0:.4f}", flush=True)

    model.train()
    idx = start_step * args.grad_accum  # continue the shuffled order where the killed run left it
    step_times = []
    losses10 = []
    t_start = time.time()
    saved_step = -1
    for step in range(start_step + 1, n_steps + 1):
        t0 = time.time()
        opt.zero_grad(set_to_none=True)
        acc = 0.0
        for _ in range(args.grad_accum):
            row = train_rows[idx % len(train_rows)]
            idx += 1
            loss = micro_step(model, tok, row, tokens_dir, melody, chroma_dir) / args.grad_accum
            loss.backward()
            acc += loss.item()
        torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0)
        opt.step()
        sched.step()
        dt = time.time() - t0
        step_times.append(dt)
        losses10.append(acc)
        cur_gb, drv_gb = note_peak()
        writer.writerow([step, round(acc, 4), "", f"{sched.get_last_lr()[0]:.2e}", round(dt, 2), round(drv_gb, 2)])
        if step % 10 == 0 or step == 1:
            print(f"step {step}/{n_steps} loss={acc:.4f} {dt:.1f}s/step mps_driver={drv_gb:.1f}GB alloc={cur_gb:.1f}GB", flush=True)
            loss_csv.flush()
        if drv_gb > args.mem_cap_gb:
            print(f"MEM_CAP_EXCEEDED driver={drv_gb:.1f}GB > cap {args.mem_cap_gb}GB — aborting cleanly at step {step}", flush=True)
            loss_csv.close()
            sys.exit(3)
        v: float | None = None
        if not args.smoke and (step % args.ckpt_every == 0 or step == 100):
            v = record_val(step)
            if step % args.ckpt_every == 0:
                ckpt = save_ckpt(step, v)
                saved_step = step
                gen_s = generate_sample(model, processor, sample_caption, args.sample_seconds, run_dir / "samples" / f"step_{step:04d}.wav", melody)
                print(f"[ckpt {step}] val_loss={v:.4f} saved {ckpt.name}, sample in {gen_s:.0f}s", flush=True)
            else:
                print(f"[val {step}] val_loss={v:.4f}", flush=True)
            if args.early_stop_patience > 0:
                d = stop_decision()
                if d.stop:
                    if saved_step != step:
                        save_ckpt(step, v)
                    write_stop_marker(run_dir, EARLY_STOP_FILE, {
                        "reason": f"val loss not improved by more than {args.early_stop_min_delta} for {d.steps_since_best} steps "
                                  f"(patience {args.early_stop_patience})",
                        "step": step, "best_step": d.best_step, "best_val": round(d.best_val, 4), "val_at_stop": round(v, 4),
                        "patience": args.early_stop_patience, "min_delta": args.early_stop_min_delta})
                    print(f"EARLY_STOP step={step} best_step={d.best_step} best_val={d.best_val:.4f} val={v:.4f}", flush=True)
                    loss_csv.close()
                    print("SCALE_TRAIN_DONE", flush=True)
                    return
        if not args.smoke and max_hours_exceeded(t_start, args.max_hours):
            if v is None:
                v = record_val(step)
            if saved_step != step:
                save_ckpt(step, v)
            hours = hours_elapsed(t_start)
            write_stop_marker(run_dir, MAX_HOURS_FILE, {
                "reason": f"wall clock {hours:.2f} h reached --max-hours {args.max_hours}; resume with --resume-from ckpt_step_{step:04d}",
                "step": step, "elapsed_hours": round(hours, 3), "max_hours": args.max_hours, "val_loss": round(v, 4)})
            print(f"MAX_HOURS_STOP step={step} elapsed_hours={hours:.2f} val_loss={v:.4f} (resume from ckpt_step_{step:04d})", flush=True)
            loss_csv.close()
            print("SCALE_TRAIN_PAUSED", flush=True)
            return

    if args.smoke:
        med = float(np.median(step_times[1:])) if len(step_times) > 1 else step_times[0]
        cur_gb, _ = note_peak()
        # every smoke validates once (what a real run does every --ckpt-every steps with the AdamW moments
        # resident) and generates a sample, so the memory verdict below covers both, not only the train steps
        smoke_val = record_val(n_steps)
        smoke_ckpt: Path | None = save_ckpt(n_steps, smoke_val) if args.smoke_ckpt else None
        gen_s = generate_sample(model, processor, sample_caption, args.sample_seconds, run_dir / "smoke_sample.wav", melody)
        peak_drv = peak_driver_gb()  # train steps + validation + generation
        est_hours = (args.total_steps * med) / 3600
        trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
        print(json.dumps({
            "model": args.model, "mode": "full_decoder" if args.full_decoder else "lora",
            "smoke_steps": args.smoke, "grad_accum": args.grad_accum, "trainable_params_m": round(trainable / 1e6, 1),
            "median_sec_per_step": round(med, 2), "peak_driver_gb": round(peak_drv, 2), "alloc_gb": round(cur_gb, 2),
            "train_loss_first": round(losses10[0], 3), "train_loss_last": round(losses10[-1], 3),
            "sample_gen_s": round(gen_s, 1), "est_full_run_hours": round(est_hours, 2),
            **probe_flags(peak_drv),
            "smoke_ckpt": str(smoke_ckpt) if smoke_ckpt else None,
            "smoke_val_loss": smoke_val,
        }, indent=2), flush=True)
    loss_csv.close()
    print("SCALE_TRAIN_DONE", flush=True)


if __name__ == "__main__":
    main()
