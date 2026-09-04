"""Harvard-raw A/B listening set (2026-09-03): 8 pairs, base MusicGen-small vs the best
fixed-harness raw checkpoint (runs/harvard_raw/ckpt_step_1500). Mirrors how
data/oud_ab_listening was built (scripts/oud_eval.py stage_gen): a seeded sample of 8 distinct
captions from the Harvard TEST split, 10 s renders, CFG 3.0, 32 kHz PCM_16 — but batch size 1,
and the SAME seed per pair on both sides (torch.manual_seed(42 + i)).

Outputs:
  data/eval_gen/harvard_base/gen_NNN.wav      + captions_index.json  (phase3_pcs_run contract)
  data/eval_gen/harvard_lora1500/gen_NNN.wav  + captions_index.json
  data/harvard_ab_listening/pairNNN_{base,finetuned}.wav + CAPTIONS.txt + README.md

Usage (cwd = apps/ai-service, ~/ai/musicgen-env, HF_HUB_OFFLINE=1): python -u runs/_tools/harvard_ab_gen.py
"""
from __future__ import annotations

import json
import random
import shutil
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "apps/ai-service"))

import soundfile as sf  # noqa: E402
import torch  # noqa: E402
from transformers import AutoProcessor  # noqa: E402

from scripts.phase2_train import DEVICE, build_model, load_split, set_dataset  # noqa: E402

BEST_CKPT = REPO / "runs/harvard_raw/ckpt_step_1500"
GEN_ROOT = REPO / "data/eval_gen"
AB_DIR = REPO / "data/harvard_ab_listening"
N_PAIRS = 8
SECONDS = 10
SEED = 42
GUIDANCE = 3.0


def main() -> None:
    set_dataset(str(REPO / "data/captions.jsonl"), str(REPO / "data/tokens"))
    rows = sorted(load_split("test"), key=lambda r: r["clip_path"])
    unique = sorted({r["caption"] for r in rows})
    captions = random.Random(SEED).sample(unique, N_PAIRS)
    print(f"{len(unique)} distinct test captions; sampled {N_PAIRS}", flush=True)

    processor = AutoProcessor.from_pretrained("facebook/musicgen-small")
    AB_DIR.mkdir(parents=True, exist_ok=True)
    for group, ckpt, side in (("harvard_base", None, "base"),
                              ("harvard_lora1500", BEST_CKPT, "finetuned")):
        out_dir = GEN_ROOT / group
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "captions_index.json").write_text(json.dumps(
            {f"gen_{i:03d}.wav": c for i, c in enumerate(captions)}, indent=2))
        model = build_model(str(ckpt) if ckpt else None)
        model.eval()
        sr = model.config.audio_encoder.sampling_rate
        t0 = time.time()
        for i, cap in enumerate(captions):
            torch.manual_seed(SEED + i)  # identical seed for this pair on both sides
            inputs = processor(text=[cap], padding=True, return_tensors="pt").to(DEVICE)
            with torch.no_grad():
                audio = model.generate(**inputs, do_sample=True, guidance_scale=GUIDANCE,
                                       max_new_tokens=SECONDS * 50)
            wav = audio[0].cpu().numpy().squeeze()
            gen_path = out_dir / f"gen_{i:03d}.wav"
            sf.write(gen_path, wav, sr, subtype="PCM_16")
            shutil.copyfile(gen_path, AB_DIR / f"pair{i:03d}_{side}.wav")
            if DEVICE == "mps":
                torch.mps.empty_cache()
            print(f"  {group} {i + 1}/{N_PAIRS} ({time.time() - t0:.0f}s)", flush=True)
        print(f"{group}: {N_PAIRS} x {SECONDS}s done in {time.time() - t0:.0f}s", flush=True)
        del model
        if DEVICE == "mps":
            torch.mps.empty_cache()

    (AB_DIR / "CAPTIONS.txt").write_text(
        "".join(f"pair{i:03d}: {c}\n" for i, c in enumerate(captions)))
    (AB_DIR / "README.md").write_text(
        "# harvard_ab_listening\n\n8 A/B pairs, 10 s each, 32 kHz PCM_16. `pairNNN_base.wav` = "
        "facebook/musicgen-small; `pairNNN_finetuned.wav` = runs/harvard_raw/ckpt_step_1500 "
        "(fixed-harness LoRA, lr 1e-4, r16, 1500 steps, 2026-09-03). Prompts: CAPTIONS.txt "
        "(seeded sample of 8 distinct Harvard test-split captions, seed 42). Each pair uses the "
        "same seed on both sides (42 + pair index), batch size 1, CFG 3.0. Same wavs live in "
        "data/eval_gen/harvard_base and harvard_lora1500 for PCS scoring. Built by "
        "runs/_tools/harvard_ab_gen.py.\n")
    print("AB_GEN_DONE", flush=True)


if __name__ == "__main__":
    main()
