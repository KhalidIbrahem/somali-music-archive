"""Scaled LoRA fine-tune of MusicGen (medium / large / melody) on the Somali
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
    saved LoRA checkpoint. Only the adapter weights come back: the AdamW moments
    restart from zero and the cosine schedule is fast-forwarded to N (inferred
    from the checkpoint name when --start-step is 0). loss.csv is appended.
  * config.json records the library versions (torch, transformers, peft,
    torchcrepe) and the git commit under "versions"

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
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import re
import subprocess
import sys
import time
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from peft import LoraConfig, get_peft_model
from transformers import (
    AutoProcessor,
    MusicgenForConditionalGeneration,
    MusicgenMelodyForConditionalGeneration,
    get_cosine_schedule_with_warmup,
)

REPO = Path(__file__).resolve().parents[3]
RUNS_DIR = REPO / "runs"
BOS = 2048
NUM_CHROMA = 12  # musicgen-melody conditions on a 12-bin chroma per frame
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

DEFAULT_TARGETS = ["q_proj", "k_proj", "v_proj", "out_proj", "fc1", "fc2"]


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


def build_model(model_name: str, targets: list[str], rank: int, alpha: int, resume_from: str | None):
    cls = MusicgenMelodyForConditionalGeneration if is_melody(model_name) else MusicgenForConditionalGeneration
    model = cls.from_pretrained(model_name, dtype=torch.float32)
    model.config.decoder.decoder_start_token_id = BOS
    model.decoder.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
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


def mps_mem_gb() -> tuple[float, float]:
    if DEVICE != "mps":
        return (0.0, 0.0)
    return (torch.mps.current_allocated_memory() / 2**30, torch.mps.driver_allocated_memory() / 2**30)


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
    if DEVICE == "mps":
        torch.mps.empty_cache()
    return float(np.mean(losses))


@torch.no_grad()
def generate_sample(model, processor, caption, seconds, out_path, melody) -> float:
    model.eval()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    inputs = processor(text=[caption], padding=True, return_tensors="pt").to(DEVICE)
    t0 = time.time()
    audio = model.generate(**inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=int(seconds * 50))
    sr = model.config.audio_encoder.sampling_rate
    sf.write(out_path, audio[0].cpu().numpy().squeeze(), sr, subtype="PCM_16")
    model.train()
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
    ap.add_argument("--resume-from", default=None, help="LoRA ckpt dir to continue from (optimizer state is not restored)")
    ap.add_argument("--start-step", type=int, default=0, help="step the resumed run continues after (0 = from the ckpt name)")
    args = ap.parse_args()
    captions = Path(args.captions)
    tokens_dir = Path(args.tokens_dir) if args.tokens_dir else None
    chroma_dir = Path(args.chroma_dir) if args.chroma_dir else None
    melody = is_melody(args.model)
    start_step = infer_start_step(args.resume_from, args.start_step)

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)

    processor = AutoProcessor.from_pretrained(args.model)
    tok = processor.tokenizer
    model = build_model(args.model, args.targets, args.rank, args.alpha, args.resume_from)

    train_rows = load_split(captions, "train")
    val_all = load_split(captions, "val")
    stride = max(1, len(val_all) // args.val_clips)
    val_rows = sorted(val_all, key=lambda r: r["clip_path"])[::stride][: args.val_clips]
    rng = random.Random(args.seed)
    rng.shuffle(train_rows)

    n_steps = args.smoke if args.smoke else args.total_steps
    run_id = args.run_id or ("smoke" if args.smoke else time.strftime("scale_%Y%m%d_%H%M%S"))
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    cfg_path = run_dir / "config.json"
    config = {
        "model": args.model, "lr": args.lr, "total_steps": args.total_steps, "warmup": args.warmup,
        "batch_size": args.batch_size, "grad_accum": args.grad_accum, "rank": args.rank, "alpha": args.alpha,
        "targets": args.targets, "captions": str(captions), "tokens_dir": str(tokens_dir) if tokens_dir else None,
        "chroma_dir": str(chroma_dir) if chroma_dir else None,
        "train_clips": len(train_rows), "val_clips_used": len(val_rows), "sample_seconds": args.sample_seconds,
        "seed": args.seed, "git_commit": git_commit(), "device": DEVICE, "smoke": bool(args.smoke),
        "versions": library_versions(), "resumed_from": args.resume_from, "start_step": start_step,
    }
    if args.resume_from and cfg_path.exists():
        # keep the original run's record; append this continuation to its history
        prev = json.loads(cfg_path.read_text())
        history = list(prev.get("resume_history", []))
        history.append({"resumed_from": args.resume_from, "start_step": start_step,
                        "git_commit": config["git_commit"], "time": time.strftime("%Y-%m-%dT%H:%M:%S")})
        config = {**prev, "resumed_from": args.resume_from, "start_step": start_step,
                  "versions": config["versions"], "resume_history": history}
    cfg_path.write_text(json.dumps(config, indent=2))

    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=0.0)
    sched = get_cosine_schedule_with_warmup(opt, args.warmup, args.total_steps)
    for _ in range(start_step):  # fast-forward the cosine schedule; AdamW moments restart from zero
        sched.step()
    csv_path = run_dir / "loss.csv"
    loss_csv = open(csv_path, "a", newline="")
    writer = csv.writer(loss_csv)
    if csv_path.stat().st_size == 0:
        writer.writerow(["step", "train_loss", "val_loss", "lr", "sec_per_step", "mps_driver_gb"])

    sample_caption = val_all[0]["caption"] if val_all else "Somali qaraami led by the oud (kaban), moderate at 100 BPM, pentatonic melody rooted on A, intimate recording"
    (run_dir / "sample_caption.txt").write_text(sample_caption + "\n")

    if start_step:
        print(f"resuming from {args.resume_from} at step {start_step} (optimizer state not restored, "
              f"schedule fast-forwarded, lr={sched.get_last_lr()[0]:.2e})", flush=True)
    if not args.smoke and not start_step:
        v0 = val_loss(model, tok, val_rows, tokens_dir, melody, chroma_dir)
        writer.writerow([0, "", round(v0, 4), 0.0, "", round(mps_mem_gb()[1], 2)])
        loss_csv.flush()
        print(f"step 0 (base+init LoRA) val_loss={v0:.4f}", flush=True)

    model.train()
    idx = start_step * args.grad_accum  # continue the shuffled order where the killed run left it
    step_times = []
    losses10 = []
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
        cur_gb, drv_gb = mps_mem_gb()
        writer.writerow([step, round(acc, 4), "", f"{sched.get_last_lr()[0]:.2e}", round(dt, 2), round(drv_gb, 2)])
        if step % 10 == 0 or step == 1:
            print(f"step {step}/{n_steps} loss={acc:.4f} {dt:.1f}s/step mps_driver={drv_gb:.1f}GB alloc={cur_gb:.1f}GB", flush=True)
            loss_csv.flush()
        if drv_gb > args.mem_cap_gb:
            print(f"MEM_CAP_EXCEEDED driver={drv_gb:.1f}GB > cap {args.mem_cap_gb}GB — aborting cleanly at step {step}", flush=True)
            loss_csv.close()
            sys.exit(3)
        if not args.smoke and (step % args.ckpt_every == 0 or step == 100):
            v = val_loss(model, tok, val_rows, tokens_dir, melody, chroma_dir)
            writer.writerow([step, "", round(v, 4), f"{sched.get_last_lr()[0]:.2e}", "", round(mps_mem_gb()[1], 2)])
            loss_csv.flush()
            if step % args.ckpt_every == 0:
                ckpt = run_dir / f"ckpt_step_{step:04d}"
                model.save_pretrained(ckpt)
                gen_s = generate_sample(model, processor, sample_caption, args.sample_seconds, run_dir / "samples" / f"step_{step:04d}.wav", melody)
                print(f"[ckpt {step}] val_loss={v:.4f} saved {ckpt.name}, sample in {gen_s:.0f}s", flush=True)
            else:
                print(f"[val {step}] val_loss={v:.4f}", flush=True)

    if args.smoke:
        med = float(np.median(step_times[1:])) if len(step_times) > 1 else step_times[0]
        cur_gb, drv_gb = mps_mem_gb()
        gen_s = generate_sample(model, processor, sample_caption, args.sample_seconds, run_dir / "smoke_sample.wav", melody)
        est_hours = (args.total_steps * med) / 3600
        print(json.dumps({
            "model": args.model, "smoke_steps": args.smoke, "grad_accum": args.grad_accum,
            "median_sec_per_step": round(med, 2), "peak_driver_gb": round(drv_gb, 2), "alloc_gb": round(cur_gb, 2),
            "train_loss_first": round(losses10[0], 3), "train_loss_last": round(losses10[-1], 3),
            "sample_gen_s": round(gen_s, 1), "est_full_run_hours": round(est_hours, 2),
            "under_60gb": drv_gb < 60, "under_90gb": drv_gb < 90,
        }, indent=2), flush=True)
    loss_csv.close()
    print("SCALE_TRAIN_DONE", flush=True)


if __name__ == "__main__":
    main()
