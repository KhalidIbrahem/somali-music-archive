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

qaraami-v2 (Phase 2 recipe E, the DPO round on the best of runs B/C):
  * --adapter must be a LoRA checkpoint (adapter_config.json). Run A
    (qaraami_medium_full) may be a FULL fine-tune of the decoder; such a
    checkpoint is refused with a clear message before any model loads: DPO here
    is defined for a LoRA policy over a frozen base (the reference policy is the
    start-of-round adapter, and the served engines switch adapters on one base).
  * captions rows may carry their own "tokens_dir" (repo-relative, the Phase 1
    sets and every build_sets --merge file do); scale_train.token_path resolves
    them, so --tokens-dir is only a fallback for rows without one (the legacy
    data/scale_captions.jsonl still pairs with data/scale_tokens by default).
    The token-CE guard and the SFT anchor take the isolated-OUD rows of the
    captions (content "oud", a *_oud set, or the legacy oud_ilkacase source).
  * --prompts-from <captions.jsonl> builds the prompt bank from the DISTINCT
    test captions of consented rows (rights ahmed_ilkacase_consented,
    internet_cc, contrib_*_consented; never harvard_* or contrib_*_research_only
    rows: the A/B clips a prompt produces are heard by others), falling back to
    the oud caption grammar (prompt_bank()) when the file yields none.
  * 256 candidates per round is the default budget: 64 prompts x 4 samples at
    15 s. 256 samples PER PROMPT would be 16,384 clips a round, about a week of
    generation on this GPU, so the per-round figure is the recorded default
    (config.json / summary.json "candidates_per_round").
  * runs/dpo_<tag>/summary.json is written after every round (and marked
    "complete": true at the end) with the reward terms before/after, the FAD to
    the real oud test clips, the token-CE collapse guard, the A/B dir and the
    final adapter path, so scripts.register_adapter can register the adapter
    from it; runs/dpo_<tag>/ckpt_step_NNNN (NNNN = cumulative DPO steps) is a
    symlink to round_N/adapter so scale_eval --run runs/dpo_<tag> finds it.
    "complete" is only ever true when at least one round produced an adapter:
    a run whose first round yields no pair above the margin writes
    {"complete": false, "stopped": "round 1: no pairs above the margin ..."}
    and exits 2 (DPO_TRAIN_FAILED), so an orchestrator never treats it as done.
    A later round without pairs ends the run normally (the earlier adapter
    stands; "stopped" names the round).
  * config.json / summary.json also record the policy's LoRA recipe read from
    the start adapter's adapter_config.json (rank, alpha, targets), the SFT run
    it came from (sft_run, sft_lr, sft_total_steps, sft_model) and
    "stage": "dpo", so a model card can state the adapter recipe and the DPO
    learning rate is never mistaken for the SFT one.
  * The listening set data/ab_dpo_<tag>/ is dpo_train's own (before vs after,
    at --seconds). An evaluator that writes data/ab_<eval tag>/ must use an eval
    tag other than dpo_<tag> (the orchestrator uses dpo_<tag>_vs_base) or it
    overwrites these pairs with base-model-vs-adapter clips of another length.

Usage (from apps/ai-service):
  python -m scripts.dpo_train --model facebook/musicgen-medium \
      --adapter ../../runs/qaraami_medium_r32/ckpt_step_2750 --tag medium
  python -m scripts.dpo_train --model facebook/musicgen-large \
      --adapter ../../runs/qaraami_large/ckpt_step_4000 --tag v2_qaraami_large \
      --captions ../../data/sets/run_qaraami_large_captions.jsonl \
      --prompts-from ../../data/sets/run_qaraami_large_captions.jsonl \
      --prompts-per-round 64 --samples-per-prompt 4 --seconds 15 --rounds 1
  python -m scripts.dpo_train --model facebook/musicgen-small \
      --adapter ../../runs/oud_lora_r16_nodrop_20260809/ckpt_step_0500 --tag smoke --smoke
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torch.nn.functional as F
from peft import PeftModel
from transformers import (
    AutoProcessor,
    MusicgenForConditionalGeneration,
    get_cosine_schedule_with_warmup,
)

from scripts import scale_train
from scripts.pentatonic import PC_NAMES
from scripts.scale_train import (
    BOS,
    DEVICE,
    delayed_labels,
    git_commit,
    load_split,
    mps_mem_gb,
    token_path,
    zero_functional_dropout,
)

REPO = Path(__file__).resolve().parents[3]
RUNS_DIR = REPO / "runs"
DATA = REPO / "data"

LEADS = ["the oud (kaban)", "the oud (kaban) and hand drums"]
BPMS = [84, 92, 100, 108, 116, 121, 128, 136, 144, 150]
ERA = "intimate oud recording"

# rights whose captions may become generation prompts (the A/B sets are heard by others)
CONSENTED_RIGHTS = {"ahmed_ilkacase_consented", "internet_cc"}
LEGACY_OUD_SOURCE = "oud_ilkacase"          # the pre-Phase-1 scale captions' isolated-oud source
LEGACY_CAPTIONS = DATA / "scale_captions.jsonl"
LEGACY_TOKENS = DATA / "scale_tokens"       # pairs with LEGACY_CAPTIONS, whose rows carry no tokens_dir
CANDIDATES_NOTE = ("256 candidates per ROUND (prompts x samples); 256 per prompt would be ~16k clips a round, "
                   "infeasible on this GPU, so the per-round budget is the recorded default")
FULL_DECODER_MARKERS = ("decoder.safetensors", "model.safetensors", "pytorch_model.bin", "full_decoder.json",
                        "model.safetensors.index.json")


# ------------------------------------------------------------------ prompts

def tempo_word(bpm: int) -> str:
    return "slow" if bpm < 80 else ("moderate" if bpm <= 120 else "lively")


def prompt_bank() -> list[str]:
    return [f"qaraami, Somali traditional song, led by {lead}, {tempo_word(b)} at {b} BPM, "
            f"pentatonic melody rooted on {t}, {ERA}"
            for lead in LEADS for b in BPMS for t in PC_NAMES]


def is_consented(rights: str | None) -> bool:
    """Rights under which a caption may be used as a generation prompt: Ahmed's
    consent, CC internet audio, a contributor's consented tier. Research-only
    rows (harvard_*, contrib_*_research_only) and rows without rights are not."""
    if not rights:
        return False
    return rights in CONSENTED_RIGHTS or (rights.startswith("contrib_") and rights.endswith("_consented"))


def is_oud_row(row: dict) -> bool:
    """An isolated-oud row: Phase 1 content "oud" or a *_oud set, or the legacy oud_ilkacase source."""
    src = str(row.get("source") or "")
    return row.get("content") == "oud" or src.endswith("_oud") or src == LEGACY_OUD_SOURCE


def prompts_from_captions(path: Path, split: str = "test") -> list[str]:
    """The distinct captions of the consented rows of one split, sorted (a stable
    bank the seeded eval/train split is drawn from). Empty when no row qualifies."""
    rows = load_split(path, split)
    return sorted({r["caption"] for r in rows if is_consented(r.get("rights"))})


def build_prompt_bank(prompts_from: Path | None) -> tuple[list[str], str]:
    """(bank, source): the consented test captions of --prompts-from when it yields
    any, else the oud caption grammar. The source string is recorded in config.json."""
    if prompts_from is not None:
        if not prompts_from.exists():
            raise SystemExit(f"--prompts-from {prompts_from}: file not found")
        caps = prompts_from_captions(prompts_from)
        if caps:
            return caps, f"captions:{prompts_from}"
        print(f"--prompts-from {prompts_from}: no consented test caption; falling back to the oud caption grammar", flush=True)
    return prompt_bank(), "grammar"


def split_prompts(n_eval: int, seed: int = 7, bank: list[str] | None = None) -> tuple[list[str], list[str]]:
    """Seeded disjoint (train, eval) prompt lists from the bank (default: the
    grammar). The eval side is clipped so at least half the bank stays for
    training; a bank of one prompt trains and evaluates on it."""
    bank = list(prompt_bank() if bank is None else bank)
    n_eval = max(1, min(n_eval, len(bank) // 2)) if len(bank) > 1 else 0
    rng = random.Random(seed)
    ev = set(rng.sample(bank, n_eval))
    train = [p for p in bank if p not in ev] or list(bank)
    return train, sorted(ev) or list(bank)


# ------------------------------------------------------------- checkpoints

def adapter_kind(path: Path) -> str:
    """"lora" (adapter_config.json), "full" (decoder weights, no adapter config) or
    "missing". scale_train.ckpt_kind decides when the harness has it (its
    full-decoder checkpoints hold decoder.safetensors); the marker list covers
    other full-weight layouts."""
    if not path.is_dir():
        return "missing"
    theirs = getattr(scale_train, "ckpt_kind", None)
    if theirs is not None:
        kind = theirs(path)
        if kind == "full_decoder":
            return "full"
        if kind == "lora":
            return "lora"
    if (path / "adapter_config.json").exists():
        return "lora"
    if any((path / m).exists() for m in FULL_DECODER_MARKERS) or any(path.glob("*.safetensors")):
        return "full"
    return "missing"


def require_lora_adapter(path: Path) -> Path:
    """DPO here optimises a LoRA policy over a frozen base; a full-decoder
    checkpoint (run A, qaraami_medium_full) is refused before any model loads."""
    kind = adapter_kind(path)
    if kind == "lora":
        return path
    if kind == "full":
        found = sorted(m for m in FULL_DECODER_MARKERS if (path / m).exists()) or [p.name for p in sorted(path.glob("*.safetensors"))] or ["decoder weights"]
        raise SystemExit(f"--adapter {path} is a FULL-DECODER checkpoint (no adapter_config.json; found {', '.join(found)}). "
                         "DPO runs on the LoRA policies (runs B/C, e.g. runs/qaraami_large/ckpt_step_NNNN): the reference "
                         "policy is the start-of-round adapter over the frozen base, and the service swaps adapters on one base.")
    raise SystemExit(f"--adapter {path}: no checkpoint there (adapter_config.json missing, no weights)")


def policy_recipe(adapter: Path) -> dict:
    """{rank, alpha, targets} of the LoRA policy from the adapter's
    adapter_config.json (PEFT keys r, lora_alpha, target_modules); values None
    when the file is missing or unreadable, so a model card can still be built."""
    cfg_path = adapter / "adapter_config.json"
    try:
        cfg = json.loads(cfg_path.read_text()) if cfg_path.exists() else {}
    except (OSError, ValueError):
        cfg = {}
    targets = cfg.get("target_modules")
    return {"rank": cfg.get("r"), "alpha": cfg.get("lora_alpha"),
            "targets": sorted(str(t) for t in targets) if isinstance(targets, list | tuple | set) else targets}


def sft_parent(adapter: Path, repo: Path | None = None) -> dict:
    """The SFT run the start adapter belongs to (runs/<run>/ckpt_step_NNNN ->
    runs/<run>/config.json): {sft_run (repo-relative when under the repo, REPO
    by default), sft_lr, sft_total_steps, sft_model}; every value None without
    a config."""
    repo = REPO if repo is None else repo
    run_dir = adapter.parent
    cfg_path = run_dir / "config.json"
    try:
        cfg = json.loads(cfg_path.read_text()) if cfg_path.exists() else {}
    except (OSError, ValueError):
        cfg = {}
    if not cfg:
        return {"sft_run": None, "sft_lr": None, "sft_total_steps": None, "sft_model": None}
    try:
        run = str(run_dir.resolve().relative_to(repo.resolve()))
    except ValueError:
        run = str(run_dir.resolve())
    return {"sft_run": run, "sft_lr": cfg.get("lr"), "sft_total_steps": cfg.get("total_steps"), "sft_model": cfg.get("model")}


def alias_checkpoint(run_dir: Path, adapter_dir: Path, step: int) -> Path:
    """runs/dpo_<tag>/ckpt_step_NNNN -> round_N/adapter (relative symlink, replaced
    when it exists) so scale_eval's find_best_ckpt / require_adapter see the DPO
    adapter through the same layout as the SFT runs."""
    alias = run_dir / f"ckpt_step_{step:04d}"
    if alias.is_symlink() or alias.exists():
        if alias.is_dir() and not alias.is_symlink():
            return alias  # a real directory of that name is left alone
        alias.unlink()
    alias.symlink_to(Path(os.path.relpath(adapter_dir, run_dir)), target_is_directory=True)
    return alias


# ------------------------------------------------------------ token rows

def resolve_tokens_dir(captions: Path, cli_tokens_dir: str | None, rows: list[dict]) -> Path | None:
    """The CLI fallback dir for rows without their own tokens_dir: the given one;
    None when every row carries tokens_dir; the legacy data/scale_tokens for the
    legacy captions; otherwise the rows cannot be trained on, so refuse early."""
    if cli_tokens_dir:
        return Path(cli_tokens_dir)
    if rows and all(r.get("tokens_dir") for r in rows):
        return None
    if captions.resolve() == LEGACY_CAPTIONS.resolve():
        return LEGACY_TOKENS
    missing = sum(1 for r in rows if not r.get("tokens_dir"))
    raise SystemExit(f"{captions}: {missing} rows carry no tokens_dir and --tokens-dir was not given")


def guard_rows(rows: list[dict], n: int) -> list[dict]:
    """The held-out oud rows for the token-CE collapse guard: isolated-oud rows of
    the given (test) rows, sorted by clip path and strided down to n."""
    oud = sorted((r for r in rows if is_oud_row(r)), key=lambda r: r["clip_path"])
    if not oud or n <= 0:
        return []
    stride = max(1, len(oud) // n)
    return oud[::stride][:n]


def check_tokens(rows: list[dict], tokens_dir: Path | None) -> None:
    """Every row's token file must exist before a model is loaded."""
    missing = []
    for r in rows:
        try:
            p = token_path(tokens_dir, r)
        except ValueError as exc:
            raise SystemExit(str(exc)) from exc
        if not p.exists():
            missing.append(str(p))
    if missing:
        raise SystemExit(f"{len(missing)} token files missing (run scripts.scale_tokens for the set), e.g. {missing[0]}")


# ---------------------------------------------------------------- summary

def ce_guard(before: float | None, after: float | None, tolerance: float = 0.05) -> dict:
    """Held-out oud token CE must not rise by more than `tolerance` nats: the
    collapse guard the orchestrator and register_adapter read."""
    if before is None or after is None:
        return {"before": before, "after": after, "delta": None, "tolerance": tolerance, "passed": None}
    delta = round(after - before, 4)
    return {"before": before, "after": after, "delta": delta, "tolerance": tolerance, "passed": delta <= tolerance}


def write_summary(run_dir: Path, meta: dict, rounds: list[dict], complete: bool, tolerance: float = 0.05,
                  stopped: str | None = None) -> dict:
    """runs/dpo_<tag>/summary.json: what register_adapter needs. Reward terms of the
    first round's start and the last round's end, FAD to the real oud test clips,
    the CE guard, the A/B dir, the final adapter and its ckpt alias, "complete"
    (false while rounds are still to come, and NEVER true without a round that
    saved an adapter, whatever the caller says: an orchestrator reads it as the
    done marker) and "stopped" (why the run ended before its rounds, or None)."""
    first, last = (rounds[0], rounds[-1]) if rounds else ({}, {})
    ce_first = first.get("held_out_oud_token_ce") or {}
    ce_last = last.get("held_out_oud_token_ce") or {}
    fad_first = first.get("fad_to_real_oud_test") or {}
    fad_last = last.get("fad_to_real_oud_test") or {}
    summary = {
        **meta,
        "rounds_done": len(rounds),
        "complete": bool(complete and rounds and last.get("adapter")),
        "stopped": stopped,
        "before": first.get("before"),
        "after": last.get("after"),
        "fad_to_real_oud_test": {"before": fad_first.get("before"), "after": fad_last.get("after")},
        "held_out_oud_token_ce": ce_guard(ce_first.get("before"), ce_last.get("after"), tolerance) | {"clips": ce_last.get("clips")},
        "ab_dir": last.get("ab_dir") or meta.get("ab_dir"),
        "adapter": last.get("adapter"),
        "ckpt_alias": last.get("ckpt_alias"),
        "rounds": rounds,
        "written_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    return summary


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
    ap.add_argument("--adapter", required=True, help="SFT LoRA checkpoint to start from (a full-decoder checkpoint is refused)")
    ap.add_argument("--tag", required=True)
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--reward", choices=["full", "simple"], default="full")
    ap.add_argument("--rounds", type=int, default=1)
    ap.add_argument("--prompts-per-round", type=int, default=64, help="with --samples-per-prompt 4: 256 candidates a round")
    ap.add_argument("--samples-per-prompt", type=int, default=4)
    ap.add_argument("--seconds", type=int, default=15)
    ap.add_argument("--margin", type=float, default=0.5, help="min reward gap (z units) for a pair")
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--beta", type=float, default=0.1)
    ap.add_argument("--lr", type=float, default=1e-5)
    ap.add_argument("--pairs-per-step", type=int, default=4)
    ap.add_argument("--warmup", type=int, default=10)
    ap.add_argument("--logp-norm", choices=["sum", "mean"], default="sum")
    ap.add_argument("--max-drift", type=float, default=0.3,
                    help="stop the round when the policy's mean log-ratio on its own chosen clips, averaged over the last five "
                         "steps, falls below minus this many nats per token (the KL budget; the first medium round drifted to -1.7)")
    ap.add_argument("--sft-weight", type=float, default=0.0,
                    help="add this times the token CE of one random real oud training clip to every DPO step "
                         "(likelihood anchor: keeps the policy a model of the corpus while it moves toward the reward)")
    ap.add_argument("--eval-prompts", type=int, default=32)
    ap.add_argument("--ce-clips", type=int, default=64, help="held-out oud clips for the token-CE guard")
    ap.add_argument("--captions", default=str(LEGACY_CAPTIONS),
                    help="captions whose isolated-oud test rows feed the token-CE guard (rows may carry tokens_dir)")
    ap.add_argument("--tokens-dir", default=None,
                    help="fallback for rows without their own tokens_dir (the legacy captions default to data/scale_tokens)")
    ap.add_argument("--prompts-from", default=None,
                    help="captions.jsonl whose distinct consented TEST captions form the prompt bank (else the oud grammar)")
    ap.add_argument("--ce-tolerance", type=float, default=0.05, help="CE guard: max rise of held-out oud token CE (nats)")
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
    require_lora_adapter(adapter)
    bank, bank_source = build_prompt_bank(Path(args.prompts_from) if args.prompts_from else None)
    train_prompts, eval_prompts = split_prompts(args.eval_prompts, bank=bank)
    try:
        from scripts.reward_model import REWARD_VERSION
    except ImportError:
        REWARD_VERSION = None

    # held-out oud clips for the token-CE guard (test split, unseen songs) and the SFT anchor;
    # everything that can fail is checked before any model is loaded
    captions = Path(args.captions)
    if not captions.exists():
        raise SystemExit(f"--captions {captions}: file not found")
    all_rows = [json.loads(l) for l in open(captions)]
    tokens_dir = resolve_tokens_dir(captions, args.tokens_dir, all_rows)
    ce_rows = guard_rows([r for r in all_rows if r["split"] == "test"], args.ce_clips)
    if not ce_rows:
        raise SystemExit(f"{captions}: no isolated-oud test row for the token-CE guard")
    check_tokens(ce_rows, tokens_dir)
    anchor_rows = [r for r in all_rows if r["split"] == "train" and is_oud_row(r)] if args.sft_weight > 0 else []
    check_tokens(anchor_rows[:8], tokens_dir)
    anchor_rng = random.Random(args.seed + 99)

    ab_dir = DATA / f"ab_dpo_{args.tag}"
    meta = {
        "tag": args.tag, "run_id": run_id, "model": args.model, "start_adapter": str(adapter), "stage": "dpo",
        **policy_recipe(adapter), **sft_parent(adapter),   # the policy's LoRA rank/alpha/targets and the SFT run it came from
        "reward": args.reward, "reward_version": REWARD_VERSION, "git_commit": git_commit(), "device": DEVICE,
        "prompts_per_round": args.prompts_per_round, "samples_per_prompt": args.samples_per_prompt,
        "candidates_per_round": args.prompts_per_round * args.samples_per_prompt, "candidates_note": CANDIDATES_NOTE,
        "seconds": args.seconds, "rounds": args.rounds, "prompt_bank_source": bank_source, "prompt_bank": len(bank),
        "captions": str(captions), "tokens_dir": str(tokens_dir) if tokens_dir else None, "ab_dir": str(ab_dir),
    }
    (run_dir / "config.json").write_text(json.dumps(vars(args) | meta | {
        "train_prompts": len(train_prompts), "eval_prompts": len(eval_prompts)}, indent=2))
    (run_dir / "prompts.json").write_text(json.dumps({"source": bank_source, "train": train_prompts, "eval": eval_prompts}, indent=2))
    round_summaries: list[dict] = []
    cum_steps = 0
    stopped_run: str | None = None   # why the run ended before its rounds (recorded in summary.json "stopped")

    processor = AutoProcessor.from_pretrained(args.model)
    tok = processor.tokenizer
    model = load_policy(args.model, adapter, trainable=True)

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
            stopped_run = f"round {rnd}: no pairs above the margin {args.margin} among {len(samples)} candidates of {len(prompts)} prompts"
            print(f"{stopped_run}; stopping", flush=True)
            write_summary(run_dir, meta, round_summaries, complete=False, tolerance=args.ce_tolerance, stopped=stopped_run)
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
        recent_drift: list[float] = []
        stopped_early = None
        for ep in range(1, args.epochs + 1):
            if stopped_early:
                break
            order = list(range(len(pairs)))
            random.Random(args.seed + rnd * 10 + ep).shuffle(order)
            for b in range(0, len(order), args.pairs_per_step):
                if stopped_early:
                    break
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
                if anchor_rows:
                    r = anchor_rng.choice(anchor_rows)
                    labels = delayed_labels(token_path(tokens_dir, r))[None].to(DEVICE)
                    text = tok(r["caption"], return_tensors="pt").to(DEVICE)
                    sft = model(input_ids=text["input_ids"], attention_mask=text["attention_mask"], labels=labels).loss
                    (args.sft_weight * sft).backward()
                    acc_loss += args.sft_weight * sft.item()
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
                recent_drift = (recent_drift + [float(np.mean(crs))])[-5:]
                if len(recent_drift) == 5 and float(np.mean(recent_drift)) < -args.max_drift:
                    stopped_early = f"step {step}: chosen log-ratio {np.mean(recent_drift):+.3f}/token over the last five steps is below -{args.max_drift}"
                    print(f"[round {rnd}] KL budget exhausted at {stopped_early}; stopping the round", flush=True)
        log.close()
        train_s = time.time() - t0
        model.save_pretrained(rdir / "adapter")
        n_steps = step
        cum_steps += n_steps
        alias = alias_checkpoint(run_dir, rdir / "adapter", cum_steps)
        print(f"[round {rnd}] DPO {n_steps} steps in {train_s/60:.1f} min; adapter saved ({alias.name} -> {rdir.name}/adapter)", flush=True)

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
        keys = [k for k in ("reward", "oud_dist", "oud_sim", "band_snr_db", "hiss_index", "rolloff95_hz", "noise_floor_db",
                            "quiet_flatness", "hf_ratio", "pcs", "voiced_fraction") if any(k in t for t in pterms)]
        summary = {
            "round": rnd, "prompts": len(prompts), "samples": len(samples), "pairs": len(pairs),
            "stopped_early": stopped_early,
            "gen_minutes": round(gen_s / 60, 1), "train_minutes": round(train_s / 60, 1), "steps": n_steps,
            "held_out_oud_token_ce": {"before": round(ce_before, 4), "after": round(ce_after, 4), "clips": len(ce_rows)},
            "before": {k: mean_of(bt, k) for k in keys}, "after": {k: mean_of(at, k) for k in keys},
            "fad_to_real_oud_test": {"before": fad_or_none(pembs[:nb] if pembs is not None else None, pref),
                                     "after": fad_or_none(pembs[nb:] if pembs is not None else None, pref)},
            "ab_dir": str(ab_dir), "adapter": str(rdir / "adapter"), "ckpt_alias": alias.name,
            "eval_minutes": round((time.time() - t0) / 60, 1),
            "round_minutes": round((time.time() - t_round) / 60, 1),
        }
        (run_dir / f"eval_round_{rnd}.json").write_text(json.dumps(summary, indent=2))
        round_summaries.append(summary)
        write_summary(run_dir, meta, round_summaries, complete=False, tolerance=args.ce_tolerance)
        (ab_dir / "ab_scores.json").write_text(json.dumps({
            "note": f"{args.model}: adapter before (base) vs after (adapter) preference optimisation, round {rnd}; same prompts and seeds.",
            "pairs": [{"pair": i, "caption": eval_prompts[i],
                       "base": {"scored": bool(bt[i].get("pcs") is not None), **{k: bt[i].get(k) for k in keys}},
                       "adapter": {"scored": bool(at[i].get("pcs") is not None), **{k: at[i].get(k) for k in keys}}}
                      for i in range(nb)]}, indent=1))
        print(json.dumps(summary, indent=2), flush=True)
        prev_ce_after = ce_after  # noqa: F841
        model.train()

    # complete only when a round saved an adapter (write_summary enforces it); a first round without
    # pairs is a failure the caller must see (exit 2), a later one ends the run with the earlier adapter
    final = write_summary(run_dir, meta, round_summaries, complete=True, tolerance=args.ce_tolerance, stopped=stopped_run)
    print(json.dumps({k: final.get(k) for k in ("rounds_done", "complete", "stopped", "fad_to_real_oud_test",
                                                 "held_out_oud_token_ce", "adapter", "ckpt_alias")}, indent=2), flush=True)
    if not final["complete"]:
        print(f"DPO_TRAIN_FAILED: no round produced an adapter ({stopped_run or 'no rounds'}); "
              f"{run_dir / 'summary.json'} has complete=false", flush=True)
        sys.exit(2)
    print("DPO_TRAIN_DONE", flush=True)


if __name__ == "__main__":
    main()
