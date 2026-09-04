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

The dropout fix (37 functional attributes zeroed) is the whole reason the
earlier runs turned positive; it is applied identically here.

Usage (from apps/ai-service):
  python -m scripts.scale_train --model facebook/musicgen-medium \
     --run-id qaraami_medium_r32 --lr 5e-5 --total-steps 3000 --ckpt-every 250 \
     --batch-size 1 --grad-accum 8 --captions ../../data/scale_captions.jsonl \
     --tokens-dir ../../data/scale_tokens --mem-cap-gb 60
  python -m scripts.scale_train --smoke ...   # 30 steps + timing + memory
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoProcessor, MusicgenForConditionalGeneration, MusicgenMelodyForConditionalGeneration, get_cosine_schedule_with_warmup

REPO = Path(__file__).resolve().parents[3]
RUNS_DIR = REPO / "runs"
BOS = 2048
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


def token_path(tokens_dir: Path, row: dict) -> Path:
    return tokens_dir / (Path(row["clip_path"]).stem + ".npy")


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


def is_melody(model_name: str) -> bool:
    return "melody" in model_name


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


def micro_step(model, tok, row, tokens_dir, melody: bool) -> torch.Tensor:
    text = tok(row["caption"], return_tensors="pt")
    labels = delayed_labels(token_path(tokens_dir, row))[None].to(DEVICE)
    kwargs = dict(input_ids=text["input_ids"].to(DEVICE), attention_mask=text["attention_mask"].to(DEVICE), labels=labels)
    return model(**kwargs).loss


@torch.no_grad()
def val_loss(model, tok, rows, tokens_dir, melody) -> float:
    model.eval()
    losses = [micro_step(model, tok, r, tokens_dir, melody).item() for r in rows]
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
    ap.add_argument("--tokens-dir", required=True)
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
    args = ap.parse_args()
    captions = Path(args.captions)
    tokens_dir = Path(args.tokens_dir)
    melody = is_melody(args.model)

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)

    processor = AutoProcessor.from_pretrained(args.model)
    tok = processor.tokenizer
    model = build_model(args.model, args.targets, args.rank, args.alpha, None)

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
    (run_dir / "config.json").write_text(json.dumps({
        "model": args.model, "lr": args.lr, "total_steps": args.total_steps, "warmup": args.warmup,
        "batch_size": args.batch_size, "grad_accum": args.grad_accum, "rank": args.rank, "alpha": args.alpha,
        "targets": args.targets, "captions": str(captions), "tokens_dir": str(tokens_dir),
        "train_clips": len(train_rows), "val_clips_used": len(val_rows), "sample_seconds": args.sample_seconds,
        "seed": args.seed, "git_commit": git_commit(), "device": DEVICE, "smoke": bool(args.smoke),
    }, indent=2))

    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=0.0)
    sched = get_cosine_schedule_with_warmup(opt, args.warmup, args.total_steps)
    csv_path = run_dir / "loss.csv"
    loss_csv = open(csv_path, "a", newline="")
    writer = csv.writer(loss_csv)
    if csv_path.stat().st_size == 0:
        writer.writerow(["step", "train_loss", "val_loss", "lr", "sec_per_step", "mps_driver_gb"])

    sample_caption = val_all[0]["caption"] if val_all else "Somali qaraami led by the oud (kaban), moderate at 100 BPM, pentatonic melody rooted on A, intimate recording"
    (run_dir / "sample_caption.txt").write_text(sample_caption + "\n")

    if not args.smoke:
        v0 = val_loss(model, tok, val_rows, tokens_dir, melody)
        writer.writerow([0, "", round(v0, 4), 0.0, "", round(mps_mem_gb()[1], 2)])
        loss_csv.flush()
        print(f"step 0 (base+init LoRA) val_loss={v0:.4f}", flush=True)

    model.train()
    idx = 0
    step_times = []
    losses10 = []
    for step in range(1, n_steps + 1):
        t0 = time.time()
        opt.zero_grad(set_to_none=True)
        acc = 0.0
        for _ in range(args.grad_accum):
            row = train_rows[idx % len(train_rows)]
            idx += 1
            loss = micro_step(model, tok, row, tokens_dir, melody) / args.grad_accum
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
            v = val_loss(model, tok, val_rows, tokens_dir, melody)
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
