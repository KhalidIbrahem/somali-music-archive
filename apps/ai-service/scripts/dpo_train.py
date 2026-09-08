"""Preference optimisation of a LoRA-adapted MusicGen toward clean oud qaraami (Stage 5).

The supervised adapters learn the corpus, tape hiss included; the blind test on
the large adapter preferred it in 11 of 16 pairs and called it noisy in 7. This
script moves the adapter toward what we actually want to hear, without any new
recordings: sample from the current policy, score the samples with a reward that
measures closeness to the real oud collection, hiss, and trackable pentatonic
melody (scripts.reward_model), and train on best-vs-worst pairs with direct
preference optimisation (DPO, Rafailov et al. 2023). The reference policy is the
adapter at the start of each round; its log-probabilities are cached, so one
model is resident. Iterating rounds gives on-policy DPO.

One round, for a policy π (base model + LoRA adapter):
  1. sample K clips for each of P prompts drawn from the oud caption grammar
     (lead instrument, tempo word and BPM, pentatonic tonic), re-encode each with
     the model's own EnCodec to the 4-codebook tokens the decoder is trained on;
  2. score every clip; per prompt keep (best, worst) when the reward gap clears
     a margin; compute log π_ref for both under the frozen start-of-round adapter;
  3. train the adapter on
        L = -log σ( β [ (log π(y_w) - log π_ref(y_w)) - (log π(y_l) - log π_ref(y_l)) ] )
     where log π(y) is the sum of token log-probabilities over the 4 codebooks
     and the delayed positions, exactly the quantities the SFT loss averages;
  4. evaluate on held-out prompts: reward terms, MERT-FAD to the real oud test
     clips, PCS and voiced fraction, held-out oud token CE (a collapse guard),
     and an A/B set start-of-round vs end-of-round with identical seeds for the
     blind listening test (data/ab_dpo_<tag>/, pairNNN_base = before,
     pairNNN_adapter = after).

Usage (from apps/ai-service):
  python -m scripts.dpo_train --model facebook/musicgen-medium \
      --adapter ../../runs/qaraami_medium_r32/ckpt_step_2750 --tag medium
  python -m scripts.dpo_train --model facebook/musicgen-small \
      --adapter ../../runs/oud_lora_r16_nodrop_20260809/ckpt_step_0500 --tag smoke --smoke
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import random
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torch.nn.functional as F
from peft import PeftModel
from transformers import AutoProcessor, MusicgenForConditionalGeneration, get_cosine_schedule_with_warmup

from scripts.pentatonic import PC_NAMES
from scripts.scale_train import BOS, DEVICE, delayed_labels, git_commit, load_split, mps_mem_gb, token_path, zero_functional_dropout

REPO = Path(__file__).resolve().parents[3]
RUNS_DIR = REPO / "runs"
DATA = REPO / "data"

LEADS = ["the oud (kaban)", "the oud (kaban) and hand drums"]
BPMS = [84, 92, 100, 108, 116, 121, 128, 136, 144, 150]
ERA = "intimate oud recording"


# ------------------------------------------------------------------ prompts

def tempo_word(bpm: int) -> str:
    return "slow" if bpm < 80 else ("moderate" if bpm <= 120 else "lively")


def prompt_bank() -> list[str]:
    return [f"qaraami, Somali traditional song, led by {lead}, {tempo_word(b)} at {b} BPM, "
            f"pentatonic melody rooted on {t}, {ERA}"
            for lead in LEADS for b in BPMS for t in PC_NAMES]


def split_prompts(n_eval: int, seed: int = 7) -> tuple[list[str], list[str]]:
    bank = prompt_bank()
    rng = random.Random(seed)
    ev = set(rng.sample(bank, n_eval))
    return [p for p in bank if p not in ev], sorted(ev)


# -------------------------------------------------------------------- model

def load_policy(model_name: str, adapter: Path, trainable: bool) -> PeftModel:
    model = MusicgenForConditionalGeneration.from_pretrained(model_name, dtype=torch.float32)
    model.config.decoder.decoder_start_token_id = BOS
    if trainable:
        model.decoder.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model = PeftModel.from_pretrained(model, str(adapter), is_trainable=trainable)
    n = zero_functional_dropout(model)
    # DPO compares log-probs under the policy and under the frozen reference, so the
    # two forward passes must be the same function of the weights: every module
    # dropout (T5 text encoder, LoRA dropout) is zeroed too. train() then differs
    # from eval() only in that gradient checkpointing is active.
    for mod in model.modules():
        if isinstance(mod, torch.nn.Dropout):
            mod.p = 0.0
    model.to(DEVICE)
    trainable_n = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"policy={model_name} adapter={adapter} functional_dropout_zeroed={n} trainable={trainable_n/1e6:.2f}M device={DEVICE}", flush=True)
    return model


@torch.no_grad()
def sample_policy(model, processor, prompt: str, k: int, seconds: int, seed: int, out_dir: Path, stem: str) -> list[tuple[Path, Path]]:
    """K samples of one prompt in a single batched call; wav + EnCodec tokens per sample."""
    model.eval()
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(seed)
    inputs = processor(text=[prompt] * k, padding=True, return_tensors="pt").to(DEVICE)
    audio = model.generate(**inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=int(seconds * 50))
    codes = model.audio_encoder.encode(audio, bandwidth=2.2).audio_codes[0]   # (k, 4, T)
    sr = model.config.audio_encoder.sampling_rate
    out = []
    for j in range(k):
        wav = out_dir / f"{stem}_{j}.wav"
        npy = out_dir / f"{stem}_{j}.npy"
        sf.write(wav, audio[j].cpu().numpy().squeeze(), sr, subtype="PCM_16")
        np.save(npy, codes[j].cpu().numpy().astype(np.int16))
        out.append((wav, npy))
    if DEVICE == "mps":
        torch.mps.empty_cache()
    return out


def seq_logp(model, tok, prompt: str, npy: Path) -> tuple[torch.Tensor, int, torch.Tensor]:
    """Sum of token log-probabilities of a clip's tokens under the model, plus the count
    and the model's own mean CE (for the consistency check: mean logp == -loss)."""
    labels = delayed_labels(npy)[None].to(DEVICE)
    text = tok(prompt, return_tensors="pt").to(DEVICE)
    out = model(input_ids=text["input_ids"], attention_mask=text["attention_mask"], labels=labels)
    logits = out.logits[:, -labels.shape[1]:]                    # (K, T, V), batch of one
    lp = F.log_softmax(logits.float(), dim=-1)
    lab = labels[0].transpose(0, 1)                               # (K, T)
    mask = lab != -100
    g = lp.gather(-1, lab.clamp(min=0)[..., None]).squeeze(-1)
    return (g * mask).sum(), int(mask.sum()), out.loss.detach()


@torch.no_grad()
def token_ce(model, tok, rows: list[dict], tokens_dir: Path) -> float:
    model.eval()
    vals = []
    for r in rows:
        labels = delayed_labels(token_path(tokens_dir, r))[None].to(DEVICE)
        text = tok(r["caption"], return_tensors="pt").to(DEVICE)
        vals.append(model(input_ids=text["input_ids"], attention_mask=text["attention_mask"], labels=labels).loss.item())
    if DEVICE == "mps":
        torch.mps.empty_cache()
    return float(np.mean(vals))


# ------------------------------------------------------------------- reward

def score_pool(wavs: list[Path], reward: str, weights: dict | None) -> tuple[list[dict], np.ndarray | None, object]:
    if reward == "full":
        from scripts.reward_model import Reference, composite, score_clips
        ref = Reference.load()
        terms, embs = score_clips(wavs, ref, DEVICE, return_embs=True)
        composite(terms, weights=weights)
        return terms, embs, ref
    # pipeline smoke without MERT: pentatonic melody only
    from scripts.scale_eval import score_clip
    terms = []
    for w in wavs:
        s = score_clip(w)
        vf = s.get("voiced_fraction") or 0.0
        pcs = s.get("pcs") or 0.0
        s["reward"] = pcs * min(vf, 0.6) / 0.6 - (2.0 if vf < 0.15 else 0.0)
        terms.append(s)
    return terms, None, None


def fad_or_none(embs, ref) -> float | None:
    if embs is None or ref is None:
        return None
    from scripts.reward_model import fad_to_ref
    return float(fad_to_ref(embs, ref))


# ---------------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--adapter", required=True, help="SFT LoRA checkpoint to start from")
    ap.add_argument("--tag", required=True)
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--reward", choices=["full", "simple"], default="full")
    ap.add_argument("--rounds", type=int, default=1)
    ap.add_argument("--prompts-per-round", type=int, default=96)
    ap.add_argument("--samples-per-prompt", type=int, default=4)
    ap.add_argument("--seconds", type=int, default=15)
    ap.add_argument("--margin", type=float, default=0.5, help="min reward gap (z units) for a pair")
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--beta", type=float, default=0.1)
    ap.add_argument("--lr", type=float, default=1e-5)
    ap.add_argument("--pairs-per-step", type=int, default=4)
    ap.add_argument("--warmup", type=int, default=10)
    ap.add_argument("--logp-norm", choices=["sum", "mean"], default="sum")
    ap.add_argument("--eval-prompts", type=int, default=32)
    ap.add_argument("--ce-clips", type=int, default=64, help="held-out oud clips for the token-CE guard")
    ap.add_argument("--captions", default=str(DATA / "scale_captions.jsonl"))
    ap.add_argument("--tokens-dir", default=str(DATA / "scale_tokens"))
    ap.add_argument("--mem-cap-gb", type=float, default=85.0)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()

    if args.smoke:
        args.prompts_per_round, args.samples_per_prompt, args.seconds = 2, 2, 5
        args.epochs, args.eval_prompts, args.ce_clips, args.margin = 1, 2, 4, 0.0
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)

    run_id = args.run_id or f"dpo_{args.tag}"
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    adapter = Path(args.adapter)
    if not adapter.is_absolute():
        adapter = (Path.cwd() / adapter).resolve()
    train_prompts, eval_prompts = split_prompts(args.eval_prompts)
    (run_dir / "config.json").write_text(json.dumps(vars(args) | {
        "adapter": str(adapter), "git_commit": git_commit(), "device": DEVICE,
        "prompt_bank": len(prompt_bank()), "train_prompts": len(train_prompts), "eval_prompts": len(eval_prompts)}, indent=2))
    (run_dir / "prompts.json").write_text(json.dumps({"train": train_prompts, "eval": eval_prompts}, indent=2))

    processor = AutoProcessor.from_pretrained(args.model)
    tok = processor.tokenizer
    model = load_policy(args.model, adapter, trainable=True)

    # held-out oud clips for the token-CE guard (test split, unseen songs)
    tokens_dir = Path(args.tokens_dir)
    test_rows = [r for r in load_split(Path(args.captions), "test") if r.get("source") == "oud_ilkacase"]
    stride = max(1, len(test_rows) // args.ce_clips)
    ce_rows = sorted(test_rows, key=lambda r: r["clip_path"])[::stride][: args.ce_clips]

    ab_dir = DATA / f"ab_dpo_{args.tag}"
    ab_dir.mkdir(parents=True, exist_ok=True)
    (ab_dir / "CAPTIONS.txt").write_text("".join(f"pair{i:03d}: {c}\n" for i, c in enumerate(eval_prompts)))
    (ab_dir / "README.txt").write_text("pairNNN_base = adapter before preference optimisation (SFT), pairNNN_adapter = after; same prompt and seed.\n")

    for rnd in range(1, args.rounds + 1):
        rdir = run_dir / f"round_{rnd}"
        rdir.mkdir(exist_ok=True)
        t_round = time.time()
        rng = random.Random(args.seed + rnd)
        prompts = rng.sample(train_prompts, min(args.prompts_per_round, len(train_prompts)))

        # -- 0. start-of-round eval material: A/B "base" side + CE guard
        if rnd == 1:
            print(f"[round {rnd}] start-of-round eval: {len(eval_prompts)} prompts + CE on {len(ce_rows)} held-out oud clips", flush=True)
            ce_before = token_ce(model, tok, ce_rows, tokens_dir)
            before_wavs = []
            for i, p in enumerate(eval_prompts):
                (w, _), = sample_policy(model, processor, p, 1, args.seconds, 1000 + i, ab_dir, f"pair{i:03d}_tmp")
                dst = ab_dir / f"pair{i:03d}_base.wav"
                w.replace(dst)
                (ab_dir / f"pair{i:03d}_tmp_0.npy").unlink(missing_ok=True)
                before_wavs.append(dst)
        else:
            ce_before = prev_ce_after  # noqa: F821  (set at the end of the previous round)
            before_wavs = [ab_dir / f"pair{i:03d}_adapter.wav" for i in range(len(eval_prompts))]

        # -- 1. sample the policy
        sdir = rdir / "samples"
        t0 = time.time()
        samples: list[dict] = []
        for pi, p in enumerate(prompts):
            outs = sample_policy(model, processor, p, args.samples_per_prompt, args.seconds, args.seed * 1000 + rnd * 100000 + pi, sdir, f"p{pi:03d}")
            for j, (w, n) in enumerate(outs):
                samples.append({"prompt_index": pi, "prompt": p, "k": j, "wav": str(w), "npy": str(n)})
            if (pi + 1) % 8 == 0 or pi + 1 == len(prompts):
                el = time.time() - t0
                print(f"[round {rnd}] sampled {pi+1}/{len(prompts)} prompts x{args.samples_per_prompt} in {el/60:.1f} min ({el/(pi+1):.1f} s/prompt)", flush=True)
        gen_s = time.time() - t0

        # -- 2. score, pair, reference log-probs
        t0 = time.time()
        terms, embs, ref = score_pool([Path(s["wav"]) for s in samples], args.reward, None)
        for s, t in zip(samples, terms):
            s.update({k: v for k, v in t.items() if k != "mert"})
        with (rdir / "samples.jsonl").open("w") as fh:
            for s in samples:
                fh.write(json.dumps(s) + "\n")
        pairs = []
        for pi in range(len(prompts)):
            group = [s for s in samples if s["prompt_index"] == pi]
            best = max(group, key=lambda s: s["reward"])
            worst = min(group, key=lambda s: s["reward"])
            if best is not worst and best["reward"] - worst["reward"] >= args.margin:
                pairs.append({"prompt": best["prompt"], "chosen": best, "rejected": worst,
                              "gap": round(best["reward"] - worst["reward"], 4)})
        print(f"[round {rnd}] scored {len(samples)} clips in {(time.time()-t0)/60:.1f} min; {len(pairs)}/{len(prompts)} prompts give a pair (margin {args.margin})", flush=True)
        if not pairs:
            print("no pairs above the margin; stopping", flush=True)
            break
        model.eval()
        with torch.no_grad():
            for pr in pairs:
                lc, nc, loss_c = seq_logp(model, tok, pr["prompt"], Path(pr["chosen"]["npy"]))
                lr_, nr, _ = seq_logp(model, tok, pr["prompt"], Path(pr["rejected"]["npy"]))
                pr["ref_chosen"], pr["n_chosen"] = lc.item(), nc
                pr["ref_rejected"], pr["n_rejected"] = lr_.item(), nr
                if rnd == 1 and pr is pairs[0]:
                    gap = abs(lc.item() / nc + loss_c.item())
                    assert gap < 1e-3, f"logp/loss mismatch {gap}"
                    print(f"[check] mean token logp {lc.item()/nc:.4f} == -loss {-loss_c.item():.4f}", flush=True)
        if DEVICE == "mps":
            torch.mps.empty_cache()
        (rdir / "pairs.json").write_text(json.dumps(pairs, indent=1))

        # -- 3. DPO
        model.train()
        params = [p for p in model.parameters() if p.requires_grad]
        opt = torch.optim.AdamW(params, lr=args.lr, weight_decay=0.0)
        n_steps = math.ceil(len(pairs) / args.pairs_per_step) * args.epochs
        sched = get_cosine_schedule_with_warmup(opt, min(args.warmup, n_steps), n_steps)
        log = open(rdir / "train_log.csv", "w", newline="")
        wr = csv.writer(log)
        wr.writerow(["step", "epoch", "loss", "margin", "acc", "chosen_logratio", "rejected_logratio", "lr", "sec", "mps_driver_gb"])
        step = 0
        t0 = time.time()
        for ep in range(1, args.epochs + 1):
            order = list(range(len(pairs)))
            random.Random(args.seed + rnd * 10 + ep).shuffle(order)
            for b in range(0, len(order), args.pairs_per_step):
                ts = time.time()
                batch = [pairs[i] for i in order[b:b + args.pairs_per_step]]
                opt.zero_grad(set_to_none=True)
                acc_loss, margins, accs, crs, rrs = 0.0, [], [], [], []
                for pr in batch:
                    lc, nc, _ = seq_logp(model, tok, pr["prompt"], Path(pr["chosen"]["npy"]))
                    lr_, nr, _ = seq_logp(model, tok, pr["prompt"], Path(pr["rejected"]["npy"]))
                    if args.logp_norm == "mean":
                        cr = lc / nc - pr["ref_chosen"] / nc
                        rr = lr_ / nr - pr["ref_rejected"] / nr
                    else:
                        cr = lc - pr["ref_chosen"]
                        rr = lr_ - pr["ref_rejected"]
                    margin = args.beta * (cr - rr)
                    loss = -F.logsigmoid(margin) / len(batch)
                    loss.backward()
                    acc_loss += loss.item()
                    margins.append(margin.item()); accs.append(float(margin.item() > 0))
                    crs.append(cr.item()); rrs.append(rr.item())
                torch.nn.utils.clip_grad_norm_(params, 1.0)
                opt.step()
                sched.step()
                step += 1
                cur, drv = mps_mem_gb()
                wr.writerow([step, ep, round(acc_loss, 4), round(float(np.mean(margins)), 4), round(float(np.mean(accs)), 3),
                             round(float(np.mean(crs)), 3), round(float(np.mean(rrs)), 3), f"{sched.get_last_lr()[0]:.2e}",
                             round(time.time() - ts, 1), round(drv, 2)])
                log.flush()
                if step % 5 == 0 or step == 1 or step == n_steps:
                    print(f"[round {rnd}] step {step}/{n_steps} loss={acc_loss:.4f} margin={np.mean(margins):+.3f} acc={np.mean(accs):.2f} "
                          f"logratio chosen={np.mean(crs):+.2f} rejected={np.mean(rrs):+.2f} {time.time()-ts:.1f}s mps={drv:.1f}GB", flush=True)
                if drv > args.mem_cap_gb:
                    print(f"MEM_CAP_EXCEEDED driver={drv:.1f}GB > cap {args.mem_cap_gb}GB; aborting at step {step}", flush=True)
                    sys.exit(3)
                if DEVICE == "mps":
                    torch.mps.empty_cache()
        log.close()
        train_s = time.time() - t0
        model.save_pretrained(rdir / "adapter")
        print(f"[round {rnd}] DPO {n_steps} steps in {train_s/60:.1f} min; adapter saved", flush=True)

        # -- 4. eval: after-side of the A/B, terms on both sides, FAD, CE guard
        t0 = time.time()
        after_wavs = []
        for i, p in enumerate(eval_prompts):
            (w, _), = sample_policy(model, processor, p, 1, args.seconds, 1000 + i, ab_dir, f"pair{i:03d}_tmp")
            dst = ab_dir / f"pair{i:03d}_adapter.wav"
            w.replace(dst)
            (ab_dir / f"pair{i:03d}_tmp_0.npy").unlink(missing_ok=True)
            after_wavs.append(dst)
        ce_after = token_ce(model, tok, ce_rows, tokens_dir)
        pool = before_wavs + after_wavs
        pterms, pembs, pref = score_pool(pool, args.reward, None)
        nb = len(before_wavs)
        bt, at = pterms[:nb], pterms[nb:]

        def mean_of(ts, key):
            v = [t[key] for t in ts if t.get(key) is not None]
            return round(float(np.mean(v)), 4) if v else None
        keys = [k for k in ("reward", "oud_dist", "oud_sim", "noise_floor_db", "quiet_flatness", "hf_ratio", "pcs", "voiced_fraction") if any(k in t for t in pterms)]
        summary = {
            "round": rnd, "prompts": len(prompts), "samples": len(samples), "pairs": len(pairs),
            "gen_minutes": round(gen_s / 60, 1), "train_minutes": round(train_s / 60, 1), "steps": n_steps,
            "held_out_oud_token_ce": {"before": round(ce_before, 4), "after": round(ce_after, 4), "clips": len(ce_rows)},
            "before": {k: mean_of(bt, k) for k in keys}, "after": {k: mean_of(at, k) for k in keys},
            "fad_to_real_oud_test": {"before": fad_or_none(pembs[:nb] if pembs is not None else None, pref),
                                     "after": fad_or_none(pembs[nb:] if pembs is not None else None, pref)},
            "ab_dir": str(ab_dir), "eval_minutes": round((time.time() - t0) / 60, 1),
            "round_minutes": round((time.time() - t_round) / 60, 1),
        }
        (run_dir / f"eval_round_{rnd}.json").write_text(json.dumps(summary, indent=2))
        (ab_dir / "ab_scores.json").write_text(json.dumps({
            "note": f"{args.model}: adapter before (base) vs after (adapter) preference optimisation, round {rnd}; same prompts and seeds.",
            "pairs": [{"pair": i, "caption": eval_prompts[i],
                       "base": {"scored": bool(bt[i].get("pcs") is not None), **{k: bt[i].get(k) for k in keys}},
                       "adapter": {"scored": bool(at[i].get("pcs") is not None), **{k: at[i].get(k) for k in keys}}}
                      for i in range(nb)]}, indent=1))
        print(json.dumps(summary, indent=2), flush=True)
        prev_ce_after = ce_after  # noqa: F841
        model.train()

    print("DPO_TRAIN_DONE", flush=True)


if __name__ == "__main__":
    main()
