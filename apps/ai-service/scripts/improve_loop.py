"""Phase 4: the improvement loop, one change at a time from the best Phase 2 run.

Starting from --best-run runs/<run> (its config.json gives the recipe, its
eval_<run>.json the yardstick), the loop tries the plan's changes in order,
each as a BOUNDED run of --steps (default 1500) that keeps every other
hyper-parameter of the current best, trains in its own tmux session and is
scored by scripts.scale_eval exactly like the Phase 2/3 runs. A change is kept
only when BOTH numbers move the right way against the current best:

    mert.fad_adapter_real           decreases  (closer to real held-out qaraami)
    per_song_ce.improvement.mean    increases  (base − adapter test CE, over songs)

Both numbers are measured on ONE fixed yardstick for the whole loop: every
variant trains on its own captions but is scored by scale_eval on the origin
run's captions file (the same test split, the same real MERT pool, the same
test tokens), so the deltas are comparable. A yardstick eval JSON that lacks
either number (a pre-Phase-3 eval without a mert block) is refused at start-up.

A kept change becomes the new best configuration, so later changes compose on
top of it (captions transforms, clip length, rank, lr); a change that is not
kept, whether rejected on the numbers or failed (training / eval never
finished), counts as a failure, and the loop stops after two consecutive
failures, after --max-attempts, or when the plan is exhausted. A skipped
variant (probe over the memory cap, nothing to change) counts as neither. The
deltas are written for every attempt, kept or not.

The plan (default order; each item may expand to several attempts):
  clip45            rebuild the run's sets at 45 s under data/sets_45s
                    (build_sets --seconds 45, scale_tokens --seconds 45, then
                    build_sets --merge). Memory is probed FIRST on a partial
                    build (--limit) with scale_train --smoke; the attempt is
                    skipped with a reason when the probe exceeds 60 GB.
  caption_ablation  the current captions without the Somali genre tag
                    (qaraami / balwo / heello / dhaanto / buraanbur) and the
                    phrase "Somali traditional song" ->
                    data/sets/run_<run>_nogenre_captions.jsonl
  data              whichever of isolated-oud-only (content oud + sep_oud) /
                    oud + ahmed_mix full mixes the current best did NOT train on
  lora_rank         rank ×2 and rank ÷2 (alpha scaled with it); skipped for a
                    full-decoder run
  lr                lr ×2 and lr ÷2
  dpo_round2        a second DPO round (scripts.dpo_train, same recipe as the
                    source round) from the best DPO round that DESCENDS from
                    this loop's lineage (its start adapter lies under
                    runs/<origin> or a kept variant's run dir, or it is the
                    origin itself), or from --dpo-run; evaluated like every
                    other variant through the ckpt_step alias dpo_train writes
When one direction of a pair (lora_rank, lr) is kept, the other direction is
dropped: it would only undo the kept change.

The best run may be a LoRA run whose config.json predates the "rank" key (the
rank and alpha are then read from its checkpoint's adapter_config.json), a
full-decoder run ("full_decoder": true) or a DPO product (config.json with
start_adapter / adapter): its SFT recipe is taken from the source run's
config.json and its latest round_N/adapter is the adapter the yardstick
measured. Rights are tracked: a config trained on any harvard_* row is
research-only and is labelled so in the state and the log.

Command shapes are those of runs/_tools/orchestrate_ahmed.sh: caffeinate -s -i,
HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false, batch 1, --mem-cap-gb 85,
--ckpt-every 250, --early-stop-patience 750, one tmux session per run
(exact-name matching with -t "=name"), a foreground batch-size probe
(--smoke 20) before every training run (a probe that aborts on the memory cap
skips the variant with the peak it saw), the eval in tmux "<run>_eval" with
--mert-real 64 --n-ab 16 --ab-seconds 30 into runs/<variant>/eval_<variant>.json.
A killed training run (no RUN_EXIT marker) or a paused one (SCALE_TRAIN_PAUSED)
resumes from its last checkpoint, up to three launches; a run or eval that
exited with an error is relaunched once (scale_eval's pre-checks fail
deterministically) and then marked failed. A live session is waited for, never
touched. A full-decoder best run (config.json "full_decoder": true) is trained
with --full-decoder and no LoRA arguments, and its lora_rank attempts are
skipped.

State lives in runs/_improve/state.json and is written after every stage, so
the loop is safe to rerun at any point (the Mac may be on battery): it picks up
the attempt in flight, the pending plan and the current best. After every
attempt docs/eval/IMPROVEMENT_LOG.md is regenerated from the state (never
hand-typed).

--dry-run prints the plan and every command the loop would run against the
current best, launches nothing and writes nothing.

Usage (from apps/ai-service):
  python -m scripts.improve_loop --best-run runs/qaraami_large --dry-run
  python -m scripts.improve_loop --best-run runs/qaraami_large --steps 1500
  python -m scripts.improve_loop --best-run runs/qaraami_large --only lr_x2 --only lr_half
  python -m scripts.improve_loop --best-run runs/ahmed_only --eval-json /tmp/fake_eval.json --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
AI_REL = "apps/ai-service"
DEFAULT_PYTHON = str(Path.home() / "ai" / "musicgen-env" / "bin" / "python")
STATE_REL = "runs/_improve/state.json"
LOG_REL = "docs/eval/IMPROVEMENT_LOG.md"
TRAIN_ENV = {"HF_HUB_OFFLINE": "1", "TOKENIZERS_PARALLELISM": "false"}
STATE_VERSION = 2
"""2: origin carries the pinned eval captions / tokens / chroma and research_only; Config has research_only."""

# orchestrate_ahmed.sh command shapes
MEM_CAP_GB = 85.0
CLIP45_CAP_GB = 60.0
CKPT_EVERY = 250
EARLY_STOP_PATIENCE = 750
PROBE_STEPS = 20
PROBE_BUILD_LIMIT = 6
"""clip45: source files cut for the memory probe before the full 45 s rebuild."""
DEFAULT_STEPS = 1500
DEFAULT_GRAD_ACCUM = 4
SAMPLE_SECONDS = 15
PROBE_SAMPLE_SECONDS = 5
N_AB = 16
"""The brief's 16-pair A/B and orchestrate_ahmed.sh's AB_N: the first eval of the loop may seed the shared
data/ab_captions_ahmed.json cache, and scale_eval.ab_captions caps every later eval at the cache's length."""
AB_SECONDS = 30
MERT_REAL = 64
AB_CAPTIONS = "data/ab_captions_ahmed.json"
AB_RIGHTS = "ahmed_ilkacase_consented"
MELODY_REFS = "data/sets/ahmed_oud/clips/test"
FULL_DECODER_FLAG = "--full-decoder"
"""scale_train's full-decoder switch; such a run's config.json carries "full_decoder": true and its
checkpoints hold decoder.safetensors instead of a PEFT adapter_config.json."""
DECODER_WEIGHTS = "decoder.safetensors"
ADAPTER_CONFIG = "adapter_config.json"
TRAIN_DONE = "SCALE_TRAIN_DONE"
"""scale_train's completion marker; a --max-hours pause ends with SCALE_TRAIN_PAUSED and exit 0 instead,
which is NOT completion: the loop resumes it from the last checkpoint."""
DPO_DONE = "DPO_TRAIN_DONE"
DEFAULT_TARGETS = ["q_proj", "k_proj", "v_proj", "out_proj", "fc1", "fc2"]
POLL_SECONDS = 30
LAUNCH_SETTLE_SECONDS = 5
MAX_LAUNCHES = 3
"""Launches of one variant's training / eval in total when the previous one was killed (no exit marker)
or paused: it resumes from the last checkpoint."""
MAX_ERROR_RELAUNCHES = 1
"""Relaunches after a launch that EXITED with an error: scale_eval's pre-checks (rights seeding, a missing
real clip, no test rows) fail the same way every time, so one retry covers the transient cases only."""
MAX_CONSECUTIVE_FAILURES = 2
MEM_CAP_RE = re.compile(r"MEM_CAP_EXCEEDED driver=(\d+(?:\.\d+)?)GB")
"""scale_train's clean abort line: `MEM_CAP_EXCEEDED driver=86.2GB > cap 85.0GB — aborting cleanly at step 11`."""
ISOLATED_OUD_CONTENT = {"oud", "sep_oud"}
"""build_sets content labels of isolated oud: ahmed_oud / internet or contrib *_oud rows are "oud", the Demucs
stems of sep_oud and harvard_sep_oud are "sep_oud" (recipe A's "all isolated oud")."""

DEFAULT_PLAN = ["clip45", "caption_ablation", "data", "lora_rank", "lr", "dpo_round2"]
PLAN_GROUPS: dict[str, list[str]] = {
    "clip45": ["clip45"],
    "caption_ablation": ["caption_ablation"],
    "data": ["data"],
    "lora_rank": ["lora_rank_x2", "lora_rank_half"],
    "lr": ["lr_x2", "lr_half"],
    "dpo_round2": ["dpo_round2"],
}
DATA_VARIANTS = ("data_oud_only", "data_oud_plus_mix")
GENRE_TAGS = {"qaraami", "balwo", "heello", "dhaanto", "buraanbur"}
TRADITION_PHRASE = "Somali traditional song"
MIX_SET = "ahmed_mix"
SETS_45S_ROOT = "data/sets_45s"
TERMINAL = {"kept", "rejected", "skipped", "failed", "dropped"}
DPO_CARRIED = ("reward", "margin", "epochs", "beta", "lr", "pairs_per_step", "warmup", "logp_norm", "max_drift",
               "sft_weight", "eval_prompts", "ce_clips", "samples_per_prompt", "seconds")
"""dpo_train hyper-parameters copied from the source DPO round's config.json so round 2 keeps its recipe."""
DPO_PROMPTS_PER_ROUND = 64

sleep: Callable[[float], None] = time.sleep  # patched in tests


class Skip(Exception):
    """A variant that cannot or need not be run; the message is the reason logged."""


@dataclass
class Config:
    """The current best training configuration (composable) and how it was measured."""
    run: str                        # run id under runs/
    model: str
    lr: float
    rank: int | None                # None = full-decoder fine-tune
    alpha: int | None
    targets: list[str]
    grad_accum: int
    captions: str                   # repo-relative captions file the run trains on
    base_captions: str              # the same before caption transforms
    transforms: list[str]           # applied to base_captions, in order (nogenre, oud_only, plus_mix)
    tokens_dir: str | None          # CLI fallback for rows without their own tokens_dir
    chroma_dir: str | None          # musicgen-melody only
    seconds: float                  # clip length of the sets
    eval_json: str
    metrics: dict
    adapter: str | None = None      # DPO product: its round_N/adapter dir (repo-relative); None for an SFT run
    changes: list[str] = field(default_factory=list)
    research_only: bool = False     # trained on any harvard_* row: never released, never served publicly

    @property
    def full(self) -> bool:
        return self.rank is None

    @property
    def melody(self) -> bool:
        return "melody" in self.model


@dataclass
class Step:
    """One preparation step of a variant: a foreground command (build, tokens, merge),
    a memory probe with a cap, or a Python action (writing a derived captions file)."""
    kind: str                       # fg | probe | py
    describe: str
    argv: list[str] | None = None   # python -m scripts.<x> arguments, without the interpreter
    log: str | None = None          # repo-relative log path
    cap_gb: float | None = None     # probe only
    fn: Callable[[], object] | None = None  # py only


@dataclass
class Derived:
    """A variant resolved against the current best."""
    variant: str
    group: str
    change: str
    run_id: str
    cfg: Config
    kind: str                       # train | dpo
    prep: list[Step] = field(default_factory=list)
    dpo_source: str | None = None   # dpo: the adapter the round starts from (repo-relative)
    dpo_args: dict | None = None    # dpo: carried hyper-parameters


# --------------------------------------------------------------------------- files

def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def save_json_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(path)


def rel(path: str | Path | None, repo: Path) -> str | None:
    """Repo-relative string for a path under the repo, else the path unchanged."""
    if path is None:
        return None
    p = Path(path)
    try:
        return str(p.resolve().relative_to(repo.resolve())) if p.is_absolute() else str(p)
    except ValueError:
        return str(p)


def read_rows(path: Path) -> list[dict]:
    with open(path) as fh:
        return [json.loads(line) for line in fh if line.strip()]


def write_rows(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")


def resolve_cfg_path(path: str | None, repo: Path) -> Path | None:
    """A path as a run's config.json recorded it (scale_eval.resolve_captions_arg's rule):
    absolute, relative to apps/ai-service (the scripts' cwd: ../../data/x.jsonl) or
    repo-relative; None when nothing exists at any of those."""
    if not path:
        return None
    p = Path(path)
    for cand in ([p] if p.is_absolute() else [repo / AI_REL / p, repo / p]):
        if cand.exists():
            return cand
    return None


def normalise_cfg_path(path: str | None, repo: Path) -> str | None:
    """Repo-relative spelling of a config.json path whether or not it exists: a relative
    one is taken relative to apps/ai-service, never to the repo root."""
    if not path:
        return None
    found = resolve_cfg_path(path, repo)
    if found is not None:
        return rel(found, repo)
    p = Path(path)
    return rel(Path(os.path.normpath(repo / AI_REL / p)) if not p.is_absolute() else p, repo)


def run_name_of(path: str | None, repo: Path) -> str | None:
    """runs/<run> component of a checkpoint path (absolute, apps/ai-service-relative or
    repo-relative) without requiring it to exist: pruned checkpoints still name their run."""
    if not path:
        return None
    p = Path(path)
    q = Path(os.path.normpath(p if p.is_absolute() else repo / AI_REL / p))
    for base in {Path(os.path.normpath(repo)), repo.resolve()}:
        try:
            parts = q.relative_to(base).parts
        except ValueError:
            continue
        if len(parts) >= 2 and parts[0] == "runs":
            return parts[1]
    return None


def is_harvard_row(row: dict) -> bool:
    """scale_eval.is_harvard: rights or source starting with harvard (research-only)."""
    return str(row.get("rights") or "").startswith("harvard") or str(row.get("source") or "").startswith("harvard")


def research_only_of(rows: list[dict]) -> bool:
    return any(is_harvard_row(r) for r in rows)


def rights_label(research_only: bool | None) -> str:
    return "—" if research_only is None else ("research-only" if research_only else "releasable")


# --------------------------------------------------------------------------- metrics / decision

def _get(d: dict, *keys: str) -> object:
    cur: object = d
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur


def read_metrics(ev: dict) -> dict:
    """The two decision numbers plus context from a scale_eval JSON.

    ce_improvement: per_song_ce.improvement.mean, or the older key
    improvement_base_minus_adapter; fad: mert.fad_adapter_real (the Phase 3
    evaluator), falling back to dpo_train's fad_to_real_oud_test.after."""
    ce = ev.get("per_song_ce") or {}
    imp = ce.get("improvement") or ce.get("improvement_base_minus_adapter") or {}
    fad = _get(ev, "mert", "fad_adapter_real")
    if fad is None:
        fad = _get(ev, "fad_to_real_oud_test", "after")
    fad_base = _get(ev, "mert", "fad_base_real")
    if fad_base is None:
        fad_base = _get(ev, "fad_to_real_oud_test", "before")
    return {
        "ce_improvement": imp.get("mean") if isinstance(imp, dict) else None,
        "ce_ci95": imp.get("ci95") if isinstance(imp, dict) else None,
        "ce_base": _get(ce, "base", "mean"),
        "ce_adapter": _get(ce, "adapter", "mean"),
        "n_songs": ce.get("n_songs"),
        "fad": fad,
        "fad_base": fad_base,
        "best_ckpt": ev.get("best_ckpt"),
        "research_only": _get(ev, "rights", "research_only"),
        "captions": ev.get("captions"),
    }


def decide(before: dict, after: dict) -> dict:
    """Keep iff FAD to real clips decreases AND the CE improvement increases (both strictly).

    Returns the deltas (after − before) and a reason; a missing number on either
    side is never a keep."""
    b_fad, a_fad = before.get("fad"), after.get("fad")
    b_ce, a_ce = before.get("ce_improvement"), after.get("ce_improvement")
    if None in (b_fad, a_fad, b_ce, a_ce):
        missing = [n for n, v in (("fad before", b_fad), ("fad after", a_fad), ("CE before", b_ce), ("CE after", a_ce)) if v is None]
        return {"keep": False, "d_fad": None, "d_ce": None, "reason": "metric missing: " + ", ".join(missing)}
    d_fad, d_ce = round(a_fad - b_fad, 4), round(a_ce - b_ce, 4)
    fad_ok, ce_ok = a_fad < b_fad, a_ce > b_ce
    if fad_ok and ce_ok:
        reason = f"FAD {d_fad:+.4f} and CE improvement {d_ce:+.4f}: both better"
    else:
        parts = [("FAD" if not fad_ok else None), ("CE improvement" if not ce_ok else None)]
        reason = " and ".join(p for p in parts if p) + " not better"
    return {"keep": fad_ok and ce_ok, "d_fad": d_fad, "d_ce": d_ce, "reason": reason}


# --------------------------------------------------------------------------- captions

def strip_genre(caption: str) -> str:
    """Drop the Somali genre tag and the "Somali traditional song" phrase from a
    Stage 2 caption; every other field stays in place."""
    parts = [p.strip() for p in caption.split(",")]
    kept = [p for p in parts if p and p.lower() not in GENRE_TAGS and p != TRADITION_PHRASE]
    return ", ".join(kept)


def set_of(row: dict) -> tuple[str, str] | None:
    """(sets root, set name) of a build_sets clip path data/<sets root>/<set>/clips/<split>/<file>."""
    parts = Path(row.get("clip_path", "")).parts
    if len(parts) >= 5 and parts[0] == "data" and parts[1].startswith("sets") and parts[3] == "clips":
        return f"{parts[0]}/{parts[1]}", parts[2]
    return None


def sets_of(rows: list[dict]) -> tuple[str, list[str]] | None:
    """One sets root and the set names the rows come from; None when a row lies
    outside data/sets*/ or the rows span two roots (not rebuildable as a unit)."""
    roots: set[str] = set()
    names: list[str] = []
    for r in rows:
        s = set_of(r)
        if s is None:
            return None
        roots.add(s[0])
        if s[1] not in names:
            names.append(s[1])
    if len(roots) != 1 or not names:
        return None
    return roots.pop(), names


def is_mix_row(row: dict) -> bool:
    s = set_of(row)
    return row.get("content") == "full_mix" or (s is not None and s[1] == MIX_SET)


def uses_mix(rows: list[dict]) -> bool:
    return any(is_mix_row(r) for r in rows)


def find_leakage(rows: list[dict]) -> dict[str, list[str]]:
    """song_sha256 / song_group values present in more than one split (build_sets' rule)."""
    out: dict[str, list[str]] = {}
    for key in ("song_sha256", "song_group"):
        splits: dict[str, set[str]] = {}
        for r in rows:
            v = r.get(key)
            if v:
                splits.setdefault(str(v), set()).add(r.get("split", ""))
        leaks = sorted(k for k, s in splits.items() if len(s) > 1)
        if leaks:
            out[key] = leaks
    return out


def apply_transform(rows: list[dict], name: str, repo: Path) -> list[dict]:
    if name == "nogenre":
        return [dict(r, caption=strip_genre(r["caption"])) for r in rows]
    if name == "oud_only":
        kept = [r for r in rows if r.get("content") in ISOLATED_OUD_CONTENT or (r.get("content") is None and not is_mix_row(r))]
        if not kept:
            raise Skip("oud_only leaves no rows")
        return kept
    if name == "plus_mix":
        sets = sets_of(rows)
        if sets is None:
            raise Skip("plus_mix: the rows lie outside data/sets*/, no matching ahmed_mix set")
        root, names = sets
        if MIX_SET in names:
            raise Skip(f"plus_mix: {MIX_SET} rows already present")
        mix_path = repo / root / MIX_SET / "captions.jsonl"
        if not mix_path.exists():
            raise Skip(f"plus_mix: {rel(mix_path, repo)} missing (build the set first)")
        mix = [dict(r) for r in read_rows(mix_path)]
        for r in mix:
            r.setdefault("tokens_dir", f"{root}/{MIX_SET}/tokens")
        union = rows + mix
        leaks = find_leakage(union)
        if leaks:
            raise Skip("plus_mix: song-level leakage across the union: " + ", ".join(f"{k} ×{len(v)}" for k, v in leaks.items()))
        return union
    raise ValueError(f"unknown captions transform {name!r}")


def derived_captions_path(base_captions: str, run: str, transforms: list[str]) -> str:
    """<root of base>/run_<run>_<transforms>_captions.jsonl (e.g. data/sets/run_ahmed_only_nogenre_captions.jsonl)."""
    return str(Path(base_captions).parent / f"run_{run}_{'_'.join(transforms)}_captions.jsonl")


def materialise(base_captions: str, transforms: list[str], out: str, repo: Path) -> dict:
    """Write base_captions with the transforms applied to out; returns a small summary."""
    rows = read_rows(repo / base_captions)
    for t in transforms:
        rows = apply_transform(rows, t, repo)
    per_split: dict[str, int] = {}
    for r in rows:
        per_split[r.get("split", "?")] = per_split.get(r.get("split", "?"), 0) + 1
    for split in ("train", "test"):  # scale_train needs train rows, scale_eval test rows: fail here, not after 1500 steps
        if not per_split.get(split):
            raise Skip(f"{out}: no {split} rows after {', '.join(transforms)} (splits: {per_split or 'none'})")
    write_rows(repo / out, rows)
    return {"out": out, "rows": len(rows), "per_split": per_split, "transforms": transforms, "research_only": research_only_of(rows)}


# --------------------------------------------------------------------------- the best run

def find_eval_json(run_dir: Path, override: str | None, repo: Path) -> Path:
    if override:
        p = Path(override)
        p = p if p.is_absolute() else repo / p
        if not p.exists():
            raise SystemExit(f"--eval-json {override}: not found")
        return p
    cand = run_dir / f"eval_{run_dir.name}.json"
    if cand.exists():
        return cand
    found = sorted(run_dir.glob("eval_*.json"))
    if len(found) == 1:
        return found[0]
    raise SystemExit(f"{run_dir}: no eval_{run_dir.name}.json (pass --eval-json); found {[p.name for p in found]}")


def clip_seconds(captions: Path) -> float:
    """The clip length the first captions row records (30.0 when the rows carry none)."""
    with open(captions) as fh:
        for line in fh:
            if line.strip():
                return float(json.loads(line).get("seconds", 30.0))
    raise SystemExit(f"{captions}: empty captions file")


def latest_adapter_dir(run_dir: Path) -> Path | None:
    """The newest PEFT adapter under a run: the highest ckpt_step_NNNN (SFT) or round_N/adapter (DPO)."""
    cands: list[tuple[int, Path]] = []
    for d in run_dir.glob("ckpt_step_*"):
        m = re.search(r"(\d+)$", d.name)
        if m and (d / ADAPTER_CONFIG).exists():
            cands.append((int(m.group(1)), d))
    for d in run_dir.glob("round_*/adapter"):
        m = re.search(r"round_(\d+)", d.parent.name)
        if m and (d / ADAPTER_CONFIG).exists():
            cands.append((int(m.group(1)), d))
    return max(cands, key=lambda c: c[0])[1] if cands else None


def lora_from_adapter(adapter: Path) -> tuple[int, int, list[str] | None]:
    """(r, lora_alpha, target_modules) of a PEFT adapter_config.json."""
    ac = load_json(adapter / ADAPTER_CONFIG)
    return int(ac["r"]), int(ac.get("lora_alpha") or 2 * int(ac["r"])), (sorted(ac["target_modules"]) if ac.get("target_modules") else None)


def config_from_run(run_dir: Path, eval_json: Path, repo: Path) -> Config:
    """The best run's recipe from its config.json and yardstick from its eval JSON.

    Three shapes of run are understood: a scale_train run (LoRA, or full decoder
    when "full_decoder" is true); a LoRA run whose config predates the "rank" key
    (rank / alpha read from its checkpoint's adapter_config.json); a dpo_train
    product (config with start_adapter / adapter), whose SFT recipe comes from the
    source run's config.json while its latest round adapter is what the yardstick
    measured. Paths are resolved as the scripts record them (absolute, relative to
    apps/ai-service, or repo-relative); a missing captions file is an error, never a
    30 s default."""
    cfg_path = run_dir / "config.json"
    if not cfg_path.exists():
        raise SystemExit(f"{run_dir}: no config.json")
    cfg = load_json(cfg_path)
    adapter: str | None = None
    recipe = cfg
    source = cfg.get("start_adapter") or cfg.get("adapter")
    if source:  # a DPO product: the recipe to vary is the SFT run the round started from
        src_run = run_name_of(str(source), repo)
        src_cfg = repo / "runs" / src_run / "config.json" if src_run else None
        if src_cfg is None or not src_cfg.exists():
            raise SystemExit(f"{run_dir} is a DPO product of {source}, whose run config.json is missing; "
                             "start the loop from the SFT run instead")
        recipe = load_json(src_cfg)
        prod = latest_adapter_dir(run_dir)
        if prod is None:
            raise SystemExit(f"{run_dir}: no round_N/adapter with {ADAPTER_CONFIG} (the DPO product to improve on)")
        adapter = rel(prod, repo)
        if recipe.get("model") != cfg.get("model"):
            raise SystemExit(f"{run_dir}: DPO model {cfg.get('model')} != source run model {recipe.get('model')}")
    captions_path = resolve_cfg_path(recipe.get("captions"), repo)
    if captions_path is None:
        raise SystemExit(f"{cfg_path}: captions {recipe.get('captions')!r} not found (absolute, apps/ai-service- or repo-relative)")
    captions = rel(captions_path, repo) or str(captions_path)
    full = bool(recipe.get("full_decoder"))
    rank, alpha, targets = recipe.get("rank"), recipe.get("alpha"), recipe.get("targets")
    if not full and not rank:  # pre-scale_train LoRA configs record no rank: the checkpoint knows
        ckpt = latest_adapter_dir(run_dir if adapter is None else repo / adapter)
        if ckpt is None:
            raise SystemExit(f"{cfg_path}: no \"rank\" and no adapter checkpoint to read it from; "
                             "not a full-decoder run either (\"full_decoder\" is not true)")
        rank, alpha, targets_ac = lora_from_adapter(ckpt)
        targets = targets or targets_ac
    rows = read_rows(captions_path)
    return Config(
        run=run_dir.name, model=recipe["model"], lr=float(recipe.get("lr", 5e-5)),
        rank=None if full else int(rank), alpha=None if full else int(alpha or 2 * int(rank)),
        targets=list(targets or DEFAULT_TARGETS), grad_accum=int(recipe.get("grad_accum") or DEFAULT_GRAD_ACCUM),
        captions=captions, base_captions=captions, transforms=[],
        tokens_dir=normalise_cfg_path(recipe.get("tokens_dir"), repo), chroma_dir=normalise_cfg_path(recipe.get("chroma_dir"), repo),
        seconds=clip_seconds(captions_path), eval_json=rel(eval_json, repo) or str(eval_json),
        metrics=read_metrics(load_json(eval_json)), adapter=adapter, research_only=research_only_of(rows),
    )


def require_yardstick(best: Config) -> None:
    """Both decision numbers must exist before anything trains: decide() can never keep otherwise."""
    missing = [k for k in ("ce_improvement", "fad") if best.metrics.get(k) is None]
    if missing:
        raise SystemExit(f"{best.eval_json}: no {' / '.join(missing)} (per_song_ce.improvement.mean, mert.fad_adapter_real); "
                         f"re-run scripts.scale_eval --mert-real {MERT_REAL} on runs/{best.run} or pass --eval-json")


# --------------------------------------------------------------------------- plan

def matches_only(variant: str, group: str, only: list[str] | None) -> bool:
    """--only names variants or groups; an unresolved "data" attempt matches when a
    data direction is named (the same rule at start-up and on resume)."""
    if not only:
        return True
    unresolved_data = group == "data" and variant == "data" and any(o in DATA_VARIANTS for o in only)
    return variant in only or group in only or unresolved_data


def pin_data_direction(variant: str, only: list[str] | None) -> str:
    """An unresolved "data" attempt takes the one direction --only names, if exactly one."""
    named = [v for v in DATA_VARIANTS if only and v in only]
    return named[0] if variant == "data" and len(named) == 1 else variant


def expand_plan(plan: list[str], only: list[str] | None = None) -> list[dict]:
    """Plan items -> attempt records (status pending). --only keeps attempts whose
    variant or group is named; "data" resolves to its direction at run time."""
    out: list[dict] = []
    for item in plan:
        if item in PLAN_GROUPS:
            group, variants = item, PLAN_GROUPS[item]
        elif item in DATA_VARIANTS:
            group, variants = "data", [item]
        else:
            group = next((g for g, vs in PLAN_GROUPS.items() if item in vs), None)
            if group is None:
                raise SystemExit(f"unknown plan item {item!r}; known: {sorted(PLAN_GROUPS)} and {list(DATA_VARIANTS)}")
            variants = [item]
        for v in variants:
            if not matches_only(v, group, only):
                continue
            out.append({"variant": pin_data_direction(v, only), "group": group, "status": "pending"})
    return out


def compose_pending(attempts: list[dict], kept_group: str) -> list[str]:
    """After a kept change, drop the pending attempts of the same group (the other
    direction of a rank / lr pair would only undo it). Returns the dropped variants."""
    dropped = []
    for a in attempts:
        if a["status"] not in TERMINAL and a["group"] == kept_group:
            a["status"] = "dropped"
            a["note"] = f"sibling of the kept {kept_group} change"
            dropped.append(a["variant"])
    return dropped


def fmt_lr(x: float) -> str:
    """Shortest exact scientific form, the orchestrator's spelling: 3e-5, 1.5e-5, 1e-4."""
    mantissa, exp = f"{x:.6e}".split("e")
    return f"{mantissa.rstrip('0').rstrip('.')}e{int(exp)}"


# --------------------------------------------------------------------------- run-dir helpers (mirror orchestrate_ahmed.sh)

def last_ckpt_step(run_dir: Path) -> int:
    best = 0
    for d in run_dir.glob("ckpt_step_*"):
        if d.is_dir():
            m = re.search(r"(\d+)$", d.name)
            if m:
                best = max(best, int(m.group(1)))
    return best


def is_checkpoint(d: Path) -> bool:
    """A LoRA adapter dir (adapter_config.json) or a full-decoder checkpoint (decoder.safetensors)."""
    return (d / ADAPTER_CONFIG).exists() or (d / DECODER_WEIGHTS).exists()


def has_checkpoint(run_dir: Path) -> bool:
    return any(is_checkpoint(d) for d in run_dir.glob("ckpt_step_*"))


def last_exit(log: Path, marker: str) -> int | None:
    if not log.exists():
        return None
    found = re.findall(rf"{marker}=(\d+)", log.read_text(errors="replace"))
    return int(found[-1]) if found else None


def train_done(log: Path, done_marker: str) -> bool:
    """orchestrate_ahmed.sh's train_ok: the completion marker printed AND the shell's RUN_EXIT=0."""
    return log.exists() and done_marker in log.read_text(errors="replace") and last_exit(log, "RUN_EXIT") == 0


def probe_metrics(log: Path) -> dict | None:
    """The last {"peak_driver_gb": ...} block of a --smoke log, or None."""
    if not log.exists():
        return None
    blocks = re.findall(r"\{[^{}]*\"peak_driver_gb\"[^{}]*\}", log.read_text(errors="replace"), re.S)
    if not blocks:
        return None
    try:
        return json.loads(blocks[-1])
    except json.JSONDecodeError:
        return None


# --------------------------------------------------------------------------- the loop

class Loop:
    def __init__(self, repo: Path, state_path: Path, log_path: Path, python: str, dry_run: bool = False,
                 extra_train: list[str] | None = None, extra_eval: list[str] | None = None, dpo_run: str | None = None,
                 out: Callable[[str], None] = print) -> None:
        self.repo = repo
        self.ai_dir = repo / AI_REL
        self.state_path = state_path
        self.log_path = log_path
        self.python = python
        self.dry_run = dry_run
        self.extra_train = extra_train or []
        self.extra_eval = extra_eval or []
        self.dpo_run = dpo_run
        self.out = out
        self.state: dict = {}

    # ----- state

    @property
    def best(self) -> Config:
        return Config(**self.state["best"])

    def init_state(self, best: Config, plan: list[str], only: list[str] | None, steps: int, max_attempts: int | None) -> None:
        # The yardstick is pinned for the whole loop: every variant is scored on the captions file the
        # origin's eval JSON was measured on (its test split, real MERT pool and test tokens), falling
        # back to the origin's training captions when the eval JSON records none.
        eval_caps = resolve_cfg_path(best.metrics.get("captions"), self.repo)
        eval_captions = (rel(eval_caps, self.repo) or str(eval_caps)) if eval_caps is not None else best.captions
        self.state = {
            "version": STATE_VERSION, "started": now(), "updated": now(),
            "origin": {"run": best.run, "eval_json": best.eval_json, "metrics": best.metrics, "research_only": best.research_only,
                       "eval_captions": eval_captions, "eval_tokens_dir": best.tokens_dir, "eval_chroma_dir": best.chroma_dir},
            "best": asdict(best), "plan": plan, "only": only or [], "steps": steps, "max_attempts": max_attempts,
            "attempts": expand_plan(plan, only), "consecutive_failures": 0, "stopped": None,
        }

    def lineage(self) -> set[str]:
        """Run names a dpo_round2 source may descend from: the origin, the current best and every kept variant."""
        runs = {self.state["origin"]["run"], self.best.run}
        runs |= {a["run_id"] for a in self.state["attempts"] if a.get("status") == "kept" and a.get("run_id")}
        return runs

    def load_state(self) -> bool:
        if not self.state_path.exists():
            return False
        self.state = load_json(self.state_path)
        if self.state.get("version") != STATE_VERSION:
            raise SystemExit(f"{self.state_path}: state version {self.state.get('version')} != {STATE_VERSION}")
        return True

    def save(self) -> None:
        if self.dry_run:
            return
        self.state["updated"] = now()
        save_json_atomic(self.state_path, self.state)

    def write_log(self) -> None:
        if self.dry_run:
            return
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.log_path.write_text(render_log(self.state, self.repo))

    # ----- paths / commands

    def abs(self, p: str) -> str:
        q = Path(p)
        return str(q if q.is_absolute() else self.repo / q)

    def wrap(self, argv: list[str]) -> list[str]:
        """caffeinate -s -i env HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false <python> -u -m scripts.<x> ..."""
        env = [f"{k}={v}" for k, v in TRAIN_ENV.items()]
        return ["caffeinate", "-s", "-i", "env", *env, self.python, "-u", "-m", *argv]

    def shell_line(self, argv: list[str], log: str, marker: str) -> str:
        q = shlex.quote(self.abs(log))
        return f"{shlex.join(self.wrap(argv))} >> {q} 2>&1; echo {marker}=$? >> {q}"

    def train_argv(self, cfg: Config, run_id: str, steps: int, resume: tuple[str, int] | None = None) -> list[str]:
        argv = ["scripts.scale_train", "--model", cfg.model, "--run-id", run_id, "--lr", fmt_lr(cfg.lr),
                "--total-steps", str(steps), "--ckpt-every", str(CKPT_EVERY), "--early-stop-patience", str(EARLY_STOP_PATIENCE),
                "--batch-size", "1", "--grad-accum", str(cfg.grad_accum)]
        argv += self.lora_args(cfg)
        argv += ["--captions", self.abs(cfg.captions)]
        if cfg.tokens_dir:
            argv += ["--tokens-dir", self.abs(cfg.tokens_dir)]
        argv += ["--sample-seconds", str(SAMPLE_SECONDS), "--mem-cap-gb", f"{MEM_CAP_GB:g}"]
        if cfg.chroma_dir:
            argv += ["--chroma-dir", self.abs(cfg.chroma_dir)]
        if resume:
            argv += ["--resume-from", self.abs(resume[0]), "--start-step", str(resume[1])]
        return argv + self.extra_train

    def lora_args(self, cfg: Config) -> list[str]:
        if cfg.full:
            return [FULL_DECODER_FLAG]
        out = ["--rank", str(cfg.rank), "--alpha", str(cfg.alpha)]
        if set(cfg.targets) != set(DEFAULT_TARGETS):  # adapter_config.json lists the same modules in another order
            out += ["--targets", *cfg.targets]
        return out

    def probe_argv(self, cfg: Config, run_id: str, steps: int, captions: str | None = None, tokens_dir: str | None = None) -> list[str]:
        argv = ["scripts.scale_train", "--model", cfg.model, "--run-id", f"{run_id}_probe", "--smoke", str(PROBE_STEPS),
                "--lr", fmt_lr(cfg.lr), "--total-steps", str(steps), "--batch-size", "1", "--grad-accum", str(cfg.grad_accum)]
        argv += self.lora_args(cfg)
        argv += ["--captions", self.abs(captions or cfg.captions)]
        tok = tokens_dir or cfg.tokens_dir
        if tok:
            argv += ["--tokens-dir", self.abs(tok)]
        argv += ["--sample-seconds", str(PROBE_SAMPLE_SECONDS), "--mem-cap-gb", f"{MEM_CAP_GB:g}"]
        if cfg.chroma_dir:
            argv += ["--chroma-dir", self.abs(cfg.chroma_dir)]
        return argv + self.extra_train

    def eval_argv(self, cfg: Config, run_id: str, run_arg: str) -> list[str]:
        """scale_eval on the PINNED yardstick captions (state origin.eval_captions), never the
        variant's own training captions: the adapter is the variant's (--rank/--alpha), the test
        split, the real pool and the test tokens are the origin's."""
        origin = self.state["origin"]
        argv = ["scripts.scale_eval", "--run", run_arg, "--model", cfg.model, "--tag", run_id,
                "--captions", self.abs(origin["eval_captions"])]
        if origin.get("eval_tokens_dir"):
            argv += ["--tokens-dir", self.abs(origin["eval_tokens_dir"])]
        if not cfg.full:
            argv += ["--rank", str(cfg.rank), "--alpha", str(cfg.alpha)]
        argv += ["--n-ab", str(N_AB), "--ab-seconds", str(AB_SECONDS), "--mert-real", str(MERT_REAL),
                 "--ab-captions", AB_CAPTIONS, "--ab-rights", AB_RIGHTS]
        if cfg.melody:
            chroma = origin.get("eval_chroma_dir") or cfg.chroma_dir
            argv += (["--chroma-dir", self.abs(chroma)] if chroma else []) + ["--melody-refs", MELODY_REFS]
        return argv + self.extra_eval

    def dpo_argv(self, d: Derived) -> list[str]:
        assert d.dpo_source and d.dpo_args is not None
        argv = ["scripts.dpo_train", "--model", d.cfg.model, "--adapter", self.abs(d.dpo_source), "--tag", d.run_id,
                "--run-id", d.run_id, "--rounds", "1", "--prompts-per-round", str(DPO_PROMPTS_PER_ROUND)]
        for k in DPO_CARRIED:
            if k in d.dpo_args and d.dpo_args[k] is not None:
                argv += [f"--{k.replace('_', '-')}", str(d.dpo_args[k])]
        argv += ["--captions", self.abs(d.cfg.captions)]
        if d.cfg.tokens_dir:
            argv += ["--tokens-dir", self.abs(d.cfg.tokens_dir)]
        return argv + ["--mem-cap-gb", f"{MEM_CAP_GB:g}"]

    def eval_json_path(self, d: Derived) -> Path:
        """runs/<run id>/eval_<run id>.json for every kind: scale_eval writes next to --run, and a
        DPO run is evaluated through the ckpt_step alias dpo_train leaves in its run dir, so the
        JSON never lands inside the PEFT adapter directory."""
        return self.repo / "runs" / d.run_id / f"eval_{d.run_id}.json"

    def eval_run_arg(self, d: Derived) -> str:
        return f"runs/{d.run_id}"

    # ----- processes

    def run_fg(self, argv: list[str], log: str) -> int:
        """Foreground step under caffeinate, stdout+stderr appended to the log."""
        log_path = Path(self.abs(log))
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with open(log_path, "a") as fh:
            proc = subprocess.run(self.wrap(argv), cwd=self.ai_dir, env={**os.environ, **TRAIN_ENV}, stdout=fh, stderr=subprocess.STDOUT, check=False)
        return proc.returncode

    def session_live(self, name: str) -> bool:
        proc = subprocess.run(["tmux", "has-session", "-t", f"={name}"], capture_output=True, check=False)
        return proc.returncode == 0

    def wait_session(self, name: str) -> None:
        while self.session_live(name):
            sleep(POLL_SECONDS)

    def tmux_launch(self, name: str, shell_cmd: str) -> None:
        proc = subprocess.run(["tmux", "new-session", "-d", "-s", name, "-c", str(self.ai_dir), shell_cmd], capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            raise RuntimeError(f"tmux new-session {name} failed: {proc.stderr.strip()}")

    def tmux_launch_line(self, name: str, shell_cmd: str) -> str:
        return shlex.join(["tmux", "new-session", "-d", "-s", name, "-c", str(self.ai_dir), shell_cmd])

    # ----- variants

    def run_id_for(self, att: dict, variant: str) -> str:
        if att.get("run_id"):
            return att["run_id"]
        taken = {a.get("run_id") for a in self.state["attempts"] if a.get("run_id")}
        run_id, k = variant, 1
        while run_id in taken or (self.repo / "runs" / run_id).exists():
            k += 1
            run_id = f"{variant}_{k}"
        return run_id

    def derive(self, att: dict, best: Config) -> Derived:
        """Resolve a pending attempt against the current best; raises Skip with the reason."""
        v = att["variant"]
        if v == "data":
            rows = read_rows(self.repo / best.captions) if (self.repo / best.captions).exists() else []
            v = "data_oud_only" if uses_mix(rows) else "data_oud_plus_mix"
        run_id = self.run_id_for(att, v)
        steps = int(self.state["steps"])
        if v == "clip45":
            return self.derive_clip45(att, best, run_id, steps)
        if v == "caption_ablation":
            if "nogenre" in best.transforms:
                raise Skip("captions already carry no genre tag (nogenre kept earlier)")
            transforms = [*best.transforms, "nogenre"]
            out = derived_captions_path(best.base_captions, best.run, transforms)
            cfg = train_cfg(best, run_id, transforms=transforms, captions=out)
            prep = [Step("py", f"write {out}: {best.base_captions} without the genre tag and '{TRADITION_PHRASE}'",
                         fn=lambda: materialise(best.base_captions, transforms, out, self.repo))]
            return Derived(v, att["group"], f"captions without the genre tag and '{TRADITION_PHRASE}'", run_id, cfg, "train",
                           prep + [self.probe_step(cfg, run_id, steps, MEM_CAP_GB)])
        if v in DATA_VARIANTS:
            t = "oud_only" if v == "data_oud_only" else "plus_mix"
            if t in best.transforms:
                raise Skip(f"{t} already applied")
            transforms = [*best.transforms, t]
            out = derived_captions_path(best.base_captions, best.run, transforms)
            cfg = train_cfg(best, run_id, transforms=transforms, captions=out)
            change = "data: isolated oud only (oud + sep_oud stems; drop the full mixes)" if t == "oud_only" else f"data: + {MIX_SET} full mixes"
            prep = [Step("py", f"write {out}: {best.base_captions} with {t}",
                         fn=lambda: materialise(best.base_captions, transforms, out, self.repo))]
            if t == "plus_mix":
                sets = sets_of(read_rows(self.repo / best.base_captions)) if (self.repo / best.base_captions).exists() else None
                if sets is None:
                    raise Skip("plus_mix: the captions lie outside data/sets*/")
                if not (self.repo / sets[0] / MIX_SET / "captions.jsonl").exists():
                    raise Skip(f"plus_mix: {sets[0]}/{MIX_SET}/captions.jsonl missing")
            return Derived(v, att["group"], change, run_id, cfg, "train", prep + [self.probe_step(cfg, run_id, steps, MEM_CAP_GB)])
        if v in ("lora_rank_x2", "lora_rank_half"):
            if best.full:
                raise Skip("full-decoder fine-tune has no LoRA rank")
            assert best.rank is not None and best.alpha is not None
            if v == "lora_rank_x2":
                rank, alpha = best.rank * 2, best.alpha * 2
            else:
                if best.rank < 2:
                    raise Skip(f"rank {best.rank} cannot be halved")
                rank, alpha = best.rank // 2, max(1, best.alpha // 2)
            cfg = train_cfg(best, run_id, rank=rank, alpha=alpha)
            change = f"LoRA rank {best.rank} → {rank} (α {best.alpha} → {alpha})"
            return Derived(v, att["group"], change, run_id, cfg, "train", [self.probe_step(cfg, run_id, steps, MEM_CAP_GB)])
        if v in ("lr_x2", "lr_half"):
            lr = best.lr * 2 if v == "lr_x2" else best.lr / 2
            cfg = train_cfg(best, run_id, lr=lr)
            return Derived(v, att["group"], f"lr {fmt_lr(best.lr)} → {fmt_lr(lr)}", run_id, cfg, "train",
                           [self.probe_step(cfg, run_id, steps, MEM_CAP_GB)])
        if v == "dpo_round2":
            return self.derive_dpo(att, best, run_id)
        raise Skip(f"unknown variant {v}")

    def probe_step(self, cfg: Config, run_id: str, steps: int, cap: float, captions: str | None = None, tokens_dir: str | None = None) -> Step:
        return Step("probe", f"batch-size probe ({PROBE_STEPS} smoke steps, grad-accum {cfg.grad_accum}); skip if peak > {cap:g} GB",
                    argv=self.probe_argv(cfg, run_id, steps, captions, tokens_dir), log=f"runs/{run_id}/probe.log", cap_gb=cap)

    def derive_clip45(self, att: dict, best: Config, run_id: str, steps: int) -> Derived:
        if best.seconds >= 45:
            raise Skip(f"sets are already {best.seconds:g} s")
        if best.melody:
            raise Skip("melody run: the MIDI chroma of a 45 s set is not rebuilt by this loop")
        base = self.repo / best.base_captions
        if not base.exists():
            raise Skip(f"{best.base_captions} missing")
        sets = sets_of(read_rows(base))
        if sets is None:
            raise Skip("captions rows lie outside data/sets*/<set>/clips/, cannot be rebuilt at 45 s")
        _root, names = sets
        first = names[0]
        merged = f"{SETS_45S_ROOT}/run_{run_id}_captions.jsonl"
        captions = derived_captions_path(merged, run_id, best.transforms) if best.transforms else merged
        tokens_dir = f"{SETS_45S_ROOT}/{first}/tokens"
        cfg = train_cfg(best, run_id, seconds=45.0, base_captions=merged, captions=captions, tokens_dir=tokens_dir)
        logs = f"runs/{run_id}"
        # a kept plus_mix re-adds ahmed_mix on top of the 45 s merge, so that set must be cut and
        # tokenised at 45 s too (it is not part of the merge: the transform appends it)
        to_build = [*names, MIX_SET] if "plus_mix" in best.transforms and MIX_SET not in names else list(names)

        def build(name: str, limit: int = 0) -> list[str]:
            argv = ["scripts.build_sets", "--set", name, "--seconds", "45", "--out-root", SETS_45S_ROOT]
            return argv + (["--limit", str(limit)] if limit else [])

        def tokens(name: str) -> list[str]:
            return ["scripts.scale_tokens", "--captions", self.abs(f"{SETS_45S_ROOT}/{name}/captions.jsonl"),
                    "--tokens-dir", self.abs(f"{SETS_45S_ROOT}/{name}/tokens"), "--seconds", "45"]

        probe_caps = f"{SETS_45S_ROOT}/{first}/captions.jsonl"
        prep = [
            Step("fg", f"partial 45 s build of {first} ({PROBE_BUILD_LIMIT} sources) for the probe", build(first, PROBE_BUILD_LIMIT), f"{logs}/build_45s.log"),
            Step("fg", f"EnCodec tokens for the partial {first} 45 s clips", tokens(first), f"{logs}/tokens_45s.log"),
            self.probe_step(cfg, run_id, steps, CLIP45_CAP_GB, captions=probe_caps, tokens_dir=tokens_dir),
        ]
        for name in to_build:
            prep.append(Step("fg", f"full 45 s build of {name}", build(name), f"{logs}/build_45s.log"))
            prep.append(Step("fg", f"EnCodec tokens for {name} at 45 s", tokens(name), f"{logs}/tokens_45s.log"))
        prep.append(Step("fg", f"merge {', '.join(names)} -> {merged}",
                         ["scripts.build_sets", "--merge", f"run_{run_id}", "--sets", *names, "--out-root", SETS_45S_ROOT, "--out", merged],
                         f"{logs}/build_45s.log"))
        if best.transforms:
            prep.append(Step("py", f"write {captions}: {merged} with {', '.join(best.transforms)}",
                             fn=lambda: materialise(merged, best.transforms, captions, self.repo)))
        return Derived("clip45", att["group"], f"clip length {best.seconds:g} s → 45 s ({SETS_45S_ROOT})", run_id, cfg, "train", prep)

    def in_lineage(self, dpo_dir: Path, dcfg: dict) -> bool:
        """A DPO run descends from this loop when it IS the origin / best / a kept variant, or its
        start adapter (config start_adapter, older runs: adapter) lies under one of their run dirs."""
        lineage = self.lineage()
        return dpo_dir.name in lineage or run_name_of(dcfg.get("start_adapter") or dcfg.get("adapter"), self.repo) in lineage

    def find_dpo_source(self, best: Config) -> tuple[str, dict, str]:
        """(adapter dir, dpo config, run name) of the DPO round to continue: --dpo-run if given,
        else the runs/dpo_*/ round on the same base that descends from this loop's lineage with
        the lowest MERT-FAD to real oud after the round. A round of another lineage (e.g. the
        scale_captions-era runs/dpo_medium for an ahmed_only best) is never 'one change from the
        best', so it is skipped, not picked."""
        cands: list[tuple[float, str, Path, dict]] = []
        foreign: list[str] = []
        dirs = [self.repo / self.dpo_run] if self.dpo_run else sorted((self.repo / "runs").glob("dpo_*"))
        for d in dirs:
            cfg_path = d / "config.json"
            if not cfg_path.exists():
                continue
            cfg = load_json(cfg_path)
            if cfg.get("model") != best.model and not self.dpo_run:
                continue
            if not self.dpo_run and not self.in_lineage(d, cfg):
                foreign.append(d.name)
                continue
            for ev in sorted(d.glob("eval_round_*.json")):
                m = re.search(r"eval_round_(\d+)", ev.name)
                if not m:
                    continue
                adapter = d / f"round_{m.group(1)}" / "adapter"
                if not (adapter / "adapter_config.json").exists():
                    continue
                fad = _get(load_json(ev), "fad_to_real_oud_test", "after")
                cands.append((float(fad) if fad is not None else float("inf"), d.name, adapter, cfg))
        if not cands:
            if self.dpo_run:
                raise Skip(f"no DPO round with an adapter and eval_round_N.json under {self.dpo_run}")
            skipped = f" (other lineage, skipped: {', '.join(foreign)})" if foreign else ""
            raise Skip(f"no DPO round for {best.model} descends from runs/{best.run}{skipped}; pass --dpo-run runs/dpo_<tag>")
        cands.sort(key=lambda c: (c[0], c[1]))
        fad, name, adapter, cfg = cands[0]
        return rel(adapter, self.repo) or str(adapter), cfg, name

    def derive_dpo(self, att: dict, best: Config, run_id: str) -> Derived:
        source, dcfg, name = self.find_dpo_source(best)
        src_caps = resolve_cfg_path(dcfg.get("captions"), self.repo)
        if src_caps is not None:
            src_rights = research_only_of(read_rows(src_caps))
            if src_rights != best.research_only:
                raise Skip(f"{name} is {rights_label(src_rights)} but the best run is {rights_label(best.research_only)}; "
                           "a DPO round must not change the rights of the lineage")
        cfg = replace(best, run=run_id, adapter=f"runs/{run_id}/round_1/adapter")
        carried = {k: dcfg.get(k) for k in DPO_CARRIED if dcfg.get(k) is not None}
        return Derived("dpo_round2", att["group"], f"second DPO round from {source} ({name} recipe)", run_id, cfg, "dpo",
                       [], dpo_source=source, dpo_args=carried)

    # ----- stages

    def execute_prep(self, att: dict, d: Derived) -> None:
        done = int(att.get("prep_done", 0))
        for i, step in enumerate(d.prep):
            if i < done:
                continue
            self.out(f"[{d.run_id}] prep {i + 1}/{len(d.prep)}: {step.describe}")
            if step.kind == "py":
                assert step.fn is not None
                att.setdefault("prep_results", []).append({"step": step.describe, "result": step.fn()})
            elif step.kind == "fg":
                assert step.argv is not None and step.log is not None
                rc = self.run_fg(step.argv, step.log)
                if rc != 0:
                    raise RuntimeError(f"{step.describe}: exit {rc} (see {step.log})")
            elif step.kind == "probe":
                assert step.argv is not None and step.log is not None and step.cap_gb is not None
                rc = self.run_fg(step.argv, step.log)
                log_path = Path(self.abs(step.log))
                pm = probe_metrics(log_path)
                if pm is None:
                    hit = mem_cap_hit(log_path)
                    if hit is not None:  # scale_train aborted the smoke steps on --mem-cap-gb: no report, but the peak is known
                        att["probe"] = {"peak_driver_gb": hit, "cap_gb": step.cap_gb, "mem_cap_exceeded": True}
                        raise Skip(f"probe hit the memory cap ({hit:g} GB > {MEM_CAP_GB:g} GB)")
                    raise RuntimeError(f"probe produced no report (exit {rc}, see {step.log})")
                att["probe"] = {"peak_driver_gb": pm.get("peak_driver_gb"), "est_full_run_hours": pm.get("est_full_run_hours"), "cap_gb": step.cap_gb}
                if float(pm.get("peak_driver_gb", 0.0)) > step.cap_gb:
                    raise Skip(f"probe peak {pm.get('peak_driver_gb')} GB > cap {step.cap_gb:g} GB")
            att["prep_done"] = i + 1
            self.save()

    def train_finished(self, d: Derived) -> bool:
        run_dir = self.repo / "runs" / d.run_id
        log = run_dir / "train.log"
        if d.kind == "dpo":
            adapter = self.repo / d.cfg.adapter  # type: ignore[operator]
            if not (train_done(log, DPO_DONE) and (adapter / ADAPTER_CONFIG).exists()):
                return False
            if not has_checkpoint(run_dir):  # dpo_train aliases ckpt_step_NNNN -> round_N/adapter; recreate it if it is missing
                alias_adapter(run_dir, adapter)
            return True
        return train_done(log, TRAIN_DONE) and has_checkpoint(run_dir)

    def train(self, att: dict, d: Derived) -> None:
        run_dir = self.repo / "runs" / d.run_id
        log = run_dir / "train.log"
        steps = int(self.state["steps"])
        while True:
            if self.session_live(d.run_id):
                self.out(f"[{d.run_id}] tmux session live, waiting")
                self.wait_session(d.run_id)
            if self.train_finished(d):
                att["steps_trained"] = last_ckpt_step(run_dir) if d.kind == "train" else None
                return
            log_text = log.read_text(errors="replace") if log.exists() else ""
            hit = mem_cap_hit(log)
            if hit is not None:
                raise RuntimeError(f"training hit the memory cap ({hit:g} GB > {MEM_CAP_GB:g} GB, see {rel(log, self.repo)})")
            if "SCALE_TRAIN_PAUSED" in log_text:
                self.out(f"[{d.run_id}] scale_train paused the run (max hours); resuming")
            launches = int(att.get("launches", 0))
            if not may_relaunch(launches, last_exit(log, "RUN_EXIT")):
                raise RuntimeError(f"training did not finish after {launches} launch(es), last RUN_EXIT={last_exit(log, 'RUN_EXIT')} "
                                   f"(see {rel(log, self.repo)})")
            run_dir.mkdir(parents=True, exist_ok=True)
            if d.kind == "dpo":
                argv = self.dpo_argv(d)
            else:
                last = last_ckpt_step(run_dir)
                resume = (f"runs/{d.run_id}/ckpt_step_{last:04d}", last) if last > 0 else None
                if resume:
                    self.out(f"[{d.run_id}] resuming after step {last} (optimizer state not restored)")
                argv = self.train_argv(d.cfg, d.run_id, steps, resume)
            self.tmux_launch(d.run_id, self.shell_line(argv, f"runs/{d.run_id}/train.log", "RUN_EXIT"))
            att["launches"] = launches + 1
            att.setdefault("commands", []).append(shlex.join(self.wrap(argv)))
            self.save()
            sleep(LAUNCH_SETTLE_SECONDS)
            self.wait_session(d.run_id)

    def evaluate(self, att: dict, d: Derived) -> Path:
        ev = self.eval_json_path(d)
        log = self.repo / "runs" / d.run_id / "eval.log"
        name = f"{d.run_id}_eval"
        while True:
            if self.session_live(name):
                self.out(f"[{d.run_id}] eval session live, waiting")
                self.wait_session(name)
            if ev.exists() and last_exit(log, "EVAL_EXIT") == 0:
                return ev
            launches = int(att.get("eval_launches", 0))
            if not may_relaunch(launches, last_exit(log, "EVAL_EXIT")):
                raise RuntimeError(f"eval did not finish after {launches} launch(es), last EVAL_EXIT={last_exit(log, 'EVAL_EXIT')} "
                                   f"(see {rel(log, self.repo)})")
            argv = self.eval_argv(d.cfg, d.run_id, self.eval_run_arg(d))
            self.tmux_launch(name, self.shell_line(argv, f"runs/{d.run_id}/eval.log", "EVAL_EXIT"))
            att["eval_launches"] = launches + 1
            att.setdefault("commands", []).append(shlex.join(self.wrap(argv)))
            self.save()
            sleep(LAUNCH_SETTLE_SECONDS)
            self.wait_session(name)

    def conclude(self, att: dict, d: Derived, ev: Path) -> None:
        before = self.best.metrics
        after = read_metrics(load_json(ev))
        verdict = decide(before, after)
        # the variant's rights follow what IT trained on (the eval JSON's research_only describes the
        # pinned yardstick captions, which are the origin's)
        caps = self.repo / d.cfg.captions
        research_only = research_only_of(read_rows(caps)) if caps.exists() else d.cfg.research_only
        att.update({"before": {"ce_improvement": before.get("ce_improvement"), "fad": before.get("fad")},
                    "after": {"ce_improvement": after.get("ce_improvement"), "fad": after.get("fad")},
                    "d_fad": verdict["d_fad"], "d_ce": verdict["d_ce"], "eval_json": rel(ev, self.repo),
                    "status": "kept" if verdict["keep"] else "rejected", "note": verdict["reason"], "research_only": research_only})
        if verdict["keep"]:
            new = replace(d.cfg, eval_json=rel(ev, self.repo) or str(ev), metrics=after, changes=[*self.best.changes, d.variant],
                          research_only=research_only)
            self.state["best"] = asdict(new)
            self.state["consecutive_failures"] = 0
            dropped = compose_pending(self.state["attempts"], d.group)
            if dropped:
                att["note"] += f"; dropped {', '.join(dropped)}"
        else:
            self.state["consecutive_failures"] = int(self.state["consecutive_failures"]) + 1
        self.out(f"[{d.run_id}] {att['status'].upper()}: {verdict['reason']}")

    def attempt(self, att: dict) -> None:
        att.setdefault("started", now())
        att["index"] = next(i for i, a in enumerate(self.state["attempts"], 1) if a is att)
        best = self.best
        try:
            d = self.derive(att, best)
            att.update({"variant": d.variant, "run_id": d.run_id, "change": d.change, "kind": d.kind,
                        "steps": int(self.state["steps"]) if d.kind == "train" else None, "vs": best.run})
            self.save()
            if att.get("stage", "prep") == "prep":
                att["status"] = "prep"
                self.execute_prep(att, d)
                att["stage"] = "train"
                self.save()
            if att["stage"] == "train":
                att["status"] = "training"
                self.save()
                self.train(att, d)
                att["stage"] = "eval"
                self.save()
            if att["stage"] == "eval":
                att["status"] = "evaluating"
                self.save()
                ev = self.evaluate(att, d)
                att["stage"] = "decide"
                self.save()
                self.conclude(att, d, ev)
        except Skip as e:
            att.update({"status": "skipped", "note": str(e)})
            self.out(f"[{att.get('run_id', att['variant'])}] SKIPPED: {e}")
        except (RuntimeError, OSError, json.JSONDecodeError) as e:
            # a failed attempt is a change that was not kept: it counts toward the two-failure stop
            # (a systematic failure must not walk the whole plan at 1500 steps a variant)
            att.update({"status": "failed", "note": str(e)})
            self.state["consecutive_failures"] = int(self.state["consecutive_failures"]) + 1
            self.out(f"[{att.get('run_id', att['variant'])}] FAILED: {e}")
        att["ended"] = now()
        att["hours"] = round(hours_between(att["started"], att["ended"]), 2)
        self.save()
        self.write_log()

    def launched(self) -> int:
        return sum(1 for a in self.state["attempts"] if a["status"] in ("kept", "rejected", "failed"))

    def run(self) -> None:
        self.write_log()
        while True:
            pending = [a for a in self.state["attempts"] if a["status"] not in TERMINAL]
            if not pending:
                self.state["stopped"] = "plan exhausted"
                break
            if int(self.state["consecutive_failures"]) >= MAX_CONSECUTIVE_FAILURES:
                self.state["stopped"] = f"{MAX_CONSECUTIVE_FAILURES} consecutive failures"
                break
            mx = self.state.get("max_attempts")
            if mx is not None and self.launched() >= int(mx):
                self.state["stopped"] = f"max attempts ({mx}) reached"
                break
            self.attempt(pending[0])
        self.save()
        self.write_log()
        self.out(f"stopped: {self.state['stopped']}; best {self.best.run} (changes kept: {', '.join(self.best.changes) or 'none'})")

    # ----- dry run

    def print_plan(self) -> None:
        best = self.best
        m = best.metrics
        origin = self.state["origin"]
        self.out(f"best: runs/{best.run}  {best.model}  {lora_label(best)}  lr {fmt_lr(best.lr)}  {best.seconds:g} s clips  "
                 f"rights {rights_label(best.research_only)}" + (f"  adapter {best.adapter}" if best.adapter else ""))
        self.out(f"  captions: {best.captions}" + (f"  (transforms: {', '.join(best.transforms)})" if best.transforms else ""))
        self.out(f"  yardstick {best.eval_json}: CE improvement {fmt(m.get('ce_improvement'))}, FAD to real {fmt(m.get('fad'))}")
        self.out(f"  every variant is scored on {origin['eval_captions']} (the origin's test split and real pool)")
        self.out(f"  steps per variant {self.state['steps']}, max attempts {self.state.get('max_attempts') or 'unbounded'}, "
                 f"stop after {MAX_CONSECUTIVE_FAILURES} consecutive failures; state {rel(self.state_path, self.repo)}")
        pending = [a for a in self.state["attempts"] if a["status"] not in TERMINAL]
        for n, att in enumerate(pending, 1):
            try:
                d = self.derive(dict(att), best)
            except Skip as e:
                self.out(f"\n{n}. {att['variant']}: SKIP — {e}")
                continue
            self.out(f"\n{n}. {d.variant} -> runs/{d.run_id}: {d.change}")
            for step in d.prep:
                if step.kind == "py":
                    self.out(f"   - {step.describe}")
                else:
                    tail = f" > {step.log}" + (f"  [skip if peak_driver_gb > {step.cap_gb:g}]" if step.kind == "probe" else "")
                    self.out(f"   $ {shlex.join(self.wrap(step.argv or []))}{tail}")
            if d.kind == "dpo":
                self.out(f"   $ {self.tmux_launch_line(d.run_id, self.shell_line(self.dpo_argv(d), f'runs/{d.run_id}/train.log', 'RUN_EXIT'))}")
            else:
                argv = self.train_argv(d.cfg, d.run_id, int(self.state["steps"]))
                self.out(f"   $ {self.tmux_launch_line(d.run_id, self.shell_line(argv, f'runs/{d.run_id}/train.log', 'RUN_EXIT'))}")
            self.out(f"   - wait: tmux has-session -t ={d.run_id}")
            ev_argv = self.eval_argv(d.cfg, d.run_id, self.eval_run_arg(d))
            self.out(f"   $ {self.tmux_launch_line(d.run_id + '_eval', self.shell_line(ev_argv, f'runs/{d.run_id}/eval.log', 'EVAL_EXIT'))}")
            self.out(f"   - wait: tmux has-session -t ={d.run_id}_eval")
            self.out(f"   - decide from {rel(self.eval_json_path(d), self.repo)}: keep iff mert.fad_adapter_real < {fmt(m.get('fad'))} "
                     f"and per_song_ce.improvement.mean > {fmt(m.get('ce_improvement'))}")
        self.out("\n(dry run: nothing launched, nothing written; decisions assume no change is kept)")


def train_cfg(best: Config, run_id: str, **changes: object) -> Config:
    """A training variant's Config: the best with the changes, and no DPO adapter (it trains an SFT run)."""
    return replace(best, run=run_id, adapter=None, **changes)  # type: ignore[arg-type]


def may_relaunch(launches: int, exit_code: int | None) -> bool:
    """Relaunch policy of a variant's training / eval: a launch that was killed (no exit marker)
    or ended cleanly without finishing (a pause, exit 0) may be repeated up to MAX_LAUNCHES
    times; one that exited with an error gets MAX_ERROR_RELAUNCHES more."""
    if exit_code is None or exit_code == 0:
        return launches < MAX_LAUNCHES
    return launches < 1 + MAX_ERROR_RELAUNCHES


def mem_cap_hit(log: Path) -> float | None:
    """The driver GB of scale_train's MEM_CAP_EXCEEDED abort line in a log, or None."""
    if not log.exists():
        return None
    found = MEM_CAP_RE.findall(log.read_text(errors="replace"))
    return float(found[-1]) if found else None


def alias_adapter(run_dir: Path, adapter: Path, step: int = 1) -> Path:
    """dpo_train's ckpt_step alias (relative symlink run_dir/ckpt_step_NNNN -> round_N/adapter)
    so scale_eval --run runs/<run> finds the adapter like an SFT checkpoint."""
    alias = run_dir / f"ckpt_step_{step:04d}"
    if not alias.exists() and not alias.is_symlink():
        alias.symlink_to(Path(os.path.relpath(adapter, run_dir)), target_is_directory=True)
    return alias


# --------------------------------------------------------------------------- report

def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def hours_between(a: str, b: str) -> float:
    fmt_ = "%Y-%m-%dT%H:%M:%S"
    return (time.mktime(time.strptime(b, fmt_)) - time.mktime(time.strptime(a, fmt_))) / 3600


def fmt(x: object, nd: int = 4) -> str:
    if x is None:
        return "—"
    if isinstance(x, float):
        return f"{x:.{nd}f}"
    return str(x)


def lora_label(cfg: Config) -> str:
    return "full decoder" if cfg.full else f"LoRA r{cfg.rank} α{cfg.alpha}"


def render_log(state: dict, repo: Path) -> str:
    """docs/eval/IMPROVEMENT_LOG.md from the state: rule, current best, one table row per attempt."""
    best = Config(**state["best"])
    origin = state["origin"]
    m, om = best.metrics, origin.get("metrics", {})
    lines = [
        f"# Improvement log — Phase 4 loop from `runs/{origin['run']}`", "",
        f"Generated by `scripts/improve_loop.py` on {now()} from `{STATE_REL}`; nothing here is typed by hand. "
        f"Rerun the script to regenerate.", "",
        f"**Rule.** Every attempt is a bounded run of {state['steps']} steps (fixed-dropout harness, batch 1, "
        f"checkpoint + validation every {CKPT_EVERY} steps, early stop after {EARLY_STOP_PATIENCE} flat steps, memory cap {MEM_CAP_GB:g} GB) "
        f"that changes ONE thing against the current best and is scored by `scripts.scale_eval` (`--mert-real {MERT_REAL} --n-ab {N_AB} --ab-seconds {AB_SECONDS}`). "
        f"A change is kept only when both `mert.fad_adapter_real` (MERT-FAD to real held-out qaraami clips) decreases "
        f"and `per_song_ce.improvement.mean` (per-song test CE, base − adapter) increases; a kept change becomes the new best and later changes compose on it; "
        f"the loop stops after {MAX_CONSECUTIVE_FAILURES} consecutive changes that were not kept (rejected on the numbers or failed), after the attempt cap, "
        f"or when the plan is exhausted; a skipped variant counts as neither. "
        f"Every variant trains on its own captions but is scored on the origin's captions file `{origin.get('eval_captions', best.captions)}` "
        f"(the same test split, real MERT pool and test tokens for every row of the table), so the deltas are comparable. "
        f"Variants are bounded runs, so a rejection means the change did not beat the best within {state['steps']} steps. "
        f"Rights follow the training rows: a configuration trained on any `harvard_*` row is research-only (tailnet service only, never published).", "",
        f"**Origin.** `runs/{origin['run']}` ({best.model}, rights: {rights_label(origin.get('research_only'))}): "
        f"CE improvement {fmt(om.get('ce_improvement'))}, FAD to real {fmt(om.get('fad'))} (`{origin['eval_json']}`).", "",
        f"**Current best.** `runs/{best.run}` — {best.model}, {lora_label(best)}, lr {fmt_lr(best.lr)}, {best.seconds:g} s clips, "
        f"rights: {rights_label(best.research_only)}, captions `{best.captions}`" + (f" (transforms: {', '.join(best.transforms)})" if best.transforms else "") +
        (f", adapter `{best.adapter}`" if best.adapter else "") +
        f"; CE improvement {fmt(m.get('ce_improvement'))}, FAD to real {fmt(m.get('fad'))}; "
        f"kept changes: {', '.join(best.changes) if best.changes else 'none'}.", "",
        f"Plan: {', '.join(state['plan'])}" + (f" (only: {', '.join(state['only'])})" if state.get("only") else "") +
        f"; consecutive failures: {state['consecutive_failures']}; status: **{state.get('stopped') or 'running'}**.", "",
        "| # | change | run id | steps | CE improvement before → after | FAD before → after | decision | rights | wall-clock | note |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for i, a in enumerate(state["attempts"], 1):
        before, after = a.get("before") or {}, a.get("after") or {}
        ce = f"{fmt(before.get('ce_improvement'))} → {fmt(after.get('ce_improvement'))}" + (f" ({a['d_ce']:+.4f})" if a.get("d_ce") is not None else "")
        fad = f"{fmt(before.get('fad'))} → {fmt(after.get('fad'))}" + (f" ({a['d_fad']:+.4f})" if a.get("d_fad") is not None else "")
        if not (before or after):
            ce = fad = "—"
        steps = a.get("steps")
        trained = a.get("steps_trained")
        steps_s = "—" if steps is None else (str(steps) if not trained or trained >= steps else f"{steps} (stopped at {trained})")
        if a.get("kind") == "dpo" and a.get("status") in ("kept", "rejected"):
            steps_s = "DPO round"
        run_id = f"`{a['run_id']}`" if a.get("run_id") else "—"
        hours = f"{a['hours']:.1f} h" if a.get("hours") is not None else "—"
        status = a.get("status", "pending")
        decision = {"kept": "**kept**", "rejected": "rejected", "skipped": "skipped", "failed": "failed", "dropped": "dropped"}.get(status, status)
        vs = f" (vs `{a['vs']}`)" if a.get("vs") and status in ("kept", "rejected") else ""
        note = (a.get("note") or "").replace("|", "\\|")
        if a.get("probe") and "probe peak" not in note and "memory cap" not in note:
            note = (note + "; " if note else "") + f"probe peak {a['probe'].get('peak_driver_gb')} GB"
        rights = rights_label(a.get("research_only")) if status in ("kept", "rejected") else "—"
        lines.append(f"| {i} | {a.get('change') or a['variant']} | {run_id} | {steps_s} | {ce} | {fad} | {decision}{vs} | {rights} | {hours} | {note} |")
    lines += ["", f"Attempt directories: `runs/<run id>/` (train.log, probe.log, eval.log, `eval_<run id>.json`; a DPO round's adapter under "
                  f"`round_1/adapter/`, aliased as `ckpt_step_NNNN`). "
                  f"A/B sets: `data/ab_<run id>/` ({N_AB} pairs at {AB_SECONDS} s, listed by `scripts.ab_listen`).", ""]
    return "\n".join(lines)


# --------------------------------------------------------------------------- CLI

def check_tools(out: Callable[[str], None]) -> None:
    for tool in ("tmux", "caffeinate"):
        if shutil.which(tool) is None:
            out(f"warning: {tool} not found on PATH; the loop cannot launch runs without it")


def parse_plan(items: list[str] | None) -> list[str]:
    if not items:
        return list(DEFAULT_PLAN)
    out: list[str] = []
    for it in items:
        out += [p.strip() for p in it.split(",") if p.strip()]
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--best-run", default=None, help="runs/<run> of the best Phase 2 run (ignored when state.json exists)")
    ap.add_argument("--eval-json", default=None, help="override the best run's eval JSON")
    ap.add_argument("--plan", action="append", default=None, help=f"comma list / repeated; default {','.join(DEFAULT_PLAN)}")
    ap.add_argument("--only", action="append", default=None, help="run only these variants or groups (repeatable)")
    ap.add_argument("--steps", type=int, default=None, help=f"steps per variant run (default {DEFAULT_STEPS})")
    ap.add_argument("--max-attempts", type=int, default=None, help="stop after this many launched attempts")
    ap.add_argument("--dry-run", action="store_true", help="print the plan and every command; launch and write nothing")
    ap.add_argument("--dpo-run", default=None, help="dpo_round2: the runs/dpo_<tag> to continue (default: lowest FAD round on the same base)")
    ap.add_argument("--extra-train-args", default="", help="appended to every scale_train command (shell-split)")
    ap.add_argument("--extra-eval-args", default="", help="appended to every scale_eval command (shell-split)")
    ap.add_argument("--repo", default=str(REPO), help="repo root (fixtures / tests)")
    ap.add_argument("--state", default=STATE_REL, help="state JSON, repo-relative")
    ap.add_argument("--log", default=LOG_REL, help="Markdown log, repo-relative")
    ap.add_argument("--python", default=DEFAULT_PYTHON, help="interpreter for the launched scripts")
    args = ap.parse_args(argv)

    repo = Path(args.repo).resolve()
    state_path = repo / args.state if not Path(args.state).is_absolute() else Path(args.state)
    log_path = repo / args.log if not Path(args.log).is_absolute() else Path(args.log)
    loop = Loop(repo, state_path, log_path, args.python, dry_run=args.dry_run,
                extra_train=shlex.split(args.extra_train_args), extra_eval=shlex.split(args.extra_eval_args), dpo_run=args.dpo_run)
    check_tools(loop.out)

    if loop.load_state():
        if args.best_run and Path(args.best_run).name != loop.state["origin"]["run"]:
            loop.out(f"note: {rel(state_path, repo)} continues from runs/{loop.state['origin']['run']}; --best-run {args.best_run} ignored")
        if args.steps is not None:
            loop.state["steps"] = args.steps
        if args.max_attempts is not None:
            loop.state["max_attempts"] = args.max_attempts
        if args.only:
            for a in loop.state["attempts"]:  # the same rule as expand_plan at start-up (an unresolved "data" attempt included)
                if a["status"] in TERMINAL:
                    continue
                if not matches_only(a["variant"], a["group"], args.only):
                    a["status"], a["note"] = "dropped", "not in --only"
                else:
                    a["variant"] = pin_data_direction(a["variant"], args.only)
        loop.out(f"resuming {rel(state_path, repo)}: best runs/{loop.best.run}, "
                 f"{sum(1 for a in loop.state['attempts'] if a['status'] not in TERMINAL)} attempts pending")
    else:
        if not args.best_run:
            ap.error("--best-run is required when no state.json exists")
        run_dir = Path(args.best_run)
        run_dir = run_dir if run_dir.is_absolute() else repo / run_dir
        if not run_dir.is_dir():
            ap.error(f"--best-run {args.best_run}: not a directory")
        ev = find_eval_json(run_dir, args.eval_json, repo)
        best = config_from_run(run_dir, ev, repo)
        require_yardstick(best)
        loop.init_state(best, parse_plan(args.plan), args.only, args.steps or DEFAULT_STEPS, args.max_attempts)

    if args.dry_run:
        loop.print_plan()
        return
    loop.save()
    loop.run()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
