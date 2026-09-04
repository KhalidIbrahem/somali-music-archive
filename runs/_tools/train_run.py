"""Run ONE fixed-harness LoRA fine-tune through scripts.phase2_train.main() UNCHANGED
(same code path as runs/oud_lora_r16_nodrop_20260809: 37 functional-dropout attrs zeroed,
LoRA r=16/alpha=32 on q/k/v/out, batch 1 x accum 4, cosine lr, ckpt+val every 250, val at 100),
with two deliberate differences requested for the M5 Max Harvard reruns (2026-09-03):

  * the per-checkpoint 4-sample generation is skipped (monkeypatched to a no-op), and
  * ONE 10 s sample is generated at the very end from the final weights, batch size 1,
    classifier-free guidance 3.0 (the July run was OOM-killed generating at batch 4).

Lives under runs/_tools so the harness file itself is never modified.

Usage (cwd = apps/ai-service, ~/ai/musicgen-env):
  python -u runs/_tools/train_run.py --run-id harvard_raw --lr 1e-4 --total-steps 1500 \
      [--captions /abs/captions.jsonl --tokens-dir /abs/tokens]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
AI_SERVICE = REPO / "apps/ai-service"
sys.path.insert(0, str(AI_SERVICE))

import soundfile as sf  # noqa: E402
import torch  # noqa: E402
from transformers import AutoProcessor  # noqa: E402

from scripts import phase2_train as t  # noqa: E402


def _skip_samples(model, processor, captions, out_dir) -> float:
    """Stand-in for phase2_train.generate_samples during training: no generation."""
    return 0.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--gen-seed", type=int, default=42)
    known, passthrough = ap.parse_known_args()
    run_dir = t.RUNS_DIR / known.run_id

    t.generate_samples = _skip_samples  # main() resolves this name at call time
    sys.argv = ["phase2_train", "--run-id", known.run_id, *passthrough]
    print(f"[train_run] harness argv: {sys.argv[1:]}", flush=True)

    t0 = time.time()
    t.main()
    train_wall = time.time() - t0

    # ---- one final sample: final weights, batch 1, CFG 3.0, 10 s -------------------
    final_ckpt = run_dir / f"ckpt_step_{t.HP['total_steps']:04d}"
    processor = AutoProcessor.from_pretrained(t.HP["model"])
    model = t.build_model(str(final_ckpt))
    model.eval()
    caption = (run_dir / "sample_captions.txt").read_text().splitlines()[0]
    torch.manual_seed(known.gen_seed)
    inputs = processor(text=[caption], padding=True, return_tensors="pt").to(t.DEVICE)
    tg = time.time()
    with torch.no_grad():
        audio = model.generate(
            **inputs, do_sample=True, guidance_scale=3.0,
            max_new_tokens=t.HP["sample_seconds"] * 50,
        )
    gen_s = time.time() - tg
    sr = model.config.audio_encoder.sampling_rate
    out = run_dir / "samples" / f"final_step{t.HP['total_steps']}_batch1_cfg3.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(out, audio[0].cpu().numpy().squeeze(), sr, subtype="PCM_16")
    out.with_suffix(".txt").write_text(caption + "\n")
    if t.DEVICE == "mps":
        torch.mps.empty_cache()

    summary = {
        "run_id": known.run_id,
        "train_wall_s": round(train_wall),
        "final_ckpt": str(final_ckpt),
        "sample_wav": str(out),
        "sample_caption": caption,
        "sample_gen_s": round(gen_s, 1),
        "sample_batch": 1,
        "guidance_scale": 3.0,
    }
    (run_dir / "train_run_summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2), flush=True)
    print("TRAIN_RUN_DONE", flush=True)


if __name__ == "__main__":
    main()
