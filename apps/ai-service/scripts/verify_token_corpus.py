"""Measure what a built token corpus is worth: decode fidelity and re-encoding agreement.

Re-renders a sample of melodies from their seeds, decodes the stored tokens with
EnCodec and compares against the original audio. Writes verify.json beside the shards.

    python -m scripts.verify_token_corpus --shards ../../dist/token_corpus --melodies 40
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np

from scripts import synth_somali_bench as synth
from scripts import synth_token_corpus as tc


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--shards", type=Path, required=True)
    ap.add_argument("--melodies", type=int, default=40)
    ap.add_argument("--seed", type=int, default=tc.BASE_SEED)
    args = ap.parse_args()
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    import librosa
    import torch
    from transformers import EncodecModel

    paths = sorted(args.shards.glob("shard_*.npy"))
    if not paths:
        raise SystemExit("no shards found")
    per_shard = [len(np.load(p, mmap_mode="r")) // len(synth.CONDITIONS) for p in paths]
    total = sum(per_shard)
    picks = np.linspace(0, total - 1, min(args.melodies, total)).astype(int).tolist()
    model = EncodecModel.from_pretrained("facebook/encodec_32khz").eval()
    mel = lambda z: librosa.power_to_db(librosa.feature.melspectrogram(y=z, sr=tc.SR, n_mels=64) + 1e-10).ravel()
    chroma = lambda z: librosa.feature.chroma_cqt(y=z, sr=tc.SR).ravel()
    rows: dict[str, list[tuple[float, float, float]]] = {c: [] for c in synth.CONDITIONS}
    for index in picks:
        shard = index // tc.SHARD_ITEMS
        codes = np.load(paths[shard], mmap_mode="r")
        _, clips = tc.render_item(index, args.seed)
        for j, cond in enumerate(synth.CONDITIONS):
            stored = np.array(codes[(index - shard * tc.SHARD_ITEMS) * len(synth.CONDITIONS) + j])
            with torch.inference_mode():
                decoded = model.decode(torch.from_numpy(stored).long()[None, None], [None]).audio_values[0, 0].numpy()
            original = clips[j][: len(decoded)]
            again = tc.encode_batch(model, "cpu", clips[j][None])[0]
            rows[cond].append((float(np.corrcoef(mel(original), mel(decoded[: len(original)]))[0, 1]),
                               float(np.corrcoef(chroma(original), chroma(decoded[: len(original)]))[0, 1]),
                               float(np.mean(again == stored))))
    result = {"melodies": len(picks), "conditions": {
        c: {"log_mel_corr": round(float(np.mean([r[0] for r in v])), 3),
            "chroma_corr": round(float(np.mean([r[1] for r in v])), 3),
            "reencode_match": round(float(np.mean([r[2] for r in v])), 4)} for c, v in rows.items()}}
    (args.shards / "verify.json").write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
