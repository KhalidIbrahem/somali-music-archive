"""Stage 1a of the Ahmed Ilkacase corpus programme: extract and inventory every
audio file in Ahmed's GarageBand bundles, Logic projects and the loose
``oud_ilkacase`` collection.

One JSON row per audio file goes to ``data/inventory/ahmed_files.jsonl`` with
provenance (source group, project, location inside the bundle, take number,
position), ffprobe metadata, the full-file sha256 (song identity for the
song-level splits), a silence fraction measured on a 16 kHz mono decode of the
whole file, a role guess from the location and the file name, and the
exclusion verdict. Nothing here is a classifier; ``ahmed_classify.py`` adds
the content label on top of these rows. No ML, no network: ffprobe/ffmpeg
subprocesses only, so a full pass over the 35 GB corpus is minutes, not hours.

Layout that is inventoried (repo-relative roots, override with ``--roots``):

* ``data/ahmed_raw/GarageBand/<name>.band/Media/*``  recorded takes and imports
  (GarageBand names unnamed takes ``No Effects#NN.aif``), ``Output/Output.aif``
  the bundle's mixdown. ``projectData`` is kept on disk for provenance only.
* ``data/ahmed_raw/Logic/<project>/Audio Files/*`` stems and takes
  (``<project>_N#NN.aif`` are recorded takes, ``NN title.m4a`` imports),
  ``Bounces/*`` mixdowns. ``*.logic`` bundles and ``Project File Backups`` are
  never entered.
* ``data/raw_incoming/oud_ilkacase/*`` Ahmed's separate collection, treated as
  source group ``ahmed_collection`` with one loose "project" per file.

Exclusion rules (``excluded`` + ``exclude_reason``), applied in this order:

* ``overview_cache``  the file ends in ``.ovw`` (Logic waveform cache, never audio).
* ``unreadable``      ffprobe reports no duration or the decode yields no samples.
* ``apple_loop``      the file is an Apple factory loop, not one of Ahmed's
  recordings. Rule used (conservative, stated here so the doc can quote it):
  (a) every ``.caf`` file (GarageBand and Logic write recordings as ``.aif``
  and imports keep their own extension; the only ``.caf`` files in this corpus
  are factory loops such as ``80s Dance Bass Synth 07.caf``), and (b) any
  other file whose stem is an Apple loop name of the form
  ``<Loop vocabulary words> NN[_N]`` (see ``APPLE_LOOP_NAME``). A recorded
  take whose track carries a preset name (``RnB Backing Vocals#02.aif``) is
  NOT matched: the ``#NN`` take marker and the missing loop index keep it.
* ``silent``          ``silence_fraction`` > SILENT_FRACTION or duration < MIN_DURATION_S.
* ``duplicate``       another file with the same sha256 was seen earlier in the
  canonical order (CANONICAL_RANK: the collection first, then GarageBand, then
  Logic; then project, name, mtime); ``dup_of`` carries the sha256 and
  ``dup_of_path`` the first-seen file, which in turn lists every later copy in
  ``also_in``. The collection ranks first so a file Ahmed both kept loose and
  imported into a bundle survives with its collection provenance (source group
  ``ahmed_collection``, role ``song``), which the classifier's oud seed rule
  and ``build_sets.py`` rely on. Duplicates stay in the inventory so the doc
  can list them.

Role guess (``role_guess``), from the location first and then the file name:
``mixdown`` (anything under ``Output/`` or ``Bounces/``, or a name carrying
"Output 1-2" or one of MIXDOWN_WORD_LIST), ``import`` (a numbered
``NN title.m4a``/``.mp3`` under ``Media`` or ``Audio Files``; checked before the
take marker because GarageBand suffixes a collision-renamed import with
``#2`` too, and before the mixdown words because a track-numbered ``.m4a`` is
an iTunes-style import whatever its title says), ``take`` (a ``#NN`` marker:
``No Effects#NN``, ``<project>_N#NN``), ``stem`` (anything else under ``Media``
or ``Audio Files``) and ``song`` for a loose standalone recording in the
collection.

The extractor is resumable and safe to run while the copy job is still
adding files: it inventories whatever exists at run time, reuses the sha256,
probe and silence measurement of every file whose path, size and mtime match
a row already in ``--out``, and recomputes the set-level fields (position,
duplicates, exclusions) on every run. Cached rows for files that were NOT
walked this run (a ``--limit`` subset, a root left out of ``--roots``, an
unmounted root) are merged back unchanged, so the inventory never shrinks by
accident; a cached row is dropped only when its root was walked and the file
is gone. A malformed line in ``--out`` is skipped (and its file re-measured).
The output is never overwritten with fewer rows than it holds except through
those "file gone" drops: ``--no-resume`` with a subset run refuses to shrink
a non-default inventory and asks for another ``--out``. ``--limit N`` measures
the first N audio files in canonical order (smoke runs) and merges them into
whatever ``--out`` already holds.

Usage (from apps/ai-service):
  python -m scripts.ahmed_extract [--roots data/ahmed_raw/GarageBand ...] \
      [--out data/inventory/ahmed_files.jsonl] [--limit N] [--no-resume]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[3]
DEFAULT_ROOTS = (
    "data/ahmed_raw/GarageBand",
    "data/ahmed_raw/Logic",
    "data/raw_incoming/oud_ilkacase",
)
DEFAULT_OUT = "data/inventory/ahmed_files.jsonl"

AUDIO_EXTS = {".aif", ".aiff", ".m4a", ".mp3", ".wav", ".caf", ".aac", ".flac", ".ogg"}
OVERVIEW_EXTS = {".ovw"}
IMPORT_EXTS = {".m4a", ".mp3"}
RECORDED_EXTS = {".aif", ".aiff", ".wav"}
SKIP_DIR_NAMES = {"Project File Backups"}
SKIP_DIR_SUFFIXES = (".logic",)

SILENCE_SR = 16000
SILENCE_FRAME_MS = 50
SILENCE_FLOOR_DB = -50.0
SILENT_FRACTION = 0.95
MIN_DURATION_S = 3.0

SOURCE_GROUPS = ("garageband", "logic", "ahmed_collection")
# Order in which identical files are ranked: the first copy survives, later
# copies become ``duplicate``. The collection ranks first (see the docstring).
CANONICAL_RANK = ("ahmed_collection", "garageband", "logic")
LOCATIONS = ("Media", "Output", "Audio Files", "Bounces", "loose")
ROLES = ("mixdown", "take", "import", "stem", "song")
EXCLUDE_REASONS = ("apple_loop", "overview_cache", "silent", "unreadable", "duplicate")

# Apple factory-loop vocabulary: a stem made of these words plus a two-digit
# loop index, optionally with Logic's "_N" re-import suffix. Only used for
# non-.caf files (every .caf is excluded outright, see the module docstring).
APPLE_LOOP_WORDS = (
    "Cartoon", "80s Dance", "Club Dance", "Edgy Rock", "Funky Electric", "Old School Funk",
    "Shaker", "Comedy Drum", "Drum Kit", "Synth", "Loop", "Vintage", "Modern", "Classic Rock",
    "Hip Hop", "Trance", "Techno", "Dubstep", "Latin", "World",
)
APPLE_LOOP_NAME = re.compile(
    r"^(?:" + "|".join(re.escape(w) for w in APPLE_LOOP_WORDS) + r")\b[\w '\-]*?\s\d{2,3}(?:_\d+)?$",
    re.IGNORECASE,
)

TAKE_MARKER = re.compile(r"#(\d+)")
TRAILING_TAKE = re.compile(r"[ _](\d{1,2})$")
IMPORT_NAME = re.compile(r"^\d{1,2}\s+\S")
# Name tokens that mark a mixdown; the doc quotes this tuple, the regex is built from it.
MIXDOWN_WORD_LIST = ("mix", "mixed", "mixdown", "final", "finalized", "last", "bounce", "bip", "mul")
MIXDOWN_WORDS = re.compile(r"(?<![a-z])(" + "|".join(MIXDOWN_WORD_LIST) + r")(?![a-z])")


@dataclass(frozen=True)
class FileRef:
    """A file found by the walk, with its provenance already resolved."""

    path: Path
    source_group: str
    project: str
    project_kind: str
    location: str


def rel(path: Path) -> str:
    """Repo-relative POSIX path (absolute when the file lies outside the repo)."""
    try:
        return path.resolve().relative_to(REPO).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def abs_path(path_str: str) -> Path:
    """Inverse of ``rel``: absolute path for a row's ``path`` field."""
    p = Path(path_str)
    return p if p.is_absolute() else REPO / p


def source_group_for_root(root: Path) -> str:
    """garageband | logic | ahmed_collection, from the root's name, else its contents."""
    low = root.name.lower()
    if low == "garageband":
        return "garageband"
    if low == "logic":
        return "logic"
    if any(p.is_dir() and p.suffix.lower() == ".band" for p in root.iterdir()):
        return "garageband"
    if any(p.is_dir() and ((p / "Audio Files").is_dir() or (p / "Bounces").is_dir()) for p in root.iterdir()):
        return "logic"
    return "ahmed_collection"


def take_number(name: str) -> int | None:
    """Take index from ``#NN`` / ``_N#NN`` markers, else a trailing `` 2`` / ``_2``.

    Trailing numbers are limited to one or two digits so BPM / key tokens such
    as ``runbaa hoos 100`` are not read as takes.
    """
    stem = Path(name).stem
    m = TAKE_MARKER.search(stem)
    if m:
        return int(m.group(1))
    m = TRAILING_TAKE.search(stem)
    if m:
        return int(m.group(1))
    return None


def is_apple_loop(name: str) -> bool:
    ext = Path(name).suffix.lower()
    if ext == ".caf":
        return True
    stem = Path(name).stem
    if "#" in stem:
        return False
    return bool(APPLE_LOOP_NAME.match(stem))


def is_import_name(location: str, name: str) -> bool:
    """A track-numbered ``NN title.m4a``/``.mp3`` under Media or Audio Files."""
    return (location in ("Media", "Audio Files") and Path(name).suffix.lower() in IMPORT_EXTS
            and bool(IMPORT_NAME.match(Path(name).stem)))


def role_guess(location: str, name: str) -> str:
    """See the module docstring; location wins, then import, mixdown words, take marker."""
    stem = Path(name).stem.lower()
    if location in ("Output", "Bounces"):
        return "mixdown"
    if is_import_name(location, name):
        return "import"
    if "output 1-2" in stem or MIXDOWN_WORDS.search(stem):
        return "mixdown"
    if TAKE_MARKER.search(stem):
        return "take"
    if location in ("Media", "Audio Files"):
        return "stem"
    return "song"


def resolve_ref(root: Path, source_group: str, path: Path) -> FileRef | None:
    """Project / kind / location for a file under ``root``; None when the file
    lives inside a Logic project bundle or its backups (provenance only)."""
    parts = path.relative_to(root).parts
    for part in parts[:-1]:
        if part in SKIP_DIR_NAMES or part.lower().endswith(SKIP_DIR_SUFFIXES):
            return None
    if source_group == "garageband" and len(parts) >= 2 and parts[0].lower().endswith(".band"):
        project = parts[0][: -len(".band")]
        sub = parts[1] if len(parts) >= 3 else ""
        location = sub if sub in ("Media", "Output") else "loose"
        return FileRef(path, source_group, project, "band", location)
    if source_group == "logic" and len(parts) >= 2:
        sub = parts[1] if len(parts) >= 3 else ""
        location = sub if sub in ("Audio Files", "Bounces") else "loose"
        return FileRef(path, source_group, parts[0], "logic", location)
    if len(parts) >= 2:
        return FileRef(path, source_group, parts[0], "loose", "loose")
    return FileRef(path, source_group, path.stem, "loose", "loose")


def walk(root: Path, source_group: str) -> list[FileRef]:
    refs: list[FileRef] = []
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.name.startswith("._") or p.name == ".DS_Store":
            continue
        if p.suffix.lower() not in AUDIO_EXTS | OVERVIEW_EXTS:
            continue
        ref = resolve_ref(root, source_group, p)
        if ref is not None:
            refs.append(ref)
    return refs


def ffprobe_meta(path: Path) -> dict:
    """duration_s / sample_rate / channels / codec via ``ffprobe -of json``; {} on failure."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
             "stream=sample_rate,channels,codec_name:format=duration", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=120,
        )
        d = json.loads(out.stdout or "{}")
    except (subprocess.SubprocessError, json.JSONDecodeError, OSError):
        return {}
    s = (d.get("streams") or [{}])[0]
    f = d.get("format") or {}
    return {
        "duration_s": round(float(f.get("duration", 0) or 0), 3),
        "sample_rate": int(s.get("sample_rate", 0) or 0),
        "channels": int(s.get("channels", 0) or 0),
        "codec": s.get("codec_name"),
    }


def decode_mono16(path: Path) -> np.ndarray:
    """Whole file as 16 kHz mono float32 in one ffmpeg pass (empty array on failure)."""
    try:
        out = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SILENCE_SR), "-f", "f32le", "-"],
            capture_output=True, timeout=900,
        )
    except (subprocess.SubprocessError, OSError):
        return np.zeros(0, dtype=np.float32)
    return np.frombuffer(out.stdout, dtype=np.float32).copy()


def silence_fraction(audio: np.ndarray, sr: int = SILENCE_SR, frame_ms: int = SILENCE_FRAME_MS,
                     floor_db: float = SILENCE_FLOOR_DB) -> float:
    """Fraction of ``frame_ms`` frames whose RMS is below ``floor_db`` dBFS."""
    frame = max(1, int(sr * frame_ms / 1000))
    n = audio.size // frame
    if n == 0:
        return 1.0
    frames = audio[: n * frame].reshape(n, frame).astype(np.float64)
    rms = np.sqrt(np.mean(frames ** 2, axis=1))
    db = 20.0 * np.log10(rms + 1e-12)
    return float(np.mean(db < floor_db))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


CACHED_FIELDS = ("sha256", "duration_s", "sample_rate", "channels", "codec", "silence_fraction", "probe_error")


def measure(ref: FileRef, cached: dict | None) -> dict:
    """Per-file facts: stat, sha256, probe, silence. Reuses ``cached`` when the
    path, size and mtime match (resume); set-level fields are added later."""
    st = ref.path.stat()
    mtime_iso = datetime.fromtimestamp(st.st_mtime, tz=UTC).isoformat(timespec="seconds")
    row: dict = {
        "path": rel(ref.path),
        "source_group": ref.source_group,
        "project": ref.project,
        "project_kind": ref.project_kind,
        "location": ref.location,
        "name": ref.path.name,
        "ext": ref.path.suffix.lower(),
        "take_number": take_number(ref.path.name),
        "position": None,
        "mtime_iso": mtime_iso,
        "bytes": st.st_size,
    }
    if cached and cached.get("bytes") == st.st_size and cached.get("mtime_iso") == mtime_iso and cached.get("sha256"):
        for k in CACHED_FIELDS:
            row[k] = cached.get(k)
        return row
    row["sha256"] = sha256_file(ref.path)
    if row["ext"] in OVERVIEW_EXTS:
        row.update({"duration_s": 0.0, "sample_rate": 0, "channels": 0, "codec": None,
                    "silence_fraction": None, "probe_error": None})
        return row
    meta = ffprobe_meta(ref.path)
    row.update({"duration_s": meta.get("duration_s", 0.0), "sample_rate": meta.get("sample_rate", 0),
                "channels": meta.get("channels", 0), "codec": meta.get("codec")})
    if not meta or not meta.get("duration_s"):
        row.update({"silence_fraction": None, "probe_error": "ffprobe: no audio stream or zero duration"})
        return row
    audio = decode_mono16(ref.path)
    if audio.size == 0:
        row.update({"silence_fraction": None, "probe_error": "ffmpeg: decode produced no samples"})
        return row
    row.update({"silence_fraction": round(silence_fraction(audio), 4), "probe_error": None})
    return row


def exclusion(row: dict) -> tuple[bool, str | None]:
    """(excluded, reason) for one row, before duplicate marking."""
    if row["ext"] in OVERVIEW_EXTS:
        return True, "overview_cache"
    if row.get("probe_error") or not row.get("duration_s"):
        return True, "unreadable"
    if is_apple_loop(row["name"]):
        return True, "apple_loop"
    if row.get("is_silent"):
        return True, "silent"
    return False, None


def canonical_key(row: dict) -> tuple:
    return (CANONICAL_RANK.index(row["source_group"]), row["project"].lower(), row["name"].lower(),
            row["mtime_iso"], row["path"])


def finalize(rows: list[dict]) -> list[dict]:
    """Sort canonically, then add position, is_silent, role_guess, duplicates and exclusions."""
    rows = sorted(rows, key=canonical_key)
    by_project: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        by_project.setdefault((r["source_group"], r["project"]), []).append(r)
    for members in by_project.values():
        for i, r in enumerate(sorted(members, key=lambda r: (r["name"].lower(), r["mtime_iso"])), 1):
            r["position"] = i
    seen: dict[str, dict] = {}
    for r in rows:
        dur = r.get("duration_s") or 0.0
        sf = r.get("silence_fraction")
        r["is_silent"] = bool((sf is not None and sf > SILENT_FRACTION) or (r["ext"] not in OVERVIEW_EXTS and dur < MIN_DURATION_S))
        r["role_guess"] = role_guess(r["location"], r["name"])
        excluded, reason = exclusion(r)
        first = seen.get(r["sha256"])
        r["also_in"] = []
        if first is None:
            seen[r["sha256"]] = r
            r["dup_of"], r["dup_of_path"] = None, None
        else:
            r["dup_of"], r["dup_of_path"] = first["sha256"], first["path"]
            first["also_in"].append(r["path"])
            if not excluded:
                excluded, reason = True, "duplicate"
        r["excluded"], r["exclude_reason"] = excluded, reason
    return rows


def summarize(rows: list[dict]) -> dict:
    def block(sub: list[dict]) -> dict:
        readable = [r for r in sub if r.get("duration_s")]
        uniq: dict[str, float] = {}
        for r in readable:
            uniq.setdefault(r["sha256"], r["duration_s"])
        kept = [r for r in sub if not r["excluded"]]
        reasons: dict[str, int] = {}
        for r in sub:
            if r["excluded"]:
                reasons[r["exclude_reason"]] = reasons.get(r["exclude_reason"], 0) + 1
        return {
            "files": len(sub),
            "unique_by_sha": len({r["sha256"] for r in sub}),
            "hours_total": round(sum(r["duration_s"] for r in readable) / 3600, 2),
            "hours_unique": round(sum(uniq.values()) / 3600, 2),
            "hours_kept": round(sum(r["duration_s"] for r in kept) / 3600, 2),
            "excluded": dict(sorted(reasons.items())),
        }

    out = {"all": block(rows)}
    for g in SOURCE_GROUPS:
        sub = [r for r in rows if r["source_group"] == g]
        if sub:
            out[g] = block(sub)
    return out


def load_existing(out: Path) -> dict[str, dict]:
    """Rows of ``out`` keyed by path. A malformed line is skipped (printed and
    counted) so that file is simply measured again; a row without a path is skipped too."""
    if not out.exists():
        return {}
    rows: dict[str, dict] = {}
    bad = 0
    for n, line in enumerate(out.read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError as exc:
            bad += 1
            print(f"  skip malformed line {n} of {out.name}: {exc}", flush=True)
            continue
        if not isinstance(r, dict) or not r.get("path"):
            bad += 1
            continue
        rows[str(r["path"])] = r
    if bad:
        print(f"  {bad} unusable line(s) in {out.name} ignored; those files are re-measured", flush=True)
    return rows


def write_jsonl(out: Path, rows: list[dict]) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(out.suffix + ".tmp")
    tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    os.replace(tmp, out)


def collect(roots: list[Path], limit: int = 0) -> list[FileRef]:
    refs: list[FileRef] = []
    for root in roots:
        if not root.is_dir():
            print(f"skip {root}: not a directory", flush=True)
            continue
        group = source_group_for_root(root)
        found = walk(root, group)
        print(f"{root}: {len(found)} audio files ({group})", flush=True)
        refs.extend(found)
    refs.sort(key=lambda r: (CANONICAL_RANK.index(r.source_group), r.project.lower(), r.path.name.lower(), str(r.path)))
    return refs[:limit] if limit else refs


def is_under(path: Path, roots: list[Path]) -> bool:
    return any(path.is_relative_to(root) for root in roots)


def merge_cached(cache: dict[str, dict], walked: set[str], walked_roots: list[Path]) -> tuple[list[dict], int]:
    """Cached rows for files not walked this run, minus those whose root was walked
    and whose file is gone. Returns (rows to keep, number dropped)."""
    keep: list[dict] = []
    dropped = 0
    for path, row in cache.items():
        if path in walked:
            continue
        p = abs_path(path)
        if is_under(p, walked_roots) and not p.exists():
            dropped += 1
            continue
        keep.append(row)
    return keep, dropped


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--roots", nargs="*", default=list(DEFAULT_ROOTS), help="directories to walk (repo-relative or absolute)")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--limit", type=int, default=0, help="measure only the first N audio files (smoke); merged into --out")
    ap.add_argument("--no-resume", action="store_true", help="ignore rows already in --out (rebuild; refuses to shrink it)")
    args = ap.parse_args()

    roots = [(REPO / r) if not Path(r).is_absolute() else Path(r) for r in args.roots]
    out = (REPO / args.out) if not Path(args.out).is_absolute() else Path(args.out)
    existing = load_existing(out)
    cache = {} if args.no_resume else existing
    refs = collect(roots, args.limit)
    walked_roots = [r.resolve() for r in roots if r.is_dir()]
    print(f"{len(refs)} files to inventory ({len(existing)} rows already in {rel(out)})", flush=True)
    if args.limit:
        print(f"  --limit {args.limit}: a subset run; rows already in {rel(out)} for other files are kept as they are", flush=True)

    rows: list[dict] = []
    t0 = time.time()
    reused = 0
    for i, ref in enumerate(refs, 1):
        cached = cache.get(rel(ref.path))
        try:
            row = measure(ref, cached)
        except Exception as exc:  # keep going; the row records the failure
            row = measure_failed(ref, exc)
        reused += int(cached is not None and cached.get("bytes") == row["bytes"] and cached.get("mtime_iso") == row["mtime_iso"])
        rows.append(row)
        if i % 50 == 0 or i == len(refs):
            print(f"  {i}/{len(refs)} measured ({time.time() - t0:.0f}s, {reused} reused)", flush=True)
    merged, dropped = merge_cached(cache, {r["path"] for r in rows}, walked_roots)
    if merged or dropped:
        print(f"  merged {len(merged)} cached rows not walked this run; dropped {dropped} whose file is gone", flush=True)
    rows.extend(merged)
    if not rows:
        raise SystemExit(f"nothing to write: no audio under the roots and no cached rows; {rel(out)} left untouched")
    if len(rows) < len(existing) and args.no_resume:
        raise SystemExit(f"refusing to shrink {rel(out)} from {len(existing)} to {len(rows)} rows under --no-resume: "
                         "pass another --out for a subset run, or delete the file to rebuild it from scratch")
    rows = finalize(rows)
    write_jsonl(out, rows)
    summary = summarize(rows)
    summary["elapsed_s"] = round(time.time() - t0, 1)
    summary["out"] = rel(out)
    summary["measured"] = len(refs)
    summary["merged_cached"] = len(merged)
    summary["dropped_gone"] = dropped
    print(json.dumps(summary, indent=2))


def measure_failed(ref: FileRef, exc: Exception) -> dict:
    st = ref.path.stat()
    return {
        "path": rel(ref.path), "source_group": ref.source_group, "project": ref.project,
        "project_kind": ref.project_kind, "location": ref.location, "name": ref.path.name,
        "ext": ref.path.suffix.lower(), "take_number": take_number(ref.path.name), "position": None,
        "mtime_iso": datetime.fromtimestamp(st.st_mtime, tz=UTC).isoformat(timespec="seconds"),
        "bytes": st.st_size, "sha256": f"error:{rel(ref.path)}", "duration_s": 0.0, "sample_rate": 0,
        "channels": 0, "codec": None, "silence_fraction": None, "probe_error": repr(exc),
    }


if __name__ == "__main__":
    main()
