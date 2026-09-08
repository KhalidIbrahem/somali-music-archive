"""Showcase sets: the best clips a preference-optimised adapter produces.

Two sources, both written as data/ab_showcase_<tag>/ with pairNNN_adapter.wav,
CAPTIONS.txt and ab_scores.json, so ab_listen.py lists them:

  --from-run runs/dpo_<tag>   the top-N samples of a DPO round by composite reward,
                               copied from round_<r>/samples (no generation)
  --generate                  fresh clips from an adapter: for each of N oud prompts
                               draw K samples of S seconds and keep the best by
                               reward (best-of-K at inference; the reward is the
                               same scripts.reward_model composite, z-scored over
                               the K*N pool)

Everything here is model output; the prompts come from the oud caption grammar
in dpo_train.py and carry no performer name.

Usage (from apps/ai-service):
  python -m scripts.showcase --from-run ../../runs/dpo_small_oud --tag small_oud --n 16
  python -m scripts.showcase --generate --model facebook/musicgen-large \
      --adapter ../../runs/dpo_large/round_1/adapter --tag large --n 8 --k 4 --seconds 30
"""
from __future__ import annotations

import argparse
import json
import random
import shutil
from pathlib import Path

from scripts.dpo_train import DATA, DEVICE, load_policy, sample_policy, split_prompts

TERM_KEYS = ("reward", "oud_dist", "oud_sim", "band_snr_db", "hiss_index", "pcs", "voiced_fraction", "loudness_dbfs")


def write_set(tag: str, clips: list[tuple[Path, str, dict]], note: str) -> Path:
    out = DATA / f"ab_showcase_{tag}"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("pair*"):
        old.unlink()
    rows = []
    for i, (src, caption, terms) in enumerate(clips):
        shutil.copy2(src, out / f"pair{i:03d}_adapter.wav")
        rows.append({"pair": i, "caption": caption,
                     "adapter": {k: terms.get(k) for k in TERM_KEYS} | {"scored": terms.get("pcs") is not None}})
    (out / "CAPTIONS.txt").write_text("".join(f"pair{r['pair']:03d}: {r['caption']}\n" for r in rows))
    (out / "README.txt").write_text(note + "\n")
    (out / "ab_scores.json").write_text(json.dumps({"note": note, "pairs": rows}, indent=1))
    return out


def from_run(run: Path, tag: str, n: int, rnd: int) -> Path:
    rows = [json.loads(l) for l in (run / f"round_{rnd}" / "samples.jsonl").open()]
    rows.sort(key=lambda r: -r["reward"])
    picked, seen = [], set()
    for r in rows:                      # at most one clip per prompt, so the set has variety
        if r["prompt_index"] in seen:
            continue
        seen.add(r["prompt_index"])
        picked.append((Path(r["wav"]), r["prompt"], r))
        if len(picked) == n:
            break
    cfg = json.loads((run / "config.json").read_text())
    note = (f"Top {len(picked)} of {len(rows)} samples drawn from {cfg['model']} + {Path(cfg['adapter']).parent.name}/"
            f"{Path(cfg['adapter']).name} during DPO round {rnd}, ranked by the composite reward; one clip per prompt.")
    return write_set(tag, picked, note)


def generate(model_name: str, adapter: Path, tag: str, n: int, k: int, seconds: int, seed: int) -> Path:
    from transformers import AutoProcessor
    from scripts.reward_model import Reference, composite, score_clips

    processor = AutoProcessor.from_pretrained(model_name)
    model = load_policy(model_name, adapter, trainable=False)
    _, eval_prompts = split_prompts(40)
    prompts = random.Random(seed).sample(eval_prompts, n)
    tmp = DATA / f"ab_showcase_{tag}" / "_candidates"
    tmp.mkdir(parents=True, exist_ok=True)
    cands = []
    for i, p in enumerate(prompts):
        for w, npy in sample_policy(model, processor, p, k, seconds, seed * 100 + i, tmp, f"p{i:02d}"):
            npy.unlink(missing_ok=True)
            cands.append((w, p, i))
        print(f"  {i+1}/{n} prompts sampled", flush=True)
    ref = Reference.load()
    terms, _ = score_clips([c[0] for c in cands], ref, DEVICE, return_embs=True)
    composite(terms)
    best: dict[int, tuple] = {}
    for (w, p, i), t in zip(cands, terms):
        if i not in best or t["reward"] > best[i][2]["reward"]:
            best[i] = (w, p, t)
    picked = [best[i] for i in sorted(best)]
    note = (f"{model_name} + {adapter.parent.name}/{adapter.name}: {n} oud prompts, {k} samples of {seconds} s each, "
            f"best of {k} by the composite reward. Candidates kept in _candidates/.")
    return write_set(tag, picked, note)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--from-run")
    ap.add_argument("--round", type=int, default=1)
    ap.add_argument("--generate", action="store_true")
    ap.add_argument("--model")
    ap.add_argument("--adapter")
    ap.add_argument("--n", type=int, default=16)
    ap.add_argument("--k", type=int, default=4)
    ap.add_argument("--seconds", type=int, default=30)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    if args.from_run:
        out = from_run(Path(args.from_run).resolve(), args.tag, args.n, args.round)
    elif args.generate:
        if not (args.model and args.adapter):
            raise SystemExit("--generate needs --model and --adapter")
        out = generate(args.model, Path(args.adapter).resolve(), args.tag, args.n, args.k, args.seconds, args.seed)
    else:
        raise SystemExit("give --from-run or --generate")
    print(f"wrote {out}", flush=True)


if __name__ == "__main__":
    main()
