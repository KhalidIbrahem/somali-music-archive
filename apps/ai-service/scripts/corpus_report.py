"""Render ``docs/data/CORPUS_REPORT.md``, the Phase 1 corpus deliverable, from files.

Every number in the document is computed from the inventories, manifests and
caption files listed below; nothing is typed by hand. An input that does not
exist renders as "not built yet (<file>)", so the report can be produced at
any point of the programme (while the Harvard fetch is still running, before
separation or the 10 s sets exist) and regenerated after every stage. It
imports the selection and leakage helpers of ``scripts.build_sets`` and the
table/hour helpers of ``scripts.ahmed_inventory_doc`` rather than copying
them, so the report and the set builder cannot disagree on what is kept.

Inputs (defaults are repo-relative; every one is overridable on the CLI):

  data/inventory/ahmed_classified.jsonl   ahmed_classify.py rows; + ahmed_classifier.json (CV report)
  data/inventory/internet_files.jsonl     inventory of the CC / public-domain downloads (rows carry
                                          ``rights``: internet_cc | internet_research_only)
  data/inventory/contrib_*_files.jsonl    one inventory per consenting contributor (rows carry the
                                          ``rights`` tier written in their CONTRIBUTOR.md)
  data/harvard_raw/manifest.jsonl         harvard_fetch.py; the last row per cid wins (resumed runs)
  data/harvard_catalog/mus00044.csv       finding-aid export (optional: gives the pending count)
  data/separated/                         separation root: index.jsonl (one row per separated mix:
                                          corpus, rights, duration_s, oud_present, vocals_present,
                                          stems{...}) or, without an index, every <corpus>/<sha12>/
                                          stems.json (``build_sets.load_separated_index``); --separated
                                          may also name an index file directly
  data/internet/manifest.jsonl            download manifest; data/internet/skipped.jsonl: objects
                                          skipped with ``reason``
  data/sets/<set>/captions.jsonl          30 s sets (+ SET_CARD.md); data/sets*/*captions.jsonl are the
                                          merged run captions; data/sets_10s/<set>/captions.jsonl the
                                          10 s sets; data/sets*/<set>/midi/skipped.jsonl melody skips

JSONL inputs are read line by line: a line that does not parse (the torn last
line of a manifest a live fetch is appending to) is skipped and counted in the
"Sources read" table instead of failing the run.

Sections: (1) headline table per corpus (Ahmed sessions, Ahmed collection,
Harvard, internet by rights tier, contributors): unique hours by sha256, hours
kept, isolated oud (recorded stems / separated "other" stems with oud_present,
shown separately), isolated vocals (recorded / separated), full mix, drums,
non-qaraami (rap, synth), unclassified, rights tier, publishable; (2) split
sizes per set at 30 s and 10 s (files, songs, clips per split, hours, leakage,
and for stem sets whether every stem sits in its source mix's split, checked
with ``build_sets.find_stem_split_mismatches`` against the mix set's captions)
and the merged run captions; (3) everything excluded and why: classifier exclusions by
reason with hours, third-party suspects, non-qaraami content with the projects,
Harvard fetch skips by reason, superseded whole-side legacy files, internet
skips by reason, separation gate failures (oud_present false), melody skips;
(4) the method paragraph (scripts by their module docstrings, library versions
via importlib.metadata); (5) what limits quality, derived from the numbers.

Usage (from apps/ai-service):
  python -m scripts.corpus_report [--out docs/data/CORPUS_REPORT.md] [--root <repo>]
      [--classified data/inventory/ahmed_classified.jsonl] [--classifier-report ...]
      [--internet-files ...] [--contrib-glob "data/inventory/contrib_*_files.jsonl"]
      [--harvard-manifest ...] [--harvard-catalog ...] [--separated data/separated]
      [--internet-manifest ...] [--internet-skipped ...] [--sets-root data/sets]
      [--sets-10s-root data/sets_10s]

The report is text only: no audio is read (a Harvard manifest row without a
sha256 is held back from ``select_harvard`` and counted, so nothing is hashed).
New audio/feature directories of this workflow are git-ignored by the root
.gitignore (owned by this component): data/separated/, data/internet/* (only
the top-level *.jsonl logs stay tracked), data/incoming/,
data/sets_10s/*/{clips,tokens,chroma,chroma_midi,midi}/,
data/sets/*/{chroma_midi,midi}/ (midi/skipped.jsonl stays tracked),
data/**/*.mid, data/inventory/*.log.
"""

from __future__ import annotations

import argparse
import ast
import datetime as dt
import json
import os
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from importlib import metadata
from pathlib import Path
from typing import Any

from scripts.ahmed_inventory_doc import EXCLUDE_GENRES, content_of, fmt_h, hours, md_table
from scripts.build_scale_dataset import TARGET_LUFS
from scripts.build_sets import (
    CAPTION_VERSION,
    DEFAULT_SECONDS,
    HARVARD_ROOTS,
    MIX_SET_OF,
    REPO,
    RIGHTS_AHMED,
    RIGHTS_HARVARD,
    SEP_CONTENT,
    SEP_SETS,
    SHA_RE,
    SPLITS,
    count_stems_with_mix,
    find_leakage,
    find_stem_split_mismatches,
    harvard_cassette,
    is_under,
    is_whole_side,
    load_catalog,
    load_separated_index,
    resolve_path,
    select_harvard,
    split_ratio_label,
    window_hop,
)

SCRIPTS_DIR = Path(__file__).resolve().parent

DEFAULT_OUT = "docs/data/CORPUS_REPORT.md"
DEFAULT_CLASSIFIED = "data/inventory/ahmed_classified.jsonl"
DEFAULT_CLASSIFIER_REPORT = "data/inventory/ahmed_classifier.json"
DEFAULT_INTERNET_FILES = "data/inventory/internet_files.jsonl"
DEFAULT_CONTRIB_GLOB = "data/inventory/contrib_*_files.jsonl"
DEFAULT_HARVARD_MANIFEST = "data/harvard_raw/manifest.jsonl"
DEFAULT_HARVARD_CATALOG = "data/harvard_catalog/mus00044.csv"
DEFAULT_SEPARATED = "data/separated"  # the separation root (build_sets.DEFAULT_SEPARATED); an index file also works
SEPARATED_INDEX = "index.jsonl"
STEMS_GLOB = "*/*/stems.json"
DEFAULT_INTERNET_MANIFEST = "data/internet/manifest.jsonl"
DEFAULT_INTERNET_SKIPPED = "data/internet/skipped.jsonl"
DEFAULT_SETS_ROOT = "data/sets"
DEFAULT_SETS_10S_ROOT = "data/sets_10s"

RIGHTS_INTERNET_CC = "internet_cc"
RIGHTS_INTERNET_RESEARCH = "internet_research_only"
SESSION_GROUPS = ("garageband", "logic")
COLLECTION_GROUP = "ahmed_collection"
CONTRIB_RE = re.compile(r"^contrib_(.+)_files\.jsonl$")
SKIP_SECONDS_KEYS = ("duration_s", "seconds")
UNSPLIT = "unsplit"  # bucket of caption rows without a split field
Unreadable = dict[Path, list[int]]  # file -> 1-based numbers of the JSONL lines that did not parse

# Scripts named in the method section: (module, role). Only the ones on disk render.
METHOD_SCRIPTS: tuple[tuple[str, str], ...] = (
    ("ahmed_extract", "inventory"),
    ("ahmed_classify", "content labels"),
    ("ahmed_inventory_doc", "inventory document"),
    ("harvard_fetch", "Harvard fetch"),
    ("harvard_gap_report", "Harvard gap list"),
    ("build_sets", "sets and captions"),
    ("build_scale_dataset", "clip cutting and splits"),
    ("pentatonic", "tonic detection"),
    ("scale_tokens", "EnCodec tokens"),
    ("scale_chroma", "melody chroma"),
    ("pcs", "pentatonic conformity score"),
    ("f0_notes", "f0 to notes"),
    ("quantize", "pentatonic quantisation"),
    ("melody", "skyline"),
    ("transcribe", "transcription"),
    ("reward_model", "MERT embeddings / FAD"),
)
# Sibling components of this workflow whose script names are not fixed yet: any
# script whose file name carries one of these stems is listed too.
METHOD_SCRIPT_STEMS = ("separat", "internet", "contrib", "midi", "10s", "corpus_report")
METHOD_PACKAGES = ("torch", "transformers", "demucs", "torchcrepe", "peft", "librosa")


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------


@dataclass
class Inputs:
    """Every file the report reads, resolved against ``root``."""

    root: Path
    classified: Path
    classifier_report: Path
    internet_files: Path
    contrib_glob: str
    harvard_manifest: Path
    harvard_catalog: Path
    separated: Path
    internet_manifest: Path
    internet_skipped: Path
    sets_root: Path
    sets_10s_root: Path

    @classmethod
    def defaults(cls, root: Path = REPO) -> Inputs:
        return cls.from_args(root, argparse.Namespace())

    @classmethod
    def from_args(cls, root: Path, ns: argparse.Namespace) -> Inputs:
        def p(attr: str, default: str) -> Path:
            raw = getattr(ns, attr, None) or default
            path = Path(raw).expanduser()
            return path if path.is_absolute() else root / path

        return cls(
            root=root,
            classified=p("classified", DEFAULT_CLASSIFIED),
            classifier_report=p("classifier_report", DEFAULT_CLASSIFIER_REPORT),
            internet_files=p("internet_files", DEFAULT_INTERNET_FILES),
            contrib_glob=getattr(ns, "contrib_glob", None) or DEFAULT_CONTRIB_GLOB,
            harvard_manifest=p("harvard_manifest", DEFAULT_HARVARD_MANIFEST),
            harvard_catalog=p("harvard_catalog", DEFAULT_HARVARD_CATALOG),
            separated=p("separated", DEFAULT_SEPARATED),
            internet_manifest=p("internet_manifest", DEFAULT_INTERNET_MANIFEST),
            internet_skipped=p("internet_skipped", DEFAULT_INTERNET_SKIPPED),
            sets_root=p("sets_root", DEFAULT_SETS_ROOT),
            sets_10s_root=p("sets_10s_root", DEFAULT_SETS_10S_ROOT),
        )

    def contrib_files(self) -> list[Path]:
        pattern = Path(self.contrib_glob)
        if pattern.is_absolute():
            return sorted(pattern.parent.glob(pattern.name))
        return sorted(self.root.glob(self.contrib_glob))


def rel(path: Path, root: Path) -> str:
    """Repo-relative posix path when inside root, else the absolute path."""
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)


def not_built(path: Path, root: Path) -> str:
    return f"not built yet (`{rel(path, root)}`)"


def read_jsonl(path: Path, unreadable: Unreadable | None = None) -> list[dict[str, Any]] | None:
    """Rows of a JSONL file, or None when the file does not exist (an empty file is []).

    Unlike ``build_sets.load_jsonl`` this never raises on a bad line: a torn or
    corrupt line (the Harvard fetch rewrites its manifest non-atomically on every
    restart and appends while this report may run) is skipped and its 1-based
    number recorded under ``unreadable[path]`` for the "Sources read" table."""
    if not path.exists():
        return None
    rows: list[dict[str, Any]] = []
    bad: list[int] = []
    for n, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            bad.append(n)
            continue
        if isinstance(row, dict):
            rows.append(row)
        else:
            bad.append(n)
    if bad and unreadable is not None:
        unreadable[path] = bad
    return rows


def read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def unreadable_note(path: Path, unreadable: Unreadable) -> str:
    """" (N unreadable line(s) skipped: 12, 13)" or "" for the Sources read table."""
    bad = unreadable.get(path)
    if not bad:
        return ""
    shown = ", ".join(str(n) for n in bad[:5]) + (", ..." if len(bad) > 5 else "")
    return f" ({len(bad)} unreadable line(s) skipped: {shown})"


def separated_paths(separated: Path) -> tuple[Path, Path]:
    """(separation root, index file): ``--separated`` names the root (default) or an index .jsonl."""
    if separated.suffix == ".jsonl":
        return separated.parent, separated
    return separated, separated / SEPARATED_INDEX


def read_separated(separated: Path, unreadable: Unreadable | None = None) -> list[dict[str, Any]] | None:
    """The separation rows: the index when present (read tolerantly), else the per-mix
    stems.json files through ``build_sets.load_separated_index``; None when neither exists."""
    sep_root, index = separated_paths(separated)
    if index.exists():
        return read_jsonl(index, unreadable)
    if separated.suffix != ".jsonl" and sep_root.exists() and any(sep_root.glob(STEMS_GLOB)):
        return load_separated_index(sep_root)
    return None


def separated_not_built(separated: Path, root: Path) -> str:
    sep_root, index = separated_paths(separated)
    if separated.suffix == ".jsonl":
        return not_built(index, root)
    return f"not built yet (`{rel(index, root)}` or `{rel(sep_root, root)}/{STEMS_GLOB}`)"


def code(text: Any) -> str:
    """Inline-code a name from the data; backticks inside it would end the span early."""
    return "`" + str(text).replace("`", "'") + "`"


def unique_hours(rows: list[dict[str, Any]]) -> float:
    """Hours of the rows, counting each sha256 once (rows without a sha count individually)."""
    seen: dict[str, float] = {}
    loose = 0.0
    for r in rows:
        dur = float(r.get("duration_s") or 0.0)
        sha = str(r.get("sha256") or "")
        if sha:
            seen.setdefault(sha, dur)
        else:
            loose += dur
    return (sum(seen.values()) + loose) / 3600.0


def kept(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [r for r in rows if not (r.get("excluded") or r.get("exclude_reason"))]


def excluded(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [r for r in rows if r.get("excluded") or r.get("exclude_reason")]


def pct(part: float, whole: float) -> str:
    return f"{100.0 * part / whole:.0f} %" if whole > 0 else "n/a"


def publishable(tier: str) -> str:
    """What the rights tier allows for model output (audio is never published)."""
    if tier == RIGHTS_AHMED:
        return "yes (adapters; the audio never)"
    if tier == RIGHTS_HARVARD:
        return "no (research adapters only, never served)"
    if tier == RIGHTS_INTERNET_CC:
        return "yes (attribution recorded)"
    if tier == RIGHTS_INTERNET_RESEARCH:
        return "no"
    if tier.startswith("internet"):
        return "no (no explicit licence)"
    if "research_only" in tier:
        return "no"
    if "consented" in tier or tier.startswith("cc"):
        return "yes (per CONTRIBUTOR.md)"
    return "unknown (see CONTRIBUTOR.md)"


# ---------------------------------------------------------------------------
# Section 1: headline rows
# ---------------------------------------------------------------------------


@dataclass
class CorpusRow:
    """One line of the headline table; hours are None when the corpus is not built yet."""

    corpus: str
    rights: str
    aliases: tuple[str, ...]
    status: str = ""  # non-empty = "not built yet (...)" text, rendered instead of numbers
    files_all: int = 0
    files_kept: int = 0
    unique_h: float = 0.0
    kept_h: float = 0.0
    oud_rec_h: float | None = 0.0
    vocals_rec_h: float | None = 0.0
    full_mix_h: float | None = 0.0
    drums_h: float | None = 0.0
    non_qaraami_h: float | None = 0.0
    unclassified_h: float | None = 0.0
    oud_sep_h: float = 0.0
    vocals_sep_h: float = 0.0
    sep_mixes: int = 0
    note: str = ""


def content_hours(rows: list[dict[str, Any]]) -> dict[str, float]:
    out: dict[str, float] = defaultdict(float)
    for r in rows:
        out[content_of(r)] += float(r.get("duration_s") or 0.0) / 3600.0
    return dict(out)


def row_from_inventory(corpus: str, rights: str, aliases: tuple[str, ...], rows: list[dict[str, Any]]) -> CorpusRow:
    """Headline row for classified/inventory rows (Ahmed, internet tiers, contributors)."""
    k = kept(rows)
    ch = content_hours(k)
    return CorpusRow(
        corpus=corpus, rights=rights, aliases=aliases, files_all=len(rows), files_kept=len(k),
        unique_h=unique_hours(rows), kept_h=hours(k),
        oud_rec_h=ch.get("oud", 0.0), vocals_rec_h=ch.get("voice", 0.0), full_mix_h=ch.get("full_mix", 0.0),
        drums_h=ch.get("drums", 0.0), non_qaraami_h=sum(ch.get(g, 0.0) for g in EXCLUDE_GENRES),
        unclassified_h=ch.get("unclassified", 0.0),
    )


def ahmed_rows(inp: Inputs, classified: list[dict[str, Any]] | None) -> list[CorpusRow]:
    sess_aliases = ("ahmed", "ahmed_sessions", "ahmed_mix", "ahmed_vocal", "ahmed_raw", "garageband", "logic")
    coll_aliases = ("ahmed_collection", "oud_ilkacase", "collection")
    if classified is None:
        status = not_built(inp.classified, inp.root)
        return [CorpusRow("Ahmed sessions (GarageBand + Logic)", RIGHTS_AHMED, sess_aliases, status=status),
                CorpusRow("Ahmed collection (oud_ilkacase)", RIGHTS_AHMED, coll_aliases, status=status)]
    sessions = [r for r in classified if str(r.get("source_group") or SESSION_GROUPS[0]) != COLLECTION_GROUP]
    collection = [r for r in classified if str(r.get("source_group")) == COLLECTION_GROUP]
    a = row_from_inventory("Ahmed sessions (GarageBand + Logic)", RIGHTS_AHMED, sess_aliases, sessions)
    b = row_from_inventory("Ahmed collection (oud_ilkacase)", RIGHTS_AHMED, coll_aliases, collection)
    b.note = "build_sets counts every non-`mixed` collection file as oud for ahmed_oud whatever the label"
    return [a, b]


# ---------------------------------------------------------------------------
# Harvard
# ---------------------------------------------------------------------------


def normalise_reason(reason: str) -> str:
    """Fold one skip reason into its family: digits become N, multi-line errors keep their first line."""
    first = (reason or "unspecified").strip().splitlines()[0].strip()
    first = re.sub(r"\d+", "N", first)
    first = re.sub(r"\s+", " ", first)
    return first[:90] + ("..." if len(first) > 90 else "")


def row_sha(r: dict[str, Any]) -> str:
    """The row's sha256 when it is a real 64-hex digest (what ``build_sets.SHA_RE`` accepts), else ""."""
    sha = str(r.get("sha256") or r.get("sha") or "").lower()
    return sha if SHA_RE.match(sha) else ""


def harvard_key(r: dict[str, Any]) -> str:
    """The identity ``select_harvard`` gives a manifest row: its cid, else its sha256."""
    return str(r.get("cid") or row_sha(r) or "")


def last_row_per_cid(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A resumed fetch appends a newer row for the same cid; the last one wins, first-appearance order."""
    last: dict[str, dict[str, Any]] = {}
    for r in rows:
        last[harvard_key(r) or str(id(r))] = r
    return list(last.values())


@dataclass
class HarvardSummary:
    objects: int
    status_counts: Counter
    unique_h: float
    kept_files: int
    kept_h: float
    skipped_by_reason: Counter
    network_skips: int
    superseded: list[dict[str, Any]]  # cid, status, title, cassette, hours, reason
    superseded_h: float
    select_skipped: Counter
    pending: int | None  # linked catalog objects without a manifest row, when the catalog exists
    linked: int | None  # catalog Item|Track objects with a Digital Content Link


def harvard_summary(manifest_rows: list[dict[str, Any]], catalog: dict[str, dict[str, Any]], root: Path) -> HarvardSummary:
    rows = last_row_per_cid(manifest_rows)
    status_counts = Counter(str(r.get("status") or "none") for r in rows)
    on_disk = [r for r in rows if str(r.get("status")) in ("fetched", "legacy")]
    # select_harvard hashes the audio of a fetched/legacy row that carries no sha256; the report
    # never reads audio, so such rows are held back and counted under their own skip key.
    no_sha_ids = {id(r) for r in on_disk if not row_sha(r)}
    selection = select_harvard([r for r in rows if id(r) not in no_sha_ids], catalog, root=root)
    select_skipped = Counter(selection.skipped)
    if no_sha_ids:
        select_skipped["no_sha256_on_row"] = len(no_sha_ids)
    chosen_keys = {str(f.extra.get("cid")) for f in selection.files}
    chosen_shas = {f.sha256 for f in selection.files}

    # the same gates select_harvard applies (file named, under HARVARD_ROOTS, present), same keys
    roots = [root / r for r in HARVARD_ROOTS]
    eligible: list[tuple[str, dict[str, Any], str, bool]] = []
    for r in on_disk:
        if id(r) in no_sha_ids or not r.get("file"):
            continue
        path = resolve_path(str(r["file"]), root)
        if not is_under(path, roots) or not path.exists():
            continue
        cat = catalog.get(str(r.get("cid") or ""))
        eligible.append((harvard_key(r), r, harvard_cassette(r, cat), is_whole_side(r, cat)))
    fetched_tracks = {c for _, r, c, w in eligible if c and not w and str(r.get("status")) == "fetched"}
    legacy_tracks = {c for _, r, c, w in eligible if c and not w and str(r.get("status")) == "legacy"}
    superseded: list[dict[str, Any]] = []
    for key, r, cassette, whole in eligible:
        if key in chosen_keys:
            continue
        if whole and cassette in fetched_tracks:
            reason = "whole side superseded by fetched tracks"
        elif whole and cassette in legacy_tracks:
            reason = "whole side superseded by legacy tracks"
        elif row_sha(r) in chosen_shas:
            reason = "duplicate sha256 of a kept file"
        else:
            reason = "not selected (see the selection skip counter)"
        superseded.append({"cid": key, "status": r.get("status"), "title": r.get("title") or "", "cassette": cassette,
                           "hours": float(r.get("duration_s") or 0.0) / 3600.0, "reason": reason})
    skipped_rows = [r for r in rows if str(r.get("status")) == "skipped"]
    skipped_by_reason = Counter(normalise_reason(str(r.get("reason") or "")) for r in skipped_rows)
    network = sum(1 for r in skipped_rows if str(r.get("reason") or "").startswith("network error"))
    pending = linked_n = None
    if catalog:
        linked = {cid for cid, c in catalog.items() if c.get("Component Type") in ("Item", "Track")
                  and str(c.get("Digital Content Link") or "").strip()}
        linked_n = len(linked)
        pending = len(linked - {str(r.get("cid")) for r in rows if r.get("cid")})
    return HarvardSummary(
        objects=len(rows), status_counts=status_counts, unique_h=unique_hours(on_disk),
        kept_files=len(selection.files), kept_h=sum(float(f.duration_s or 0.0) for f in selection.files) / 3600.0,
        skipped_by_reason=skipped_by_reason, network_skips=network, superseded=superseded,
        superseded_h=sum(s["hours"] for s in superseded), select_skipped=select_skipped, pending=pending, linked=linked_n,
    )


def harvard_row(inp: Inputs, summary: HarvardSummary | None) -> CorpusRow:
    aliases = ("harvard", "harvard_full", "harvard_raw", "aryette")
    if summary is None:
        return CorpusRow("Harvard (Aryette collection)", RIGHTS_HARVARD, aliases, status=not_built(inp.harvard_manifest, inp.root))
    row = CorpusRow(
        "Harvard (Aryette collection)", RIGHTS_HARVARD, aliases,
        files_all=summary.status_counts.get("fetched", 0) + summary.status_counts.get("legacy", 0),
        files_kept=summary.kept_files, unique_h=summary.unique_h, kept_h=summary.kept_h,
        oud_rec_h=None, vocals_rec_h=None, full_mix_h=summary.kept_h, drums_h=None, non_qaraami_h=None, unclassified_h=None,
        note="no content classifier runs on Harvard: every kept track counts as a full mix",
    )
    return row


# ---------------------------------------------------------------------------
# Internet and contributors
# ---------------------------------------------------------------------------


def internet_rows(inp: Inputs, rows: list[dict[str, Any]] | None) -> list[CorpusRow]:
    if rows is None:
        return [CorpusRow("Internet (by rights tier)", f"{RIGHTS_INTERNET_CC} | {RIGHTS_INTERNET_RESEARCH}",
                          ("internet",), status=not_built(inp.internet_files, inp.root))]
    by_tier: dict[str, list[dict[str, Any]]] = defaultdict(list)
    no_rights = 0
    for r in rows:
        tier = str(r.get("rights") or "")
        if not tier:  # policy: anything without an explicit licence is research-only
            tier = RIGHTS_INTERNET_RESEARCH
            no_rights += 1
        by_tier[tier].append(r)
    if not by_tier:
        return [CorpusRow("Internet (no rows yet)", RIGHTS_INTERNET_CC, ("internet",), note="inventory exists but is empty")]
    out = [row_from_inventory(f"Internet {code(tier)}", tier, ("internet", tier, f"internet_{tier}"), by_tier[tier])
           for tier in sorted(by_tier)]
    if no_rights:
        for row in out:
            if row.rights == RIGHTS_INTERNET_RESEARCH:
                row.note = (f"{no_rights} inventory row(s) carry no `rights` field and are counted as "
                            f"`{RIGHTS_INTERNET_RESEARCH}` (no explicit licence, not publishable)")
    return out


def contrib_rows(inp: Inputs, unreadable: Unreadable | None = None) -> list[CorpusRow]:
    files = inp.contrib_files()
    if not files:
        return [CorpusRow("Contributors", "contrib_<name> (per CONTRIBUTOR.md)", ("contrib",),
                          status=not_built(inp.root / inp.contrib_glob, inp.root))]
    out: list[CorpusRow] = []
    for path in files:
        m = CONTRIB_RE.match(path.name)
        name = m.group(1) if m else path.stem
        rows = read_jsonl(path, unreadable) or []
        tiers = Counter(str(r.get("rights")) for r in rows if r.get("rights"))
        tier = tiers.most_common(1)[0][0] if tiers else f"contrib_{name}"
        # separate_stems names a contributor's corpus by the rights tier, so the tier is an alias too
        out.append(row_from_inventory(f"Contributor {code(name)}", tier, (f"contrib_{name}", name, tier), rows))
    return out


# ---------------------------------------------------------------------------
# Separation
# ---------------------------------------------------------------------------


def attach_separated(rows: list[CorpusRow], separated: list[dict[str, Any]]) -> list[CorpusRow]:
    """Add the separated-stem hours to the headline rows: match the index row's corpus
    against each headline row's aliases, disambiguate by rights, fall back to rights
    alone, and give anything unmatched its own row so no hour is dropped. Rows whose
    inventory is not built yet render no numbers, so they are never a target."""
    extra: dict[tuple[str, str], CorpusRow] = {}
    built = [r for r in rows if not r.status]
    for s in separated:
        corpus = str(s.get("corpus") or "").strip().lower()
        rights = str(s.get("rights") or "")
        cands = [r for r in built if corpus in r.aliases]
        if len(cands) > 1:
            cands = [r for r in cands if r.rights == rights] or cands[:1]
        if not cands:
            cands = [r for r in built if r.rights == rights]
        if len(cands) == 1:
            target = cands[0]
        else:
            key = (corpus or "unknown", rights or "unknown")
            target = extra.setdefault(key, CorpusRow(f"separated: {code(key[0])}", key[1], (key[0],), oud_rec_h=None,
                                                     vocals_rec_h=None, full_mix_h=None, drums_h=None,
                                                     non_qaraami_h=None, unclassified_h=None,
                                                     note="separated mixes whose corpus matches no inventory"))
        dur = float(s.get("duration_s") or 0.0) / 3600.0
        target.sep_mixes += 1
        if s.get("oud_present"):
            target.oud_sep_h += dur
        if s.get("vocals_present"):
            target.vocals_sep_h += dur
    return rows + [extra[k] for k in sorted(extra)]


def separation_gate(separated: list[dict[str, Any]]) -> list[list[Any]]:
    """Per corpus: separated mixes, hours, gate failures (oud_present false) and their hours."""
    agg: dict[str, list[float]] = defaultdict(lambda: [0, 0.0, 0, 0.0])
    for s in separated:
        key = str(s.get("corpus") or "unknown")
        dur = float(s.get("duration_s") or 0.0) / 3600.0
        agg[key][0] += 1
        agg[key][1] += dur
        if not s.get("oud_present"):
            agg[key][2] += 1
            agg[key][3] += dur
    return [[k, int(v[0]), fmt_h(v[1]), int(v[2]), fmt_h(v[3])] for k, v in sorted(agg.items())]


# ---------------------------------------------------------------------------
# Section 2: sets
# ---------------------------------------------------------------------------


@dataclass
class SetSummary:
    name: str
    path: Path
    window_s: float
    files: int
    songs: int
    clips: Counter
    hours: dict[str, float]
    sources: Counter
    rights: Counter
    leakage: dict[str, list[str]]
    card: bool
    caption_versions: Counter = field(default_factory=Counter)
    label: str = ""  # merged runs: the sets root they live under ("sets", "sets_10s")
    # stem sets: the mix set whose captions fix the stems' splits, how many stems had a mix row to be
    # checked against, and how many sit in another split than their mix (None = mix set not built)
    mix_set: str | None = None
    stems_checked: int = 0
    stem_mismatches: int | None = None

    @property
    def total_clips(self) -> int:
        return sum(self.clips.values())

    @property
    def total_hours(self) -> float:
        return sum(self.hours.values())

    @property
    def is_stem_set(self) -> bool:
        return self.mix_set is not None


def summarise_captions(name: str, path: Path, card: Path | None = None, rows: list[dict[str, Any]] | None = None,
                       unreadable: Unreadable | None = None) -> SetSummary:
    if rows is None:
        rows = read_jsonl(path, unreadable) or []
    clips: Counter = Counter()
    hrs: dict[str, float] = defaultdict(float)
    windows: Counter = Counter()
    for r in rows:
        split = str(r.get("split") or UNSPLIT)
        sec = float(r.get("seconds") or 0.0)
        clips[split] += 1
        hrs[split] += sec / 3600.0
        if sec > 0:
            windows[sec] += 1
    window = windows.most_common(1)[0][0] if windows else 0.0
    return SetSummary(
        name=name, path=path, window_s=window,
        files=len({str(r.get("song_sha256")) for r in rows if r.get("song_sha256")}),
        songs=len({str(r.get("song_group")) for r in rows if r.get("song_group")}),
        clips=clips, hours=dict(hrs), sources=Counter(str(r.get("source")) for r in rows),
        rights=Counter(str(r.get("rights")) for r in rows), leakage=find_leakage(rows),
        card=bool(card and card.exists()), caption_versions=Counter(str(r.get("caption_version")) for r in rows),
    )


def has_stems(rows: list[dict[str, Any]]) -> bool:
    return any(r.get("content") in SEP_CONTENT for r in rows)


def check_stem_splits(summary: SetSummary, rows: list[dict[str, Any]],
                      rows_of: dict[str, list[dict[str, Any]]] | None = None) -> None:
    """Stems must share their source mix's split (``build_sets.find_stem_split_mismatches``),
    which ``find_leakage`` on one captions file can never see: a rebuilt mix set moves songs
    between splits while an older stem set keeps its own. A sep set is checked against its
    mix set's captions (``MIX_SET_OF``) among ``rows_of``; with ``rows_of`` None (a merged
    run, whose file carries its own mixes) only the rows themselves are searched."""
    if summary.name not in SEP_SETS and not has_stems(rows):
        return
    mix_name = MIX_SET_OF.get(summary.name) if rows_of is not None else None
    mix_rows: list[dict[str, Any]] = []
    if mix_name is None:  # a merged run or a generic stem set: only its own rows can hold the mixes
        summary.mix_set = "(own rows)"
    else:
        summary.mix_set = mix_name
        if rows_of is None or mix_name not in rows_of:
            return  # mix set not built: stem_mismatches stays None
        mix_rows = rows_of[mix_name]
    summary.stems_checked = count_stems_with_mix(rows, mix_rows)
    summary.stem_mismatches = len(find_stem_split_mismatches(rows, mix_rows))


def set_summaries(sets_root: Path, unreadable: Unreadable | None = None) -> list[SetSummary]:
    if not sets_root.exists():
        return []
    rows_of: dict[str, list[dict[str, Any]]] = {}
    out: list[SetSummary] = []
    for cap in sorted(sets_root.glob("*/captions.jsonl")):
        name = cap.parent.name
        rows_of[name] = read_jsonl(cap, unreadable) or []
        out.append(summarise_captions(name, cap, cap.parent / "SET_CARD.md", rows=rows_of[name]))
    for s in out:
        check_stem_splits(s, rows_of[s.name], rows_of)
    return out


def merged_summaries(sets_root: Path, unreadable: Unreadable | None = None) -> list[SetSummary]:
    """build_sets --merge writes <out_root>/<run>_captions.jsonl under whichever root it is told
    (data/sets or data/sets_10s), so both roots are scanned; ``label`` names the root."""
    if not sets_root.exists():
        return []
    out: list[SetSummary] = []
    for p in sorted(sets_root.glob("*captions.jsonl")):
        if not p.is_file():
            continue
        rows = read_jsonl(p, unreadable) or []
        s = summarise_captions(p.name.removesuffix("_captions.jsonl").removesuffix("captions.jsonl") or p.stem, p, rows=rows)
        s.label = sets_root.name
        check_stem_splits(s, rows)
        out.append(s)
    return out


def leakage_text(leak: dict[str, list[str]]) -> str:
    n = sum(len(v) for v in leak.values())
    return "none" if n == 0 else f"{n} key(s) in two splits"


def stem_split_text(s: SetSummary) -> str:
    if not s.is_stem_set:
        return "n/a"
    if s.stem_mismatches is None:
        return f"mix set {code(s.mix_set)} not built"
    if s.stems_checked == 0:
        return "no mix row to check against"
    if s.stem_mismatches == 0:
        return f"ok ({s.stems_checked} stems)"
    return f"{s.stem_mismatches} stem(s) in another split than their mix"


def clips_text(s: SetSummary) -> str:
    n = s.clips.get(UNSPLIT, 0)
    return f"{s.total_clips} ({n} {UNSPLIT})" if n else str(s.total_clips)


def window_text(s: SetSummary) -> str:
    return f"{s.window_s:g} s" if s.window_s > 0 else "unknown"


def sets_table(summaries: list[SetSummary], merged: bool = False) -> str:
    headers = ["set" if not merged else "run captions", "window", "files (sha256)", "songs (groups)"]
    headers += [f"clips {s}" for s in SPLITS] + ["clips", "hours", "rights", "leakage", "stem/mix split",
                                                 "set card" if not merged else "sets"]
    rows: list[list[Any]] = []
    for s in summaries:
        tail: Any = ("yes" if s.card else "no") if not merged else ", ".join(f"{k} {v}" for k, v in sorted(s.sources.items()))
        name = code(f"{s.label}/{s.name}" if merged and s.label else s.name)
        rows.append([name, window_text(s), s.files, s.songs, *[s.clips.get(sp, 0) for sp in SPLITS],
                     clips_text(s), fmt_h(s.total_hours), ", ".join(sorted(s.rights)), leakage_text(s.leakage),
                     stem_split_text(s), tail])
    return md_table(headers, rows)


# ---------------------------------------------------------------------------
# Section 3: exclusions
# ---------------------------------------------------------------------------


def exclusions_by_reason(rows: list[dict[str, Any]]) -> list[list[Any]]:
    agg: dict[str, list[float]] = defaultdict(lambda: [0, 0.0])
    for r in excluded(rows):
        key = str(r.get("exclude_reason") or "unspecified")
        agg[key][0] += 1
        agg[key][1] += float(r.get("duration_s") or 0.0) / 3600.0
    return [[k, int(v[0]), fmt_h(v[1])] for k, v in sorted(agg.items(), key=lambda kv: -kv[1][1])]


def third_party_table(rows: list[dict[str, Any]]) -> list[list[Any]]:
    agg: dict[str, list[Any]] = defaultdict(lambda: [0, 0.0, set()])
    for r in kept(rows):
        if not r.get("third_party_suspect"):
            continue
        key = str(r.get("third_party_reason") or "suspect")
        agg[key][0] += 1
        agg[key][1] += float(r.get("duration_s") or 0.0) / 3600.0
        agg[key][2].add(str(r.get("project") or ""))
    return [[k, int(v[0]), fmt_h(v[1]), len(v[2])] for k, v in sorted(agg.items(), key=lambda kv: -kv[1][1])]


def non_qaraami_table(rows: list[dict[str, Any]]) -> list[list[Any]]:
    out: list[list[Any]] = []
    k = kept(rows)
    for genre in EXCLUDE_GENRES:
        sel = [r for r in k if content_of(r) == genre]
        if not sel:
            continue
        projects = sorted({str(r.get("project") or "") for r in sel})
        out.append([genre, len(sel), fmt_h(hours(sel)), len(projects), ", ".join(code(p) for p in projects)])
    return out


def skipped_table(rows: list[dict[str, Any]]) -> list[list[Any]]:
    """Objects skipped by a downloader, by normalised reason, with hours when the rows carry any."""
    agg: dict[str, list[float]] = defaultdict(lambda: [0, 0.0])
    for r in rows:
        key = normalise_reason(str(r.get("reason") or r.get("status") or ""))
        agg[key][0] += 1
        sec = next((float(r[k]) for k in SKIP_SECONDS_KEYS if r.get(k) is not None), 0.0)
        agg[key][1] += sec / 3600.0
    return [[k, int(v[0]), fmt_h(v[1])] for k, v in sorted(agg.items(), key=lambda kv: (-kv[1][0], kv[0]))]


def melody_skips(roots: list[Path], unreadable: Unreadable | None = None) -> list[list[Any]]:
    out: list[list[Any]] = []
    for root in roots:
        if not root.exists():
            continue
        for p in sorted(root.glob("*/midi/skipped.jsonl")):
            rows = read_jsonl(p, unreadable) or []
            reasons = Counter(normalise_reason(str(r.get("reason") or r.get("status") or "")) for r in rows)
            for reason, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
                out.append([f"`{root.name}/{p.parent.parent.name}`", reason, n])
    return out


# ---------------------------------------------------------------------------
# Section 4: method
# ---------------------------------------------------------------------------


def script_summary(path: Path, max_chars: int = 160) -> str:
    """First paragraph of a module docstring, read from the source (no import, no torch)."""
    try:
        doc = ast.get_docstring(ast.parse(path.read_text())) or ""
    except (OSError, SyntaxError):
        return ""
    para = doc.strip().split("\n\n")[0]
    text = re.sub(r"\s+", " ", para).strip()
    if len(text) > max_chars:
        cut = text[:max_chars].rsplit(" ", 1)[0]
        text = cut.rstrip(",;:") + " ..."
    return text


def method_scripts(scripts_dir: Path = SCRIPTS_DIR) -> list[tuple[str, str, str]]:
    """(module, role, docstring summary) for every method script present on disk."""
    out: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for name, role in METHOD_SCRIPTS:
        p = scripts_dir / f"{name}.py"
        if p.exists():
            out.append((name, role, script_summary(p)))
            seen.add(name)
    for p in sorted(scripts_dir.glob("*.py")):
        if p.stem in seen or not any(stem in p.stem for stem in METHOD_SCRIPT_STEMS):
            continue
        out.append((p.stem, "workflow component", script_summary(p)))
    return out


def package_versions(packages: tuple[str, ...] = METHOD_PACKAGES) -> dict[str, str]:
    out: dict[str, str] = {}
    for name in packages:
        try:
            out[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            out[name] = "not installed"
    return out


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def _h(v: float | None) -> str:
    return "–" if v is None else fmt_h(v)


def _pair(rec: float | None, sep: float, sep_available: bool) -> str:
    sep_txt = fmt_h(sep) if sep_available else "–"
    return f"{_h(rec)} / {sep_txt}"


def headline_table(rows: list[CorpusRow], sep_available: bool) -> str:
    headers = ["corpus", "rights tier", "publishable", "files (all / kept)", "unique h (sha256)", "kept h",
               "isolated oud h (recorded / separated)", "isolated vocals h (recorded / separated)",
               "full mix h", "drums h", "non-qaraami h", "unclassified h"]
    body: list[list[Any]] = []
    for r in rows:
        if r.status:
            body.append([r.corpus, f"`{r.rights}`", publishable(r.rights) if " | " not in r.rights else "per tier", r.status,
                         "", "", "", "", "", "", "", ""])
            continue
        body.append([r.corpus, f"`{r.rights}`", publishable(r.rights), f"{r.files_all} / {r.files_kept}",
                     fmt_h(r.unique_h), fmt_h(r.kept_h), _pair(r.oud_rec_h, r.oud_sep_h, sep_available),
                     _pair(r.vocals_rec_h, r.vocals_sep_h, sep_available), _h(r.full_mix_h), _h(r.drums_h),
                     _h(r.non_qaraami_h), _h(r.unclassified_h)])
    return md_table(headers, body)


@dataclass
class Report:
    """Everything the renderer needs, loaded once."""

    inp: Inputs
    classified: list[dict[str, Any]] | None
    classifier_report: dict[str, Any] | None
    internet_files: list[dict[str, Any]] | None
    harvard_manifest: list[dict[str, Any]] | None
    harvard: HarvardSummary | None
    separated: list[dict[str, Any]] | None
    internet_manifest: list[dict[str, Any]] | None
    internet_skipped: list[dict[str, Any]] | None
    sets30: list[SetSummary]
    sets10: list[SetSummary]
    merged: list[SetSummary]
    melody: list[list[Any]]
    headline: list[CorpusRow]
    unreadable: Unreadable = field(default_factory=dict)


def merged_globs(inp: Inputs) -> str:
    return " or ".join(f"`{rel(r, inp.root)}/*captions.jsonl`" for r in (inp.sets_root, inp.sets_10s_root))


def load_report(inp: Inputs) -> Report:
    unreadable: Unreadable = {}
    classified = read_jsonl(inp.classified, unreadable)
    manifest = read_jsonl(inp.harvard_manifest, unreadable)
    catalog = load_catalog(inp.harvard_catalog)
    harvard = harvard_summary(manifest, catalog, inp.root) if manifest is not None else None
    internet_files = read_jsonl(inp.internet_files, unreadable)
    separated = read_separated(inp.separated, unreadable)
    rows = (ahmed_rows(inp, classified) + [harvard_row(inp, harvard)] + internet_rows(inp, internet_files)
            + contrib_rows(inp, unreadable))
    if separated:
        rows = attach_separated(rows, separated)
    return Report(
        inp=inp, classified=classified, classifier_report=read_json(inp.classifier_report), internet_files=internet_files,
        harvard_manifest=manifest, harvard=harvard, separated=separated,
        internet_manifest=read_jsonl(inp.internet_manifest, unreadable),
        internet_skipped=read_jsonl(inp.internet_skipped, unreadable),
        sets30=set_summaries(inp.sets_root, unreadable), sets10=set_summaries(inp.sets_10s_root, unreadable),
        merged=merged_summaries(inp.sets_root, unreadable) + merged_summaries(inp.sets_10s_root, unreadable),
        melody=melody_skips([inp.sets_root, inp.sets_10s_root], unreadable), headline=rows, unreadable=unreadable,
    )


def sources_table(rep: Report) -> str:
    inp = rep.inp

    def state(path: Path, rows: list[Any] | None, unit: str = "rows") -> str:
        if rows is None:
            return not_built(path, inp.root)
        return f"{len(rows)} {unit}{unreadable_note(path, rep.unreadable)}"

    def classifier_state() -> str:
        if rep.classifier_report:
            return "present"
        return "unreadable (not valid JSON)" if inp.classifier_report.exists() else not_built(inp.classifier_report, inp.root)

    def set_state(summaries: list[SetSummary], root: Path, unit: str) -> str:
        if not summaries:
            return not_built(root / "*/captions.jsonl", inp.root)
        bad = "".join(unreadable_note(s.path, rep.unreadable) for s in summaries)
        return f"{len(summaries)} {unit}{bad}"

    sep_root, sep_index = separated_paths(inp.separated)
    sep_path = f"`{rel(sep_index, inp.root)}`" + ("" if inp.separated.suffix == ".jsonl"
                                                  else f" or `{rel(sep_root, inp.root)}/{STEMS_GLOB}`")
    contrib_bad = "".join(unreadable_note(p, rep.unreadable) for p in inp.contrib_files())
    merged_bad = "".join(unreadable_note(s.path, rep.unreadable) for s in rep.merged)
    body = [
        ["Ahmed classified inventory", f"`{rel(inp.classified, inp.root)}`", state(inp.classified, rep.classified)],
        ["Ahmed classifier report", f"`{rel(inp.classifier_report, inp.root)}`", classifier_state()],
        ["Internet inventory", f"`{rel(inp.internet_files, inp.root)}`", state(inp.internet_files, rep.internet_files)],
        ["Contributor inventories", f"`{inp.contrib_glob}`",
         f"{len(inp.contrib_files())} file(s){contrib_bad}" if inp.contrib_files()
         else not_built(inp.root / inp.contrib_glob, inp.root)],
        ["Harvard manifest", f"`{rel(inp.harvard_manifest, inp.root)}`",
         f"{len(rep.harvard_manifest)} rows, {rep.harvard.objects} objects{unreadable_note(inp.harvard_manifest, rep.unreadable)}"
         if rep.harvard_manifest is not None and rep.harvard else not_built(inp.harvard_manifest, inp.root)],
        ["Harvard catalog", f"`{rel(inp.harvard_catalog, inp.root)}`",
         "present" if inp.harvard_catalog.exists() else not_built(inp.harvard_catalog, inp.root)],
        ["Separation index", sep_path,
         f"{len(rep.separated)} rows{unreadable_note(sep_index, rep.unreadable)}" if rep.separated is not None
         else separated_not_built(inp.separated, inp.root)],
        ["Internet download manifest", f"`{rel(inp.internet_manifest, inp.root)}`", state(inp.internet_manifest, rep.internet_manifest)],
        ["Internet skipped", f"`{rel(inp.internet_skipped, inp.root)}`", state(inp.internet_skipped, rep.internet_skipped)],
        ["30 s sets", f"`{rel(inp.sets_root, inp.root)}/*/captions.jsonl`", set_state(rep.sets30, inp.sets_root, "set(s)")],
        ["10 s sets", f"`{rel(inp.sets_10s_root, inp.root)}/*/captions.jsonl`", set_state(rep.sets10, inp.sets_10s_root, "set(s)")],
        ["Merged run captions", merged_globs(inp),
         f"{len(rep.merged)} file(s){merged_bad}" if rep.merged else f"not built yet ({merged_globs(inp)})"],
        ["Melody skips", f"`{rel(inp.sets_root, inp.root)}*/*/midi/skipped.jsonl`",
         f"{sum(int(r[2]) for r in rep.melody)} skipped clip(s)" if rep.melody
         else not_built(inp.sets_root / "*/midi/skipped.jsonl", inp.root)],
    ]
    return md_table(["input", "path", "state"], body)


def render_exclusions(rep: Report) -> list[str]:
    inp = rep.inp
    out: list[str] = ["## 3. Everything excluded, and why", ""]

    out += ["### 3.1 Classifier / inventory exclusions (Ahmed)", ""]
    if rep.classified is None:
        out.append(not_built(inp.classified, inp.root))
    else:
        ex = excluded(rep.classified)
        out.append(f"{len(ex)} of {len(rep.classified)} inventoried files are excluded ({fmt_h(hours(ex))} h of file time; "
                   "duplicates repeat hours that the kept copy already counts).")
        out += ["", md_table(["exclude_reason", "files", "hours"], exclusions_by_reason(rep.classified)) if ex else "No exclusions."]

    out += ["", "### 3.2 Third-party suspects (kept in the inventory, left out of every set)", ""]
    if rep.classified is None:
        out.append(not_built(inp.classified, inp.root))
    else:
        tp = third_party_table(rep.classified)
        tp_rows = [r for r in kept(rep.classified) if r.get("third_party_suspect")]
        out.append(f"{len(tp_rows)} kept files ({fmt_h(hours(tp_rows))} h) are flagged `third_party_suspect`: numbered imports, "
                   "`_mixed` downloads and `xml` instrumental bases whose authorship is unverified. `build_sets` skips them "
                   "unless `--include-third-party` is passed; their hours are counted in the headline content columns.")
        out += ["", md_table(["third_party_reason", "files", "hours", "projects"], tp) if tp else "None flagged."]

    out += ["", "### 3.3 Non-qaraami content (beats / rap / synth)", ""]
    if rep.classified is None:
        out.append(not_built(inp.classified, inp.root))
    else:
        nq = non_qaraami_table(rep.classified)
        out.append(f"Content labels {', '.join(f'`{g}`' for g in EXCLUDE_GENRES)} select no set; the projects below are Ahmed's "
                   "modern productions, not the qaraami repertoire.")
        out += ["", md_table(["content", "files", "hours", "projects", "project list"], nq) if nq else "None labelled."]

    out += ["", "### 3.4 Harvard fetch skips by reason", ""]
    if rep.harvard is None:
        out.append(not_built(inp.harvard_manifest, inp.root))
    else:
        h = rep.harvard
        status = ", ".join(f"{k} {v}" for k, v in sorted(h.status_counts.items())) or "none"
        pending = (f"; the catalog links {h.linked} objects, {h.pending} of them have no manifest row yet"
                   if h.pending is not None else "")
        out.append(f"{h.objects} manifest objects (last row per cid): {status}{pending}. `network error` skips ({h.network_skips}) "
                   "are retried by a resumed fetch; the cassette-level skips are by policy (their track objects are fetched instead).")
        table = [[k, v] for k, v in sorted(h.skipped_by_reason.items(), key=lambda kv: (-kv[1], kv[0]))]
        out += ["", md_table(["reason (digits folded to N)", "objects"], table) if table else "No skips."]

    out += ["", "### 3.5 Superseded whole-side legacy files and duplicates (Harvard)", ""]
    if rep.harvard is None:
        out.append(not_built(inp.harvard_manifest, inp.root))
    else:
        h = rep.harvard
        sel = ", ".join(f"{k} {v}" for k, v in sorted(h.select_skipped.items())) or "none"
        out.append(f"`build_sets.select_harvard` keeps {h.kept_files} files ({fmt_h(h.kept_h)} h) and drops {len(h.superseded)} "
                   f"({fmt_h(h.superseded_h)} h): a whole cassette side is a superset of the track files of the same cassette. "
                   f"Selection skip counter: {sel}.")
        table = [[code(s["cid"]), s["status"], s["cassette"], s["title"], fmt_h(s["hours"]), s["reason"]] for s in h.superseded]
        out += ["", md_table(["cid", "status", "cassette", "title", "hours", "reason"], table) if table else "None dropped."]

    out += ["", "### 3.6 Internet downloads skipped by reason", ""]
    if rep.internet_skipped is None:
        out.append(not_built(inp.internet_skipped, inp.root))
    else:
        n_manifest = len(rep.internet_manifest) if rep.internet_manifest is not None else 0
        out.append(f"{n_manifest} objects in the download manifest, {len(rep.internet_skipped)} skipped. By policy nothing "
                   f"without an explicit CC / public-domain licence is downloaded; such objects appear here, not in the corpus.")
        table = skipped_table(rep.internet_skipped)
        out += ["", md_table(["reason (digits folded to N)", "objects", "hours (when known)"], table) if table else "No skips."]

    out += ["", "### 3.7 Separation gate failures (`oud_present` false)", ""]
    if rep.separated is None:
        out.append(separated_not_built(inp.separated, inp.root))
    else:
        gate = separation_gate(rep.separated)
        failed = sum(1 for s in rep.separated if not s.get("oud_present"))
        out.append(f"{len(rep.separated)} mixes separated, {failed} fail the oud gate: their `other` stem holds no oud and enters "
                   "no isolated-oud set.")
        out += ["", md_table(["corpus", "mixes", "hours", "gate failures", "hours failed"], gate) if gate else "No rows."]

    out += ["", "### 3.8 Melody transcription skips", ""]
    if not rep.melody:
        out.append(not_built(inp.sets_root / "*/midi/skipped.jsonl", inp.root))
    else:
        out.append(md_table(["set", "reason", "clips"], rep.melody))
    return out


def overlap_pct(seconds: float = DEFAULT_SECONDS) -> float:
    """Clip overlap in percent from build_sets.window_hop, the same arithmetic the set card uses."""
    win, hop = window_hop(seconds)
    return 100.0 * (1 - hop / win) if win else 0.0


def render_method(rep: Report) -> list[str]:
    versions = package_versions()
    vers = ", ".join(f"{k} {v}" for k, v in versions.items())
    scripts = method_scripts()
    lines = ["## 4. Method", ""]
    lines.append(
        "Inventory and labels: `scripts/ahmed_extract.py` walks the GarageBand bundles, Logic projects and the loose "
        "collection (ffprobe metadata, full-file sha256 as song identity, silence measure, duplicate and silent exclusions); "
        "`scripts/ahmed_classify.py` labels every kept file (MERT-v1-95M embedding, Silero VAD vocal fraction, HPSS "
        "percussive ratio, torchcrepe voiced fraction and PCS, spectral flatness) with a logistic regression fitted on "
        "name-rule seeds and withholds the label under the probability threshold. Harvard: `scripts/harvard_fetch.py` "
        "downloads the public streams of the Aryette finding aid into `data/harvard_raw/` and writes the manifest this "
        "report reads; the last manifest row per cid wins. Sets: `scripts/build_sets.py` selects by content label "
        f"(collection-as-oud rule, third-party exclusion), cuts {DEFAULT_SECONDS:g} s clips exactly like "
        f"`scripts/build_scale_dataset.py` ({overlap_pct():g} % overlap, peak then {TARGET_LUFS:g} LUFS, quiet clips dropped), "
        f"captions with template v{CAPTION_VERSION} and assigns song-group-aware {split_ratio_label()} splits over a split "
        "universe, asserting no song_sha256 or song_group in two splits (the leakage column above reruns `find_leakage` on "
        "every captions file) and that every stem clip sits in its source mix's split (the stem/mix column reruns "
        "`find_stem_split_mismatches` against the mix set's captions). `scripts/scale_tokens.py` writes the "
        "EnCodec tokens and `scripts/scale_chroma.py` the musicgen-melody chroma. Separation uses Demucs htdemucs_ft "
        "(the oud lands in the `other` stem) with an oud-presence gate; the melody pipeline is CREPE f0 to notes "
        "(`f0_notes`, `quantize`, `melody`, `transcribe`). Unique hours count each sha256 once; kept hours are the "
        "non-excluded rows; content hours are the classifier's confident labels, everything else is unclassified."
    )
    if rep.classifier_report:
        cv = rep.classifier_report.get("cv") or {}

        def metric(key: str) -> str:
            val = cv.get(key)
            return f"{float(val):.3f}" if isinstance(val, (int, float)) else "n/a"

        cv_text = (f"{cv.get('n_splits', '?')}-fold CV accuracy {metric('accuracy')}, balanced {metric('balanced_accuracy')}"
                   if cv else "no CV block in the report")
        lines.append("")
        lines.append(f"Classifier report: model {code(rep.classifier_report.get('model', '?'))}, "
                     f"{rep.classifier_report.get('n_seeds', '?')} seed rows, {cv_text}; thresholds "
                     f"{json.dumps(rep.classifier_report.get('thresholds', {}))}.")
    lines += ["", f"Library versions (importlib.metadata): {vers}.", "", "Scripts (first docstring paragraph, read from source):", ""]
    lines.append(md_table(["script", "role", "summary"], [[f"`scripts/{n}.py`", r, s] for n, r, s in scripts]))
    return lines


def render_limits(rep: Report) -> list[str]:
    rows = [r for r in rep.headline if not r.status]
    sep_ok = rep.separated is not None
    oud_rec = sum(r.oud_rec_h or 0.0 for r in rows)
    oud_sep = sum(r.oud_sep_h for r in rows)
    voc_rec = sum(r.vocals_rec_h or 0.0 for r in rows)
    mix = sum(r.full_mix_h or 0.0 for r in rows)
    kept_h = sum(r.kept_h for r in rows)
    uncl = sum(r.unclassified_h or 0.0 for r in rows)
    non_q = sum(r.non_qaraami_h or 0.0 for r in rows)
    pub_h = sum(r.kept_h for r in rows if publishable(r.rights).startswith("yes"))
    research_h = sum(r.kept_h for r in rows if publishable(r.rights).startswith("no"))
    kept_classified = sum(r.kept_h for r in rows if r.unclassified_h is not None)
    lines = ["## 5. What limits quality", ""]
    if not rows:
        lines.append("No corpus is built yet; nothing can be said about quality until an inventory exists.")
        return lines
    if not any(r.files_all for r in rows):  # only separated stems exist: attach_separated gave them their own rows
        n_mixes = sum(r.sep_mixes for r in rows)
        lines.append(f"No inventory is built yet; only separation output exists: {n_mixes} separated mixes, "
                     f"{fmt_h(oud_sep)} h of `other` stems pass the oud gate. Nothing more can be said about quality "
                     "until an inventory exists.")
        return lines

    def missing(path: Path) -> str:
        return f"`{rel(path, rep.inp.root)}` not built yet"

    sep_missing = separated_not_built(rep.inp.separated, rep.inp.root).removeprefix("not built yet (").removesuffix(")")
    parts: list[str] = []
    ratio = f"{mix / oud_rec:.0f}× more mix than recorded oud" if oud_rec > 0 else "no recorded oud at all"
    parts.append(f"Isolated oud is the scarce resource: {fmt_h(oud_rec)} h of recorded oud"
                 + (f" plus {fmt_h(oud_sep)} h of separated `other` stems that pass the oud gate" if sep_ok else
                    f" and no separated stems yet ({sep_missing} not built yet)")
                 + f", against {fmt_h(mix)} h of full mixes ({ratio}); recorded oud is "
                 f"{pct(oud_rec, kept_h)} of the {fmt_h(kept_h)} h kept.")
    if kept_classified > 0:
        parts.append(f"{fmt_h(uncl)} h of the {fmt_h(kept_classified)} h with a classifier ({pct(uncl, kept_classified)}) carry no "
                     "confident content label and enter no set; the classifier's weakest classes (drums, oud, rap, synth) are "
                     f"exactly the ones a set needs. Another {fmt_h(non_q)} h are non-qaraami productions ({pct(non_q, kept_classified)}).")
    if rep.classified is not None:
        tp = [r for r in kept(rep.classified) if r.get("third_party_suspect")]
        if tp:
            parts.append(f"{len(tp)} files ({fmt_h(hours(tp))} h) are third-party suspects and are excluded from every published "
                         "adapter until their rights are settled.")
    if voc_rec > 0:
        parts.append(f"Isolated vocals are {fmt_h(voc_rec)} h recorded; a vocal model also needs aligned lyrics, which do not exist yet.")
    if rep.harvard is not None:
        h = rep.harvard
        fetched = h.status_counts.get("fetched", 0)
        pend = f", {h.pending} of {h.linked} linked catalog objects not yet attempted" if h.pending is not None else ""
        parts.append(f"Harvard: {fetched} fetched + {h.status_counts.get('legacy', 0)} legacy objects give {fmt_h(h.kept_h)} h kept "
                     f"({h.status_counts.get('skipped', 0)} skipped, {h.network_skips} of them network errors that a resumed fetch retries{pend}). "
                     "The material is research-only and never served, and no classifier runs on it, so its oud hours exist only through separation"
                     + (" (see the separated column)." if sep_ok else " (not built yet)."))
    else:
        parts.append(f"Harvard is not in the report yet ({missing(rep.inp.harvard_manifest)}).")
    if rep.internet_files is None:
        parts.append(f"No internet material yet ({missing(rep.inp.internet_files)}); "
                     "by policy only explicit CC / public-domain downloads are taken.")
    if not rep.inp.contrib_files():
        parts.append("No contributor recordings yet; every consented, publishable hour is Ahmed Ilkacase's.")
    parts.append(f"Publishable (consented or CC) hours: {fmt_h(pub_h)}; research-only hours: {fmt_h(research_h)} "
                 f"({pct(research_h, pub_h + research_h)} of the kept corpus cannot back a served model).")
    if not rep.sets10:
        parts.append(f"No 10 s sets yet ({missing(rep.inp.sets_10s_root / '*/captions.jsonl')}); the 30 s sets are the "
                     "only training material.")
    if rep.sets30:
        smallest = min(rep.sets30, key=lambda s: s.total_hours)
        parts.append(f"The smallest 30 s set is `{smallest.name}` with {smallest.total_clips} clips ({fmt_h(smallest.total_hours)} h of "
                     f"overlapping windows) from {smallest.files} files: its test split holds {smallest.clips.get('test', 0)} clips, so "
                     "per-song confidence intervals there will be wide.")
    lines.append(" ".join(parts))
    return lines


def render(rep: Report, today: str | None = None) -> str:
    today = today or dt.date.today().isoformat()
    inp = rep.inp
    sep_ok = rep.separated is not None
    out: list[str] = [
        f"# Corpus report (Phase 1, {today})",
        "",
        "Generated by `apps/ai-service/scripts/corpus_report.py`; every number is computed from the files in the table below, "
        "nothing is typed by hand. Inputs that do not exist yet render as \"not built yet\" with their file name; rerun the "
        "script after each stage. Rights tiers: `ahmed_ilkacase_consented` (train + publish adapters), `harvard_research_only` "
        "(train research adapters, never served), `internet_cc` (train + publish, attribution recorded), "
        "`internet_research_only` (never downloaded by policy; the tier exists for the manifest), `contrib_<name>` (the tier "
        "in the contributor's CONTRIBUTOR.md). Audio never enters git; paths are repo-relative.",
        "",
        "## Sources read",
        "",
        sources_table(rep),
        "",
        "## 1. Headline: hours per corpus",
        "",
        headline_table(rep.headline, sep_ok),
        "",
        "Unique hours count each sha256 once over every inventoried row (duplicates included); kept hours are the non-excluded "
        "rows. Isolated oud / vocals: recorded stems (classifier label `oud` / `voice`) and, after the slash, separated stems "
        "(separation rows with `oud_present` / `vocals_present`)"
        + ("." if sep_ok else f"; \"–\" = {separated_not_built(inp.separated, inp.root)}.")
        + " Non-qaraami = " + " + ".join(f"`{g}`" for g in EXCLUDE_GENRES) + ". \"–\" in a content column = no classifier for that corpus.",
    ]
    notes = [f"- {r.corpus}: {r.note}" for r in rep.headline if r.note]
    if notes:
        out += ["", *notes]
    out += ["", "## 2. Sets and splits", ""]
    if rep.sets30:
        out += ["### 2.1 30 s sets", "", sets_table(rep.sets30)]
    else:
        out += ["### 2.1 30 s sets", "", not_built(inp.sets_root / "*/captions.jsonl", inp.root)]
    out += ["", "### 2.2 10 s sets", ""]
    out.append(sets_table(rep.sets10) if rep.sets10 else not_built(inp.sets_10s_root / "*/captions.jsonl", inp.root))
    out += ["", "### 2.3 Merged run captions", ""]
    out.append(sets_table(rep.merged, merged=True) if rep.merged else f"not built yet ({merged_globs(inp)})")
    out += ["", f"Files = unique `song_sha256`, songs = unique `song_group`, hours = clips × window ({overlap_pct():g} % overlap, "
            "so about twice the source audio). Leakage reruns `build_sets.find_leakage` on the captions file; stem/mix split "
            "reruns `build_sets.find_stem_split_mismatches` for stem sets (`sep_*`, `harvard_sep_*`, any set with `sep_oud` / "
            "`sep_vocal` rows) against the mix set named in `build_sets.MIX_SET_OF`, or within a merged file.", ""]
    out += render_exclusions(rep)
    out += ["", *render_method(rep)]
    out += ["", *render_limits(rep), ""]
    return "\n".join(out)


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=str(REPO), help="repo root that relative input paths resolve against")
    ap.add_argument("--out", default=DEFAULT_OUT, help=f"output Markdown (default {DEFAULT_OUT}, relative to --root)")
    ap.add_argument("--classified", default=None, help=f"default {DEFAULT_CLASSIFIED}")
    ap.add_argument("--classifier-report", default=None, help=f"default {DEFAULT_CLASSIFIER_REPORT}")
    ap.add_argument("--internet-files", default=None, help=f"default {DEFAULT_INTERNET_FILES}")
    ap.add_argument("--contrib-glob", default=None, help=f"default {DEFAULT_CONTRIB_GLOB}")
    ap.add_argument("--harvard-manifest", default=None, help=f"default {DEFAULT_HARVARD_MANIFEST}")
    ap.add_argument("--harvard-catalog", default=None, help=f"default {DEFAULT_HARVARD_CATALOG}")
    ap.add_argument("--separated", default=None,
                    help=f"separation root (default {DEFAULT_SEPARATED}: its index.jsonl, else */*/stems.json) or an index .jsonl")
    ap.add_argument("--internet-manifest", default=None, help=f"default {DEFAULT_INTERNET_MANIFEST}")
    ap.add_argument("--internet-skipped", default=None, help=f"default {DEFAULT_INTERNET_SKIPPED}")
    ap.add_argument("--sets-root", default=None, help=f"default {DEFAULT_SETS_ROOT}")
    ap.add_argument("--sets-10s-root", default=None, help=f"default {DEFAULT_SETS_10S_ROOT}")
    ap.add_argument("--quiet", action="store_true", help="do not print the headline table")
    return ap


def main(argv: list[str] | None = None) -> Path:
    ns = build_parser().parse_args(argv)
    root = Path(ns.root).expanduser().resolve()
    inp = Inputs.from_args(root, ns)
    out = Path(ns.out).expanduser()
    out = out if out.is_absolute() else root / out
    rep = load_report(inp)
    text = render(rep)
    write_atomic(out, text)
    if not ns.quiet:
        print(headline_table(rep.headline, rep.separated is not None))
        print(json.dumps({"out": rel(out, root), "bytes": len(text.encode()), "sets_30s": len(rep.sets30),
                          "sets_10s": len(rep.sets10), "merged": len(rep.merged)}))
    return out


if __name__ == "__main__":
    main()
