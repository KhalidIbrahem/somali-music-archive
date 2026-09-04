"""Melody-conditioned qaraami generation with musicgen-melody.

Qaraami identity lives in the melodic line, so this conditions generation on a
REAL held-out qaraami melody (chroma) plus a Somali text prompt, and scores the
output's pentatonic conformity. It demonstrates the melody-conditioned variant
on the base model (no training needed to show the mechanism); a fine-tuned
melody adapter can be dropped in with --adapter once trained.

For each reference oud/qaraami clip it: loads the audio, lets the processor
extract the conditioning chroma, generates with a matching Somali caption, and
writes base-vs-(optional adapter) with PCS + voiced fraction.

Rights: reference clips are the project's own processed clips (already on disk,
never distributed); only generated audio is written. Outputs to data/ab_melody/.

Usage (from apps/ai-service):
  python -m scripts.melody_condition --refs ../../data/oud_clips/test --n 8 \
     --caption "Somali qaraami led by the oud (kaban), moderate at 100 BPM, pentatonic melody rooted on A, intimate recording" \
     [--adapter runs/qaraami_melody_r32/ckpt_step_XXXX]
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from transformers import AutoProcessor, MusicgenMelodyForConditionalGeneration

from scripts.pcs import extract_f0, score_frames
from scripts.scale_train import zero_functional_dropout

REPO = Path(__file__).resolve().parents[3]
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
MODEL = "facebook/musicgen-melody"


def score(path: Path) -> dict:
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    f0, pd = extract_f0(audio, DEVICE, sr=sr)
    res = score_frames(f0, pd)
    if DEVICE == "mps":
        torch.mps.empty_cache()
    return {"pcs": round(res.pcs, 4), "voiced_fraction": round(res.voiced_fraction, 3), "tonic": res.tonic_name} if res else {"scored": False}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refs", required=True, help="dir of reference qaraami clips")
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--caption", default="Somali qaraami led by the oud (kaban), moderate at 100 BPM, pentatonic melody rooted on A, intimate recording")
    ap.add_argument("--adapter", default=None)
    ap.add_argument("--seconds", type=int, default=15)
    ap.add_argument("--out", default="data/ab_melody")
    args = ap.parse_args()
    refs = sorted(Path(args.refs).glob("*.wav"))[:: max(1, len(list(Path(args.refs).glob("*.wav"))) // max(1, args.n))][: args.n]
    out = REPO / args.out
    out.mkdir(parents=True, exist_ok=True)

    processor = AutoProcessor.from_pretrained(MODEL)
    model = MusicgenMelodyForConditionalGeneration.from_pretrained(MODEL, dtype=torch.float32)
    model.config.decoder.decoder_start_token_id = 2048
    if args.adapter:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, args.adapter)
    zero_functional_dropout(model)
    model.to(DEVICE).eval()
    sr_model = model.config.audio_encoder.sampling_rate

    rows = []
    for i, ref in enumerate(refs):
        wav, sr = sf.read(ref, dtype="float32")
        if wav.ndim > 1:
            wav = wav.mean(axis=1)
        inputs = processor(audio=wav, sampling_rate=sr, text=[args.caption], padding=True, return_tensors="pt").to(DEVICE)
        torch.manual_seed(42 + i)
        t0 = time.time()
        with torch.no_grad():
            audio = model.generate(**inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=int(args.seconds * 50))
        gen = out / f"melody{i:03d}_{'adapter' if args.adapter else 'base'}.wav"
        sf.write(gen, audio[0].cpu().numpy().squeeze(), sr_model, subtype="PCM_16")
        if DEVICE == "mps":
            torch.mps.empty_cache()
        s = score(gen)
        rows.append({"i": i, "ref": ref.name, "file": gen.name, "pcs": s.get("pcs"), "voiced_fraction": s.get("voiced_fraction"), "gen_s": round(time.time() - t0, 1)})
        print(f"melody {i+1}/{len(refs)} ref={ref.name} pcs={s.get('pcs')} voiced={s.get('voiced_fraction')}", flush=True)

    pcs = [r["pcs"] for r in rows if r["pcs"] is not None]
    vf = [r["voiced_fraction"] for r in rows if r["voiced_fraction"] is not None]
    summary = {"model": MODEL, "adapter": args.adapter, "n": len(rows), "caption": args.caption,
               "pcs_mean": round(float(np.mean(pcs)), 4) if pcs else None,
               "voiced_fraction_mean": round(float(np.mean(vf)), 3) if vf else None, "clips": rows}
    (out / "melody_condition.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps({k: v for k, v in summary.items() if k != "clips"}, indent=2), flush=True)
    print("MELODY_DONE", flush=True)


if __name__ == "__main__":
    main()
