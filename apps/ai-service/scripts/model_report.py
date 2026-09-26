"""Render docs/eval/QARAAMI_MODEL_REPORT.md, one docs/eval/MODEL_CARD_<adapter>.md
per registered v2 adapter and the docs/figures/v2_*.png figures from the run
artifacts on disk (Phase 5). Nothing in the report is typed by hand: every
number is read from a file, and a run or measurement that has not happened
renders as "not run". Rerun after every training, eval, DPO, improvement or
listening step.

Sources, per run in runs/<run>/:
  * eval_<tag>.json (scale_eval; eval_<run>.json first, else the most recently
    written eval_*.json, the same rule as register_adapter): per_song_ce with
    its bootstrap CI, the A/B block (voiced fraction = trackable melody, PCS,
    per-pair tuning offsets), scorer_version, the "turing" block ({dir, n}: a
    Turing set built by --turing, heard or not) and the Phase 3 blocks when the
    eval wrote them:
      "mert":   {fad_adapter_real, fad_base_real, fad_adapter_base, cos_adapter,
                 cos_base (mean cosine to the real centroid), nn_cos_adapter,
                 nn_cos_base (mean nearest-real cosine), delta_mean, delta_ci95
                 (paired adapter − base nearest-real cosine), closer_to_real,
                 n_real, n_gen}
      "tuning": {real | None, base, adapter: {n, mean, sd, frac_abs_ge_threshold},
                 threshold_cents, ks_*, offsets: {real, base, adapter}}
    (a few alternative spellings are read too). A missing block is "not run";
    base/adapter offsets fall back to the A/B pairs' tuning_offset_cents.
  * eval_round_N.json (dpo_train, last round): held_out_oud_token_ce, the
    before/after PCS and voiced fraction, fad_to_real_oud_test and ab_dir. A DPO
    row's "base" is the adapter the round started from, its "adapter" the
    round's result; the table says so.
  * test_ce.json (the small-model harness): clip-mean test CE without a CI.
  * loss.csv (val CE at step 0 = the base, and at the best checkpoint; the
    validation interval), config.json (base model, recipe incl. full_decoder and
    the early-stop settings, versions, the captions file), the EARLY_STOP /
    MAX_HOURS stop markers scale_train writes, and that captions file (sets,
    clips, songs, split sizes, split disjointness, rights tiers). Hours per set
    are the set card's source-audio hours when data/sets/<set>/SET_CARD.md has
    one, else "~" the 50 %-overlap estimate; the card's "- Clips:" window total
    is shown next to it in the corpus section.
  * data/listening/<set>_<listener>_<ts>.json (ab_listen): every blind session
    whose "set" is the run's A/B directory, with the adapter / base / neither
    counts and the Wilson 95 % interval; data/listening/ab_turing_*.json is the
    Turing check (real recording vs model output) behind the Somali-ness
    sentence.
  * services/musicgen-api/adapters.extra.json: the v2 adapter registry the
    service reads (a JSON list of {name, kind: "lora" | "full_decoder", path,
    base, corpus, trained, metrics, listening_gate, rights: "releasable" |
    "research_only", best_step}; a {name: entry} object is read too, and a
    boolean research_only or a "run" key are honoured when present; "run" may
    be a bare run name, a repo-relative "runs/<run>" as register_adapter writes
    it, or an absolute path). Without the file, every runs/qaraami_*/ with an
    eval JSON is a registered adapter; an empty registry registers nothing.
  * docs/eval/IMPROVEMENT_LOG.md (Phase 4), included verbatim when present.

Every JSON is read tolerantly: a truncated or malformed file (scale_eval and
dpo_train write theirs non-atomically) is reported on stderr and its run
renders as "not run" instead of aborting the report.

Rights are read from the captions rows, never assumed: any harvard_* /
*research_only* row (rights or source, as scale_eval.is_harvard) makes the
adapter research-only; only rows carrying a consented tier (ahmed_*,
internet_cc, contrib_*_consented) make it releasable; anything else is "rights
unverified". Research-only cards open with the warning.

The "best evaluated run" is ranked by the adapter's MERT-FAD to the real
held-out clips from scale_eval's design only (30 s A/B clips against the
run's own n_real pool); a DPO round's fad_to_real_oud_test (15 s candidates
against the reward-model reference pool) is a different design, is shown in
its row but never ranked against it. Without any such FAD the ranking falls
back to the per-song CE improvement.

Usage (from apps/ai-service):
  python -m scripts.model_report
  python -m scripts.model_report --runs-dir ../../runs --data-dir ../../data \
     --out ../../docs/eval/QARAAMI_MODEL_REPORT.md --figures-dir ../../docs/figures
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from scripts.ahmed_report import (  # noqa: E402
    GRID,
    INK,
    INK_2,
    PRIOR_COLOR,
    SERIES,
    _style,
    estimate_hours,
    f,
    read_loss,
    resolve_captions,
    set_card_hours,
    signed,
    smooth,
)

REPO = Path(__file__).resolve().parents[3]
NOT_RUN = "not run"
CLIP_SECONDS = 30.0
REGISTRY_REL = "services/musicgen-api/adapters.extra.json"
IMPROVEMENT_LOG_REL = "docs/eval/IMPROVEMENT_LOG.md"
TURING_PREFIX = "ab_turing_"
OFFSET_THRESHOLD_CENTS = 15.0
MAX_SECONDS = 30  # services/musicgen-api/app.py MAX_SECONDS: the service caps a generation at 30 s
EARLY_STOP_FILE = "EARLY_STOP"   # scale_train.write_stop_marker
MAX_HOURS_FILE = "MAX_HOURS"
FRAMES_PER_SECOND = 50           # EnCodec 32 kHz frame rate: config "frames" / 50 = clip seconds

# the prior programme, in chronological order: small oud, small Harvard, the r32 scale
# runs and the DPO round on large; then the Phase 2 recipes A-D. Improvement
# variants (Phase 4) and dpo_v2_* rounds are discovered on disk.
PRIOR_RUNS = [
    ("oud_lora_r16_nodrop_20260809", "oud (small)"),
    ("harvard_raw_3000", "harvard_raw (small)"),
    ("qaraami_medium_r32", "medium r32"),
    ("qaraami_large_r32", "large r32"),
    ("dpo_large", "DPO large"),
]
V2_RUNS = ["qaraami_medium_full", "qaraami_large", "qaraami_large_all", "qaraami_melody"]
DISCOVER_GLOBS = ("qaraami_*", "dpo_v2_*")
SKIP_SUFFIXES = ("_probe", "_smoke")
# the two small-model runs predate per-row rights and eval JSONs: their test CE
# lives in data/oud_eval_test_ce.json (oud) and the legacy A/B set is
# data/oud_ab_listening; harvard_raw_3000 trained on data/captions.jsonl, the
# Harvard clips, whose rows carry no rights key at all
LEGACY_TEST_CE = {"oud_lora_r16_nodrop_20260809": "oud_eval_test_ce.json"}
LEGACY_AB = {"oud_lora_r16_nodrop_20260809": "oud_ab_listening"}
KNOWN_RIGHTS = {"harvard_raw_3000": ("research-only", "trained on data/captions.jsonl, the Harvard Aryette clips; the rows predate the rights key")}

# the reference categorical palette (dataviz skill instance), fixed slot order
SERIES8 = list(SERIES) + ["#e87ba4", "#008300", "#4a3aa7", "#e34948"]
REAL_COLOR = "#52514e"

CLIPS_LINE_RE = re.compile(r"^\s*-\s*Clips:\s*([\d,]+)\s*×\s*(\d+(?:\.\d+)?)\s*s\s*=\s*(\d+(?:\.\d+)?)\s*h")


# ------------------------------------------------------------ tolerant io

def warn(msg: str) -> None:
    print(f"model_report: {msg}", file=sys.stderr, flush=True)


def read_json_safe(path: Path) -> dict | None:
    """The JSON object at `path`, or None when the file is absent, unreadable,
    truncated / malformed or not an object; every failure is one stderr line
    (eval and config files are written non-atomically by the harness)."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        warn(f"{path}: unreadable JSON ({exc}); treated as absent")
        return None
    if not isinstance(data, dict):
        warn(f"{path}: not a JSON object; treated as absent")
        return None
    return data


def eval_usable(ev: dict | None) -> bool:
    """An eval file the report can use: it carries a per_song_ce block or a best_ckpt."""
    return isinstance(ev, dict) and bool(ev.get("per_song_ce") or ev.get("best_ckpt"))


def run_clip_seconds(cfg: dict | None) -> float:
    """The clip length a run trained on: config "frames" / 50, else 30 s. The
    rows' own "seconds" (when present) override this in corpus_of."""
    frames = (cfg or {}).get("frames")
    return float(frames) / FRAMES_PER_SECOND if frames else CLIP_SECONDS


# ----------------------------------------------------------------- rights

def rights_tier(row: dict | str | None) -> str:
    """'research_only' | 'consented' | 'unknown' for one captions row (or its
    bare rights string). A row whose rights OR source starts with harvard is
    research-only, the same test as scale_eval.is_harvard / register_adapter."""
    rights, source = row, ""
    if isinstance(row, dict):
        rights, source = row.get("rights"), str(row.get("source") or "")
    if source.lower().startswith("harvard"):
        return "research_only"
    if not rights:
        return "unknown"
    r = str(rights).lower()
    if "harvard" in r or "research_only" in r:
        return "research_only"
    if r.startswith("ahmed_") or r == "internet_cc" or (r.startswith("contrib_") and r.endswith("_consented")):
        return "consented"
    return "unknown"


def rights_verdict(tiers: dict[str, int]) -> tuple[str, str]:
    """('research-only' | 'releasable' | 'rights unverified', why) from the rows per tier."""
    if not tiers:
        return "rights unverified", "no captions rows could be read"
    if tiers.get("research_only"):
        return "research-only", f"{tiers['research_only']} training rows are Harvard / research-only material"
    if tiers.get("unknown"):
        return "rights unverified", f"{tiers['unknown']} rows carry no recognised rights tier"
    return "releasable", f"all {tiers.get('consented', 0)} rows carry a consented tier"


# ----------------------------------------------------------------- corpus

@dataclass
class Corpus:
    captions: Path | None = None
    sources: dict[str, dict] = field(default_factory=dict)   # name -> clips, songs, hours, hours_is_estimate, window_hours
    splits: dict[str, tuple[int, int]] = field(default_factory=dict)  # split -> (clips, songs)
    split_songs: dict[str, set[str]] = field(default_factory=dict)    # split -> song ids
    unique_songs: int = 0
    unique_hours_est: float = 0.0
    tiers: dict[str, int] = field(default_factory=dict)
    rights_values: dict[str, int] = field(default_factory=dict)
    clip_seconds: float = CLIP_SECONDS

    def summary(self) -> str:
        if self.captions is None:
            return "captions file missing"
        parts = []
        for name, s in sorted(self.sources.items()):
            h = f"~{s['hours']:.1f} h" if s["hours_is_estimate"] else f"{s['hours']:.1f} h"
            parts.append(f"{name} {s['clips']} clips ({h})")
        return ", ".join(parts) if parts else "empty captions"

    def split_overlap(self) -> set[str]:
        """Song ids that appear in more than one split (empty = song-level splits are disjoint)."""
        seen: dict[str, int] = {}
        for songs in self.split_songs.values():
            for s in songs:
                seen[s] = seen.get(s, 0) + 1
        return {s for s, n in seen.items() if n > 1}


def set_card_windows(data_dir: Path, set_name: str) -> tuple[int, float] | None:
    """(clips, hours) of the set card's "- Clips: N × 30 s = H h" window total, or None."""
    card = data_dir / "sets" / set_name / "SET_CARD.md"
    if not card.exists():
        return None
    for line in card.read_text().splitlines():
        m = CLIPS_LINE_RE.match(line)
        if m:
            return int(m.group(1).replace(",", "")), float(m.group(3))
    return None


def read_rows(captions: Path) -> list[dict]:
    rows = []
    with open(captions) as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def corpus_of(captions: Path | None, data_dir: Path, clip_seconds: float = CLIP_SECONDS) -> Corpus:
    """Sets, split sizes, unique songs and the overlap-aware unique-source hours
    of a run's captions file; hours per set from the set card when it has one."""
    c = Corpus(captions=captions, clip_seconds=clip_seconds)
    if captions is None or not captions.exists():
        c.captions = None
        return c
    rows = read_rows(captions)
    clips: dict[str, int] = {}
    songs: dict[str, set[str]] = {}
    split_clips: dict[str, int] = {}
    split_songs: dict[str, set[str]] = {}
    per_song: dict[str, int] = {}
    secs = [float(r["seconds"]) for r in rows if r.get("seconds")]
    if secs:
        c.clip_seconds = float(np.median(secs))
    for r in rows:
        name = r.get("source") or r.get("rights") or "unlabelled"
        sha = str(r.get("song_sha256") or r.get("clip_path"))
        clips[name] = clips.get(name, 0) + 1
        songs.setdefault(name, set()).add(sha)
        split = r.get("split", "unsplit")
        split_clips[split] = split_clips.get(split, 0) + 1
        split_songs.setdefault(split, set()).add(sha)
        per_song[sha] = per_song.get(sha, 0) + 1
        tier = rights_tier(r)
        c.tiers[tier] = c.tiers.get(tier, 0) + 1
        rv = str(r.get("rights") or "none")
        c.rights_values[rv] = c.rights_values.get(rv, 0) + 1
    for name in clips:
        hours = set_card_hours(data_dir, name)
        windows = set_card_windows(data_dir, name)
        c.sources[name] = {
            "clips": clips[name], "songs": len(songs[name]),
            "hours": hours if hours is not None else estimate_hours(clips[name], len(songs[name]), c.clip_seconds),
            "hours_is_estimate": hours is None,
            "window_hours": windows[1] if windows else None,
        }
    c.splits = {s: (split_clips[s], len(split_songs[s])) for s in split_clips}
    c.split_songs = split_songs
    c.unique_songs = len(per_song)
    c.unique_hours_est = sum(estimate_hours(n, 1, c.clip_seconds) for n in per_song.values())
    return c


# ------------------------------------------------------------------- eval

def pick(d: dict | None, *paths: str):
    """The first non-None value at any of the dotted paths ("mert.fad_to_real.base")."""
    for path in paths:
        cur: object = d
        for key in path.split("."):
            if not isinstance(cur, dict) or key not in cur:
                cur = None
                break
            cur = cur[key]
        if cur is not None:
            return cur
    return None


def _mean_or_none(x) -> float | None:
    if x is None:
        return None
    if isinstance(x, list | tuple | np.ndarray):
        vals = [float(v) for v in x if v is not None]
        return float(np.mean(vals)) if vals else None
    if isinstance(x, dict):
        return _mean_or_none(x.get("mean"))
    return float(x)


def _list_or_none(x) -> list[float] | None:
    if isinstance(x, list | tuple | np.ndarray):
        vals = [float(v) for v in x if v is not None]
        return vals or None
    if isinstance(x, dict):
        return _list_or_none(x.get("values") or x.get("per_clip"))
    return None


def mert_block(ev: dict) -> dict:
    """{fad_base, fad_adapter, fad_adapter_to_base, closer_to_real, cosine_base,
    cosine_adapter, cosine_base_list, cosine_adapter_list, n_real}; every value
    None when the eval never measured it. Reads the Phase 3 "mert" block in its
    documented spelling and a few plausible variants, and the DPO round's
    fad_to_real_oud_test (before = base side, after = adapter side)."""
    fb = pick(ev, "mert.fad_base_real", "mert.fad_to_real.base", "mert.fad_base_to_real", "mert.fad.base", "mert_fad.base",
              "fad_to_real.base", "fad_to_real_oud_test.before")
    fa = pick(ev, "mert.fad_adapter_real", "mert.fad_to_real.adapter", "mert.fad_adapter_to_real", "mert.fad.adapter", "mert_fad.adapter",
              "fad_to_real.adapter", "fad_to_real_oud_test.after")
    fab = pick(ev, "mert.fad_adapter_base", "mert.fad_adapter_to_base", "mert.fad_to_base.adapter", "mert.fad.adapter_to_base")
    # which design produced the FAD: scale_eval's "mert" block (gen clips vs the run's real
    # held-out pool) or a DPO round's fad_to_real_oud_test (candidates vs the reward reference)
    source = "scale_eval" if isinstance(ev.get("mert"), dict) or isinstance(ev.get("mert_fad"), dict) or isinstance(ev.get("fad_to_real"), dict) \
        else "dpo_round" if isinstance(ev.get("fad_to_real_oud_test"), dict) else None
    closer = pick(ev, "mert.closer_to_real", "closer_to_real")
    if closer is None and fa is not None and fb is not None:
        closer = float(fa) < float(fb)
    cb = pick(ev, "mert.cos_base", "mert.cosine_to_real.base", "mert.cosine.base", "mert.cosine_base")
    ca = pick(ev, "mert.cos_adapter", "mert.cosine_to_real.adapter", "mert.cosine.adapter", "mert.cosine_adapter")
    nb = pick(ev, "mert.nn_cos_base", "mert.nearest_real_cosine.base")
    na = pick(ev, "mert.nn_cos_adapter", "mert.nearest_real_cosine.adapter")
    return {
        "fad_base": None if fb is None else float(fb), "fad_adapter": None if fa is None else float(fa),
        "fad_adapter_to_base": None if fab is None else float(fab),
        "closer_to_real": None if closer is None else bool(closer),
        "cosine_base": _mean_or_none(cb), "cosine_adapter": _mean_or_none(ca),
        "cosine_base_list": _list_or_none(cb), "cosine_adapter_list": _list_or_none(ca),
        "nn_cos_base": _mean_or_none(nb), "nn_cos_adapter": _mean_or_none(na),
        "nn_delta_mean": pick(ev, "mert.delta_mean"), "nn_delta_ci95": pick(ev, "mert.delta_ci95"),
        "n_real": pick(ev, "mert.n_real", "mert.real.n"), "n_gen": pick(ev, "mert.n_gen"),
        "source": source if (fa is not None or fb is not None or ca is not None) else None,
    }


def frac_ge(values: list[float] | None, threshold: float = OFFSET_THRESHOLD_CENTS) -> float | None:
    if not values:
        return None
    return float(np.mean([abs(v) >= threshold for v in values]))


def tuning_block(ev: dict) -> dict:
    """{offsets: {real, base, adapter}, frac: {real, base, adapter}} in cents; the
    Phase 3 "tuning" block first, the A/B pairs' tuning_offset_cents as the
    fallback for base and adapter. A side never measured is None."""
    offsets: dict[str, list[float] | None] = {}
    frac: dict[str, float | None] = {}
    for side in ("real", "base", "adapter"):
        vals = _list_or_none(pick(ev, f"tuning.offsets.{side}", f"tuning.offsets_cents.{side}", f"tuning.{side}.offsets_cents",
                                  f"tuning.{side}.values", f"tuning.{side}.offsets"))
        if vals is None and side != "real":
            pairs = (ev.get("ab") or {}).get("pairs") or []
            got = [p[side]["tuning_offset_cents"] for p in pairs
                   if isinstance(p.get(side), dict) and p[side].get("tuning_offset_cents") is not None]
            vals = [float(v) for v in got] or None
        offsets[side] = vals
        fr = pick(ev, f"tuning.{side}.frac_abs_ge_threshold", f"tuning.abs_offset_ge15_fraction.{side}", f"tuning.frac_abs_offset_ge15.{side}",
                  f"tuning.{side}.frac_ge15", f"tuning.{side}.abs_offset_ge15_fraction", f"tuning.{side}.fraction_ge15")
        frac[side] = float(fr) if fr is not None else frac_ge(vals)
    return {"offsets": offsets, "frac": frac}


def pick_eval_file(run_dir: Path) -> Path | None:
    """runs/<run>/eval_<run>.json when it exists, else the most recently written
    eval_*.json (register_adapter.pick_eval_json's rule), else None."""
    own = run_dir / f"eval_{run_dir.name}.json"
    if own.exists():
        return own
    found = sorted((p for p in run_dir.glob("eval_*.json") if not p.name.startswith("eval_round_")),
                   key=lambda p: (p.stat().st_mtime, p.name))
    return found[-1] if found else None


def read_eval_sft(run_dir: Path) -> tuple[dict | None, str]:
    """(eval json, file name) of the run's eval, or (None, "") without one; a
    malformed file is (None, its name) and reported by read_json_safe."""
    p = pick_eval_file(run_dir)
    if p is None:
        return None, ""
    return read_json_safe(p), p.name


def _round_no(p: Path) -> int:
    m = re.search(r"(\d+)", p.stem)
    return int(m.group(1)) if m else 0


def read_eval_dpo(run_dir: Path, cfg: dict) -> tuple[dict | None, str]:
    """The last eval_round_N.json of a DPO run normalised into the scale_eval shape
    (per_song_ce without CI, ab means, a mert block); base = the round's start."""
    rounds = sorted(run_dir.glob("eval_round_*.json"), key=_round_no)
    if not rounds:
        return None, ""
    ev = read_json_safe(rounds[-1])
    if ev is None:
        return None, rounds[-1].name
    rnd = ev.get("round", _round_no(rounds[-1]))
    ce = ev.get("held_out_oud_token_ce") or {}
    before, after = ev.get("before") or {}, ev.get("after") or {}
    b, a = ce.get("before"), ce.get("after")
    ab_dir = ev.get("ab_dir") or ""
    n_pairs = len(list(Path(ab_dir).glob("pair*_base.wav"))) if ab_dir and Path(ab_dir).is_dir() else None
    out = {
        "model": cfg.get("model", ""), "best_ckpt": f"round_{rnd}/adapter",
        "per_song_ce": {"n_songs": None, "base": {"mean": b, "ci95": None}, "adapter": {"mean": a, "ci95": None},
                        "improvement_base_minus_adapter": {"mean": (b - a) if b is not None and a is not None else None,
                                                            "ci95": None, "significant": None}},
        "ab": {"dir": ab_dir, "n": n_pairs, "seconds": cfg.get("seconds"),
               "base": {"pcs_mean": before.get("pcs"), "voiced_fraction_mean": before.get("voiced_fraction")},
               "adapter": {"pcs_mean": after.get("pcs"), "voiced_fraction_mean": after.get("voiced_fraction")},
               "pairs": []},
        "fad_to_real_oud_test": ev.get("fad_to_real_oud_test") or {},
        "dpo_round": ev,
    }
    return out, rounds[-1].name


def read_eval_small(run_dir: Path, cfg: dict, data_dir: Path | None = None) -> tuple[dict | None, str]:
    """test_ce.json of the small-model harness (clip mean, no CI) in the same
    shape; the oud run's data/oud_eval_test_ce.json ({"test_ce": {"base",
    "lora_step0500", ...}}, best = the lowest) when the run dir holds none."""
    tce = read_json_safe(run_dir / "test_ce.json")
    src = "test_ce.json"
    if tce is None and data_dir is not None and run_dir.name in LEGACY_TEST_CE:
        legacy = read_json_safe(data_dir / LEGACY_TEST_CE[run_dir.name])
        if legacy is not None:
            ce = legacy.get("test_ce") or {}
            steps = {k: v for k, v in ce.items() if k != "base" and v is not None}
            if steps:
                best_key = min(steps, key=lambda k: steps[k])
                m = re.search(r"(\d+)$", best_key)
                tce = {"test_ce": {"base": ce.get("base"), best_key: steps[best_key]}, "best_test_ckpt": best_key}
                tce["_best_ckpt"] = f"ckpt_step_{int(m.group(1)):04d}" if m else best_key
                src = LEGACY_TEST_CE[run_dir.name]
    if tce is None:
        return None, ""
    best = tce.get("best_test_ckpt") or ""
    base = (tce.get("test_ce") or {}).get("base")
    adapter = (tce.get("test_ce") or {}).get(best) if best else None
    out = {
        "model": cfg.get("model", ""), "best_ckpt": tce.get("_best_ckpt") or (best.replace("step_", "ckpt_step_") if best else ""),
        "per_song_ce": {"n_songs": None, "base": {"mean": base, "ci95": None}, "adapter": {"mean": adapter, "ci95": None},
                        "improvement_base_minus_adapter": {"mean": (base - adapter) if base is not None and adapter is not None else None,
                                                            "ci95": None, "significant": None}},
        "val_ce_table": tce.get("val_ce") or {},
    }
    return out, src


# -------------------------------------------------------------------- runs

@dataclass
class RunRecord:
    run: str
    label: str
    group: str                      # prior | v2 | variant
    present: bool = False
    kind: str = "sft"               # sft | dpo
    model: str = ""
    recipe: str = ""
    best_ckpt: str = ""
    config: dict = field(default_factory=dict)
    corpus: Corpus = field(default_factory=Corpus)
    rights: str = "rights unverified"
    rights_reason: str = ""
    val_ce: tuple[float | None, float | None] = (None, None)
    ce: dict | None = None
    ab: dict | None = None
    ab_dir: str = ""
    mert: dict = field(default_factory=dict)
    tuning: dict = field(default_factory=dict)
    listening: list[dict] = field(default_factory=list)
    scorer: dict = field(default_factory=dict)
    val_curve: dict[int, float] = field(default_factory=dict)
    train_curve: dict[int, float] = field(default_factory=dict)
    eval_file: str = ""
    dpo: dict = field(default_factory=dict)
    stop: dict = field(default_factory=dict)        # EARLY_STOP / MAX_HOURS marker: {kind, step, best_step, ...}
    turing_set: dict = field(default_factory=dict)  # eval "turing" block: {dir, n}

    @property
    def research_only(self) -> bool:
        return self.rights == "research-only"

    def ckpt_steps(self, runs_dir: Path | None = None) -> list[int]:
        """The ckpt_step_NNNN directories on disk, sorted (empty without a runs dir)."""
        if runs_dir is None:
            return []
        out = []
        for p in (runs_dir / self.run).glob("ckpt_step_*"):
            m = re.fullmatch(r"ckpt_step_(\d+)", p.name)
            if m and p.is_dir():
                out.append(int(m.group(1)))
        return sorted(out)


def is_full_decoder_cfg(cfg: dict) -> bool:
    """config.json says the run trained the whole decoder: scale_train's
    "full_decoder" (it still records rank/alpha/targets, unused), or the older
    spellings."""
    return bool(cfg.get("full_decoder") or cfg.get("full_finetune") or cfg.get("mode") == "full_decoder"
                or cfg.get("kind") == "full" or cfg.get("train_kind") == "full")


def recipe_of(cfg: dict, kind: str, ckpt_dir: Path | None = None) -> str:
    """'LoRA r64 α128 (q,k,v,out,fc1,fc2)', 'full decoder fine-tune' or 'DPO β10 …' from config.json."""
    if kind == "dpo":
        bits = [f"DPO β{cfg['beta']:g}" if cfg.get("beta") is not None else "DPO"]
        if cfg.get("lr") is not None:
            bits.append(f"lr {cfg['lr']:g}")
        if cfg.get("rounds") is not None:
            bits.append(f"{cfg['rounds']} round(s)")
        if cfg.get("candidates_per_round") is not None:
            bits.append(f"{cfg['candidates_per_round']} candidates/round")
        return ", ".join(bits)
    full = is_full_decoder_cfg(cfg)
    if not full and ckpt_dir is not None and ckpt_dir.is_dir() and not (ckpt_dir / "adapter_config.json").exists():
        full = any((ckpt_dir / w).exists() for w in ("decoder.safetensors", "model.safetensors", "pytorch_model.bin"))
    if full:
        return "full decoder fine-tune"
    rank, alpha = cfg.get("rank", cfg.get("lora_r")), cfg.get("alpha", cfg.get("lora_alpha"))
    targets = cfg.get("targets") or cfg.get("lora_targets") or []
    if rank is None and alpha is None:
        return ""
    txt = "LoRA " + " ".join(p for p in (f"r{rank}" if rank is not None else "", f"α{alpha}" if alpha is not None else "") if p)
    if targets:
        txt += " (" + ",".join(str(t).replace("_proj", "") for t in targets) + ")"
    return txt


def val_ce_pair(val_curve: dict[int, float], best_ckpt: str, ev: dict | None) -> tuple[float | None, float | None]:
    """(val CE at step 0 = the base, val CE at the best checkpoint's step)."""
    m = re.search(r"(\d+)$", best_ckpt or "")
    step = int(m.group(1)) if m else None
    base = val_curve.get(0)
    adapter = val_curve.get(step) if step is not None else None
    table = (ev or {}).get("val_ce_table") or {}
    if base is None and table:
        base = table.get("0")
    if adapter is None and step is not None and table:
        adapter = table.get(str(step))
    return base, adapter


def listening_sessions(data_dir: Path, set_name: str) -> list[dict]:
    """Every base-vs-adapter session in data/listening/*.json whose "set" is
    set_name, oldest first. A file of another shape (a Turing session's
    model/real counts, or no adapter/base counts) is skipped, never a crash."""
    out = []
    d = data_dir / "listening"
    if not set_name or not d.is_dir():
        return out
    for p in sorted(d.glob("*.json")):
        try:
            r = json.loads(p.read_text())
        except (OSError, ValueError):
            continue
        if not isinstance(r, dict) or r.get("set") != set_name or r.get("kind") == "turing":
            continue
        s = r.get("summary") or {}
        if not isinstance(s, dict) or not s.get("n") or "adapter" not in s or "base" not in s:
            continue
        n = int(s["n"])
        a, b = int(s.get("adapter") or 0), int(s.get("base") or 0)
        out.append({"file": p.name, "listener": r.get("listener", ""), "date": str(r.get("date", ""))[:10],
                    **s, "n": n, "adapter": a, "base": b, "none": int(s.get("none") if s.get("none") is not None else n - a - b)})
    return out


def turing_sessions(data_dir: Path) -> list[dict]:
    """The Turing checks: data/listening/ab_turing_*.json written by ab_listen for a
    data/ab_turing_<tag>/ set (pairNNN_real.wav vs pairNNN_model.wav, question
    "which is the real recording?"): summary counts model (the model clip taken
    for the real one), real (recognised), none, and a Wilson 95 % interval on
    "picked the model as real". An older adapter/base spelling is read the same way."""
    out = []
    d = data_dir / "listening"
    if not d.is_dir():
        return out
    for p in sorted(d.glob(f"{TURING_PREFIX}*.json")):
        try:
            r = json.loads(p.read_text())
        except (OSError, ValueError):
            continue
        s = r.get("summary") or {}
        n = s.get("n")
        if not n:
            continue
        model = s.get("model", s.get("adapter", 0))
        real = s.get("real", s.get("base", 0))
        out.append({"file": p.name, "set": r.get("set", p.stem), "listener": r.get("listener", ""),
                    "date": str(r.get("date", ""))[:10], "n": n, "model": model, "real": real,
                    "none": s.get("none", n - model - real), "wilson95": s.get("wilson95") or list(wilson(model, n)),
                    "question": r.get("question") or "which of the two is the real recording?"})
    return out


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (round(c - h, 4), round(c + h, 4))


def stop_marker(run_dir: Path) -> dict:
    """scale_train's EARLY_STOP or MAX_HOURS marker as {kind, ...its JSON}; {} when the run has none."""
    for name, kind in ((EARLY_STOP_FILE, "early_stop"), (MAX_HOURS_FILE, "max_hours")):
        m = read_json_safe(run_dir / name)
        if m is not None:
            return {"kind": kind, **m}
    return {}


def stop_text(rec: RunRecord) -> str:
    """'stopped early at step N (best step M, val X; patience P, min Δ D)', 'paused
    by --max-hours …', 'ran to its total_steps (no stop marker)' or '' without a config."""
    s = rec.stop
    if s.get("kind") == "early_stop":
        return (f"stopped early at step {s.get('step')} (best step {s.get('best_step')}, best val {s.get('best_val')}; "
                f"patience {s.get('patience')} steps, min Δ {s.get('min_delta')})")
    if s.get("kind") == "max_hours":
        return f"paused by --max-hours {s.get('max_hours')} at step {s.get('step')} after {s.get('elapsed_hours')} h (meant to be resumed)"
    if not rec.config or rec.kind == "dpo":  # DPO rounds have no loss.csv and no early stop
        return ""
    last = max(rec.train_curve, default=max(rec.val_curve, default=None))
    total = rec.config.get("total_steps")
    if total is not None and last is not None and last >= int(total):
        return f"ran to its total_steps ({total}; no stop marker)"
    if last is not None:
        return f"no stop marker; last logged step {last}" + (f" of {total}" if total is not None else "")
    return "no stop marker and no loss.csv"


def load_run(runs_dir: Path, data_dir: Path, run: str, label: str, group: str) -> RunRecord:
    rec = RunRecord(run=run, label=label, group=group)
    run_dir = runs_dir / run
    cfg = read_json_safe(run_dir / "config.json") or {}
    rec.config = cfg
    rec.kind = "dpo" if (run.startswith("dpo_") or "beta" in cfg and "adapter" in cfg) else "sft"
    rec.val_curve, rec.train_curve = read_loss(run_dir)
    rec.stop = stop_marker(run_dir)
    if rec.kind == "dpo":
        ev, rec.eval_file = read_eval_dpo(run_dir, cfg)
    else:
        ev, rec.eval_file = read_eval_sft(run_dir)
        if ev is None:
            ev, small_file = read_eval_small(run_dir, cfg, data_dir)
            rec.eval_file = small_file or rec.eval_file  # keep a malformed eval's name for the footnote
    rec.model = (ev or {}).get("model") or cfg.get("model", "")
    if ev is not None and not eval_usable(ev):
        warn(f"{run_dir / rec.eval_file}: no per_song_ce / best_ckpt; the run renders as not run")
        ev = None
    if ev is None:
        rec.recipe = recipe_of(cfg, rec.kind)
        return rec
    rec.present = True
    rec.best_ckpt = ev.get("best_ckpt", "")
    rec.recipe = recipe_of(cfg, rec.kind, run_dir / rec.best_ckpt if rec.best_ckpt else None)
    rec.ce = ev.get("per_song_ce")
    ab = ev.get("ab") or {}
    rec.ab = {k: v for k, v in ab.items() if k != "pairs"}
    rec.ab_dir = ab.get("dir", "")
    if not rec.ab_dir and run in LEGACY_AB and (data_dir / LEGACY_AB[run]).is_dir():
        rec.ab_dir = str(data_dir / LEGACY_AB[run])
    rec.mert = mert_block(ev)
    rec.tuning = tuning_block(ev)
    rec.scorer = ev.get("scorer_version") or {}
    rec.dpo = ev.get("dpo_round") or {}
    rec.val_ce = val_ce_pair(rec.val_curve, rec.best_ckpt, ev)
    rec.listening = listening_sessions(data_dir, Path(rec.ab_dir).name if rec.ab_dir else "")
    tur = ev.get("turing") if isinstance(ev.get("turing"), dict) else {}
    tur_dir = tur.get("dir") or ev.get("turing_dir") or ""
    if tur_dir:
        rec.turing_set = {"dir": str(tur_dir), "n": tur.get("n")}
    rec.corpus = corpus_of(resolve_captions(cfg.get("captions")), data_dir, run_clip_seconds(cfg))
    rec.rights, rec.rights_reason = rights_verdict(rec.corpus.tiers)
    if rec.rights == "rights unverified" and run in KNOWN_RIGHTS:
        rec.rights, rec.rights_reason = KNOWN_RIGHTS[run]
    return rec


def discover_variants(runs_dir: Path, known: set[str]) -> list[str]:
    """runs/qaraami_* and runs/dpo_v2_* directories not in the fixed lists
    (Phase 4 improvement variants and v2 DPO rounds), sorted."""
    found: set[str] = set()
    for pattern in DISCOVER_GLOBS:
        for p in runs_dir.glob(pattern):
            if p.is_dir() and p.name not in known and not p.name.endswith(SKIP_SUFFIXES):
                found.add(p.name)
    return sorted(found)


def load_all(runs_dir: Path, data_dir: Path) -> list[RunRecord]:
    recs = [load_run(runs_dir, data_dir, run, label, "prior") for run, label in PRIOR_RUNS]
    recs += [load_run(runs_dir, data_dir, run, run, "v2") for run in V2_RUNS]
    known = {r for r, _ in PRIOR_RUNS} | set(V2_RUNS)
    recs += [load_run(runs_dir, data_dir, run, run, "variant") for run in discover_variants(runs_dir, known)]
    return recs


def rankable_fad(rec: RunRecord) -> bool:
    """A FAD that may be ranked across runs: scale_eval's design (the "mert"
    block, the run's own real held-out pool, n_real recorded) on an SFT run. A
    DPO round's fad_to_real_oud_test uses another pool and clip length."""
    m = rec.mert or {}
    return rec.kind == "sft" and m.get("fad_adapter") is not None and m.get("source") == "scale_eval" and m.get("n_real") is not None


def best_run_ranking(recs: list[RunRecord]) -> tuple[RunRecord | None, str, list[RunRecord]]:
    """(best run, criterion text, runs whose FAD was not ranked). Ranking: the
    lowest rankable adapter MERT-FAD to real (ties: the larger CE improvement),
    else the largest per-song CE improvement; None without an evaluated run."""
    present = [r for r in recs if r.present]
    if not present:
        return None, "", []
    excluded = [r for r in present if r.mert.get("fad_adapter") is not None and not rankable_fad(r)]
    ranked = [r for r in present if rankable_fad(r)]
    if ranked:
        best = min(ranked, key=lambda r: (r.mert["fad_adapter"], -(imp_mean(r) or -math.inf)))
        return best, f"MERT-FAD to real (scale_eval design, {len(ranked)} run(s) ranked)", excluded
    with_ce = [r for r in present if imp_mean(r) is not None]
    if with_ce:
        return max(with_ce, key=imp_mean), f"per-song CE improvement ({len(with_ce)} run(s) ranked; no rankable MERT-FAD yet)", excluded
    return present[0], "the only evaluated run (no CE or MERT-FAD number)", excluded


def best_run(recs: list[RunRecord]) -> RunRecord | None:
    return best_run_ranking(recs)[0]


def imp_mean(rec: RunRecord) -> float | None:
    return ((rec.ce or {}).get("improvement_base_minus_adapter") or {}).get("mean")


def imp_ci(rec: RunRecord) -> list[float] | None:
    return ((rec.ce or {}).get("improvement_base_minus_adapter") or {}).get("ci95")


# ------------------------------------------------------------------ cells

def rel(path: str) -> str:
    """Repo-relative spelling of a path (resolved first, so a cwd-relative
    config value such as ../../data/x.jsonl renders as data/x.jsonl); a path
    outside the repo is returned as given."""
    try:
        return str(Path(path).resolve().relative_to(REPO.resolve()))
    except (ValueError, OSError):
        return path


def ce_cell(ce: dict | None) -> str:
    if not ce or ce.get("base", {}).get("mean") is None:
        return NOT_RUN
    imp = ce.get("improvement_base_minus_adapter") or {}
    ci = imp.get("ci95")
    ci_txt = f" [{ci[0]:.3f}, {ci[1]:.3f}]" if ci else ""
    n = ce.get("n_songs")
    n_txt = f", n = {n} songs" if n else ", clip mean, no CI"
    return f"{f(ce['base']['mean'])} → {f(ce['adapter']['mean'])} (Δ {signed(imp.get('mean'))}{ci_txt}{n_txt})"


def pair_cell(a, b, nd: int) -> str:
    if a is None and b is None:
        return NOT_RUN
    return f"{f(a, nd)} → {f(b, nd)}"


def ab_cell(ab: dict | None, key: str, nd: int) -> str:
    if not ab or not ab.get("base") or not ab.get("adapter"):
        return NOT_RUN
    return pair_cell(ab["base"].get(key), ab["adapter"].get(key), nd)


def fad_cell(m: dict) -> str:
    if not m or (m.get("fad_adapter") is None and m.get("fad_base") is None):
        return NOT_RUN
    return f"{f(m.get('fad_adapter'), 3)} / {f(m.get('fad_base'), 3)}"


def closer_cell(m: dict) -> str:
    c = (m or {}).get("closer_to_real")
    return NOT_RUN if c is None else ("yes" if c else "no")


def tuning_cell(t: dict) -> str:
    fr = (t or {}).get("frac") or {}
    if all(fr.get(s) is None for s in ("real", "base", "adapter")):
        return NOT_RUN
    return " / ".join(f(fr.get(s), 2) for s in ("real", "base", "adapter"))


def ab_dir_cell(rec: RunRecord) -> str:
    if not rec.ab_dir:
        return NOT_RUN
    n = (rec.ab or {}).get("n")
    secs = (rec.ab or {}).get("seconds")
    bits = [f"{n} pairs" if n else None, f"{secs:g} s" if secs else None]
    inner = ", ".join(b for b in bits if b)
    return f"`{rel(rec.ab_dir)}/`" + (f" ({inner})" if inner else "")


def listening_cell(sessions: list[dict]) -> str:
    if not sessions:
        return "no blind session yet"
    parts = []
    for s in sessions:
        a, b, n = int(s.get("adapter", 0)), int(s.get("base", 0)), int(s.get("n", 0))
        lo, hi = s.get("wilson95") or wilson(a, n)
        parts.append(f"adapter {a} / base {b} / neither {s.get('none', n - a - b)} of {n}, "
                     f"rate {a / n if n else 0.0:.2f} [{lo:.2f}, {hi:.2f}] ({s.get('listener', '')} {s.get('date', '')})")
    return "<br>".join(parts)


def model_cell(rec: RunRecord) -> str:
    name = rec.model.replace("facebook/", "") or "–"
    return f"{name} ({rec.recipe})" if rec.recipe else name


RESULTS_HEADER = ("| run | group | base model (recipe) | corpus sets (clips, source audio h) | best ckpt | val CE base → adapter | "
                  "per-song test CE base → adapter | trackable melody base → adapter | PCS base → adapter | "
                  "MERT-FAD to real adapter / base | closer to real | \\|offset\\| ≥ 15 c real / base / adapter | A/B set | blind result |\n"
                  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")


def group_cell(rec: RunRecord) -> str:
    return rec.group if rec.label == rec.run else f"{rec.group}: {rec.label}"


def results_row(rec: RunRecord) -> str:
    if not rec.present:
        return f"| {rec.run} | {group_cell(rec)} | {NOT_RUN} | | | | | | | | | | | |"
    vb, va = rec.val_ce
    return (f"| {rec.run} | {group_cell(rec)} | {model_cell(rec)} | {rec.corpus.summary()} | {rec.best_ckpt or '–'} | "
            f"{pair_cell(vb, va, 4)} | {ce_cell(rec.ce)} | {ab_cell(rec.ab, 'voiced_fraction_mean', 3)} | "
            f"{ab_cell(rec.ab, 'pcs_mean', 4)} | {fad_cell(rec.mert)} | {closer_cell(rec.mert)} | {tuning_cell(rec.tuning)} | "
            f"{ab_dir_cell(rec)} | {listening_cell(rec.listening)} |")


def corpus_row(rec: RunRecord) -> str:
    c = rec.corpus
    if not rec.present:
        return f"| {rec.run} | {NOT_RUN} | | | | |"
    if c.captions is None:
        return f"| {rec.run} | captions file missing | | | | |"
    sets = []
    for name, s in sorted(c.sources.items()):
        h = f"~{s['hours']:.1f} h" if s["hours_is_estimate"] else f"{s['hours']:.1f} h"
        w = f", {s['window_hours']:.1f} h of {c.clip_seconds:g} s windows" if s.get("window_hours") is not None else ""
        sets.append(f"{name}: {s['clips']} clips, {s['songs']} songs, {h}{w}")
    splits = ", ".join(f"{k} {v[0]} ({v[1]} songs)" for k, v in sorted(c.splits.items()))
    tiers = ", ".join(f"{k} {v}" for k, v in sorted(c.rights_values.items()))
    return (f"| {rec.run} | `{rel(str(c.captions))}` | {'; '.join(sets)} | {c.unique_songs} songs, ~{c.unique_hours_est:.1f} h | "
            f"{splits} | {tiers} → **{rec.rights}** |")


# --------------------------------------------------------- fixed wording

def _names(recs: list[RunRecord]) -> str:
    return ", ".join(r.run for r in recs)


def findings(recs: list[RunRecord]) -> list[str]:
    """"What the model does and does not do", one sentence per rule, every
    sentence chosen by the numbers on disk (fixed wording, no adjectives)."""
    present = [r for r in recs if r.present]
    out: list[str] = []
    if not present:
        return ["No run has been evaluated yet; nothing can be said about what the adapters do."]

    with_ci = [r for r in present if imp_ci(r)]
    sig = [r for r in with_ci if (imp_ci(r) or [0])[0] > 0]
    if not with_ci:
        out.append("No run has a per-song test CE with a bootstrap CI yet.")
    elif len(sig) == len(with_ci):
        out.append(f"Every evaluated adapter with a CI ({len(with_ci)}) lowers held-out per-song token cross-entropy against its own base, "
                   "with a 95 % bootstrap CI over songs that excludes zero.")
    else:
        others = [r for r in with_ci if r not in sig]
        out.append(f"{len(sig)} of {len(with_ci)} evaluated adapters lower held-out per-song token cross-entropy against their own base "
                   f"with a 95 % CI that excludes zero; {_names(others)} do not.")
    no_ci = [r for r in present if imp_mean(r) is not None and not imp_ci(r)]
    if no_ci:
        lower = [r for r in no_ci if (imp_mean(r) or 0) > 0]
        out.append(f"{len(no_ci)} further run(s) report a test CE without a CI ({_names(no_ci)}): "
                   + ("every one is below its comparison point." if len(lower) == len(no_ci)
                      else f"{len(lower)} below the comparison point, {_names([r for r in no_ci if r not in lower])} not."))

    def side(r: RunRecord, key: str) -> tuple[float | None, float | None]:
        ab = r.ab or {}
        return (ab.get("base") or {}).get(key), (ab.get("adapter") or {}).get(key)

    mel = [r for r in present if None not in side(r, "voiced_fraction_mean")]
    up = [r for r in mel if side(r, "voiced_fraction_mean")[1] > side(r, "voiced_fraction_mean")[0]]
    if not mel:
        out.append("Trackable melody (CREPE voiced fraction) has not been measured on any run's A/B clips.")
    elif len(up) == len(mel):
        out.append(f"Every evaluated adapter ({len(mel)}) produces more trackable melody (CREPE voiced fraction) than its base on the A/B clips.")
    elif not up:
        out.append(f"No evaluated adapter ({len(mel)}) produces more trackable melody (CREPE voiced fraction) than its base on the A/B clips.")
    else:
        out.append(f"{len(up)} of {len(mel)} evaluated adapters produce more trackable melody (CREPE voiced fraction) than their base; "
                   f"{_names([r for r in mel if r not in up])} do not.")

    pcs = [r for r in present if None not in side(r, "pcs_mean")]
    down = [r for r in pcs if side(r, "pcs_mean")[1] < side(r, "pcs_mean")[0]]
    if not pcs:
        out.append("Pentatonic conformity (PCS) has not been measured on any run's A/B clips.")
    elif len(down) == len(pcs):
        out.append(f"Pentatonic conformity (PCS) falls against base in every evaluated run ({len(pcs)}): by this scorer the adapters' "
                   "extra sung material is less strictly pentatonic, or harder to track.")
    elif not down:
        out.append(f"Pentatonic conformity (PCS) rises against base in every evaluated run ({len(pcs)}).")
    else:
        out.append(f"Pentatonic conformity (PCS) falls against base in {len(down)} of {len(pcs)} evaluated runs ({_names(down)}) and rises in the others.")

    mert = [r for r in present if r.mert.get("closer_to_real") is not None]
    closer = [r for r in mert if r.mert["closer_to_real"]]
    if not mert:
        out.append("MERT-embedding distance to the real held-out qaraami clips: not run for any adapter.")
    elif not closer:
        out.append(f"No adapter's outputs are closer to the real held-out qaraami clips in MERT space than its base's outputs "
                   f"(MERT-FAD, {len(mert)} run(s) measured), so no run can claim to have moved toward the real recordings by this measure.")
    elif len(closer) == len(mert):
        out.append(f"Every measured adapter ({len(mert)}) has outputs closer to the real held-out qaraami clips in MERT space (MERT-FAD) than its base's outputs.")
    else:
        out.append(f"{_names(closer)} have outputs closer to the real held-out qaraami clips in MERT space (MERT-FAD) than their base; "
                   f"{_names([r for r in mert if r not in closer])} do not.")

    tun = [r for r in present if all((r.tuning.get("frac") or {}).get(s) is not None for s in ("real", "base", "adapter"))]
    if not tun:
        out.append("The tuning-offset distribution of real, base and adapter clips has not been measured on any run.")
    else:
        toward = [r for r in tun if abs(r.tuning["frac"]["adapter"] - r.tuning["frac"]["real"]) < abs(r.tuning["frac"]["base"] - r.tuning["frac"]["real"])]
        if len(toward) == len(tun):
            out.append(f"In every measured run ({len(tun)}) the adapter's share of clips more than 15 cents off A440 is closer to the real recordings' share than the base's.")
        elif not toward:
            out.append(f"In no measured run ({len(tun)}) is the adapter's share of clips more than 15 cents off A440 closer to the real recordings' share than the base's.")
        else:
            out.append(f"The adapter's share of clips more than 15 cents off A440 is closer to the real recordings' share than the base's in {_names(toward)}, "
                       f"not in {_names([r for r in tun if r not in toward])}.")

    heard = [r for r in present if r.listening]
    if not heard:
        out.append("No blind A/B listening session has been recorded for any evaluated run.")
    for r in heard:
        for s in r.listening:
            a, b, n = int(s.get("adapter", 0)), int(s.get("base", 0)), int(s.get("n", 0))
            lo, hi = s.get("wilson95") or wilson(a, n)
            verdict = ("the interval excludes one half, a preference for the adapter" if lo > 0.5
                       else "the interval excludes one half, a preference against the adapter" if hi < 0.5
                       else "the interval includes one half, no preference established at this n")
            out.append(f"Blind A/B, {Path(r.ab_dir).name} ({s.get('listener', '')}, {s.get('date', '')}): the adapter was preferred in {a} of {n} pairs, "
                       f"the base in {b}, neither in {s.get('none', n - a - b)}; Wilson 95 % [{lo:.2f}, {hi:.2f}], {verdict}.")

    research = [r for r in present if r.research_only]
    releasable = [r for r in present if r.rights == "releasable"]
    unverified = [r for r in present if r.rights == "rights unverified"]
    out.append("Rights: research-only adapters (Harvard rows in training): " + (_names(research) or "none") + "; releasable adapters: "
               + (_names(releasable) or "none") + "; rights unverified from the captions rows: " + (_names(unverified) or "none") + ".")
    out.append(f"Every adapter generates at most {MAX_SECONDS} s of audio per request (the service cap); nothing here models song form, "
               "lyrics or Somali-language singing: the captions carry no words and the models emit no text.")
    return out


def unheard_turing_sets(recs: list[RunRecord], turing: list[dict]) -> list[str]:
    """'`data/ab_turing_<tag>/` (n pairs, run X)' for every Turing set an eval
    built that no listening session covers yet."""
    heard = {s.get("set") for s in turing}
    out = []
    for r in recs:
        d = r.turing_set.get("dir")
        if d and Path(d).name not in heard:
            n = r.turing_set.get("n")
            out.append(f"`{rel(d)}/`" + (f" ({n} pairs, run {r.run})" if n else f" (run {r.run})"))
    return out


def somali_ness_sentence(turing: list[dict], recs: list[RunRecord]) -> str:
    """One honest sentence on audible Somali-ness: the Turing listening result
    when one exists, else the fixed sentence built from the best run's MERT
    verdict (or its absence), prefixed by the Turing sets that are built but
    unheard so a set nobody listened to is not confused with one never built."""
    if turing:
        parts = []
        for s in turing:
            lo, hi = s["wilson95"]
            parts.append(f"Turing check {s['set']} ({s['listener']}, {s['date']}): asked which of a real held-out recording and a model clip is the "
                         f"real recording, the listener took the model clip for the real one in {s['model']} of {s['n']} pairs, recognised the real "
                         f"recording in {s['real']}, could not tell in {s['none']} (model-as-real rate {s['model'] / s['n']:.2f}, Wilson 95 % "
                         f"[{lo:.2f}, {hi:.2f}]); one listener, so this is one person's ear, not a population claim.")
        unheard = unheard_turing_sets(recs, turing)
        if unheard:
            parts.append("Turing set(s) built but not yet heard: " + ", ".join(unheard) + ".")
        return " ".join(parts)
    unheard = unheard_turing_sets(recs, turing)
    prefix = ("Turing set(s) built but not yet heard: " + ", ".join(unheard) + ". ") if unheard else ""
    best = best_run(recs)
    closer = (best.mert.get("closer_to_real") if best else None)
    if closer is None:
        for_best = f" for the best run ({best.run})" if best is not None else ""
        return prefix + (f"No native-listener Turing result exists yet, and no MERT distance to the real recordings has been measured{for_best}; "
                         "nothing here is a perceptual claim.")
    word = "closer" if closer else "not closer"
    return prefix + f"No native-listener Turing result exists yet; the MERT distance says {word} to the real recordings, which is not a perceptual claim."


# ---------------------------------------------------------------- registry

@dataclass
class AdapterEntry:
    name: str
    path: Path
    base: str = ""
    research_only: bool | None = None
    run: str = ""
    corpus: str = ""
    trained: str = ""
    metrics: dict = field(default_factory=dict)
    listening_gate: str = ""
    kind: str = ""
    registered: bool = True     # False when derived from a run because no registry exists


def find_run_dir(run: str, runs_dir: Path) -> Path | None:
    """The run directory a registry "run" value names: a bare run name under
    runs_dir, a repo-relative path ("runs/<run>", as register_adapter writes
    it), an absolute path, or a path relative to the cwd; None when none is a directory."""
    if not run:
        return None
    p = Path(run)
    cands = [runs_dir / p.name, runs_dir / run] if not p.is_absolute() else [p]
    if not p.is_absolute():
        cands += [REPO / run, p]
    for cand in cands:
        if cand.is_dir():
            return cand
    return None


def run_name_of(run: str, runs_dir: Path) -> str:
    """The bare run name of a registry "run" value (see find_run_dir); a value
    that names no directory is reduced to its last path component."""
    if not run:
        return ""
    d = find_run_dir(run, runs_dir)
    return d.name if d is not None else Path(run).name


def _entry(name: str, info: dict, runs_dir: Path) -> AdapterEntry:
    raw = str(info.get("path") or "")
    path = Path(raw)
    if raw and not path.is_absolute():
        path = REPO / raw
    run = run_name_of(str(info.get("run") or ""), runs_dir)
    if not run and raw:
        for cand in (path, path.parent, path.parent.parent):
            if (cand / "config.json").exists() and cand.parent.resolve() == runs_dir.resolve():
                run = cand.name
                break
        if not run and path.parent.name:
            run = path.parent.name if path.parent.parent.resolve() == runs_dir.resolve() else run
    ro = info.get("research_only")
    if ro is None and info.get("rights"):
        ro = "research" in str(info["rights"]).lower()
    kind = {"lora": "PEFT LoRA adapter", "peft": "PEFT LoRA adapter", "full_decoder": "full decoder weights",
            "full": "full decoder weights"}.get(str(info.get("kind") or "").lower(), str(info.get("kind") or ""))
    return AdapterEntry(name=name, path=path, base=str(info.get("base") or info.get("base_model") or info.get("model") or ""),
                        research_only=None if ro is None else bool(ro), run=run, corpus=str(info.get("corpus") or ""),
                        trained=str(info.get("trained") or ""), metrics=info.get("metrics") or {},
                        listening_gate=str(info.get("listening_gate") or ""), kind=kind)


def load_registry(path: Path, runs_dir: Path) -> list[AdapterEntry] | None:
    """adapters.extra.json as a list of entries; None when the file is absent."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        warn(f"{path}: unreadable registry ({exc}); no model card written")
        return []
    entries: list[AdapterEntry] = []
    if isinstance(data, dict):
        items = data.get("adapters") if isinstance(data.get("adapters"), dict | list) else data
        if isinstance(items, dict):
            entries = [_entry(str(k), v or {}, runs_dir) for k, v in items.items() if isinstance(v, dict)]
        elif isinstance(items, list):
            entries = [_entry(str(v.get("name") or v.get("id")), v, runs_dir) for v in items if isinstance(v, dict) and (v.get("name") or v.get("id"))]
    elif isinstance(data, list):
        entries = [_entry(str(v.get("name") or v.get("id")), v, runs_dir) for v in data if isinstance(v, dict) and (v.get("name") or v.get("id"))]
    return entries


def adapters_from_runs(recs: list[RunRecord], runs_dir: Path) -> list[AdapterEntry]:
    """Without a registry: every evaluated runs/qaraami_* run is an adapter named after its run."""
    out = []
    for r in recs:
        if r.present and r.run.startswith("qaraami_") and r.best_ckpt:
            out.append(AdapterEntry(name=r.run, path=runs_dir / r.run / r.best_ckpt, base=r.model, research_only=r.research_only, run=r.run, registered=False))
    return out


# -------------------------------------------------------------- model card

def ckpt_kind(path: Path) -> str:
    """'PEFT LoRA adapter' | 'full decoder weights' | 'checkpoint not on disk' from the files."""
    if not path.is_dir():
        return "checkpoint not on disk"
    if (path / "adapter_config.json").exists():
        return "PEFT LoRA adapter"
    if any((path / w).exists() for w in ("decoder.safetensors", "model.safetensors", "pytorch_model.bin")):
        return "full decoder weights"
    return "checkpoint of unknown layout"


def dir_mb(path: Path) -> float | None:
    if not path.is_dir():
        return None
    return round(sum(p.stat().st_size for p in path.rglob("*") if p.is_file()) / 2**20, 1)


def how_to_load(entry: AdapterEntry, kind: str) -> str:
    rel_path = rel(str(entry.path))
    base = entry.base or "<base model>"
    if kind == "full decoder weights":
        return (f"```python\nfrom scripts.scale_train import load_checkpoint  # Phase 2 harness\n"
                f"model = load_checkpoint(\"{base}\", \"{rel_path}\")  # full decoder: decoder.safetensors into the base's decoder\n```\n"
                f"Without `load_checkpoint`, load `{base}` with transformers and `load_state_dict` the safetensors into `model.decoder`.")
    melody = "melody" in base.lower()  # scale_train.is_melody
    cls = "MusicgenMelodyForConditionalGeneration" if melody else "MusicgenForConditionalGeneration"
    note = (" A melody adapter is conditioned on chroma: pass the processor's `input_features` (12-bin chroma of a reference clip, "
            "or the MIDI-derived chroma the run trained on) next to the text, or generate text-only as the service does." if melody else "")
    return (f"```python\nfrom peft import PeftModel\nfrom transformers import {cls}\n"
            f"model = {cls}.from_pretrained(\"{base}\")\n"
            f"model.config.decoder.decoder_start_token_id = 2048\n"
            f"model = PeftModel.from_pretrained(model, \"{rel_path}\").eval()\n```\n"
            f"On the local service the adapter is `{entry.name}`; `base` selects the same engine with the adapter disabled.{note}")


def provenance_line(entry: AdapterEntry, rec: RunRecord | None) -> str:
    corpus = entry.corpus or (rec.corpus.summary() if rec and rec.present else "the QaraamiGen v2 corpus sets")
    rights = ("Research-only adapter: trained on Harvard Loeb Music Library material, served on the tailnet-only research service, never published."
              if (entry.research_only or (rec and rec.research_only)) else
              "Source recordings are not distributed and are not served; every clip is model output.")
    return (f"Generated by {entry.base or (rec.model if rec else '')} with the '{entry.name}' adapter ({rel(str(entry.path))}), "
            f"fine-tuned on {corpus}. {rights}")


def _interval(steps: list[int]) -> int | None:
    """The most common gap between consecutive steps (the validation / checkpoint
    interval as actually logged; an odd early probe does not change it), or
    None below two steps."""
    s = sorted(set(steps))
    gaps = [b - a for a, b in zip(s, s[1:]) if b > a]
    if not gaps:
        return None
    counts: dict[int, int] = {}
    for g in gaps:
        counts[g] = counts.get(g, 0) + 1
    return min(counts, key=lambda g: (-counts[g], g))


def training_recipe_lines(cfg: dict, rec: RunRecord | None = None, runs_dir: Path | None = None) -> list[str]:
    """One bullet per recorded config key; a full-decoder run shows its mode
    instead of the (recorded but unused) LoRA rank / α / targets; the early-stop
    settings, the stop marker and the validation / checkpoint intervals read
    from loss.csv and the ckpt_step_* directories. Nothing is asserted that no
    file records."""
    if not cfg:
        return ["- config.json: not found"]
    full = is_full_decoder_cfg(cfg) and not (rec and rec.kind == "dpo")
    keys = [("model", "base model"), ("lr", "learning rate"), ("total_steps", "steps"), ("warmup", "warm-up steps"),
            ("batch_size", "batch size"), ("grad_accum", "gradient accumulation"), ("rank", "LoRA rank"), ("alpha", "LoRA α"),
            ("lora_r", "LoRA rank"), ("lora_alpha", "LoRA α"), ("targets", "target modules"), ("lora_targets", "target modules"),
            ("train_clips", "training clips"), ("val_clips_used", "validation clips"), ("seed", "seed"),
            ("early_stop_patience", "early-stop patience (steps; 0 = off)"), ("early_stop_min_delta", "early-stop min Δ val loss"),
            ("max_hours", "max wall-clock hours (0 = off)"), ("keep_last", "checkpoints kept (--keep-last; 0 = all)"),
            ("beta", "DPO β"), ("rounds", "DPO rounds"), ("prompts_per_round", "prompts per round"),
            ("samples_per_prompt", "samples per prompt"), ("candidates_per_round", "candidates per round"),
            ("candidates_note", "candidate budget note"), ("device", "device"), ("git_commit", "git commit")]
    lora_labels = {"LoRA rank", "LoRA α", "target modules"}
    lines = []
    seen = set()
    if full:
        lines.append("- mode: full decoder fine-tune (no LoRA; rank / α / targets are recorded by the harness but unused)")
    for key, label in keys:
        if key in cfg and cfg[key] is not None and label not in seen and not (full and label in lora_labels):
            seen.add(label)
            val = cfg[key]
            lines.append(f"- {label}: `{', '.join(map(str, val)) if isinstance(val, list) else val}`")
    versions = cfg.get("versions") or {}
    if versions:
        lines.append("- library versions: " + ", ".join(f"{k} {v}" for k, v in versions.items() if k != "git_commit"))
    if cfg.get("resume_history"):
        lines.append(f"- resumed {len(cfg['resume_history'])} time(s) from a saved checkpoint (optimizer state restarted)")
    if rec is not None:
        vi = _interval([s for s in rec.val_curve if s > 0])
        ci = _interval(rec.ckpt_steps(runs_dir))
        lines.append("- validation interval (loss.csv): " + (f"every {vi} steps" if vi else "not recorded")
                     + "; checkpoint interval (ckpt_step_* on disk): " + (f"every {ci} steps" if ci else "not recorded"))
        st = stop_text(rec)
        if st:
            lines.append(f"- stop: {st}")
    lines.append("- harness: `apps/ai-service/scripts/scale_train.py`" + (" (DPO: `scripts/dpo_train.py`)" if rec and rec.kind == "dpo" else "")
                 + "; the fixed-dropout fix (functional dropout zeroed) and gradient checkpointing are the harness's defaults, not config keys")
    return lines


def card_rights(entry: AdapterEntry, rec: RunRecord | None) -> tuple[str, str]:
    """('research-only' | 'releasable' | 'rights unverified', why): the rows of
    the run's captions decide when a run record exists; otherwise the registry's
    own rights value is reported as such (register_adapter derives it from the
    same rows), and an entry without one is unverified."""
    if bool(entry.research_only) or bool(rec and rec.research_only):
        why = (rec.rights_reason if rec and rec.present and rec.research_only else "") or "research_only in the registry entry"
        return "research-only", why
    if rec and rec.present:
        return rec.rights, rec.rights_reason
    if entry.research_only is False:
        return "releasable", "the registry entry says releasable (register_adapter derives it from the run's captions rows); no run record here to re-check the rows"
    return "rights unverified", "no run record and no rights value in the registry entry"


def model_card(entry: AdapterEntry, rec: RunRecord | None, data_dir: Path, runs_dir: Path | None = None) -> str:
    rights_word, why = card_rights(entry, rec)
    research = rights_word == "research-only"
    kind = entry.kind or ckpt_kind(entry.path)
    size = dir_mb(entry.path)
    out = [f"# Model card — `{entry.name}` (QaraamiGen v2)", ""]
    if research:
        out.append("**RESEARCH-ONLY ADAPTER.** This adapter was trained on rows from the Harvard Loeb Music Library collection "
                   "(or other research-only material). It is served only on the tailnet-only research service with `research_only=true`, "
                   "never on the public site, never published, never distributed as weights. Its outputs are research material only.")
    elif rights_word == "releasable":
        out.append(f"Releasable adapter: {why}. Weights may be published; the training audio may not.")
    else:
        out.append(f"**Rights unverified:** {why}. Treat as not releasable until the training rows have been read.")
    out += ["", f"**Artifact:** `{rel(str(entry.path))}` ({kind}" + (f", {size} MB" if size is not None else "") + "). "
            + (f"Registered on the local service as `{entry.name}`" if entry.registered else f"Not yet registered on the service (card derived from run `{entry.run}`)")
            + (f", base `{entry.base}`" if entry.base else "") + ".", ""]
    out += ["## Base model", "", f"`{entry.base or (rec.model if rec else 'unknown')}`, unchanged; "
            + (f"recipe: {rec.recipe}." if rec and rec.recipe else "recipe not recorded."), ""]
    out += ["## Rights", "", f"**{rights_word}** — {why}." + ("" if research else " Releasable means every training row carries a consented tier "
            "(ahmed_*, internet_cc, contrib_*_consented); the audio itself stays private."), ""]
    out += ["## Data — described, not distributed", ""]
    if rec and rec.present and rec.corpus.captions is not None:
        c = rec.corpus
        out.append(f"Captions file `{rel(str(c.captions))}`: {c.unique_songs} unique songs, ~{c.unique_hours_est:.1f} h of unique source audio "
                   f"(50 %-overlap estimate), clips of {c.clip_seconds:g} s.")
        out.append("")
        out.append("| set | clips | songs | source audio | rights tier |")
        out.append("| --- | --- | --- | --- | --- |")
        tier_by_set: dict[str, str] = {}
        for r in read_rows(c.captions):
            tier_by_set.setdefault(r.get("source") or r.get("rights") or "unlabelled", rights_tier(r))
        for name, s in sorted(c.sources.items()):
            h = f"~{s['hours']:.1f} h" if s["hours_is_estimate"] else f"{s['hours']:.1f} h"
            out.append(f"| {name} | {s['clips']} | {s['songs']} | {h} | {tier_by_set.get(name, 'unknown')} |")
        out.append("")
        overlap = c.split_overlap()
        disjoint = ("song-level: no song appears in two splits (checked over the rows' song ids)" if not overlap
                    else f"**{len(overlap)} song id(s) appear in more than one split** (checked over the rows' song ids)")
        out.append("Splits: " + ", ".join(f"{k} {v[0]} clips ({v[1]} songs)" for k, v in sorted(c.splits.items())) + f" — {disjoint}.")
    else:
        out.append(entry.corpus or "not run (no evaluated run behind this adapter)")
    out += ["", "## Training recipe (config.json)", ""] + training_recipe_lines(rec.config if rec else {}, rec, runs_dir)
    if entry.trained:
        out.append(f"- registry note: {entry.trained}")
    out += ["", "## Metrics", ""]
    if rec and rec.present:
        vb, va = rec.val_ce
        out += ["| measure | base | adapter |", "| --- | --- | --- |",
                f"| validation token CE (loss.csv, step 0 → best ckpt {rec.best_ckpt}) | {f(vb)} | {f(va)} |",
                f"| per-song test CE | {f((rec.ce or {}).get('base', {}).get('mean'))} | {f((rec.ce or {}).get('adapter', {}).get('mean'))} |",
                f"| CE improvement base − adapter [95 % CI] | {ce_cell(rec.ce).split('(Δ ')[-1].rstrip(')') if rec.ce else NOT_RUN} | |",
                f"| trackable melody (voiced fraction, A/B clips) | {f(((rec.ab or {}).get('base') or {}).get('voiced_fraction_mean'), 3)} | {f(((rec.ab or {}).get('adapter') or {}).get('voiced_fraction_mean'), 3)} |",
                f"| PCS (A/B clips) | {f(((rec.ab or {}).get('base') or {}).get('pcs_mean'), 4)} | {f(((rec.ab or {}).get('adapter') or {}).get('pcs_mean'), 4)} |",
                f"| MERT-FAD to real held-out clips | {f(rec.mert.get('fad_base'), 3)} | {f(rec.mert.get('fad_adapter'), 3)} |",
                f"| closer to real (MERT-FAD) | | {closer_cell(rec.mert)} |",
                f"| MERT cosine to the real centroid | {f(rec.mert.get('cosine_base'), 4)} | {f(rec.mert.get('cosine_adapter'), 4)} |",
                f"| MERT nearest-real cosine (paired Δ adapter − base [95 % CI]) | {f(rec.mert.get('nn_cos_base'), 4)} | {f(rec.mert.get('nn_cos_adapter'), 4)}"
                + (f" (Δ {signed(rec.mert.get('nn_delta_mean'))} [{rec.mert['nn_delta_ci95'][0]:.3f}, {rec.mert['nn_delta_ci95'][1]:.3f}])" if rec.mert.get("nn_delta_ci95") else "") + " |",
                f"| share of clips with \\|tuning offset\\| ≥ 15 c (real / base / adapter) | {tuning_cell(rec.tuning)} | |"]
        if entry.metrics:
            out.append(f"| registry metrics | `{json.dumps(entry.metrics)}` | |")
    else:
        out.append(NOT_RUN)
    out += ["", "## Listening results", ""]
    if rec and rec.listening:
        out.append(listening_cell(rec.listening).replace("<br>", "\n\n"))
    else:
        out.append("No blind listening session recorded for this adapter's A/B set" + (f" (`{rel(rec.ab_dir)}/`)." if rec and rec.ab_dir else "."))
    if entry.listening_gate:
        out.append(f"\nRegistry listening gate: {entry.listening_gate}")
    turing = turing_sessions(data_dir)
    out += ["", somali_ness_sentence(turing, [rec] if rec else []), ""]
    scorer = (rec.scorer if rec else {}) or {}
    out += ["## Limitations", "",
            "- Scorer sensitivity: PCS, voiced fraction and tuning offset come from torchcrepe" + (f" {scorer.get('torchcrepe')}" if scorer.get("torchcrepe") else "")
            + (f", hop {scorer.get('pcs_hop')}, confidence gate {scorer.get('pcs_conf_thresh')}, scripts/pcs.py sha256 {str(scorer.get('pcs_file_sha256', ''))[:12]}" if scorer else " (version not pinned in the eval)")
            + "; numbers scored under another torchcrepe build, hop or gate are not comparable with these.",
            "- Single listener: every blind result on record is one listener's ear; no population claim follows from it.",
            "- Harvard rule: an adapter that saw any harvard_* row is research-only, whatever its metrics; releasable adapters never saw one.",
            f"- Generation on the service is capped at {MAX_SECONDS} s per request (services/musicgen-api MAX_SECONDS), batch 1; "
            "there is no song form, no lyrics, no Somali-language singing.",
            "- Token-CE margins are small in absolute terms; the CI over songs, not the point estimate, is the evidence.", ""]
    out += ["## How to load", "", how_to_load(entry, kind), ""]
    out += ["## Provenance", "", provenance_line(entry, rec), "",
            f"*Generated by `apps/ai-service/scripts/model_report.py` on {time.strftime('%Y-%m-%d')} from the run artifacts; nothing typed by hand.*", ""]
    return "\n".join(out)


# ----------------------------------------------------------------- report

def improvement_log(path: Path) -> str:
    if not path.exists():
        return f"{NOT_RUN} — `{IMPROVEMENT_LOG_REL}` does not exist yet (Phase 4 writes it)."
    body = path.read_text().strip()
    # demote the log's own headings under this section; lines inside ``` fences stay untouched
    out, fenced = [], False
    for line in body.splitlines():
        if line.lstrip().startswith("```"):
            fenced = not fenced
        elif not fenced and re.match(r"^#{1,4} ", line):
            line = "##" + line
        out.append(line)
    return f"*Included verbatim from `{IMPROVEMENT_LOG_REL}`.*\n\n" + "\n".join(out)


def build_report(runs_dir: Path, data_dir: Path, figures_rel: str = "../figures", log_path: Path | None = None) -> tuple[str, list[RunRecord]]:
    recs = load_all(runs_dir, data_dir)
    turing = turing_sessions(data_dir)
    best, criterion, excluded = best_run_ranking(recs)
    log_path = log_path if log_path is not None else REPO / IMPROVEMENT_LOG_REL
    out = ["# QaraamiGen v2 — model report", "",
           f"*Generated by `apps/ai-service/scripts/model_report.py` on {time.strftime('%Y-%m-%d')} from `runs/*/eval_*.json`, "
           "`eval_round_*.json`, `test_ce.json`, `loss.csv`, `config.json`, the captions files, `data/listening/*.json` and the "
           "adapter registry; nothing typed by hand. A run or measurement that has not happened reads \"not run\". Per-song test CE is "
           "the mean token cross-entropy over held-out test songs with a bootstrap 95 % CI over songs on base − adapter; trackable "
           "melody is the CREPE voiced fraction and PCS the pentatonic conformity of the A/B clips (same captions and seeds on both "
           "sides); MERT-FAD is the Fréchet distance between MERT embeddings of generated clips and of real held-out clips; the "
           "tuning column is the share of clips whose global tuning offset is at least 15 cents off A440. DPO rows compare the round's "
           "start adapter (\"base\") with its end (\"adapter\"). Hours are source-audio hours from the set card, or `~` a 50 %-overlap "
           "estimate from the clip count.*", ""]
    out += ["## (a) Results across all runs", "", RESULTS_HEADER]
    out += [results_row(r) for r in recs]
    if best is not None:
        line = f"Best evaluated run by {criterion}: **{best.run}** ({best.rights})."
        if excluded:
            line += (" Not ranked by FAD: " + ", ".join(f"{r.run} ({'DPO round' if r.kind == 'dpo' else 'no n_real pool'})" for r in excluded)
                     + " — a DPO round's fad_to_real_oud_test measures 15 s candidates against the reward-model reference pool, another design "
                     "than scale_eval's real held-out pool, so the numbers are shown in the rows but not compared across runs.")
        out += ["", line]
    files = [f"{r.run} → `{r.eval_file}`" for r in recs if r.present and r.eval_file]
    if files:
        out += ["", "Eval files read (eval_<run>.json first, else the newest eval_*.json): " + "; ".join(files) + "."]
    if any(r.turing_set for r in recs):
        heard = {s.get("set") for s in turing}
        bits = []
        for r in recs:
            if r.turing_set:
                d, n = r.turing_set["dir"], r.turing_set.get("n")
                bits.append(f"{r.run} → `{rel(d)}/`" + (f" ({n} pairs)" if n else "") + (" — heard" if Path(d).name in heard else " — no session yet"))
        out += ["", "Turing sets built by the evals (real recording vs model clip): " + "; ".join(bits) + "."]
    out += ["", "## (b) Improvement log", "", improvement_log(log_path)]
    out += ["", "## (c) Corpus hours per run", "",
            "| run | captions | sets (clips, songs, source audio; card window total) | unique songs, unique hours (est.) | splits | rights rows → verdict |",
            "| --- | --- | --- | --- | --- | --- |"]
    out += [corpus_row(r) for r in recs]
    out += ["", "## (d) What the model does and does not do", ""]
    out += [f"- {s}" for s in findings(recs)]
    out += ["", "## (e) Audible Somali-ness", "", somali_ness_sentence(turing, recs)]
    out += ["", "## Figures", "",
            f"![validation and training loss per v2 run]({figures_rel}/v2_loss_curves.png)", "",
            f"![per-song test CE improvement with 95 % CI]({figures_rel}/v2_ce_improvement.png)", "",
            f"![MERT-FAD to the real held-out clips, adapter vs base]({figures_rel}/v2_fad_bars.png)", "",
            f"![tuning-offset histograms, real / base / adapter]({figures_rel}/v2_tuning_hist.png)", "",
            f"![MERT cosine to the real clips, base vs adapter]({figures_rel}/v2_mert_cosine.png)", ""]
    return "\n".join(out), recs


# ---------------------------------------------------------------- figures

def _empty(ax, text: str) -> None:
    ax.text(0.5, 0.5, text, ha="center", va="center", color=INK_2, transform=ax.transAxes, fontsize=10)
    ax.set_xticks([])
    ax.set_yticks([])


def _color(i: int) -> str:
    return SERIES8[i] if i < len(SERIES8) else PRIOR_COLOR


def fig_loss_curves(recs: list[RunRecord], path: Path) -> None:
    v2 = [r for r in recs if r.group != "prior" and (r.val_curve or r.train_curve)]
    fig, (ax_v, ax_t) = plt.subplots(2, 1, figsize=(8, 7), sharex=True)
    for i, rec in enumerate(v2):
        color = _color(i)
        vs = sorted(rec.val_curve)
        if vs:
            ax_v.plot(vs, [rec.val_curve[s] for s in vs], color=color, linewidth=2, marker="o", markersize=4, label=rec.run)
            ax_v.annotate(rec.run, (vs[-1], rec.val_curve[vs[-1]]), textcoords="offset points", xytext=(4, 0), fontsize=8, color=INK_2)
        ts, tv = smooth(rec.train_curve)
        if ts:
            ax_t.plot(ts, tv, color=color, linewidth=1.6, label=rec.run)
    for ax, title in ((ax_v, "validation CE per checkpoint"), (ax_t, "training loss (50-step running mean)")):
        _style(ax)
        ax.set_title(title, loc="left", fontsize=11, color=INK)
        ax.set_ylabel("token cross-entropy", color=INK_2, fontsize=9)
    ax_t.set_xlabel("optimizer step", color=INK_2, fontsize=9)
    if v2:
        ax_v.legend(frameon=False, fontsize=9, labelcolor=INK_2)
    else:
        _empty(ax_v, "no v2 run has a loss.csv yet (not run)")
        _empty(ax_t, NOT_RUN)
    fig.suptitle("QaraamiGen v2 runs — loss curves", x=0.02, ha="left", fontsize=13, color=INK)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def fig_ce_improvement(recs: list[RunRecord], path: Path) -> None:
    labels, means, lo, hi, colors = [], [], [], [], []
    for rec in recs:
        labels.append(rec.run)
        colors.append(SERIES8[0] if rec.group != "prior" else PRIOR_COLOR)
        m, ci = imp_mean(rec), imp_ci(rec)
        means.append(m if m is not None else 0.0)
        lo.append((m - ci[0]) if (m is not None and ci) else 0.0)
        hi.append((ci[1] - m) if (m is not None and ci) else 0.0)
    fig, ax = plt.subplots(figsize=(8, 0.45 * len(labels) + 1.8))
    y = list(range(len(labels)))[::-1]
    ax.barh(y, means, color=colors, height=0.55, edgecolor="none")
    ax.errorbar(means, y, xerr=[lo, hi], fmt="none", ecolor=INK_2, elinewidth=1, capsize=3)
    for yi, rec, m_lo, m_hi in zip(y, recs, lo, hi):
        m, ci = imp_mean(rec), imp_ci(rec)
        if not rec.present:
            ax.text(0.002, yi, NOT_RUN, va="center", ha="left", fontsize=8.5, color=INK_2)
        elif m is not None:
            txt = f"{m:+.3f}" + (f" [{ci[0]:.3f}, {ci[1]:.3f}]" if ci else " (no CI)")
            ax.text(max(m, 0) + m_hi + 0.003, yi, txt, va="center", ha="left", fontsize=8.5, color=INK_2)
    ax.axvline(0, color=INK_2, linewidth=1)
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=9, color=INK)
    _style(ax)
    ax.grid(True, axis="x", color=GRID, linewidth=0.8)
    ax.grid(False, axis="y")
    ax.set_xlabel("per-song test CE improvement, base − adapter (nats/token, 95 % bootstrap CI over songs)", color=INK_2, fontsize=9)
    from matplotlib.patches import Patch
    ax.legend(handles=[Patch(color=SERIES8[0], label="v2 runs and variants"), Patch(color=PRIOR_COLOR, label="prior runs")],
              frameon=False, fontsize=9, labelcolor=INK_2, loc="upper center", bbox_to_anchor=(0.5, -0.18), ncol=2)
    ax.set_title("Per-song test CE improvement, every run", loc="left", fontsize=11, color=INK)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def fig_fad_bars(recs: list[RunRecord], path: Path) -> None:
    rows = [r for r in recs if r.present and (r.mert.get("fad_adapter") is not None or r.mert.get("fad_base") is not None)]
    fig, ax = plt.subplots(figsize=(8, 0.7 * max(len(rows), 1) + 2.2))
    if not rows:
        _empty(ax, "MERT-FAD to the real held-out clips: not run for any adapter")
    else:
        y = np.arange(len(rows))[::-1]
        h = 0.3
        base = [r.mert.get("fad_base") or 0.0 for r in rows]
        adapter = [r.mert.get("fad_adapter") or 0.0 for r in rows]
        ax.barh(y + h / 2 + 0.02, base, height=h, color=PRIOR_COLOR, label="base → real", edgecolor="none")
        ax.barh(y - h / 2 - 0.02, adapter, height=h, color=SERIES8[0], label="adapter → real", edgecolor="none")
        top = max(max(base), max(adapter), 1e-6)
        for i, (yi, r) in enumerate(zip(y, rows)):
            ax.text(max(base[i], adapter[i]) + top * 0.01, yi, "closer" if r.mert.get("closer_to_real") else "not closer",
                    va="center", ha="left", fontsize=8.5, color=INK_2)
        ax.set_xlim(0, top * 1.25)
        ax.set_ylim(-0.8, len(rows) - 0.2)
        ax.set_yticks(y)
        ax.set_yticklabels([r.run for r in rows], fontsize=9, color=INK)
        _style(ax)
        ax.grid(True, axis="x", color=GRID, linewidth=0.8)
        ax.grid(False, axis="y")
        ax.set_xlabel("MERT-FAD to the real held-out clips (lower = closer)", color=INK_2, fontsize=9)
        ax.legend(frameon=False, fontsize=9, labelcolor=INK_2, loc="upper center", bbox_to_anchor=(0.5, -0.28), ncol=2)
    ax.set_title("MERT-FAD to real recordings, adapter against base", loc="left", fontsize=11, color=INK)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def fig_tuning_hist(recs: list[RunRecord], path: Path) -> None:
    rows = [r for r in recs if r.present and any((r.tuning.get("offsets") or {}).get(s) for s in ("real", "base", "adapter"))]
    n = max(len(rows), 1)
    fig, axes = plt.subplots(n, 1, figsize=(8, 2.4 * n + 0.8), squeeze=False)
    bins = np.arange(0, 55, 5)
    if not rows:
        _empty(axes[0][0], "tuning offsets of real / base / adapter clips: not run")
    for ax, r in zip((a[0] for a in axes), rows):
        off = r.tuning["offsets"]
        for side, color in (("real", REAL_COLOR), ("base", PRIOR_COLOR), ("adapter", SERIES8[0])):
            vals = off.get(side)
            if vals:
                ax.hist(np.clip(np.abs(vals), 0, 50), bins=bins, histtype="step", linewidth=2, color=color,
                        label=f"{side} (n = {len(vals)}, ≥15 c: {frac_ge(vals):.2f})", density=True)
        ax.axvline(OFFSET_THRESHOLD_CENTS, color=INK_2, linewidth=1, linestyle="--")
        _style(ax)
        ax.set_title(r.run, loc="left", fontsize=10, color=INK)
        ax.set_ylabel("density", color=INK_2, fontsize=9)
        ax.legend(frameon=False, fontsize=8, labelcolor=INK_2)
    axes[-1][0].set_xlabel("|tuning offset| from A440 (cents, clipped at 50)", color=INK_2, fontsize=9)
    fig.suptitle("Tuning-offset distribution, real / base / adapter", x=0.02, ha="left", fontsize=13, color=INK)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def fig_mert_cosine(recs: list[RunRecord], path: Path) -> None:
    rows = [r for r in recs if r.present and (r.mert.get("cosine_adapter") is not None or r.mert.get("cosine_base") is not None)]
    fig, ax = plt.subplots(figsize=(8, 0.6 * max(len(rows), 1) + 1.8))
    if not rows:
        _empty(ax, "MERT cosine to the real clips: not run for any adapter")
    else:
        y = np.arange(len(rows))[::-1]
        for yi, r in zip(y, rows):
            for side, color, dy in (("base", PRIOR_COLOR, 0.15), ("adapter", SERIES8[0], -0.15)):
                lst = r.mert.get(f"cosine_{side}_list")
                mean = r.mert.get(f"cosine_{side}")
                if lst:
                    ax.scatter(lst, [yi + dy] * len(lst), s=14, color=color, alpha=0.35, edgecolors="none")
                if mean is not None:
                    ax.scatter([mean], [yi + dy], s=60, color=color, edgecolors="white", linewidths=1, zorder=3,
                               label=f"{side} (mean)" if yi == y[0] else None)
                    ax.text(mean, yi + dy + (0.12 if dy > 0 else -0.2), f"{mean:.3f}", ha="center", fontsize=8, color=INK_2)
        ax.set_yticks(y)
        ax.set_yticklabels([r.run for r in rows], fontsize=9, color=INK)
        _style(ax)
        ax.grid(True, axis="x", color=GRID, linewidth=0.8)
        ax.grid(False, axis="y")
        ax.set_xlabel("MERT cosine similarity to the real held-out clips (higher = closer)", color=INK_2, fontsize=9)
        ax.legend(frameon=False, fontsize=9, labelcolor=INK_2, loc="lower right")
    ax.set_title("MERT cosine to real recordings, base against adapter", loc="left", fontsize=11, color=INK)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


FIGURES = ("v2_loss_curves.png", "v2_ce_improvement.png", "v2_fad_bars.png", "v2_tuning_hist.png", "v2_mert_cosine.png")


def write_figures(recs: list[RunRecord], figures_dir: Path) -> list[Path]:
    figures_dir.mkdir(parents=True, exist_ok=True)
    fig_loss_curves(recs, figures_dir / FIGURES[0])
    fig_ce_improvement(recs, figures_dir / FIGURES[1])
    fig_fad_bars(recs, figures_dir / FIGURES[2])
    fig_tuning_hist(recs, figures_dir / FIGURES[3])
    fig_mert_cosine(recs, figures_dir / FIGURES[4])
    return [figures_dir / n for n in FIGURES]


def write_cards(recs: list[RunRecord], runs_dir: Path, data_dir: Path, registry: Path, cards_dir: Path) -> list[Path]:
    entries = load_registry(registry, runs_dir)
    if entries is None:
        entries = adapters_from_runs(recs, runs_dir)
    by_run = {r.run: r for r in recs}
    out = []
    cards_dir.mkdir(parents=True, exist_ok=True)
    for e in entries:
        rec = by_run.get(e.run)
        if rec is None and e.run:
            d = find_run_dir(e.run, runs_dir)
            if d is not None:
                rec = load_run(d.parent, data_dir, d.name, d.name, "v2")
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", e.name)
        p = cards_dir / f"MODEL_CARD_{safe}.md"
        p.write_text(model_card(e, rec, data_dir, runs_dir))
        out.append(p)
    return out


def write_report(runs_dir: Path, data_dir: Path, out: Path, figures_dir: Path, registry: Path, cards_dir: Path | None = None,
                 log_path: Path | None = None) -> tuple[Path, list[Path], list[Path]]:
    out.parent.mkdir(parents=True, exist_ok=True)
    figures_dir.mkdir(parents=True, exist_ok=True)
    # the image links are relative to the report's directory, whatever the layout
    figures_rel = os.path.relpath(figures_dir.resolve(), out.parent.resolve()).replace(os.sep, "/")
    md, recs = build_report(runs_dir, data_dir, figures_rel, log_path)
    figs = write_figures(recs, figures_dir)
    cards = write_cards(recs, runs_dir, data_dir, registry, cards_dir or out.parent)
    out.write_text(md)
    return out, figs, cards


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs-dir", default=str(REPO / "runs"))
    ap.add_argument("--data-dir", default=str(REPO / "data"))
    ap.add_argument("--out", default=str(REPO / "docs/eval/QARAAMI_MODEL_REPORT.md"))
    ap.add_argument("--figures-dir", default=str(REPO / "docs/figures"))
    ap.add_argument("--registry", default=str(REPO / REGISTRY_REL))
    ap.add_argument("--cards-dir", default=None, help="model cards directory (default: next to --out)")
    ap.add_argument("--improvement-log", default=str(REPO / IMPROVEMENT_LOG_REL))
    args = ap.parse_args()
    out, figs, cards = write_report(Path(args.runs_dir), Path(args.data_dir), Path(args.out), Path(args.figures_dir),
                                    Path(args.registry), Path(args.cards_dir) if args.cards_dir else None, Path(args.improvement_log))
    print(f"wrote {out}")
    print("figures: " + ", ".join(str(p) for p in figs))
    print("model cards: " + (", ".join(str(p) for p in cards) or "none (no registered adapter)"))


if __name__ == "__main__":
    main()
