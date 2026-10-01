"""Contributor intake: turn a consented drop-off folder under ``data/incoming/``
into an inventory the rest of the corpus pipeline can consume.

A contributor (a performer, a family, a collector) hands over audio plus a
plain-text ``CONTRIBUTOR.md`` (the required record is described in
``docs/data/INCOMING_README.md``). This script

1. scans ``--root`` (default ``data/incoming``) for ``<contributor>/CONTRIBUTOR.md``;
2. parses the record: it MUST carry ``tier: consented_publishable`` or
   ``tier: research_only``, a ``date: YYYY-MM-DD`` and a ``signed_by:`` line, or
   the folder is skipped with the reason logged (nothing is inventoried from a
   folder whose consent record is missing or malformed);
3. inventories every audio file under the folder with the helpers of
   ``scripts.ahmed_extract`` (``walk``/``measure``/``finalize``: ffprobe, full
   sha256, silence fraction, in-folder duplicates), with source group
   ``contrib_<slug>`` and role ``song``;
4. stamps ``rights`` = ``contrib_<slug>_consented`` (tier consented_publishable:
   train + publish) or ``contrib_<slug>_research_only`` on every row, together
   with the contributor's credited name, the record path, date and uses. When
   the record lists ``uses:``, the tier must be covered by them (research_only
   needs ``train``; consented_publishable needs ``train``, ``publish_adapters``
   and ``publish_outputs``) or the folder is skipped: the tier is what
   downstream reads, so it may never claim more than the signed uses grant;
5. dedupes by sha256 against ``data/inventory/ahmed_files.jsonl``, the Harvard
   manifest (``data/harvard_raw/manifest.jsonl``) and the internet manifest
   (``data/internet/manifest.jsonl``): a file we already hold is kept in the
   inventory but ``excluded`` with reason ``duplicate_of_corpus`` and
   ``dup_of_corpus`` naming the earlier copy;
6. writes ``data/inventory/contrib_<slug>_files.jsonl`` (ahmed_files schema plus
   the rights/consent fields, so ``ahmed_classify.py --inventory`` and
   ``build_sets.py`` can consume it) and appends one line per changed
   contributor to ``data/inventory/intake_log.jsonl``.

The slug is the folder name (lower-case, ``[a-z0-9_]``), not the credited name:
the folder is the contributor's identity in the corpus, the name is how they
are credited in captions and cards. Two folders that slugify alike ("Faadumo
Qaasim" and "faadumo-qaasim") would share one inventory file, so the second
one (the folder not already inventoried, else the later in sorted order) is
skipped with the reason logged until it is renamed.

``ahmed_extract.finalize`` excludes every ``.caf`` and every Apple-loop-looking
name as ``apple_loop``; that heuristic is about Ahmed's GarageBand bundles, so
for contributor rows the exclusion is lifted (the row is then judged on
silence and duplicates only).

Idempotent and resumable: the orchestrator runs this every time it starts. Each
folder's state is fingerprinted (record text + every audio file's path, size
and mtime); a folder whose fingerprint matches its last log line (keyed by the
folder path) is left alone, per-file measurements are reused from the existing
inventory when size and mtime match (``ahmed_extract.measure``), writes are
atomic, and when nothing changed the run prints ``no new contributors``.
``--dry-run`` parses, walks and reports without writing; ``--limit N`` measures
only the first N files of each folder (smoke) and logs the folder with status
``partial``, which never counts as final: the next full run re-inventories it
(only a rerun with the same limit sees it as unchanged).

Audio never enters git: ``data/incoming/`` is ignored by the root .gitignore
(pattern owned by the report component: ``data/incoming/``); the inventories are
JSON and stay tracked.

Usage (from apps/ai-service):
  python -m scripts.intake [--root data/incoming] [--limit N] [--dry-run]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path

from scripts import ahmed_extract as ax

REPO = Path(__file__).resolve().parents[3]
DEFAULT_ROOT = "data/incoming"
DEFAULT_INVENTORY_DIR = "data/inventory"
DEFAULT_AHMED_INVENTORY = "data/inventory/ahmed_files.jsonl"
DEFAULT_HARVARD_MANIFEST = "data/harvard_raw/manifest.jsonl"
DEFAULT_INTERNET_MANIFEST = "data/internet/manifest.jsonl"
RECORD_NAME = "CONTRIBUTOR.md"
LOG_NAME = "intake_log.jsonl"

# tier written in CONTRIBUTOR.md -> suffix of the rights tier stamped on rows
TIERS = {"consented_publishable": "consented", "research_only": "research_only"}
# uses a record may grant; the list mirrors docs/data/consent/README.md item 3
USES = (
    "analyse", "train", "evaluate", "publish_adapters", "publish_outputs", "quote_excerpts", "keep_for_project",
)
REQUIRED_KEYS = ("name", "date", "tier", "signed_by")
# uses a tier presupposes; checked only when the record lists ``uses:`` at all
TIER_REQUIRED_USES = {"consented_publishable": ("train", "publish_adapters", "publish_outputs"),
                      "research_only": ("train",)}
# accepted spellings of the keys; the canonical key always wins over an alias
KEY_ALIASES = {"credited_as": "name", "credit": "name", "contributor": "name", "signed": "signed_by",
               "what": "gave", "recordings": "gave", "uses_granted": "uses"}
BOM = "\ufeff"
RECORD_LINE = re.compile(r"^\s*(?:[-*]\s*)?\**([A-Za-z_ ]+?)\**\s*:\s*(.*?)\s*$")
SLUG_CHARS = re.compile(r"[^a-z0-9]+")


@dataclass
class ContributorRecord:
    """The parsed CONTRIBUTOR.md of one folder; ``errors`` non-empty means skip."""

    slug: str
    folder: str
    record_path: str
    name: str = ""
    date: str = ""
    tier: str = ""
    signed_by: str = ""
    gave: str = ""
    uses: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def rights(self) -> str:
        return f"contrib_{self.slug}_{TIERS[self.tier]}" if self.tier in TIERS else ""

    @property
    def source_group(self) -> str:
        return f"contrib_{self.slug}"


def slugify(name: str) -> str:
    """Folder name -> ``[a-z0-9_]`` slug (at most 40 chars, never empty)."""
    s = SLUG_CHARS.sub("_", name.strip().lower()).strip("_")
    return (s or "contributor")[:40].strip("_") or "contributor"


def parse_record(text: str, slug: str, folder: str, record_path: str) -> ContributorRecord:
    """Parse ``key: value`` lines (Markdown bullets and bold keys allowed).

    Required: name, date (a real YYYY-MM-DD), tier (consented_publishable |
    research_only), signed_by. Optional: gave, uses (comma-separated, each one
    of USES; unknown uses are reported as errors so a typo cannot silently
    grant or withhold anything, and a tier the listed uses do not cover is an
    error too). A leading UTF-8 BOM and CRLF line ends are tolerated. The first
    occurrence of a canonical key wins; an alias (KEY_ALIASES) is used only when
    the canonical key is absent from the whole record.
    """
    rec = ContributorRecord(slug=slug, folder=folder, record_path=record_path)
    fields: dict[str, str] = {}
    aliased: dict[str, str] = {}
    for line in text.lstrip(BOM).splitlines():
        m = RECORD_LINE.match(line)
        if not m:
            continue
        raw_key = m.group(1).strip().lower().replace(" ", "_")
        value = m.group(2).strip().strip("`*").strip()
        if raw_key in KEY_ALIASES:
            aliased.setdefault(KEY_ALIASES[raw_key], value)
        else:
            fields.setdefault(raw_key, value)
    for key, value in aliased.items():
        fields.setdefault(key, value)
    for key in REQUIRED_KEYS:
        if not fields.get(key):
            rec.errors.append(f"missing '{key}:' line")
    rec.name = fields.get("name", "")
    rec.signed_by = fields.get("signed_by", "")
    rec.gave = fields.get("gave", "")
    rec.tier = fields.get("tier", "").lower()
    if rec.tier and rec.tier not in TIERS:
        rec.errors.append(f"tier must be one of {sorted(TIERS)}, got {rec.tier!r}")
    rec.date = fields.get("date", "")
    if rec.date:
        try:
            date.fromisoformat(rec.date)
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", rec.date):
                raise ValueError(rec.date)
        except ValueError:
            rec.errors.append(f"date must be YYYY-MM-DD, got {rec.date!r}")
    if fields.get("uses"):
        rec.uses = [u.strip().lower().replace(" ", "_") for u in fields["uses"].split(",") if u.strip()]
        bad = [u for u in rec.uses if u not in USES]
        if bad:
            rec.errors.append(f"unknown uses {bad}; allowed: {list(USES)}")
        needed = [u for u in TIER_REQUIRED_USES.get(rec.tier, ()) if u not in rec.uses]
        if needed:
            rec.errors.append(f"tier {rec.tier} needs uses {list(TIER_REQUIRED_USES[rec.tier])}; missing {needed}")
    return rec


def read_record(folder: Path, slug: str) -> ContributorRecord:
    record = folder / RECORD_NAME
    if not record.is_file():
        return ContributorRecord(slug=slug, folder=ax.rel(folder), record_path=ax.rel(record),
                                 errors=[f"no {RECORD_NAME} in the folder"])
    return parse_record(record.read_text(encoding="utf-8-sig", errors="replace"), slug, ax.rel(folder), ax.rel(record))


def audio_files(folder: Path) -> list[ax.FileRef]:
    """Audio under the folder in canonical order. The refs carry source group
    ``ahmed_collection`` only because ``ahmed_extract.finalize`` ranks rows with
    CANONICAL_RANK; ``stamp_rows`` rewrites the group to ``contrib_<slug>``."""
    refs = [r for r in ax.walk(folder, "ahmed_collection") if r.path.suffix.lower() not in ax.OVERVIEW_EXTS]
    refs.sort(key=lambda r: (r.project.lower(), r.path.name.lower(), str(r.path)))
    return refs


def fingerprint(record_text: str, refs: list[ax.FileRef]) -> str:
    """sha256 over the record text and every audio file's (path, size, mtime_ns)."""
    h = hashlib.sha256(record_text.encode("utf-8", errors="replace"))
    for r in refs:
        st = r.path.stat()
        h.update(f"\n{ax.rel(r.path)}|{st.st_size}|{st.st_mtime_ns}".encode())
    return h.hexdigest()


def load_known_sha256s(ahmed_inventory: Path, harvard_manifest: Path, internet_manifest: Path,
                       inventory_dir: Path | None = None, skip_slug: str | None = None) -> dict[str, str]:
    """sha256 -> label of the copy the corpus already holds (first seen wins).

    Reads the Ahmed inventory, the Harvard manifest, the internet manifest (its
    per-item ``files`` list and any top-level sha256) and every other
    ``contrib_*_files.jsonl`` in ``inventory_dir`` except ``skip_slug``'s own.
    """
    known: dict[str, str] = {}

    def add(sha: object, label: str) -> None:
        if isinstance(sha, str) and len(sha) == 64 and sha not in known:
            known[sha] = label

    for row in _jsonl(ahmed_inventory):
        add(row.get("sha256"), f"ahmed:{row.get('path')}")
    for row in _jsonl(harvard_manifest):
        add(row.get("sha256"), f"harvard:{row.get('cid') or row.get('file')}")
    for row in _jsonl(internet_manifest):
        add(row.get("sha256"), f"internet:{row.get('source')}/{row.get('item_id')}")
        for f in row.get("files") or []:
            if isinstance(f, dict):
                add(f.get("sha256"), f"internet:{row.get('source')}/{row.get('item_id')}/{f.get('name')}")
    if inventory_dir and inventory_dir.is_dir():
        for inv in sorted(inventory_dir.glob("contrib_*_files.jsonl")):
            if skip_slug and inv.name == f"contrib_{skip_slug}_files.jsonl":
                continue
            for row in _jsonl(inv):
                add(row.get("sha256"), f"{row.get('source_group')}:{row.get('path')}")
    return known


def _jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    rows: list[dict] = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(r, dict):
            rows.append(r)
    return rows


def stamp_rows(rows: list[dict], rec: ContributorRecord, known: dict[str, str]) -> list[dict]:
    """Rewrite the source group, force role ``song``, lift the Ahmed-only
    ``apple_loop`` exclusion, add the rights/consent fields and mark cross-corpus
    duplicates (in-folder duplicates were already marked by
    ``ahmed_extract.finalize``)."""
    for r in rows:
        if r.get("exclude_reason") == "apple_loop":
            # finalize's order was overview > unreadable > apple_loop > silent > duplicate; redo the tail
            if r.get("is_silent"):
                r["excluded"], r["exclude_reason"] = True, "silent"
            elif r.get("dup_of"):
                r["excluded"], r["exclude_reason"] = True, "duplicate"
            else:
                r["excluded"], r["exclude_reason"] = False, None
        r["source_group"] = rec.source_group
        r["project_kind"] = "contrib"
        r["role_guess"] = "song"
        r["rights"] = rec.rights
        r["contributor"] = rec.name
        r["contributor_slug"] = rec.slug
        r["consent_record"] = rec.record_path
        r["consent_date"] = rec.date
        r["consent_tier"] = rec.tier
        r["uses_granted"] = list(rec.uses)
        label = known.get(r.get("sha256", ""))
        r["dup_of_corpus"] = label
        if label and not r.get("excluded"):
            r["excluded"], r["exclude_reason"] = True, "duplicate_of_corpus"
    return rows


def inventory_folder(folder: Path, rec: ContributorRecord, known: dict[str, str], out: Path,
                     limit: int = 0) -> list[dict]:
    """Measure (or reuse) every audio file of the folder and return the stamped rows."""
    refs = audio_files(folder)
    if limit:
        refs = refs[:limit]
    cache = ax.load_existing(out)
    rows: list[dict] = []
    for ref in refs:
        cached = cache.get(ax.rel(ref.path))
        try:
            rows.append(ax.measure(ref, cached))
        except Exception as exc:  # the row records the failure, the run goes on
            rows.append(ax.measure_failed(ref, exc))
    rows = ax.finalize(rows)
    return stamp_rows(rows, rec, known)


def summarize(rows: list[dict]) -> dict:
    kept = [r for r in rows if not r.get("excluded")]
    reasons: dict[str, int] = {}
    for r in rows:
        if r.get("excluded"):
            reasons[str(r.get("exclude_reason"))] = reasons.get(str(r.get("exclude_reason")), 0) + 1
    return {
        "files": len(rows),
        "kept": len(kept),
        "hours_kept": round(sum(float(r.get("duration_s") or 0.0) for r in kept) / 3600, 3),
        "excluded": dict(sorted(reasons.items())),
    }


def last_log_by_folder(log: Path) -> dict[str, dict]:
    """Last log row per contributor folder (repo-relative path; rows of older
    logs without ``folder`` fall back to their slug)."""
    last: dict[str, dict] = {}
    for row in _jsonl(log):
        key = row.get("folder") or row.get("slug")
        if key:
            last[str(key)] = row
    return last


def is_unchanged(prev: dict | None, fp: str, out: Path, limit: int) -> bool:
    """A folder is left alone when its fingerprint equals its last log row's and
    that row was final: a skip, a full inventory whose file still exists, or a
    ``partial`` (--limit) pass with the same limit. A partial pass never
    satisfies a full run."""
    if not prev or prev.get("fingerprint") != fp:
        return False
    status = prev.get("status")
    if status == "skipped":
        return True
    if status == "ok":
        return out.is_file()
    if status == "partial":
        return bool(limit) and int(prev.get("limit") or 0) == limit and out.is_file()
    return False


def slug_owners(folders: list[Path], last: dict[str, dict]) -> dict[str, Path]:
    """One folder per slug: the folder already inventoried under it (last log
    status ok/partial), else the first in sorted order. Any other folder with
    the same slug is skipped by ``run`` until renamed."""
    owners: dict[str, Path] = {}
    for folder in folders:
        prev = last.get(ax.rel(folder))
        if prev and prev.get("status") in ("ok", "partial"):
            owners.setdefault(slugify(folder.name), folder)
    for folder in folders:
        owners.setdefault(slugify(folder.name), folder)
    return owners


def append_log(log: Path, row: dict) -> None:
    log.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def contributor_folders(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    return sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith("."))


def run(root: Path, inventory_dir: Path, ahmed_inventory: Path, harvard_manifest: Path, internet_manifest: Path,
        limit: int = 0, dry_run: bool = False) -> dict:
    """One intake pass; returns a summary dict (also printed as JSON by main)."""
    log = inventory_dir / LOG_NAME
    last = last_log_by_folder(log)
    now = datetime.now(tz=UTC).isoformat(timespec="seconds")
    summary: dict = {"root": ax.rel(root), "dry_run": dry_run, "contributors": [], "changed": 0, "unchanged": 0,
                     "skipped": 0}
    folders = contributor_folders(root)
    owners = slug_owners(folders, last)
    if not folders:
        print(f"{ax.rel(root)}: no contributor folders", flush=True)
    for folder in folders:
        slug = slugify(folder.name)
        rec = read_record(folder, slug)
        if owners[slug] != folder:
            rec.errors.append(f"slug '{slug}' already used by {ax.rel(owners[slug])}; rename the folder")
        refs = audio_files(folder)
        record_text = (folder / RECORD_NAME).read_text(encoding="utf-8-sig", errors="replace") if (folder / RECORD_NAME).is_file() else ""
        fp = fingerprint(record_text, refs)
        prev = last.get(ax.rel(folder))
        out = inventory_dir / f"contrib_{slug}_files.jsonl"
        entry: dict = {"slug": slug, "folder": ax.rel(folder), "fingerprint": fp, "audio_files": len(refs)}
        if is_unchanged(prev, fp, out, limit):
            entry["status"] = "unchanged"
            summary["unchanged"] += 1
            summary["contributors"].append(entry)
            continue
        if rec.errors:
            entry.update({"status": "skipped", "reason": "; ".join(rec.errors)})
            print(f"skip {ax.rel(folder)}: {entry['reason']}", flush=True)
            summary["skipped"] += 1
            if not dry_run:
                append_log(log, {"ts": now, **entry, "record": asdict(rec)})
            summary["contributors"].append(entry)
            continue
        if not refs:
            entry.update({"status": "skipped", "reason": "no audio files under the folder"})
            print(f"skip {ax.rel(folder)}: {entry['reason']}", flush=True)
            summary["skipped"] += 1
            if not dry_run:
                append_log(log, {"ts": now, **entry, "record": asdict(rec)})
            summary["contributors"].append(entry)
            continue
        known = load_known_sha256s(ahmed_inventory, harvard_manifest, internet_manifest, inventory_dir, skip_slug=slug)
        t0 = time.time()
        rows = inventory_folder(folder, rec, known, out, limit=limit)
        stats = summarize(rows)
        status = "dry_run" if dry_run else ("partial" if limit else "ok")
        entry.update({"status": status, "out": ax.rel(out), "rights": rec.rights,
                      "record": {"name": rec.name, "date": rec.date, "tier": rec.tier, "signed_by": rec.signed_by,
                                 "uses": rec.uses, "gave": rec.gave},
                      **stats, "limit": limit, "elapsed_s": round(time.time() - t0, 1)})
        print(f"{'would write' if dry_run else 'wrote'} {ax.rel(out)}: {stats['files']} files, {stats['kept']} kept, "
              f"{stats['hours_kept']} h, rights {rec.rights}"
              + (f" (partial: first {limit} of {len(refs)} files, not final)" if limit else ""), flush=True)
        if not dry_run:
            ax.write_jsonl(out, rows)
            append_log(log, {"ts": now, **entry})
        summary["changed"] += 1
        summary["contributors"].append(entry)
    if summary["changed"] == 0 and summary["skipped"] == 0:
        print("no new contributors", flush=True)
    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=DEFAULT_ROOT, help="folder of contributor drop-offs")
    ap.add_argument("--inventory-dir", default=DEFAULT_INVENTORY_DIR, help="where contrib_<slug>_files.jsonl and intake_log.jsonl go")
    ap.add_argument("--ahmed-inventory", default=DEFAULT_AHMED_INVENTORY)
    ap.add_argument("--harvard-manifest", default=DEFAULT_HARVARD_MANIFEST)
    ap.add_argument("--internet-manifest", default=DEFAULT_INTERNET_MANIFEST)
    ap.add_argument("--limit", type=int, default=0,
                    help="measure only the first N audio files per contributor (smoke; logged as 'partial', re-done by the next full run)")
    ap.add_argument("--dry-run", action="store_true", help="parse and walk, write nothing")
    args = ap.parse_args()

    def absp(s: str) -> Path:
        p = Path(s)
        return p if p.is_absolute() else REPO / p

    summary = run(absp(args.root), absp(args.inventory_dir), absp(args.ahmed_inventory), absp(args.harvard_manifest),
                  absp(args.internet_manifest), limit=args.limit, dry_run=args.dry_run)
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    main()
