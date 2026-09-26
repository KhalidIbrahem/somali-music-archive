"""Register a finished run's best checkpoint with the QaraamiGen inference service.

The service (services/musicgen-api/app.py) merges services/musicgen-api/adapters.extra.json
into its adapter registry at start-up, so a new adapter is served without editing
Python. This script writes that entry from what the run already produced:

  * the best checkpoint: the one the eval JSON evaluated (eval_<tag>.json
    "best_ckpt") when it still exists, else scale_eval.find_best_ckpt (lowest val
    CE among the SAVED checkpoints, then the last one)
  * the kind: --kind lora | full_decoder, or auto = scale_train.ckpt_kind of the
    checkpoint (decoder.safetensors -> full_decoder, adapter_config.json -> lora)
  * metrics: val CE base -> adapter from loss.csv (step 0 and the best step; the
    full-decoder ckpt_meta.json val_loss is the fallback), per-song test CE base ->
    adapter with its bootstrap CI from the eval JSON, the MERT block (closer_to_real,
    FAD adapter/base -> real) when the eval has one, the A/B PCS / trackable-melody
    means and the tuning-offset summary
  * rights, derived from the run's captions (config.json -> captions): any harvard_*
    row makes the adapter research_only, and so does any rights label outside the
    releasable set (ahmed_*, internet_cc, contrib_*_consented); --rights overrides
    the unknown-label case only — a run that saw Harvard rows is research-only
    whatever the flag says (tailnet-only service, never the public site, never
    published)
  * corpus text from the captions' sources (clips, songs, hours), unless --corpus
  * the trained line from config.json: the v2 harness keys (rank/alpha/targets), the
    2026-08 harness keys (lora_r/lora_alpha/lora_targets), or, for a scripts.dpo_train
    run (start_adapter, rounds, prompts_per_round, samples_per_prompt, beta), a DPO
    line; a DPO entry also records its parent adapter

The --name must be one the service will actually serve: NAME_RE below is the
service's own rule (a name it rejects is dropped from the registry at start-up).

The entry is upserted by name (idempotent: registering twice leaves one entry; an
existing listening_gate survives unless --listening-gate is given) and the file is
written atomically (temp file + rename). Then the launchctl kickstart command is
printed. With --restart the script runs it, polls /health until the new adapter
reports loaded (up to --timeout seconds, default 600), pre-warms it with one
--prewarm-seconds /generate using the bearer token from the service env file
(~/ai/musicgen-api/musicgen-api.env, outside the repo) and prints the timing.
Nothing here moves, copies or serves audio or weights: the entry points at the
checkpoint where the trainer left it.

Usage (from apps/ai-service):
  python -m scripts.register_adapter --run runs/qaraami_large --name qaraami_large --base facebook/musicgen-large
  python -m scripts.register_adapter --run runs/qaraami_medium_full --name qaraami_medium_full --kind auto
  python -m scripts.register_adapter --run runs/qaraami_large_all --name qaraami_large_all --rights research_only --restart
  python -m scripts.register_adapter --run runs/qaraami_large --name qaraami_large --dry-run   # print, write nothing
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from collections.abc import Callable
from pathlib import Path

from scripts.scale_eval import (
    find_best_ckpt,
    is_harvard,
    resolve,
    resolve_captions_arg,
    source_counts,
)
from scripts.scale_train import ADAPTER_CONFIG, CKPT_META, DECODER_WEIGHTS, ckpt_kind

REPO = Path(__file__).resolve().parents[3]
REGISTRY = REPO / "services/musicgen-api/adapters.extra.json"
SERVICE_ENV = Path(os.environ.get("MUSICGEN_API_ENV_FILE", Path.home() / "ai/musicgen-api/musicgen-api.env"))
LAUNCHD_LABEL = "com.qaraamigen.musicgen-api"
KINDS = ("lora", "full_decoder")
RIGHTS_VALUES = ("releasable", "research_only")
# Mirrors services/musicgen-api/app.py NAME_RE (test_registry.py checks they agree): an
# entry whose name fails it is dropped by the service at start-up, so refuse it here.
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$")
RESERVED_NAME = "base"
NOT_GATED = "not yet performed"
DEFAULT_PORT = 8765
PREWARM_PROMPT = "Somali qaraami led by the oud (kaban), moderate at 100 BPM, pentatonic melody rooted on A, intimate home recording"
TARGET_SHORT = {"q_proj": "q", "k_proj": "k", "v_proj": "v", "out_proj": "out", "fc1": "fc1", "fc2": "fc2"}


# --- rights ------------------------------------------------------------------------------

def releasable_label(rights: str) -> bool:
    """A rights label the brief allows in a releasable adapter: Ahmed Ilkacase's
    consented sets (ahmed_*), openly licensed internet audio (internet_cc) and
    contributors who consented (contrib_<slug>_consented)."""
    return rights.startswith("ahmed_") or rights == "internet_cc" or (rights.startswith("contrib_") and rights.endswith("_consented"))


def rights_histogram(captions: Path) -> Counter:
    """{rights label: rows} over every row of the captions file (all splits: a
    set that only contributes val/test rows still shaped the run)."""
    hist: Counter = Counter()
    with open(captions) as fh:
        for line in fh:
            line = line.strip()
            if line:
                row = json.loads(line)
                hist[str(row.get("rights") or ("harvard" if is_harvard(row) else "unlabelled"))] += 1
    return hist


def derive_rights(hist: Counter) -> tuple[str, dict[str, list[str]]]:
    """("releasable" | "research_only", reasons). Harvard rows (rights or source
    harvard*) are decisive; any other label outside the releasable set is
    reported under "unknown" and also makes the derived rights research_only, the
    conservative default the --rights flag may override."""
    harvard = sorted(r for r in hist if r.startswith("harvard"))
    unknown = sorted(r for r in hist if not r.startswith("harvard") and not releasable_label(r))
    reasons = {"harvard": harvard, "unknown": unknown}
    return ("research_only" if harvard or unknown else "releasable"), reasons


def decide_rights(hist: Counter, requested: str | None) -> str:
    """The rights the entry gets: the derived value, or --rights when it only
    overrides unknown labels. A run that trained on Harvard rows cannot be made
    releasable (SystemExit)."""
    derived, reasons = derive_rights(hist)
    if requested is None:
        return derived
    if requested == "releasable" and reasons["harvard"]:
        raise SystemExit(f"--rights releasable refused: the run's captions carry Harvard rows ({reasons['harvard']}); "
                         "adapters trained on them are research-only")
    return requested


# --- run artefacts ----------------------------------------------------------------------

def read_json(path: Path) -> dict:
    return json.loads(path.read_text()) if path.exists() else {}


def pick_eval_json(run: Path, tag: str | None) -> Path | None:
    """eval_<tag>.json when --tag is given (missing -> None), else eval_<run name>.json,
    else the most recently written eval_*.json, else None."""
    if tag:
        p = run / f"eval_{tag}.json"
        return p if p.exists() else None
    own = run / f"eval_{run.name}.json"
    if own.exists():
        return own
    cands = sorted(run.glob("eval_*.json"), key=lambda p: p.stat().st_mtime)
    return cands[-1] if cands else None


def dpo_round_adapters(run: Path) -> list[Path]:
    """A DPO run's round_N/adapter checkpoints, in round order."""
    found = []
    for p in run.glob("round_*/adapter"):
        m = re.fullmatch(r"round_(\d+)", p.parent.name)
        if m and ckpt_kind(p) is not None:
            found.append((int(m.group(1)), p))
    return [p for _, p in sorted(found)]


def best_checkpoint(run: Path, ev: dict) -> Path:
    """The checkpoint to serve: the one the eval measured (ev["best_ckpt"]) when
    it still exists, else scale_eval.find_best_ckpt over ckpt_step_* (which
    includes a DPO run's ckpt_step_NNNN alias). A DPO run without the alias
    (older dpo_train layouts) falls back to its summary.json final adapter, then
    to the last round_N/adapter. A run without any checkpoint is an error."""
    name = ev.get("best_ckpt")
    if name and (run / str(name)).is_dir():
        return run / str(name)
    ckpt = find_best_ckpt(run)
    if ckpt != run:
        return ckpt
    final = (read_json(run / "summary.json")).get("adapter")
    if final and Path(str(final)).is_dir() and ckpt_kind(Path(str(final))) is not None:
        return Path(str(final))
    rounds = dpo_round_adapters(run)
    if rounds:
        return rounds[-1]
    raise SystemExit(f"{run}: no ckpt_step_* checkpoint (nor round_N/adapter) to register")


def step_of(ckpt: Path) -> int | None:
    tail = ckpt.name.rsplit("_", 1)[-1]
    return int(tail) if tail.isdigit() else None


def detect_kind(ckpt: Path, requested: str) -> str:
    """--kind lora|full_decoder as asked (checked against what the directory
    holds), or auto from scale_train.ckpt_kind. A directory that is not a
    checkpoint at all is refused whatever --kind says: the service would only
    fail on it at load time."""
    found = ckpt_kind(ckpt)
    if found is None:
        raise SystemExit(f"{ckpt}: neither {ADAPTER_CONFIG} nor {DECODER_WEIGHTS} found; not a checkpoint")
    if requested == "auto":
        return found
    if requested not in KINDS:
        raise SystemExit(f"--kind {requested!r}: expected auto, lora or full_decoder")
    if found != requested:
        raise SystemExit(f"--kind {requested} but {ckpt} holds a {found} checkpoint")
    return requested


def valid_name(name: str) -> bool:
    """An adapter name the service will serve: ASCII letter or digit first, then
    letters, digits, _ . -, at most 40 chars, and not the reserved "base"."""
    return bool(NAME_RE.fullmatch(name)) and name != RESERVED_NAME


def val_ce(run: Path, ckpt: Path) -> dict | None:
    """{"base": val CE at step 0, "adapter": val CE at the checkpoint's step} from
    loss.csv (the full-decoder ckpt_meta.json val_loss is the fallback for the
    adapter side). None when neither number exists."""
    step = step_of(ckpt)
    base = adapter = None
    lc = run / "loss.csv"
    if lc.exists():
        with open(lc) as fh:
            for row in csv.DictReader(fh):
                if not row.get("val_loss"):
                    continue
                try:
                    s, v = int(row["step"]), float(row["val_loss"])
                except (KeyError, ValueError):
                    continue
                if s == 0:
                    base = v
                elif step is not None and s == step:
                    adapter = v
    if adapter is None:
        meta = read_json(ckpt / CKPT_META)
        if isinstance(meta.get("val_loss"), int | float):
            adapter = float(meta["val_loss"])
    if base is None and adapter is None:
        return None
    return {"base": base, "adapter": adapter}


def test_ce(ev: dict) -> dict | None:
    """Per-song test CE base -> adapter with the bootstrap CI of the improvement."""
    ps = ev.get("per_song_ce")
    if not isinstance(ps, dict):
        return None
    imp = ps.get("improvement_base_minus_adapter") or {}
    return {"base": (ps.get("base") or {}).get("mean"), "adapter": (ps.get("adapter") or {}).get("mean"),
            "n_songs": ps.get("n_songs"), "improvement": imp.get("mean"), "improvement_ci95": imp.get("ci95"),
            "significant": imp.get("significant")}


def mert_summary(ev: dict) -> dict | None:
    """The eval's MERT block, reduced to what the model card needs."""
    m = ev.get("mert")
    if not isinstance(m, dict):
        return None
    keys = ("closer_to_real", "fad_adapter_real", "fad_base_real", "fad_adapter_base", "cos_adapter", "cos_base",
            "nn_cos_adapter", "nn_cos_base", "delta_mean", "delta_ci95", "n_real", "n_gen")
    return {k: m[k] for k in keys if k in m}


def ab_summary(ev: dict) -> dict | None:
    ab = ev.get("ab")
    if not isinstance(ab, dict):
        return None
    return {"n": ab.get("n"), "seconds": ab.get("seconds"), "base": ab.get("base"), "adapter": ab.get("adapter")}


def tuning_summary(ev: dict) -> dict | None:
    t = ev.get("tuning")
    if not isinstance(t, dict):
        return None
    return {k: t.get(k) for k in ("threshold_cents", "real", "base", "adapter", "ks_real_adapter", "ks_real_base") if k in t}


def build_metrics(run: Path, ckpt: Path, ev: dict) -> dict:
    out: dict = {}
    for key, value in (("val_ce", val_ce(run, ckpt)), ("test_ce", test_ce(ev)), ("mert", mert_summary(ev)),
                       ("ab", ab_summary(ev)), ("tuning", tuning_summary(ev))):
        if value is not None:
            out[key] = value
    if isinstance(ev.get("scorer_version"), dict):
        out["scorer_version"] = ev["scorer_version"]
    return out


# --- entry text --------------------------------------------------------------------------

def corpus_text(captions: Path) -> str:
    """"<source> (n clips, n songs), ... — H h" from every row of the captions file."""
    rows = []
    with open(captions) as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    counts = source_counts(rows)
    parts = [f"{src} ({c['clips']:,} clips, {c['songs']} songs)" for src, c in counts.items()]
    hours = sum(float(r.get("seconds") or 0) for r in rows) / 3600
    text = ", ".join(parts) if parts else "an empty captions file"
    return f"{text} — {hours:.1f} h" if hours > 0 else text


def dpo_start_adapter(cfg: dict) -> str | None:
    """The adapter a scripts.dpo_train run started from, else None: config.json
    start_adapter (current dpo_train), or the 2026-09-08 layout's --adapter argument
    beside the round keys (runs/dpo_large). The SFT harness writes none of these."""
    if cfg.get("start_adapter") and "rounds" in cfg:
        return str(cfg["start_adapter"])
    if cfg.get("adapter") and "rounds" in cfg and "prompts_per_round" in cfg:
        return str(cfg["adapter"])
    return None


def is_dpo_run(cfg: dict) -> bool:
    return dpo_start_adapter(cfg) is not None


def dpo_parent(cfg: dict) -> str | None:
    """The adapter a DPO run started from (repo-relative), else None."""
    start = dpo_start_adapter(cfg)
    return repo_relative(Path(start)) if start else None


def trained_text(cfg: dict, kind: str, ckpt: Path, summary: dict | None = None) -> str:
    """One line in the style of the built-in entries: date, recipe, schedule, best step.
    LoRA rank/alpha/targets come from the v2 harness keys (rank, alpha, targets) or
    the 2026-08 harness keys (lora_r, lora_alpha, lora_targets). A DPO run gets a
    DPO line (rounds done from its summary.json when given, else the rounds asked
    for; candidates per round; beta; lr; the parent adapter)."""
    date = time.strftime("%Y-%m-%d", time.localtime(ckpt.stat().st_mtime)) if ckpt.exists() else "date unknown"
    lr = cfg.get("lr")
    lr_s = f"{lr:g}" if isinstance(lr, int | float) else "?"
    step = step_of(ckpt)
    if is_dpo_run(cfg):
        rounds = (summary or {}).get("rounds_done") or cfg.get("rounds", "?")
        ppr, spp = cfg.get("prompts_per_round", "?"), cfg.get("samples_per_prompt", "?")
        cands = cfg.get("candidates_per_round") or (ppr * spp if isinstance(ppr, int) and isinstance(spp, int) else "?")
        tail = f"best checkpoint step {step}" if step is not None else "final round adapter"  # no ckpt_step alias: round_N/adapter
        return (f"{date}, DPO {rounds} round(s) of {ppr}x{spp} = {cands} candidates at {cfg.get('seconds', '?')} s, "
                f"beta {cfg.get('beta', '?')}, lr {lr_s}, from {dpo_parent(cfg)}, {tail}")
    if kind == "full_decoder":
        recipe = "full fine-tune of the decoder (no LoRA)"
    else:
        targets = cfg.get("targets") or cfg.get("lora_targets") or []
        rank = cfg.get("rank") or cfg.get("lora_r") or "?"
        alpha = cfg.get("alpha") or cfg.get("lora_alpha") or "?"
        tgt = "/".join(TARGET_SHORT.get(t, t) for t in targets) if targets else "projections"
        recipe = f"LoRA r={rank} α={alpha} on decoder {tgt}"
    steps = cfg.get("total_steps", "?")
    tail = f"best checkpoint step {step}" if step is not None else "checkpoint step unknown"
    return f"{date}, {recipe}, lr {lr_s} cosine, up to {steps:,} steps, {tail}" if isinstance(steps, int) \
        else f"{date}, {recipe}, lr {lr_s} cosine, {tail}"


def repo_relative(path: Path, repo: Path = REPO) -> str:
    """Repo-relative when the path lies under the repo (portable across checkouts), else absolute."""
    try:
        return str(path.resolve().relative_to(repo.resolve()))
    except ValueError:
        return str(path.resolve())


def build_entry(name: str, run: Path, ckpt: Path, kind: str, base: str, rights: str, corpus: str, cfg: dict, ev: dict,
                eval_json: Path | None, hist: Counter, listening_gate: str | None) -> dict:
    """The adapters.extra.json entry (the service's normalise_entry accepts it)."""
    return {
        "name": name,
        "kind": kind,
        "path": repo_relative(ckpt),
        "base": base,
        "corpus": corpus,
        "trained": trained_text(cfg, kind, ckpt, read_json(run / "summary.json")),
        "parent": dpo_parent(cfg),  # the adapter a DPO run started from; None for SFT runs
        "metrics": build_metrics(run, ckpt, ev),
        "listening_gate": listening_gate,  # None: keep the registered gate, else "not yet performed"
        "rights": rights,
        "best_step": step_of(ckpt),
        "run": repo_relative(run),
        "eval_json": repo_relative(eval_json) if eval_json else None,
        "trained_on_rights": dict(sorted(hist.items())),
        "registered": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


# --- registry file -----------------------------------------------------------------------

def load_registry(path: Path) -> list[dict]:
    """The registry list; a missing file is empty; anything but a JSON list is an error."""
    if not path.exists():
        return []
    try:
        entries = json.loads(path.read_text())
    except ValueError as exc:
        raise SystemExit(f"{path}: not valid JSON ({exc}); fix or remove it before registering") from exc
    if not isinstance(entries, list):
        raise SystemExit(f"{path}: top level must be a JSON list of adapter entries")
    return entries


def upsert_entry(entries: list[dict], entry: dict) -> list[dict]:
    """Replace the entry with the same name in place (order kept) or append. An
    entry whose listening_gate is None inherits the existing entry's gate, so
    re-registering never resets a gate that has been performed."""
    new = dict(entry)
    out = []
    replaced = False
    for e in entries:
        if isinstance(e, dict) and e.get("name") == new["name"] and not replaced:
            if new.get("listening_gate") is None:
                new["listening_gate"] = e.get("listening_gate") or NOT_GATED
            out.append(new)
            replaced = True
        else:
            out.append(e)
    if not replaced:
        if new.get("listening_gate") is None:
            new["listening_gate"] = NOT_GATED
        out.append(new)
    return out


def write_registry(path: Path, entries: list[dict]) -> None:
    """Atomic: the JSON goes to a temp file in the same directory, then os.replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


# --- service restart, readiness, pre-warm ---------------------------------------------

def kickstart_command(uid: int | None = None) -> list[str]:
    return ["launchctl", "kickstart", "-k", f"gui/{os.getuid() if uid is None else uid}/{LAUNCHD_LABEL}"]


def service_env(env_file: Path = SERVICE_ENV) -> dict[str, str]:
    """KEY=value pairs of the service env file (token, port); empty when absent."""
    out: dict[str, str] = {}
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"')
    return out


def fetch_json(url: str, token: str | None = None, body: dict | None = None, timeout: float = 30.0) -> dict:
    """GET (or POST `body` as JSON) and decode the JSON reply; HTTP errors raise."""
    headers = {"content-type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 headers=headers, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 — loopback only
        return json.loads(res.read())


def adapter_status(health: dict, adapter: str) -> dict | None:
    for row in health.get("adapter_details") or []:
        if row.get("id") == adapter:
            return row
    return None


def wait_for_ready(base_url: str, adapter: str, timeout_s: float = 600.0, poll_s: float = 5.0,
                   fetch: Callable[..., dict] = fetch_json, sleep: Callable[[float], None] = time.sleep,
                   clock: Callable[[], float] = time.monotonic) -> dict:
    """Poll /health until the service is up AND `adapter` reports loaded. Returns
    {"health", "waited_seconds", "polls"}. RuntimeError at once when waiting cannot
    help: the service does not list the adapter, its engine failed, or its engine
    is ready without it (weights missing at load time; the row's `error` says so).
    The deadline raises TimeoutError."""
    t0 = clock()
    polls = 0
    last_state = "unreachable"
    while True:
        polls += 1
        try:
            health = fetch(f"{base_url}/health", timeout=10)
        except (urllib.error.URLError, OSError, ValueError, TimeoutError):
            health = None
        if health is not None:
            row = adapter_status(health, adapter)
            if row is None:
                raise RuntimeError(f"the service does not list adapter {adapter!r}: {[r.get('id') for r in health.get('adapter_details') or []]}")
            last_state = str(row.get("engine_state"))
            if row.get("loaded"):
                return {"health": health, "waited_seconds": round(clock() - t0, 1), "polls": polls}
            if last_state == "failed":
                err = row.get("error") or (health.get("engines") or {}).get(row.get("engine") or "", {}).get("error")
                raise RuntimeError(f"adapter {adapter!r}: its engine failed to load ({err})")
            if last_state == "ready":  # the engine finished without this adapter: only a restart with the weights present changes that
                raise RuntimeError(f"adapter {adapter!r}: its engine is ready but the adapter did not load "
                                   f"({row.get('error') or 'weights missing when the engine loaded?'})")
        if clock() - t0 >= timeout_s:
            raise TimeoutError(f"adapter {adapter!r} not loaded after {timeout_s:.0f} s (last state: {last_state})")
        sleep(poll_s)


def prewarm(base_url: str, token: str, adapter: str, seconds: int = 5, fetch: Callable[..., dict] = fetch_json,
            clock: Callable[[], float] = time.monotonic) -> dict:
    """One short /generate on the adapter (so the first real request is not the
    slow one). Returns the reply's timing fields plus the wall-clock round trip."""
    t0 = clock()
    meta = fetch(f"{base_url}/generate", token=token, timeout=600,
                 body={"prompt": PREWARM_PROMPT, "duration": seconds, "seed": 7, "adapter": adapter, "score": False})
    return {"adapter": adapter, "id": meta.get("id"), "generation_seconds": meta.get("generation_seconds"),
            "total_seconds": meta.get("total_seconds"), "seconds_generated": meta.get("seconds_generated"),
            "round_trip_seconds": round(clock() - t0, 2)}


def restart_and_warm(adapter: str, seconds: int, timeout_s: float, env_file: Path = SERVICE_ENV) -> dict:
    env = service_env(env_file)
    token = env.get("MUSICGEN_API_TOKEN", "")
    if not token:
        raise SystemExit(f"no MUSICGEN_API_TOKEN in {env_file}; cannot pre-warm")
    port = int(env.get("MUSICGEN_API_PORT") or DEFAULT_PORT)
    base_url = f"http://127.0.0.1:{port}"
    cmd = kickstart_command()
    print("restart:", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)
    time.sleep(2)  # let the old listener go away before the first poll
    ready = wait_for_ready(base_url, adapter, timeout_s=timeout_s)
    print(f"ready: {adapter} loaded after {ready['waited_seconds']} s ({ready['polls']} polls)", flush=True)
    warm = prewarm(base_url, token, adapter, seconds)
    print(f"prewarm: {seconds} s clip in {warm['round_trip_seconds']} s round trip "
          f"(generation {warm['generation_seconds']} s, id {warm['id']})", flush=True)
    return {"ready": ready, "prewarm": warm}


# --- main ------------------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> dict:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--run", required=True, help="runs/<run> (repo-relative or absolute)")
    ap.add_argument("--name", required=True, help="adapter name on the service (also the registry key)")
    ap.add_argument("--base", default=None, help="base model id; default: the run's config.json model")
    ap.add_argument("--kind", default="auto", help="auto | lora | full_decoder")
    ap.add_argument("--rights", choices=RIGHTS_VALUES, default=None, help="override the rights derived from the captions (never past Harvard rows)")
    ap.add_argument("--corpus", default=None, help="corpus description; default: sources from the run captions")
    ap.add_argument("--tag", default=None, help="eval_<tag>.json to read; default eval_<run>.json, else the newest eval_*.json")
    ap.add_argument("--listening-gate", default=None, help='e.g. "passed (Khalid, 2026-10)"; default keeps the registered gate or "not yet performed"')
    ap.add_argument("--registry", default=str(REGISTRY), help="adapters.extra.json to update")
    ap.add_argument("--dry-run", action="store_true", help="print the entry, write nothing")
    ap.add_argument("--restart", action="store_true", help="launchctl kickstart the service, wait for /health, pre-warm")
    ap.add_argument("--prewarm-seconds", type=int, default=5)
    ap.add_argument("--timeout", type=float, default=600.0, help="seconds to wait for the adapter after --restart")
    args = ap.parse_args(argv)

    run = resolve(args.run)
    if not run.is_dir():
        raise SystemExit(f"--run {args.run}: not a directory")
    if not valid_name(args.name):
        raise SystemExit(f"--name {args.name!r}: the service only serves names matching {NAME_RE.pattern} "
                         "(ASCII letters, digits, _ . -; a letter or digit first; at most 40 chars) and not 'base'")
    cfg = read_json(run / "config.json")
    base = args.base or cfg.get("model")
    if not base:
        raise SystemExit("--base not given and the run's config.json names no model")
    eval_json = pick_eval_json(run, args.tag)
    ev = read_json(eval_json) if eval_json else {}
    if not ev:
        print(f"note: no eval JSON in {run}; test CE / MERT metrics will be absent", file=sys.stderr)
    ckpt = best_checkpoint(run, ev)
    kind = detect_kind(ckpt, args.kind)
    captions = resolve_captions_arg(cfg.get("captions"))
    if captions is None:
        if args.rights is None or args.corpus is None:
            raise SystemExit(f"{run}: config.json names no readable captions file ({cfg.get('captions')!r}); "
                             "pass both --rights and --corpus to register without it")
        hist: Counter = Counter()
        rights = args.rights
        corpus = args.corpus
    else:
        hist = rights_histogram(captions)
        rights = decide_rights(hist, args.rights)
        corpus = args.corpus or corpus_text(captions)
    entry = build_entry(args.name, run, ckpt, kind, base, rights, corpus, cfg, ev, eval_json, hist, args.listening_gate)
    registry = Path(args.registry)
    entries = upsert_entry(load_registry(registry), entry)
    final = next(e for e in entries if isinstance(e, dict) and e.get("name") == args.name)  # non-object entries are tolerated
    print(json.dumps(final, indent=2, ensure_ascii=False), flush=True)
    if args.dry_run:
        print("dry run: registry not written", flush=True)
        return final
    write_registry(registry, entries)
    print(f"registered {args.name} ({kind}, {rights}, {final['path']}) in {registry}", flush=True)
    print("to serve it, restart the service:", " ".join(kickstart_command()), flush=True)
    if args.restart:
        final["restart"] = restart_and_warm(args.name, args.prewarm_seconds, args.timeout)
    return final


if __name__ == "__main__":
    main()
