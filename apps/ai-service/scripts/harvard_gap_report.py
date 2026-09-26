"""Gap report for the local copy of the Harvard Maryan "Aryette" Omar Ali collection.

    python -m scripts.harvard_gap_report [--manifest ../../data/harvard_raw/manifest.jsonl]
        [--catalog ../../data/harvard_catalog/mus00044.csv]
        [--legacy-dir ../../data/harvard_raw/legacy]
        [--legacy-meta ../../data/harvard_catalog/harvard_tracks_metadata.csv]
        [--out ../../docs/data/HARVARD_GAP_LIST.md]

Reads the fetcher's manifest (scripts/harvard_fetch.py writes one JSON row per
catalog object that has a digital-content link; on a resumed run a later row for
the same cid supersedes the earlier one, so the last row per cid wins here too)
and the finding-aid CSV export, looks at the legacy directory on disk, and writes
the Markdown gap list:

  * totals — catalog objects with links, fetched / legacy / skipped by reason,
    and the linked objects the fetcher has not reached yet;
  * hours on disk (fetched only, fetched + legacy, and the unique-audio figure
    that drops legacy whole-cassette files whose tracks are also on disk);
  * every skipped object with its cid, cassette, title, reason and link;
  * the cassette-level objects skipped by policy because their track objects
    are fetched instead;
  * the legacy whole-cassette files whose cassette has linked track objects (a
    superset of those tracks: a song-level split leak if both entered one
    training set), with how many of those tracks are on disk or still pending;
  * the catalog tracks that have no digital object at all (a finding-aid fact,
    not a fetch failure);
  * the legacy files on disk that no manifest row names (a stray file, or two
    2025 files whose names map to one URN so the fetcher's index keeps one).

Every number comes from the manifest, the catalog and a directory listing of
the legacy folder (no audio is opened). The report is valid on a partial
manifest, including one the fetcher is appending to: a half-written line is
counted as malformed and skipped, not fatal. The header states the row count,
the manifest timestamp and whether the fetch is complete. The headline counts
are also printed as JSON. Exit status 2 when an input is missing or unreadable.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from scripts.harvard_fetch import CASSETTE_RE, LEGACY, META, Obj, load_catalog, norm_urn, plan

REPO = Path(__file__).resolve().parents[3]
MANIFEST = REPO / "data/harvard_raw/manifest.jsonl"
CATALOG = REPO / "data/harvard_catalog/mus00044.csv"
OUT = REPO / "docs/data/HARVARD_GAP_LIST.md"

# Skip reasons written by harvard_fetch, grouped for the report; the tuple order is the report order.
REASON_CLASSES: tuple[tuple[str, str], ...] = (
    ("http_429", "HTTP 429 at the player page (rate-limited by the streaming server)"),
    ("http_other", "other non-200 HTTP status at the player page"),
    ("requires_login", "requires a Harvard login (HarvardKey); not public"),
    ("no_playlist", "no public stream on the SDS page (no playlist)"),
    ("download_failed", "stream download failed (ffmpeg)"),
    ("network_error", "network error while resolving the link"),
    ("other", "other reason"),
    ("cassette_superseded_by_tracks", "cassette-level object superseded by its track objects (policy skip)"),
    ("duplicate_link", "same digital object as another component (duplicate link, policy skip)"),
)
CLASS_LABEL: dict[str, str] = dict(REASON_CLASSES)
# Policy skips are final; every other skipped object is re-queued by the fetcher on its next run.
POLICY_CLASSES: frozenset[str] = frozenset({"cassette_superseded_by_tracks", "duplicate_link"})
# The groups harvard_fetch.plan() can produce; the headline always carries all four.
PLAN_GROUPS: tuple[str, ...] = ("legacy", "fetch", "cassette_superseded_by_tracks", "duplicate_link")
# The fixed prefixes harvard_fetch writes, checked before any free-text match: a download
# reason carries an ffmpeg stderr tail and a bounce URL, which may mention "login" or "no playlist".
FIXED_PREFIXES: tuple[tuple[str, str], ...] = (
    ("cassette-level object", "cassette_superseded_by_tracks"),
    ("same digital object as another component", "duplicate_link"),
    ("stream download failed", "download_failed"),
    ("network error", "network_error"),
    ("requires a harvard login", "requires_login"),
    ("no public stream", "no_playlist"),
    ("http 429", "http_429"),
    ("http ", "http_other"),
)
LEGACY_NAME_RE = re.compile(r"^track_(\d{4})")


def reason_class(reason: str) -> str:
    """Map a manifest skip reason to one of the REASON_CLASSES keys: the fetcher's fixed
    prefixes first, in a deterministic order, then free-text matches for hand-written reasons."""
    r = reason.lower().strip()
    for prefix, key in FIXED_PREFIXES:
        if r.startswith(prefix):
            return key
    if "duplicate link" in r:
        return "duplicate_link"
    if "harvardkey" in r or "login" in r:
        return "requires_login"
    if "no playlist" in r:
        return "no_playlist"
    if "download failed" in r:
        return "download_failed"
    if "network error" in r:
        return "network_error"
    return "other"


def parse_duration(v: object) -> float | None:
    """`duration_s` as the fetcher writes it (a number); a numeric string is accepted, an absent
    value is 0 (skipped rows carry none), anything else is None so the caller can count it."""
    if v is None or v == "":
        return 0.0
    try:
        return float(str(v))
    except ValueError:
        return None


@dataclass(frozen=True)
class ManifestRow:
    """One manifest object (the last row the fetcher wrote for its cid)."""

    cid: str
    status: str  # fetched | legacy | skipped
    ctype: str  # Item (cassette) | Track
    title: str
    cassette: str  # AWM SC number, "" when unknown
    link: str
    reason: str = ""
    file: str = ""
    duration_s: float = 0.0
    parent: str = ""
    duration_ok: bool = True  # False when duration_s was present but not a number (then 0.0)

    @classmethod
    def from_json(cls, d: dict[str, object]) -> ManifestRow:
        def s(key: str) -> str:
            v = d.get(key)
            return "" if v is None else str(v)

        dur = parse_duration(d.get("duration_s"))
        return cls(cid=s("cid"), status=s("status"), ctype=s("type"), title=s("title"), cassette=s("cassette"),
                   link=s("link"), reason=s("reason"), file=s("file"), duration_s=dur if dur is not None else 0.0,
                   parent=s("parent"), duration_ok=dur is not None)

    @property
    def sort_key(self) -> tuple[int, str]:
        return (int(self.cassette) if self.cassette.isdigit() else 10**9, self.cid)


@dataclass(frozen=True)
class ManifestLoad:
    """What load_manifest() found: the objects plus the lines it could not use."""

    rows: list[ManifestRow]  # last row per cid, first-appearance order
    raw_rows: int  # non-blank lines, malformed ones included
    malformed_lines: list[int]  # 1-based line numbers that were not a JSON object (e.g. a line still being written)
    rows_without_cid: int  # JSON objects with no cid: not an object, not counted
    bad_durations: int  # fetched/legacy objects whose duration_s was not a number (counted as 0 h)


@dataclass(frozen=True)
class LegacyFile:
    """A legacy *.mp3 on disk that no manifest row names."""

    name: str
    bytes: int
    urn: str  # from the 2025 metadata row the name points at, "" when there is none
    note: str  # why it has no row / what is known about its identity


@dataclass(frozen=True)
class LegacyScan:
    """Directory listing of the legacy folder against the manifest (no audio is opened)."""

    directory: Path
    files_on_disk: int
    unaccounted: list[LegacyFile]
    meta_found: bool  # harvard_tracks_metadata.csv was readable


@dataclass(frozen=True)
class Overlap:
    """A legacy whole-cassette file (manifest `legacy` row of type Item) whose cassette has
    linked track objects: the file is a superset of those tracks."""

    row: ManifestRow
    fetched_tracks: int  # fetched Track rows on the same cassette
    legacy_tracks: int  # legacy Track rows on the same cassette
    linked_tracks: int  # linked Track objects for the cassette in the catalog
    pending_tracks: int  # of those, without a manifest row yet

    @property
    def on_disk(self) -> bool:
        """True when at least one of the cassette's tracks is on disk now (the leak exists today)."""
        return self.fetched_tracks + self.legacy_tracks > 0


@dataclass
class Analysis:
    """Everything the report prints, computed once from the manifest, the catalog and the legacy listing."""

    catalog_types: Counter[str]
    linked: list[Obj]
    groups: dict[str, list[Obj]]  # harvard_fetch.plan() over the catalog, with the manifest's legacy rows
    rows: list[ManifestRow]
    raw_rows: int
    by_status: Counter[str]
    skipped_by_class: dict[str, list[ManifestRow]]
    pending: list[Obj]  # linked catalog objects with no manifest row yet
    hours_fetched: float
    hours_legacy: float
    hours_unique: float
    overlaps: list[Overlap]
    unlinked_tracks: list[dict[str, str]]
    unlinked_items: list[dict[str, str]]
    fetch_group_status: Counter[str] = field(default_factory=Counter)
    malformed_lines: list[int] = field(default_factory=list)
    rows_without_cid: int = 0
    bad_durations: int = 0
    legacy_scan: LegacyScan | None = None


def load_manifest(path: Path) -> ManifestLoad:
    """Last row per cid in first-appearance order. A line that is not a JSON object (the
    fetcher appends and flushes per row, so a read can race a half-written line) is
    counted in malformed_lines and skipped; a row without a cid is counted and skipped."""
    last: dict[str, ManifestRow] = {}
    n = 0
    malformed: list[int] = []
    no_cid = 0
    with open(path, encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            if not line.strip():
                continue
            n += 1
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                malformed.append(lineno)
                continue
            if not isinstance(d, dict):
                malformed.append(lineno)
                continue
            row = ManifestRow.from_json(d)
            if not row.cid:
                no_cid += 1
                continue
            last[row.cid] = row
    rows = list(last.values())
    bad = sum(1 for r in rows if r.status in ("fetched", "legacy") and not r.duration_ok)
    return ManifestLoad(rows, n, malformed, no_cid, bad)


def read_catalog_rows(path: Path) -> list[dict[str, str]]:
    """The finding-aid export: a few collection-level lines, then the row whose first
    cell is "Database Number" is the header (same detection as harvard_fetch.load_catalog,
    which only returns the linked objects and is therefore not enough here).
    Raises ValueError, naming the file, when no such header row exists."""
    with open(path, encoding="utf-8", errors="ignore") as f:
        rows = list(csv.reader(f))
    hi = next((i for i, r in enumerate(rows) if r and r[0] == "Database Number"), None)
    if hi is None:
        raise ValueError(f"{path}: no 'Database Number' header row; not a finding-aid CSV export")
    hdr = rows[hi]
    return [dict(zip(hdr, r)) for r in rows[hi + 1:] if len(r) >= len(hdr)]


def unlinked_components(rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Catalog Track rows and Item rows without a Digital Content Link, as {cid, cassette, parent, title}."""
    items = {r["Component Title"]: r for r in rows if r["Component Type"] == "Item"}

    def cassette_of(container: str) -> str:
        m = CASSETTE_RE.search(container or "")
        return m.group(1) if m else ""

    tracks: list[dict[str, str]] = []
    cassettes: list[dict[str, str]] = []
    for r in rows:
        if r["Digital Content Link"].strip():
            continue
        if r["Component Type"] == "Track":
            parent = r["Level 2"]
            tracks.append({"cid": r["Database Number"], "cassette": cassette_of(items.get(parent, {}).get("Container Info", "")),
                           "parent": parent, "title": r["Component Title"].strip()})
        elif r["Component Type"] == "Item":
            cassettes.append({"cid": r["Database Number"], "cassette": cassette_of(r.get("Container Info", "")),
                              "parent": "", "title": r["Component Title"].strip()})
    return tracks, cassettes


def legacy_urns(meta_path: Path) -> list[str] | None:
    """URN key per 1-based row of harvard_tracks_metadata.csv ("" for a row without url), or
    None when the file is absent. Same reading as harvard_fetch.legacy_index()."""
    if not meta_path.exists():
        return None
    with open(meta_path, encoding="utf-8", errors="ignore") as f:
        return [norm_urn(r["url"]) if (r.get("url") or "").strip() else "" for r in csv.DictReader(f)]


def scan_legacy(legacy_dir: Path, meta_path: Path, rows: list[ManifestRow]) -> LegacyScan | None:
    """List the legacy *.mp3 files that no manifest row names. Files are matched to rows by
    file name (legacy names are unique inside the folder). For each unaccounted file the note
    says why: no track_NNNN prefix, a metadata row without url, or two files whose names map
    to one URN (harvard_fetch.legacy_index keeps the last one per URN, so the other never gets
    a row and the identity of both is unresolved). Returns None when the folder is absent."""
    if not legacy_dir.is_dir():
        return None
    files = sorted(legacy_dir.glob("*.mp3"))
    named = {Path(r.file).name for r in rows if r.file}
    urns = legacy_urns(meta_path)

    def urn_of(f: Path) -> tuple[str, str]:
        """(urn, problem): the URN the file name points at, or "" and why."""
        m = LEGACY_NAME_RE.match(f.name)
        if not m:
            return "", "no track_NNNN prefix, so no row of harvard_tracks_metadata.csv names it; identity unknown"
        if urns is None:
            return "", f"row {m.group(1)} of harvard_tracks_metadata.csv (file not found); identity unknown"
        i = int(m.group(1))
        if not 1 <= i <= len(urns):
            return "", f"row {i} is beyond the {len(urns)} rows of harvard_tracks_metadata.csv; identity unknown"
        if not urns[i - 1]:
            return "", f"row {i} of harvard_tracks_metadata.csv has no url; identity unknown"
        return urns[i - 1], ""

    by_urn: dict[str, list[Path]] = defaultdict(list)
    resolved = {f: urn_of(f) for f in files}
    for f, (urn, _) in resolved.items():
        if urn:
            by_urn[urn].append(f)
    unaccounted: list[LegacyFile] = []
    for f in files:
        if f.name in named:
            continue
        urn, problem = resolved[f]
        if problem:
            note = problem
        elif len(by_urn[urn]) > 1:
            others = ", ".join(f"{o.name} ({o.stat().st_size} B{', has a manifest row' if o.name in named else ''})"
                               for o in by_urn[urn] if o != f)
            note = (f"identity unresolved: shares URN {urn} with {others}; the fetcher's legacy index keeps one file "
                    "per URN, so this one has no row and one of the two carries a wrong title in the 2025 metadata")
        else:
            note = f"URN {urn} has no manifest row (not among the catalog's linked objects, or the fetcher has not run since)"
        unaccounted.append(LegacyFile(f.name, f.stat().st_size, urn, note))
    return LegacyScan(legacy_dir, len(files), unaccounted, urns is not None)


def analyse(load: ManifestLoad, catalog: list[dict[str, str]], linked: list[Obj],
            legacy_scan: LegacyScan | None = None) -> Analysis:
    rows = load.rows
    legacy_map = {norm_urn(r.link): Path(r.file) for r in rows if r.status == "legacy"}
    groups = plan(linked, legacy_map)
    status_of = {r.cid: r for r in rows}
    pending = [o for o in linked if o.cid not in status_of]
    by_status: Counter[str] = Counter(r.status for r in rows)
    skipped_by_class: dict[str, list[ManifestRow]] = defaultdict(list)
    for r in rows:
        if r.status == "skipped":
            skipped_by_class[reason_class(r.reason)].append(r)
    fetch_group_status: Counter[str] = Counter(
        status_of[o.cid].status if o.cid in status_of else "pending" for o in groups.get("fetch", []))

    fetched = [r for r in rows if r.status == "fetched"]
    legacy = [r for r in rows if r.status == "legacy"]
    fetched_tracks: Counter[str] = Counter(r.cassette for r in fetched if r.ctype == "Track" and r.cassette)
    legacy_tracks: Counter[str] = Counter(r.cassette for r in legacy if r.ctype == "Track" and r.cassette)
    linked_tracks: Counter[str] = Counter(o.cassette for o in linked if o.ctype == "Track" and o.cassette)
    pending_tracks: Counter[str] = Counter(o.cassette for o in pending if o.ctype == "Track" and o.cassette)
    overlaps = [Overlap(r, fetched_tracks.get(r.cassette, 0), legacy_tracks.get(r.cassette, 0),
                        linked_tracks.get(r.cassette, 0), pending_tracks.get(r.cassette, 0))
                for r in legacy if r.ctype == "Item" and r.cassette
                and (r.cassette in fetched_tracks or r.cassette in legacy_tracks or r.cassette in linked_tracks)]
    hours_fetched = sum(r.duration_s for r in fetched) / 3600
    hours_legacy = sum(r.duration_s for r in legacy) / 3600
    hours_unique = hours_fetched + hours_legacy - sum(o.row.duration_s for o in overlaps if o.on_disk) / 3600
    unlinked_tracks, unlinked_items = unlinked_components(catalog)
    return Analysis(Counter(r["Component Type"] for r in catalog), linked, groups, rows, load.raw_rows, by_status,
                    dict(skipped_by_class), pending, hours_fetched, hours_legacy, hours_unique, overlaps,
                    unlinked_tracks, unlinked_items, fetch_group_status, list(load.malformed_lines),
                    load.rows_without_cid, load.bad_durations, legacy_scan)


def headline(a: Analysis) -> dict[str, object]:
    """The counts worth pasting into a status note; every value is also in the report."""
    skipped = {k: len(v) for k, v in a.skipped_by_class.items()}
    scan = a.legacy_scan
    return {
        "manifest_rows": a.raw_rows,
        "manifest_objects": len(a.rows),
        "malformed_lines": len(a.malformed_lines),
        "rows_without_cid": a.rows_without_cid,
        "bad_durations": a.bad_durations,
        "catalog_rows": dict(a.catalog_types),
        "linked_catalog_objects": len(a.linked),
        "linked_items": sum(1 for o in a.linked if o.ctype == "Item"),
        "linked_tracks": sum(1 for o in a.linked if o.ctype == "Track"),
        "fetched": a.by_status.get("fetched", 0),
        "legacy": a.by_status.get("legacy", 0),
        "skipped": a.by_status.get("skipped", 0),
        "skipped_by_reason": skipped,
        "pending": len(a.pending),
        "to_retry": sum(n for k, n in skipped.items() if k not in POLICY_CLASSES),
        "plan": {k: len(a.groups.get(k, [])) for k in PLAN_GROUPS},
        "hours_fetched": round(a.hours_fetched, 2),
        "hours_fetched_plus_legacy": round(a.hours_fetched + a.hours_legacy, 2),
        "hours_unique_audio": round(a.hours_unique, 2),
        "tracks_without_digital_object": len(a.unlinked_tracks),
        "items_without_digital_object": len(a.unlinked_items),
        "legacy_cassette_overlaps": sum(1 for o in a.overlaps if o.on_disk),
        "legacy_cassettes_with_linked_tracks": len(a.overlaps),
        "legacy_files_on_disk": scan.files_on_disk if scan else 0,
        "legacy_files_unaccounted": len(scan.unaccounted) if scan else 0,
        "complete": not a.pending,
    }


def md(s: str) -> str:
    """One Markdown table cell: line breaks of any kind become spaces, pipes are escaped."""
    return re.sub(r"[\r\n]+", " ", s).replace("|", "\\|").strip()


def table(header: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join(" --- " for _ in header) + "|"]
    lines += ["| " + " | ".join(md(c) for c in r) + " |" for r in rows]
    return "\n".join(lines)


def hours(h: float) -> str:
    return f"{h:.2f} h"


def repo_relative(p: Path) -> str:
    """Repo-relative form for the report header when the path is inside the repo, else as given."""
    try:
        return str(p.resolve().relative_to(REPO))
    except ValueError:
        return str(p)


def render(a: Analysis, manifest: Path, catalog: Path, generated: str, manifest_mtime: str) -> str:
    manifest, catalog = Path(repo_relative(manifest)), Path(repo_relative(catalog))
    n_linked = len(a.linked)
    n_pending = len(a.pending)
    skipped_n = {k: len(v) for k, v in a.skipped_by_class.items()}
    to_retry = sum(n for k, n in skipped_n.items() if k not in POLICY_CLASSES)
    scan = a.legacy_scan
    out: list[str] = []
    out.append("# Harvard collection fetch — gap list\n")
    legacy_note = (f" and a listing of `{repo_relative(scan.directory)}` ({scan.files_on_disk} `*.mp3` files)"
                   if scan else "")
    out.append(f"Generated {generated} by `apps/ai-service/scripts/harvard_gap_report.py` from "
               f"`{manifest}` ({a.raw_rows} rows, {len(a.rows)} objects after keeping the last row per cid; "
               f"last modified {manifest_mtime}), `{catalog}`{legacy_note}. Every number below is computed "
               "from those inputs; rerun the script to refresh it. Research-only material: the files it counts "
               "are git-ignored and are never served (`docs/data/HARVARD_TERMS.md`).\n")
    problems: list[str] = []
    if a.malformed_lines:
        shown = ", ".join(str(n) for n in a.malformed_lines[:10]) + (", …" if len(a.malformed_lines) > 10 else "")
        problems.append(f"{len(a.malformed_lines)} manifest line(s) were not a JSON object and were skipped "
                        f"(line {shown}; a line the fetcher was still writing, or a hand edit)")
    if a.rows_without_cid:
        problems.append(f"{a.rows_without_cid} manifest row(s) had no `cid` and were not counted as objects")
    if a.bad_durations:
        problems.append(f"{a.bad_durations} fetched/legacy object(s) had a `duration_s` that is not a number "
                        "and count as 0 h")
    if problems:
        out.append("**Input problems:** " + "; ".join(problems) + ".\n")
    if n_pending:
        out.append(f"**Status: PARTIAL — the fetch is still running.** {n_pending} of {n_linked} linked catalog objects "
                   f"have no manifest row yet, and {to_retry} skipped objects are re-queued on the fetcher's next run. "
                   "Rerun this script when `harvard_fetch` prints `HARVARD_FETCH_DONE`.\n")
    else:
        out.append(f"**Status: complete.** Every one of the {n_linked} linked catalog objects has a manifest row; "
                   f"{to_retry} skipped objects would be re-queued by another fetcher run.\n")

    ct = a.catalog_types
    rows1 = [
        ["catalog rows (Series / Item / Track)", f"{ct.get('Series', 0)} / {ct.get('Item', 0)} / {ct.get('Track', 0)}"],
        ["catalog objects with a digital-content link",
         f"{n_linked} ({sum(1 for o in a.linked if o.ctype == 'Item')} cassette-level, "
         f"{sum(1 for o in a.linked if o.ctype == 'Track')} tracks)"],
        ["manifest rows / objects", f"{a.raw_rows} / {len(a.rows)}"],
        ["fetched (this run)", str(a.by_status.get("fetched", 0))],
        ["legacy (2025 files matched to the catalog by URN)", str(a.by_status.get("legacy", 0))],
        ["skipped, total", str(a.by_status.get("skipped", 0))],
    ]
    for key, label in REASON_CLASSES:
        if skipped_n.get(key):
            rows1.append([f"skipped: {label}", str(skipped_n[key])])
    rows1 += [
        ["pending (linked objects with no manifest row yet)", str(n_pending)],
        ["catalog tracks with no digital object (not a fetch failure)", str(len(a.unlinked_tracks))],
        ["catalog cassette-level objects with no digital object", str(len(a.unlinked_items))],
    ]
    if scan:
        rows1.append(["legacy files on disk / with no manifest row (see 8)",
                      f"{scan.files_on_disk} / {len(scan.unaccounted)}"])
    out.append("## 1. Totals\n")
    out.append(table(["quantity", "count"], rows1) + "\n")

    out.append("## 2. Hours on disk\n")
    out.append("`duration_s` is what the fetcher measured with ffprobe on each file. Legacy files with no "
               "manifest row (section 8) are in no figure here.\n")
    out.append(table(["files", "hours"], [
        ["fetched only", hours(a.hours_fetched)],
        ["legacy only", hours(a.hours_legacy)],
        ["fetched + legacy", hours(a.hours_fetched + a.hours_legacy)],
        ["fetched + legacy, minus legacy whole-cassette files whose tracks are also on disk (unique audio)",
         hours(a.hours_unique)],
    ]) + "\n")

    out.append("## 3. Plan and progress\n")
    out.append("`harvard_fetch.plan()` over the catalog, with the manifest's legacy rows as the legacy index: "
               "track-level objects are fetched; a cassette-level object only when its cassette has no linked "
               "track objects; a link already on disk from 2025 is `legacy`; a link that repeats an earlier "
               "component is `duplicate_link`.\n")
    g = {k: len(a.groups.get(k, [])) for k in PLAN_GROUPS}
    fs = a.fetch_group_status
    out.append(table(["plan group", "objects", "note"], [
        ["fetch", str(g["fetch"]),
         f"fetched {fs.get('fetched', 0)}, skipped {fs.get('skipped', 0)}, pending {fs.get('pending', 0)}; "
         f"{sum(1 for o in a.groups.get('fetch', []) if o.ctype == 'Item')} of them cassette-level objects "
         "without linked tracks"],
        ["legacy", str(g["legacy"]), "2025 files, not re-fetched"],
        ["cassette_superseded_by_tracks", str(g["cassette_superseded_by_tracks"]), "policy skip, see 4"],
        ["duplicate_link", str(g["duplicate_link"]), "policy skip, see 4"],
    ]) + "\n")

    out.append("## 4. Skipped objects\n")
    out.append("Every manifest object whose last row has `status: skipped`, grouped by reason. Policy skips are "
               "final; the others are re-queued on the fetcher's next run.\n")
    if not a.by_status.get("skipped"):
        out.append("None.\n")
    sub = 0
    for key, label in REASON_CLASSES:
        rows_k = sorted(a.skipped_by_class.get(key, []), key=lambda r: r.sort_key)
        if not rows_k:
            continue
        sub += 1
        heading = ("Cassette-level objects superseded by their track objects" if key == "cassette_superseded_by_tracks"
                   else "Duplicate links" if key == "duplicate_link" else label[0].upper() + label[1:])
        out.append(f"### 4.{sub} {heading} ({len(rows_k)}) — `{key}`\n")
        if key == "cassette_superseded_by_tracks":
            out.append("The cassette-level digital object is the union of the cassette's track objects; fetching "
                       "both would put the same audio under two identities and leak across song-level splits.\n")
        out.append(table(["cid", "cassette", "type", "title", "reason", "link"],
                         [[r.cid, r.cassette or "?", r.ctype, r.title, r.reason, r.link] for r in rows_k]) + "\n")

    n_on_disk = sum(1 for o in a.overlaps if o.on_disk)
    n_waiting = len(a.overlaps) - n_on_disk
    out.append("## 5. Legacy whole-cassette files that overlap track files\n")
    out.append("Manifest `legacy` rows of type `Item` (a 2025 file holding a whole cassette side or cassette) whose "
               "AWM SC number has linked `Track` objects in the catalog. Each of these files is a superset of "
               "those tracks and must be excluded from any training set that includes the tracks (it would repeat "
               "the same songs under another `song_sha256`). `overlaps on disk` says whether any of the tracks is "
               "fetched or legacy already; only those files are subtracted from the unique-audio figure in section "
               "2, so `hours_unique_audio` falls as pending tracks arrive. A track that ends up skipped is not on "
               "disk, and the cassette file is then its only copy.\n")
    if not a.overlaps:
        out.append("None.\n")
    else:
        out.append(f"{len(a.overlaps)} files: {n_on_disk} overlap tracks on disk now, {n_waiting} have no track on disk "
                   f"yet ({sum(o.pending_tracks for o in a.overlaps if not o.on_disk)} linked track objects pending "
                   "for them).\n")
        out.append(table(["cid", "cassette", "title", "legacy file", "linked track objects in catalog",
                          "fetched track rows", "legacy track rows", "pending", "overlaps on disk", "hours"],
                         [[o.row.cid, o.row.cassette, o.row.title, o.row.file, str(o.linked_tracks),
                           str(o.fetched_tracks), str(o.legacy_tracks), str(o.pending_tracks),
                           "yes" if o.on_disk else "no", hours(o.row.duration_s / 3600)]
                          for o in sorted(a.overlaps, key=lambda o: o.row.sort_key)]) + "\n")

    out.append(f"## 6. Catalog tracks with no digital object ({len(a.unlinked_tracks)})\n")
    out.append("Track rows of the finding-aid export whose `Digital Content Link` is empty: no digital object in "
               "the finding aid. These are not fetch failures and nothing can be fetched for them; they are "
               "listed so the gap between the catalog's track count and the audio on disk is accounted for.\n")
    if not a.unlinked_tracks:
        out.append("None.\n")
    else:
        out.append(table(["cid", "cassette", "cassette title", "track title"],
                         [[t["cid"], t["cassette"] or "?", t["parent"], t["title"]]
                          for t in sorted(a.unlinked_tracks, key=lambda t: (int(t["cassette"]) if t["cassette"].isdigit() else 10**9, t["cid"]))]) + "\n")

    out.append(f"## 7. Cassette-level objects with no digital object ({len(a.unlinked_items)})\n")
    if not a.unlinked_items:
        out.append("None.\n")
    else:
        out.append(table(["cid", "cassette", "title"],
                         [[t["cid"], t["cassette"] or "?", t["title"]] for t in a.unlinked_items]) + "\n")

    n_un = len(scan.unaccounted) if scan else 0
    out.append(f"## 8. Legacy files on disk with no manifest row ({n_un})\n")
    if scan is None:
        out.append("The legacy folder was not found, so nothing was listed (pass `--legacy-dir`).\n")
    else:
        out.append(f"`*.mp3` files in `{repo_relative(scan.directory)}` that no manifest row names. They are in no "
                   "count above, no hours figure, and no training set (`build_sets` reads the manifest only). A "
                   "2025 file is identified by its `track_NNNN` prefix, the 1-based row of "
                   "`harvard_tracks_metadata.csv`; when two files point at one URN, the fetcher's legacy index keeps "
                   "one and the other has no row, and the title of at least one of the pair is wrong in that "
                   "metadata, so the identity of both stays unresolved until someone listens to them against the "
                   "catalog." + ("" if scan.meta_found else " `harvard_tracks_metadata.csv` was not found, so no URN "
                                 "could be looked up.") + "\n")
        if not scan.unaccounted:
            out.append("None.\n")
        else:
            out.append(table(["file", "bytes", "URN from the 2025 metadata", "note"],
                             [[f.name, str(f.bytes), f.urn or "?", f.note] for f in scan.unaccounted]) + "\n")
    return "\n".join(out)


def build(manifest: Path, catalog: Path, generated: str | None = None, legacy_dir: Path | None = None,
          legacy_meta: Path | None = None) -> tuple[str, dict[str, object]]:
    """Read the inputs and return (markdown, headline counts). legacy_dir defaults to the repo's
    data/harvard_raw/legacy and legacy_meta to harvard_tracks_metadata.csv; both are tolerated
    when absent. Raises ValueError for a catalog without the header row."""
    load = load_manifest(manifest)
    catalog_rows = read_catalog_rows(catalog)
    linked = load_catalog(catalog)
    scan = scan_legacy(legacy_dir if legacy_dir is not None else LEGACY,
                       legacy_meta if legacy_meta is not None else META, load.rows)
    a = analyse(load, catalog_rows, linked, scan)
    mtime = datetime.fromtimestamp(manifest.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
    text = render(a, manifest, catalog, generated or time.strftime("%Y-%m-%d %H:%M:%S %z"), mtime)
    return text, headline(a)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", type=Path, default=MANIFEST, help="fetcher manifest (JSONL)")
    ap.add_argument("--catalog", type=Path, default=CATALOG, help="finding-aid CSV export")
    ap.add_argument("--legacy-dir", type=Path, default=LEGACY,
                    help="folder of the 2025 files, listed for section 8 (tolerated when absent)")
    ap.add_argument("--legacy-meta", type=Path, default=META,
                    help="the 2025 title/url export whose row numbers name the legacy files (tolerated when absent)")
    ap.add_argument("--out", type=Path, default=OUT, help="Markdown report to write")
    args = ap.parse_args()
    for p in (args.manifest, args.catalog):
        if not p.exists():
            print(f"missing input: {p}", file=sys.stderr)
            return 2
    if args.out.is_dir():
        print(f"--out is a directory, not a file: {args.out}", file=sys.stderr)
        return 2
    try:
        text, counts = build(args.manifest, args.catalog, legacy_dir=args.legacy_dir, legacy_meta=args.legacy_meta)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
    except (ValueError, OSError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(json.dumps(counts, indent=2))
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
