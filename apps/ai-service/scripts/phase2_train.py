"""Phase 2 Track A: LoRA fine-tune of facebook/musicgen-small on the Somali corpus.

Precomputed EnCodec tokens (data/tokens/*.npy, (4, 750) int16) are turned into
delay-pattern labels: codebook k is shifted right by k frames (matching MusicGen's
generation-time codebook interleaving), non-token positions are -100. HF's
MusicgenForConditionalGeneration then builds shifted decoder inputs (BOS=2048 in
the delay triangle) and computes per-codebook cross-entropy — verified against the
installed transformers 4.57 source.

Config is fixed per the run spec: float32 on MPS, LoRA r=16/alpha=32/dropout=0.05
on decoder self+cross attention q/k/v/out projections, batch 1 x grad-accum 4,
lr 1e-4 cosine with 100 warmup steps, AdamW, grad clip 1.0, gradient checkpointing.

Usage (from apps/ai-service):
  python3 -m scripts.phase2_train --smoke          # 50 opt steps on 20 clips + timing
  python3 -m scripts.phase2_train --run-id <id>    # real 1500-step run
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import subprocess
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoProcessor, MusicgenForConditionalGeneration, get_cosine_schedule_with_warmup

REPO = Path(__file__).resolve().parents[3]
CAPTIONS = REPO / "data/captions.jsonl"
TOKENS_DIR = REPO / "data/tokens"
RUNS_DIR = REPO / "runs"

HP = {
    "model": "facebook/musicgen-small",
    "precision": "float32",
    "lora_r": 16,
    "lora_alpha": 32,
    "lora_dropout": 0.05,
    "lora_targets": ["q_proj", "k_proj", "v_proj", "out_proj"],
    "batch_size": 1,
    "grad_accum": 4,
    "lr": 1e-4,
    "schedule": "cosine",
    "warmup_steps": 100,
    "optimizer": "AdamW",
    "weight_decay": 0.0,
    "grad_clip": 1.0,
    "gradient_checkpointing": True,
    "total_steps": 1500,
    "ckpt_every": 250,
    "val_clips": 64,
    "n_samples_per_ckpt": 4,
    "sample_seconds": 10,
    "seed": 42,
    "codebooks": 4,
    "frames": 750,
}

BOS = 2048
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"


def load_split(split: str) -> list[dict]:
    rows = [json.loads(l) for l in open(CAPTIONS)]
    return [r for r in rows if r["split"] == split]


def delayed_labels(npy_path: Path) -> torch.Tensor:
    """(4, 750) codes -> (753, 4) delay-pattern labels, -100 outside each codebook's span."""
    codes = np.load(npy_path)
    k, t = codes.shape
    lab = np.full((t + k - 1, k), -100, dtype=np.int64)
    for cb in range(k):
        lab[cb:cb + t, cb] = codes[cb]
    return torch.from_numpy(lab)


def token_path(row: dict) -> Path:
    return TOKENS_DIR / (Path(row["clip_path"]).stem + ".npy")


def git_commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO,
                              capture_output=True, text=True).stdout.strip()
    except OSError:
        return "unknown"


def build_model(resume_from: str | None = None):
    model = MusicgenForConditionalGeneration.from_pretrained(
        HP["model"], torch_dtype=torch.float32
    )
    # musicgen-small ships without this set; shift_tokens_right needs it (BOS=2048)
    model.config.decoder.decoder_start_token_id = BOS
    model.decoder.gradient_checkpointing_enable(
        gradient_checkpointing_kwargs={"use_reentrant": False}
    )
    if resume_from:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, resume_from, is_trainable=True)
    else:
        lcfg = LoraConfig(
            r=HP["lora_r"], lora_alpha=HP["lora_alpha"], lora_dropout=HP["lora_dropout"],
            target_modules=HP["lora_targets"], bias="none",
        )
        model = get_peft_model(model, lcfg)
    model.to(DEVICE)
    lora_modules = sum(1 for n, _ in model.named_modules() if n.endswith("lora_A"))
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"device={DEVICE} lora_modules={lora_modules} "
          f"trainable={trainable/1e6:.2f}M / {total/1e6:.1f}M", flush=True)
    assert lora_modules == 24 * 2 * 4, f"expected 192 LoRA sites, got {lora_modules}"
    return model


def micro_step(model, tok, row: dict) -> torch.Tensor:
    text = tok(row["caption"], return_tensors="pt")
    labels = delayed_labels(token_path(row))[None].to(DEVICE)
    out = model(
        input_ids=text["input_ids"].to(DEVICE),
        attention_mask=text["attention_mask"].to(DEVICE),
        labels=labels,
    )
    return out.loss


@torch.no_grad()
def val_loss(model, tok, rows: list[dict]) -> float:
    model.eval()
    losses = [micro_step(model, tok, r).item() for r in rows]
    model.train()
    if DEVICE == "mps":
        torch.mps.empty_cache()
    return float(np.mean(losses))


@torch.no_grad()
def generate_samples(model, processor, captions: list[str], out_dir: Path) -> float:
    model.eval()
    out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    sr = model.config.audio_encoder.sampling_rate
    # pairs, not one batch of 4: batch-4 CFG balloons the MPS driver to ~17 GB
    # and macOS kills the job under the resulting memory pressure
    for b in range(0, len(captions), 2):
        chunk = captions[b:b + 2]
        inputs = processor(text=chunk, padding=True, return_tensors="pt").to(DEVICE)
        audio = model.generate(
            **inputs, do_sample=True, guidance_scale=3.0,
            max_new_tokens=HP["sample_seconds"] * 50,
        )
        for i, wav in enumerate(audio.cpu().numpy()):
            sf.write(out_dir / f"sample_{b + i}.wav", wav.squeeze(), sr, subtype="PCM_16")
        if DEVICE == "mps":
            torch.mps.empty_cache()
    (out_dir / "captions.txt").write_text("\n".join(captions) + "\n")
    model.train()
    if DEVICE == "mps":
        torch.mps.empty_cache()  # generation balloons the MPS driver cache
    return time.time() - t0


def pick_sample_captions(val_rows: list[dict]) -> list[str]:
    """4 fixed, diverse held-out captions: prefer a Qaraami one, spread tonics."""
    rows = sorted(val_rows, key=lambda r: r["clip_path"])
    chosen: list[dict] = []
    qaraami = [r for r in rows if r["caption"].startswith("Qaraami")]
    if qaraami:
        chosen.append(qaraami[0])
    for r in rows:
        if len(chosen) == 4:
            break
        tonics = {c["caption"].split("rooted on ")[1] for c in chosen}
        if r["caption"].split("rooted on ")[1] not in tonics:
            chosen.append(r)
    return [r["caption"] for r in chosen[:4]]


def mps_peak_mb() -> tuple[float, float]:
    if DEVICE != "mps":
        return (0.0, 0.0)
    return (torch.mps.current_allocated_memory() / 2**20,
            torch.mps.driver_allocated_memory() / 2**20)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--resume-from", default=None,
                    help="path to a ckpt_step_* dir; adapters restored, optimizer fresh")
    ap.add_argument("--start-step", type=int, default=0,
                    help="optimizer step the resume checkpoint was saved at")
    ap.add_argument("--lr", type=float, default=HP["lr"],
                    help="peak learning rate (recorded in config.json)")
    args = ap.parse_args()
    HP["lr"] = args.lr

    torch.manual_seed(HP["seed"])
    random.seed(HP["seed"])
    np.random.seed(HP["seed"])

    processor = AutoProcessor.from_pretrained(HP["model"])
    tok = processor.tokenizer
    model = build_model(args.resume_from)

    train_rows = load_split("train")
    val_rows_all = load_split("val")
    stride = max(1, len(val_rows_all) // HP["val_clips"])
    val_rows = sorted(val_rows_all, key=lambda r: r["clip_path"])[::stride][: HP["val_clips"]]

    rng = random.Random(HP["seed"])
    rng.shuffle(train_rows)

    n_steps = 50 if args.smoke else HP["total_steps"]
    if args.smoke:
        train_rows = train_rows[:20]

    opt = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad],
        lr=HP["lr"], weight_decay=HP["weight_decay"],
    )
    sched = get_cosine_schedule_with_warmup(opt, HP["warmup_steps"], HP["total_steps"])
    for _ in range(args.start_step):
        sched.step()

    run_id = args.run_id or ("smoke" if args.smoke else time.strftime("lora_r16_%Y%m%d"))
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "config.json").write_text(json.dumps(
        {**HP, "smoke": args.smoke, "git_commit": git_commit(), "device": DEVICE,
         "train_clips": len(train_rows), "val_clips_used": len(val_rows),
         "resumed_from": args.resume_from, "resume_start_step": args.start_step,
         "resume_optimizer_state": "reinitialized" if args.resume_from else None},
        indent=2))

    csv_path = run_dir / "loss.csv"
    if args.resume_from and csv_path.exists():
        # drop rows from the killed trajectory beyond the resume checkpoint
        kept = [l for l in csv_path.read_text().splitlines()
                if l.startswith("step") or (l.split(",")[0].isdigit()
                                            and int(l.split(",")[0]) <= args.start_step)]
        csv_path.write_text("\n".join(kept) + "\n")
    loss_csv = open(csv_path, "a", newline="")
    writer = csv.writer(loss_csv)
    if not args.resume_from:
        writer.writerow(["step", "train_loss", "val_loss", "lr", "sec_per_step"])

    sample_captions = pick_sample_captions(val_rows_all)
    (run_dir / "sample_captions.txt").write_text("\n".join(sample_captions) + "\n")

    if not args.smoke and not args.resume_from:
        v0 = val_loss(model, tok, val_rows)
        writer.writerow([0, "", round(v0, 4), 0.0, ""]); loss_csv.flush()
        print(f"step 0 (base+init LoRA) val_loss={v0:.4f}", flush=True)

    model.train()
    step_times: list[float] = []
    step_losses: list[float] = []
    idx = args.start_step * HP["grad_accum"]
    for step in range(args.start_step + 1, n_steps + 1):
        t0 = time.time()
        opt.zero_grad(set_to_none=True)
        acc = 0.0
        for _ in range(HP["grad_accum"]):
            row = train_rows[idx % len(train_rows)]
            idx += 1
            loss = micro_step(model, tok, row) / HP["grad_accum"]
            loss.backward()
            acc += loss.item()
        torch.nn.utils.clip_grad_norm_(
            [p for p in model.parameters() if p.requires_grad], HP["grad_clip"])
        opt.step()
        sched.step()
        dt = time.time() - t0
        step_times.append(dt)
        step_losses.append(acc)
        writer.writerow([step, round(acc, 4), "", f"{sched.get_last_lr()[0]:.2e}", round(dt, 2)])
        if step % 10 == 0:
            alloc, drv = mps_peak_mb()
            print(f"step {step}/{n_steps} loss={acc:.4f} {dt:.1f}s/step "
                  f"mps_alloc={alloc:.0f}MB driver={drv:.0f}MB", flush=True)
            loss_csv.flush()

        if not args.smoke and (step % HP["ckpt_every"] == 0 or step == 100):
            v = val_loss(model, tok, val_rows)
            writer.writerow([step, "", round(v, 4), f"{sched.get_last_lr()[0]:.2e}", ""])
            loss_csv.flush()
            if step % HP["ckpt_every"] != 0:  # step-100 early drift check: val only
                print(f"[val {step}] val_loss={v:.4f}", flush=True)
                continue
            ckpt = run_dir / f"ckpt_step_{step:04d}"
            model.save_pretrained(ckpt)
            gen_s = generate_samples(model, processor, sample_captions,
                                     run_dir / "samples" / f"step_{step:04d}")
            print(f"[ckpt {step}] val_loss={v:.4f} saved {ckpt.name}, "
                  f"4 samples in {gen_s:.0f}s", flush=True)

    if args.smoke:
        alloc, drv = mps_peak_mb()
        med = float(np.median(step_times[2:]))
        t_val = time.time()
        v8 = val_loss(model, tok, val_rows[:8])
        val8_s = time.time() - t_val
        gen_s = generate_samples(model, processor, sample_captions[:1], run_dir / "samples_smoke")
        est_train = HP["total_steps"] * med
        est_overhead = (HP["total_steps"] // HP["ckpt_every"]) * (val8_s * 8 + 4 * gen_s)
        print(json.dumps({
            "median_sec_per_opt_step": round(med, 2),
            "first_step_sec": round(step_times[0], 2),
            "mps_current_allocated_MB": round(alloc),
            "mps_driver_allocated_MB": round(drv),
            "train_loss_first10_avg": round(float(np.mean(step_losses[:10])), 4),
            "train_loss_last10_avg": round(float(np.mean(step_losses[-10:])), 4),
            "val8_loss_after_smoke": round(v8, 4),
            "gen_10s_sample_sec": round(gen_s, 1),
            "est_1500_steps_hours": round(est_train / 3600, 2),
            "est_ckpt_overhead_hours": round(est_overhead / 3600, 2),
            "est_total_hours": round((est_train + est_overhead) / 3600, 2),
        }, indent=2), flush=True)

    loss_csv.close()


if __name__ == "__main__":
    main()
