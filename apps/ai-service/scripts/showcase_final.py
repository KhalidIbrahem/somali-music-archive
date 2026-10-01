"""The final 16-clip showcase of one adapter (Phase 5): data/showcase_final/<adapter>/
clipNN.wav, 30 s each, on a FIXED caption list shared by every adapter, with
scores.json and a README.txt that states provenance and rights.

  * the adapter comes from the service registry (--adapter <name> in
    services/musicgen-api/adapters.extra.json: path, base, rights, run — "run"
    as a bare name, register_adapter's repo-relative "runs/<run>" or an absolute
    path) or from a run (--run runs/<run> [--ckpt <dir>] [--model <base>]; the
    best checkpoint by val CE through scale_eval.find_best_ckpt when --ckpt is
    not given, the base model from config.json when --model is not given)
  * the caption list is data/showcase_captions_v2.json; when it does not exist
    it is created ONCE from the run's captions file: 16 distinct captions of
    CONSENTED test rows (ahmed_*, internet_cc, contrib_*_consented; never a
    Harvard row, by rights or source), sampled with a fixed seed, so every
    adapter is heard on the same prompts. A test split with fewer than 16
    distinct consented captions (the Ahmed-only set has 11: five test songs
    share a caption grammar) is topped up from the consented val rows, then
    train rows; the composition (per-split counts, seed, source file, date) is
    written next to the list as showcase_captions_v2.meta.json and repeated in
    README.txt / scores.json; fewer than 16 consented captions in the whole
    file is an error
  * generation is batch 1, CFG 3, seed 1000 + i for clip i, max_new_tokens =
    50 × seconds; a clip that already exists with the asked length is not
    regenerated (--force regenerates), so a killed run resumes
  * every clip is loudness-normalised to −14 LUFS (pyloudnorm, integrated) with
    a 0.99 peak limit that wins over the target when they conflict; the gain
    and whether the limiter engaged are in scores.json. A clip below
    pyloudnorm's −70 LUFS absolute gate (integrated loudness −inf, but not
    digital silence) is peak-normalised to the limit instead and flagged in
    scores.json (loudness.note) and the build log; digital silence is unchanged
  * scores.json: per clip the caption, seed, PCS / voiced fraction / tuning
    offset / tonic from scripts.pcs (through scale_eval.score_clip, scorer
    version pinned) and the loudness numbers
  * README.txt: the provenance line (base model, adapter path, corpus sets and
    hours from the run captions at the run's clip length, as in the model
    report), the rights statement, the caption list file and its composition,
    seeds, CFG, loudness target and the scorer version
  * rights are tri-state, read from the run's captions rows (research-only |
    releasable | unverified; the registry's own value counts when no rows can
    be read). A RESEARCH-ONLY adapter (Harvard rows in training, or
    research_only in the registry) is refused unless --allow-research-only is
    passed; then the README says "research-only, not for publication" in its
    first line. An UNVERIFIED adapter (rows without a recognised tier, or no
    captions file and no registry rights) is refused unless
    --allow-unverified-rights is passed, and is never called releasable

Checkpoint loading goes through scale_train.load_checkpoint when this checkout
has it (the Phase 2 harness: LoRA or full decoder); otherwise a LoRA checkpoint
loads with PEFT and a full-decoder checkpoint's safetensors are loaded into the
base model's decoder here.

Usage (from apps/ai-service):
  python -m scripts.showcase_final --adapter qaraami_large
  python -m scripts.showcase_final --run ../../runs/qaraami_large_all --allow-research-only
  python -m scripts.showcase_final --run ../../runs/ahmed_only --ckpt ../../runs/ahmed_only/ckpt_step_0250 \
     --model facebook/musicgen-medium --n 1 --seconds 3 --out-root /tmp/showcase_smoke
"""
from __future__ import annotations

import argparse
import json
import random
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

from scripts.ahmed_report import resolve_captions
from scripts.model_report import (
    REGISTRY_REL,
    AdapterEntry,
    corpus_of,
    find_run_dir,
    load_registry,
    read_json_safe,
    read_rows,
    rel,
    rights_tier,
    run_clip_seconds,
)

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "data"
RUNS = REPO / "runs"
DEFAULT_OUT_ROOT = DATA / "showcase_final"
DEFAULT_CAPTIONS = DATA / "showcase_captions_v2.json"
N_CLIPS = 16
SECONDS = 30
CFG = 3.0
SEED_BASE = 1000
CAPTION_SEED = 1000
TARGET_LUFS = -14.0
PEAK_LIMIT = 0.99
SILENCE_PEAK = 1e-4              # below this peak a clip is digital silence and is left alone
FRAMES_PER_SECOND = 50
WEIGHT_FILES = ("decoder.safetensors", "model.safetensors", "pytorch_model.bin")
RIGHTS_WORDS = ("research-only", "releasable", "unverified")

GenerateFn = Callable[[str, int, int], tuple[np.ndarray, int]]
ScoreFn = Callable[[Path], dict]


# ----------------------------------------------------------------- target

@dataclass
class Target:
    """Everything the showcase needs to know about the adapter it renders."""
    name: str
    base: str
    ckpt: Path
    run_dir: Path | None = None
    captions: Path | None = None
    research_only: bool = False
    rights_reason: str = ""
    corpus: str = ""
    kind: str = ""
    config: dict = field(default_factory=dict)
    rights: str = "unverified"          # research-only | releasable | unverified (RIGHTS_WORDS)
    registry_rights: str | None = None  # the registry entry's own word, when the target came from one

    def __post_init__(self) -> None:
        if self.research_only:
            self.rights = "research-only"
        if self.rights not in RIGHTS_WORDS:
            raise ValueError(f"rights must be one of {RIGHTS_WORDS}, not {self.rights!r}")


def ckpt_kind(path: Path) -> str:
    if (path / "adapter_config.json").exists():
        return "PEFT LoRA adapter"
    if any((path / w).exists() for w in WEIGHT_FILES):
        return "full decoder weights"
    return "unknown"


def rights_of(captions: Path | None) -> tuple[str | None, str]:
    """('research-only' | 'releasable' | 'unverified', why) from the rows of a
    captions file (rights or source, as model_report.rights_tier); (None, why)
    when there is no file to read."""
    if captions is None or not captions.exists():
        return None, "no captions file to read the rights from"
    tiers: dict[str, int] = {}
    for r in read_rows(captions):
        t = rights_tier(r)
        tiers[t] = tiers.get(t, 0) + 1
    if tiers.get("research_only"):
        return "research-only", f"{tiers['research_only']} training rows are Harvard / research-only material"
    if tiers.get("unknown"):
        return "unverified", f"{tiers['unknown']} rows carry no recognised rights tier (not research-only, not verified consented)"
    if not tiers:
        return "unverified", "the captions file has no rows"
    return "releasable", f"all {tiers.get('consented', 0)} rows carry a consented tier"


def _finish(t: Target, data_dir: Path) -> Target:
    """Fill the target from its run: config, captions, base, checkpoint kind,
    rights (rows first; the registry's word when no rows can be read) and the
    corpus line at the run's clip length (model_report.run_clip_seconds)."""
    if t.run_dir is not None and not t.config:
        t.config = read_json_safe(t.run_dir / "config.json") or {}
    if t.captions is None and t.config.get("captions"):
        t.captions = resolve_captions(t.config.get("captions"))
    if not t.base:
        t.base = str(t.config.get("model") or "")
    if not t.kind:
        t.kind = ckpt_kind(t.ckpt)
    rows_word, why = rights_of(t.captions)
    if t.research_only:
        t.rights = "research-only"
        if rows_word == "research-only":
            t.rights_reason = why
        t.rights_reason = t.rights_reason or "research_only in the registry"
    elif rows_word is not None:
        t.rights, t.rights_reason = rows_word, why
    elif t.registry_rights == "releasable":
        t.rights, t.rights_reason = "releasable", f"{why}; the registry entry says releasable (derived from the rows by register_adapter)"
    else:
        t.rights, t.rights_reason = "unverified", why
    t.research_only = t.rights == "research-only"
    if not t.corpus:
        t.corpus = corpus_of(t.captions, data_dir, run_clip_seconds(t.config)).summary() if t.captions else "an unrecorded corpus (no captions file)"
    return t


def target_from_registry(name: str, registry: Path, runs_dir: Path, data_dir: Path) -> Target:
    entries = load_registry(registry, runs_dir)
    if entries is None:
        raise SystemExit(f"--adapter {name}: registry {registry} does not exist; use --run instead")
    by_name: dict[str, AdapterEntry] = {e.name: e for e in entries}
    if name not in by_name:
        raise SystemExit(f"--adapter {name}: not in {registry}; registered: {sorted(by_name)}")
    e = by_name[name]
    if not e.path.is_dir():
        raise SystemExit(f"--adapter {name}: checkpoint {e.path} is not a directory")
    run_dir = find_run_dir(e.run, runs_dir)
    t = Target(name=name, base=e.base, ckpt=e.path, run_dir=run_dir,
               research_only=bool(e.research_only), rights_reason="research_only in the registry" if e.research_only else "",
               corpus=e.corpus, kind=e.kind,
               registry_rights=None if e.research_only is None else ("research-only" if e.research_only else "releasable"))
    return _finish(t, data_dir)


def target_from_run(run: Path, ckpt: Path | None, model: str | None, data_dir: Path) -> Target:
    if not run.is_dir():
        raise SystemExit(f"--run {run}: not a run directory")
    if ckpt is None:
        from scripts.scale_eval import find_best_ckpt  # lazy: scale_eval imports torch/transformers
        ckpt = find_best_ckpt(run)
    if not ckpt.is_dir() or ckpt_kind(ckpt) == "unknown":
        raise SystemExit(f"--run {run}: {ckpt} holds no LoRA adapter and no decoder weights")
    t = Target(name=run.name, base=model or "", ckpt=ckpt, run_dir=run)
    t = _finish(t, data_dir)
    if not t.base:
        raise SystemExit(f"--run {run}: no --model and config.json names no model")
    return t


# --------------------------------------------------------------- captions

def consented_captions(captions: Path, split: str) -> list[str]:
    """Distinct captions of the consented rows of one split, sorted (deterministic
    before sampling); a Harvard row (rights or source) never counts."""
    return sorted({r["caption"] for r in read_rows(captions)
                   if r.get("split") == split and rights_tier(r) == "consented"})


def seed_captions(captions_file: Path, want: int, seed: int, log: Callable[[str], None] = print) -> tuple[list[str], dict]:
    """(`want` distinct consented captions, composition): all from the test split
    when it has enough, else the test captions plus a seeded top-up from val,
    then train. Never a Harvard / research-only row. The composition is
    {seed, want, per_split, source_captions_file, created}."""
    picked: list[str] = []
    rng = random.Random(seed)
    per_split: dict[str, int] = {}
    for split in ("test", "val", "train"):
        pool = [c for c in consented_captions(captions_file, split) if c not in picked]
        take = min(want - len(picked), len(pool))
        if take <= 0:
            continue
        picked += rng.sample(pool, take) if take < len(pool) else pool
        per_split[split] = take
        if len(picked) == want:
            break
    if len(picked) < want:
        raise SystemExit(f"{captions_file}: only {len(picked)} distinct consented captions over all splits, need {want}")
    if len(per_split) > 1:
        log(f"caption list seeded from consented rows: {composition_text(per_split)} (the test split alone had fewer than {want} distinct captions)")
    meta = {"seed": seed, "want": want, "per_split": per_split, "source_captions_file": rel(str(captions_file)),
            "rule": "distinct captions of consented rows (ahmed_*, internet_cc, contrib_*_consented; never harvard); test first, topped up from val, then train",
            "created": time.strftime("%Y-%m-%dT%H:%M:%S")}
    return picked, meta


def composition_text(per_split: dict) -> str:
    return ", ".join(f"{k} {v}" for k, v in per_split.items()) if per_split else "not recorded"


def meta_path(path: Path) -> Path:
    """showcase_captions_v2.json -> showcase_captions_v2.meta.json, next to the list."""
    return path.with_name(path.stem + ".meta.json")


def captions_meta(path: Path) -> dict:
    """The composition written next to the caption list; {} when the list predates it."""
    return read_json_safe(meta_path(path)) or {}


def showcase_captions(path: Path, captions_file: Path | None, n: int = N_CLIPS, seed: int = CAPTION_SEED,
                      log: Callable[[str], None] = print) -> list[str]:
    """The fixed caption list: read from `path` when it exists (its first n),
    else N_CLIPS (or n, if larger) seeded distinct consented captions of
    `captions_file` (seed_captions), written to `path` once with its
    composition in meta_path(path)."""
    if path.exists():
        caps = json.loads(path.read_text())
        if not isinstance(caps, list) or len(caps) < n:
            raise SystemExit(f"{path}: needs at least {n} captions, has {len(caps) if isinstance(caps, list) else 'no list'}")
        return [str(c) for c in caps[:n]]
    if captions_file is None or not captions_file.exists():
        raise SystemExit(f"{path} does not exist and the run has no captions file to seed it from")
    picked, meta = seed_captions(captions_file, max(n, N_CLIPS), seed, log)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(picked, indent=2, ensure_ascii=False) + "\n")
    meta_path(path).write_text(json.dumps(meta, indent=2) + "\n")
    return picked[:n]


# --------------------------------------------------------------- loudness

def normalise_loudness(audio: np.ndarray, sr: int, target_lufs: float = TARGET_LUFS, peak: float = PEAK_LIMIT) -> tuple[np.ndarray, dict]:
    """Scale to the target integrated loudness (pyloudnorm), then cap the peak:
    the limit wins over the target. Too-short audio and digital silence (peak
    below SILENCE_PEAK) are left alone; audio below pyloudnorm's −70 LUFS
    absolute gate (integrated loudness −inf, yet not silent) is peak-normalised
    to the limit and flagged in the returned info ("note")."""
    x = np.asarray(audio, dtype=np.float32)
    if x.ndim > 1:
        x = x.mean(axis=1)
    peak_in = float(np.abs(x).max()) if x.size else 0.0
    info: dict = {"lufs_in": None, "lufs_out": None, "gain_db": 0.0, "peak_limited": False, "peak": peak_in}
    if x.size < int(0.4 * sr) + 1:
        info["note"] = "shorter than one loudness block; unchanged"
        return x, info
    if peak_in < SILENCE_PEAK:
        info["note"] = "digital silence; unchanged"
        return x, info
    meter = pyln.Meter(sr)
    lufs = float(meter.integrated_loudness(x.astype(np.float64)))
    if not np.isfinite(lufs):
        gain = peak / peak_in
        out = (x * gain).astype(np.float32)
        lufs_out = float(meter.integrated_loudness(out.astype(np.float64)))
        info.update({"lufs_out": round(lufs_out, 2) if np.isfinite(lufs_out) else None, "gain_db": round(20.0 * np.log10(gain), 2),
                     "peak_limited": True, "peak": round(float(np.abs(out).max()), 4),
                     "note": f"below the -70 LUFS absolute gate (integrated loudness undefined); peak-normalised to {peak:g} instead of the {target_lufs:g} LUFS target"})
        return out, info
    gain = 10.0 ** ((target_lufs - lufs) / 20.0)
    out = x * gain
    pk = float(np.abs(out).max())
    if pk > peak:
        out = out * (peak / pk)
        gain *= peak / pk
        info["peak_limited"] = True
    out = out.astype(np.float32)
    info.update({"lufs_in": round(lufs, 2), "lufs_out": round(float(meter.integrated_loudness(out.astype(np.float64))), 2),
                 "gain_db": round(20.0 * np.log10(gain), 2), "peak": round(float(np.abs(out).max()), 4)})
    return out, info


# ------------------------------------------------------------- generation

def _load_fallback(model_name: str, ckpt: Path):
    """PEFT for a LoRA checkpoint; safetensors into the decoder for a full one."""
    import torch
    from transformers import (
        MusicgenForConditionalGeneration,
        MusicgenMelodyForConditionalGeneration,
    )

    from scripts.scale_train import BOS, DEVICE, is_melody, zero_functional_dropout

    cls = MusicgenMelodyForConditionalGeneration if is_melody(model_name) else MusicgenForConditionalGeneration
    model = cls.from_pretrained(model_name, dtype=torch.float32)
    model.config.decoder.decoder_start_token_id = BOS
    if (ckpt / "adapter_config.json").exists():
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, str(ckpt))
    else:
        weights = next((ckpt / w for w in WEIGHT_FILES if (ckpt / w).exists()), None)
        if weights is None:
            raise SystemExit(f"{ckpt}: no adapter_config.json and none of {WEIGHT_FILES}")
        if weights.suffix == ".safetensors":
            from safetensors.torch import load_file
            sd = load_file(str(weights))
        else:
            sd = torch.load(str(weights), map_location="cpu")
        try:
            model.decoder.load_state_dict(sd, strict=True)
        except RuntimeError:
            missing, unexpected = model.load_state_dict(sd, strict=False)
            if len(unexpected) == len(sd):
                raise SystemExit(f"{weights}: no key matches the base model or its decoder") from None
    zero_functional_dropout(model)
    return model.to(DEVICE).eval()


def load_generator(model_name: str, ckpt: Path):
    """(model, processor): scale_train.load_checkpoint when the harness has it, else the fallback."""
    from transformers import AutoProcessor
    processor = AutoProcessor.from_pretrained(model_name)
    try:
        from scripts.scale_train import load_checkpoint  # Phase 2 harness (LoRA or full decoder)
    except ImportError:
        load_checkpoint = None
    model = None
    if load_checkpoint is not None:
        try:
            model = load_checkpoint(model_name, str(ckpt))
        except TypeError as exc:  # a signature this script does not know: fall back rather than guess
            print(f"scale_train.load_checkpoint refused ({exc}); loading here instead", flush=True)
    if model is None:
        model = _load_fallback(model_name, ckpt)
    model.eval()
    return model, processor


def make_generate_fn(model, processor, cfg: float = CFG) -> GenerateFn:
    """Batch-1 sampling with the given CFG; (mono float32 audio, sample rate)."""
    import torch

    from scripts.scale_train import DEVICE

    try:
        from scripts.scale_eval import (
            patch_melody_generation,  # transformers 4.57 melody prefix fix (no-op on other models)
        )

        patch_melody_generation(model)
    except Exception as exc:  # noqa: BLE001 - the showcase must still run on an older scale_eval
        print(f"melody generation patch not applied: {exc}", flush=True)

    @torch.no_grad()
    def generate(caption: str, seconds: int, seed: int) -> tuple[np.ndarray, int]:
        torch.manual_seed(seed)
        inputs = processor(text=[caption], padding=True, return_tensors="pt").to(DEVICE)
        audio = model.generate(**inputs, do_sample=True, guidance_scale=cfg, max_new_tokens=int(seconds * FRAMES_PER_SECOND))
        sr = int(model.config.audio_encoder.sampling_rate)
        wav = audio[0].cpu().numpy().squeeze().astype(np.float32)
        if DEVICE == "mps":
            torch.mps.empty_cache()
        return wav, sr

    return generate


def default_score_fn() -> ScoreFn:
    from scripts.scale_eval import score_clip  # lazy: torch + torchcrepe
    return score_clip


def default_scorer_version() -> dict:
    from scripts.scale_eval import scorer_version
    return scorer_version()


# ------------------------------------------------------------------ build

def provenance_line(t: Target) -> str:
    rights = ("RESEARCH-ONLY adapter: trained on Harvard Loeb Music Library material; served only on the tailnet research service, "
              "not for publication." if t.research_only else
              "RIGHTS UNVERIFIED: the training rows' rights could not be read; not releasable until they are." if t.rights == "unverified" else
              "Source recordings are not distributed and are not served; every clip in this folder is model output.")
    return (f"Generated by {t.base} with the '{t.name}' adapter ({rel(str(t.ckpt))}, {t.kind}), fine-tuned on {t.corpus}. {rights}")


def captions_line(captions_path: Path, meta: dict) -> str:
    if not meta:
        return (f"Captions: the fixed list {rel(str(captions_path))} (same prompts for every adapter); "
                "composition not recorded (the list predates its .meta.json).")
    return (f"Captions: the fixed list {rel(str(captions_path))} (same prompts for every adapter); composition by split of the "
            f"consented rows it was seeded from: {composition_text(meta.get('per_split') or {})} (seed {meta.get('seed')}, "
            f"source {meta.get('source_captions_file')}, created {meta.get('created')}).")


def readme_text(t: Target, captions_path: Path, n: int, seconds: int, cfg: float, seed_base: int, scorer: dict, allow_research: bool,
                meta: dict | None = None, unnormalised: list[str] | None = None) -> str:
    lines = []
    if t.research_only:
        lines.append("RESEARCH-ONLY — NOT FOR PUBLICATION. This showcase was built with --allow-research-only; "
                     "the adapter saw Harvard / research-only rows and may not leave the research context.")
    elif t.rights == "unverified":
        lines.append("RIGHTS UNVERIFIED — NOT CLEARED FOR PUBLICATION. This showcase was built with --allow-unverified-rights; "
                     "the training rows' rights tier could not be verified from the captions.")
    loud = (f"Loudness: every clip normalised to {TARGET_LUFS:g} LUFS integrated (pyloudnorm) with a {PEAK_LIMIT:g} peak limit that wins over the target"
            + (f"; {len(unnormalised)} clip(s) fell below pyloudnorm's -70 LUFS absolute gate and were peak-normalised to {PEAK_LIMIT:g} instead "
               f"({', '.join(unnormalised)}; see loudness.note in scores.json)." if unnormalised else "."))
    lines += [f"QaraamiGen v2 showcase — adapter '{t.name}' ({t.rights}: {t.rights_reason})",
              provenance_line(t),
              f"Clips: {n} × {seconds} s, batch 1, CFG {cfg:g}, seed {seed_base} + i for clipNN, max_new_tokens {seconds * FRAMES_PER_SECOND}.",
              captions_line(captions_path, meta if meta is not None else captions_meta(captions_path)),
              loud,
              "Scores: scores.json carries PCS, voiced fraction, tuning offset and tonic per clip from scripts.pcs"
              + (f" (torchcrepe {scorer.get('torchcrepe')}, hop {scorer.get('pcs_hop')}, gate {scorer.get('pcs_conf_thresh')}, pcs.py sha256 {str(scorer.get('pcs_file_sha256', ''))[:12]})." if scorer else "."),
              f"Built {time.strftime('%Y-%m-%dT%H:%M:%S')} by apps/ai-service/scripts/showcase_final.py."]
    return "\n".join(lines) + "\n"


def clip_ok(path: Path, seconds: int) -> bool:
    """An existing clip of (about) the asked length counts as done."""
    if not path.exists():
        return False
    try:
        info = sf.info(str(path))
    except RuntimeError:
        return False
    return abs(info.duration - seconds) < 1.0


def refuse_reason(t: Target, allow_research: bool, allow_unverified: bool) -> str | None:
    """Why the showcase must not be built, or None."""
    if t.rights == "research-only" and not allow_research:
        return (f"refusing: adapter '{t.name}' is research-only ({t.rights_reason}). "
                "Pass --allow-research-only to build a research-only showcase (its README will say so).")
    if t.rights == "unverified" and not allow_unverified:
        return (f"refusing: adapter '{t.name}' has unverified rights ({t.rights_reason}). "
                "Pass --allow-unverified-rights to build it anyway (its README will say RIGHTS UNVERIFIED, never releasable).")
    return None


def build_showcase(t: Target, captions: list[str], out_dir: Path, seconds: int, cfg: float, generate_fn: GenerateFn,
                   score_fn: ScoreFn | None, captions_path: Path, scorer: dict | None = None, seed_base: int = SEED_BASE,
                   force: bool = False, allow_research: bool = False, log: Callable[[str], None] = print,
                   allow_unverified: bool = False) -> dict:
    """Render the clips, score them, write scores.json and README.txt; resumable."""
    why = refuse_reason(t, allow_research, allow_unverified)
    if why:
        raise SystemExit(why)
    out_dir.mkdir(parents=True, exist_ok=True)
    scores_path = out_dir / "scores.json"
    prev = read_json_safe(scores_path) if scores_path.exists() and not force else None
    done = {c["clip"]: c for c in (prev or {}).get("clips", []) if c.get("clip")}
    meta = captions_meta(captions_path)
    clips = []
    for i, caption in enumerate(captions):
        name = f"clip{i:02d}.wav"
        wav_path = out_dir / name
        seed = seed_base + i
        if not force and clip_ok(wav_path, seconds) and name in done and done[name].get("caption") == caption:
            clips.append(done[name])
            log(f"  {name}: exists, kept")
            continue
        t0 = time.time()
        audio, sr = generate_fn(caption, seconds, seed)
        audio, loud = normalise_loudness(audio, sr)
        sf.write(wav_path, audio, sr, subtype="PCM_16")
        row = {"clip": name, "caption": caption, "seed": seed, "seconds": round(len(audio) / sr, 2), "sample_rate": sr,
               "loudness": loud, "generation_seconds": round(time.time() - t0, 1)}
        if score_fn is not None:
            row["scores"] = score_fn(wav_path)
        clips.append(row)
        # scores.json after every clip: a killed run resumes from the last finished clip
        scores_path.write_text(json.dumps({"adapter": t.name, "base": t.base, "ckpt": rel(str(t.ckpt)), "seconds": seconds, "cfg": cfg,
                                           "target_lufs": TARGET_LUFS, "peak_limit": PEAK_LIMIT, "scorer_version": scorer or {},
                                           "clips": clips}, indent=2))
        s = row.get("scores") or {}
        log(f"  {name}: {row['seconds']} s, {loud.get('lufs_out')} LUFS (gain {loud.get('gain_db')} dB"
            f"{', peak-limited' if loud.get('peak_limited') else ''}), pcs/voiced={s.get('pcs')}/{s.get('voiced_fraction')}")
        if loud.get("note"):
            log(f"  {name}: WARNING loudness not normalised to target: {loud['note']}")
    unnormalised = [c["clip"] for c in clips if (c.get("loudness") or {}).get("note")]
    result = {"adapter": t.name, "base": t.base, "ckpt": rel(str(t.ckpt)), "rights": t.rights, "research_only": t.research_only,
              "rights_reason": t.rights_reason, "seconds": seconds, "cfg": cfg, "seed_base": seed_base, "target_lufs": TARGET_LUFS,
              "peak_limit": PEAK_LIMIT, "captions_file": rel(str(captions_path)), "captions_meta": meta, "unnormalised_clips": unnormalised,
              "scorer_version": scorer or {}, "provenance": provenance_line(t), "clips": clips}
    scores_path.write_text(json.dumps(result, indent=2))
    (out_dir / "README.txt").write_text(readme_text(t, captions_path, len(captions), seconds, cfg, seed_base, scorer or {}, allow_research,
                                                    meta, unnormalised))
    (out_dir / "CAPTIONS.txt").write_text("".join(f"clip{i:02d}: {c}\n" for i, c in enumerate(captions)))
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--adapter", default=None, help="adapter name in the registry (adapters.extra.json)")
    ap.add_argument("--run", default=None, help="run directory (with --ckpt / --model overrides)")
    ap.add_argument("--ckpt", default=None)
    ap.add_argument("--model", default=None)
    ap.add_argument("--registry", default=str(REPO / REGISTRY_REL))
    ap.add_argument("--runs-dir", default=str(RUNS))
    ap.add_argument("--data-dir", default=str(DATA))
    ap.add_argument("--out-root", default=str(DEFAULT_OUT_ROOT))
    ap.add_argument("--captions-file", default=str(DEFAULT_CAPTIONS), help="the fixed caption list (created once when missing)")
    ap.add_argument("--n", type=int, default=N_CLIPS)
    ap.add_argument("--seconds", type=int, default=SECONDS)
    ap.add_argument("--cfg", type=float, default=CFG)
    ap.add_argument("--seed-base", type=int, default=SEED_BASE)
    ap.add_argument("--allow-research-only", action="store_true")
    ap.add_argument("--allow-unverified-rights", action="store_true",
                    help="build although the training rows' rights tier could not be verified (README says RIGHTS UNVERIFIED)")
    ap.add_argument("--force", action="store_true", help="regenerate clips that already exist")
    ap.add_argument("--no-score", action="store_true", help="skip the PCS scoring")
    args = ap.parse_args()
    if bool(args.adapter) == bool(args.run):
        raise SystemExit("give exactly one of --adapter <name> or --run <dir>")
    data_dir = Path(args.data_dir)
    if args.adapter:
        t = target_from_registry(args.adapter, Path(args.registry), Path(args.runs_dir), data_dir)
    else:
        t = target_from_run(Path(args.run).resolve(), Path(args.ckpt).resolve() if args.ckpt else None, args.model, data_dir)
    why = refuse_reason(t, args.allow_research_only, args.allow_unverified_rights)
    if why:
        raise SystemExit(why)
    captions_path = Path(args.captions_file)
    captions = showcase_captions(captions_path, t.captions, args.n)
    out_dir = Path(args.out_root) / t.name
    print(f"adapter={t.name} base={t.base} ckpt={t.ckpt} kind={t.kind} rights={t.rights} ({t.rights_reason}) -> {out_dir}", flush=True)
    model, processor = load_generator(t.base, t.ckpt)
    generate_fn = make_generate_fn(model, processor, args.cfg)
    score_fn = None if args.no_score else default_score_fn()
    scorer = {} if args.no_score else default_scorer_version()
    build_showcase(t, captions, out_dir, args.seconds, args.cfg, generate_fn, score_fn, captions_path, scorer,
                   args.seed_base, args.force, args.allow_research_only, allow_unverified=args.allow_unverified_rights)
    print(f"wrote {out_dir} ({len(captions)} clips, scores.json, README.txt)", flush=True)
    print("SHOWCASE_FINAL_DONE", flush=True)


if __name__ == "__main__":
    main()
