"""Build the Stage 2 training sets and merge their captions into run captions.

Four sets, one directory each under data/sets/<set>/:

  ahmed_oud     classified Ahmed rows with content == "oud" (recorded takes,
                imports and the oud_ilkacase collection), default genre qaraami
  ahmed_mix     content == "full_mix" plus every ahmed_collection file whose
                name contains "mixed" (the vocal mixes of the collection; those
                files belong to ahmed_mix only and are skipped by the other two
                sets with reason "collection_mix", whatever the classifier says)
  ahmed_vocal   content == "voice" (cod takes)
  harvard_full  every manifest row with status fetched|legacy whose file is on
                disk, minus superseded whole-cassette-side legacy files and
                exact sha256 duplicates (research-only, never served)

Every set is cut exactly like scripts/build_scale_dataset.py (30 s windows,
50 % overlap, whole-file peak normalisation, clips QUIET_DROP_DB under the
file RMS dropped, TARGET_LUFS, tonic via scripts.pentatonic.detect_from_audio,
tempo via build_scale_dataset.tempo_bpm); the helpers are imported, not
copied. Two guards that build_scale_dataset lacks: a source whose
pre-normalisation RMS is under SILENT_RMS_DBFS (an armed but unplayed take, a
noise floor) is skipped as "silent_source" instead of being amplified into
captioned noise, and a clip whose integrated loudness is not finite is dropped.

Captions follow the Stage 2 template:

  "<genre>, Somali traditional song, led by <instruments>, <tempo-word> at
   <N> BPM, pentatonic melody rooted on <tonic>, <recording tag>
   [, performed by Ahmed Ilkacase]"

where <genre> is the first genre word (by position) in the project/bundle
name and then the file name (Harvard: the catalog title, then the cassette
title), mapped to {qaraami, balwo, heello, dhaanto, buraanbur}; without a
genre word the set default applies (ahmed_oud -> "qaraami", the others ->
"Somali song", which also drops the "Somali traditional song" phrase). Genre
words match at a word start and may carry Somali suffixes ("Qaraamiga"), but
the short heello variants "heele"/"hele" only as whole words, so the
interjection "Heeleelooy" is not a genre. Instruments come from the content
label ("oud" -> the oud (kaban), "voice" -> vocals, "full_mix" -> vocals, the
oud (kaban) and hand drums), with "hand drums" added when percussive_ratio >=
0.35; a classifier "instruments" list on the row overrides the default. Ahmed
sets carry "studio recording, clean" and "performed by Ahmed Ilkacase";
harvard_full carries "vintage cassette" and never a performer name (nor does
any row field: an unknown Harvard cassette gives project "AWM SC unknown
(<cid>)", never the cassette title).

Splits are song-level (build_scale_dataset.song_splits ratios) applied to the
sorted (sha256-hashed, so cassette and name order do not cluster) group keys
of a split universe, so every file of one song_group (takes, mixdowns, key
variants) lands in the same split. The universe is larger than the set on
purpose: for the Ahmed sets it is every non-excluded row of the classified
inventory (so ahmed_oud, ahmed_mix and ahmed_vocal agree on the split of each
song and can be merged), for harvard_full it is every Item|Track object of the
finding aid (so the split of a track is fixed before the fetch job has
downloaded it). A leakage check asserts that no song_sha256 and no song_group
appears in two splits and prints "LEAKAGE CHECK PASSED".

Classified inventory rows (data/inventory/ahmed_classified.jsonl, one JSON per
line) are read with these keys: path (absolute or repo-relative), name,
sha256 (full; computed from the file when absent), content (oud | voice |
full_mix | ...), excluded / exclude_reason (truthy = skip), song_group,
percussive_ratio, source_group ("ahmed_collection" for the oud_ilkacase
files), project, optional instruments (list). Audio is read only under
data/ahmed_raw and data/raw_incoming/oud_ilkacase (Ahmed) and data/harvard_raw
(Harvard); anything else is skipped with reason "outside_roots".

Harvard: the manifest is read as it is at build time, so harvard_full can be
rebuilt while the fetch job is still adding files; a later rebuild picks up
the new rows and, being resumable, only cuts what is new (a song whose split
moved has its clips renamed). Whole-cassette-side objects are recognised by
the manifest/catalog type: Item = whole side, Track = single track (the
finding aid titles tracks "Side A. Track 1: ...", "Side A: Track 4: ...",
"[Side B. Track 1: ...], 1963" or "Side A. (Songs of ...) Track 2: ...", so
the title alone is not trusted); a Track row that carries its own "AWM SC"
container and no track-like title is a mis-typed cassette, and a row without
any type falls back to the title. A whole side is a superset of the track
files of the same cassette and is excluded whenever a fetched track row -- or
a legacy track row -- shares its cassette number.

Outputs per set: clips/{train,val,test}/<set>_<sha12>_segNNN.wav,
captions.jsonl (clip_path, caption, song_sha256, song_group, split, source,
source_name, source_path, rights, content, project, tokens_dir, seconds,
caption_version[, chroma_dir]) and SET_CARD.md. Resumable: a source whose
clips and caption rows already exist with the same --seconds and caption
template version is reused; otherwise it is re-cut. A --limit run is partial:
the caption rows of the sources it did not process are kept as they are. A
full run drops the rows of sources no longer selected; clip files that no
caption row references are reported as orphans (and deleted only with
--prune-orphans). --out-root must lie under <repo>/data unless
--allow-outside-data is passed (for synthesised fixtures only): cut audio of
the corpus never leaves data/.

Usage (from apps/ai-service):
  python -m scripts.build_sets --set ahmed_oud [--classified data/inventory/ahmed_classified.jsonl]
      [--out-root data/sets] [--seconds 30] [--limit N] [--dry-run] [--prune-orphans]
  python -m scripts.build_sets --set harvard_full [--harvard-manifest data/harvard_raw/manifest.jsonl]
      [--harvard-catalog data/harvard_catalog/mus00044.csv]
  python -m scripts.build_sets --merge ahmed_all --sets ahmed_oud ahmed_mix ahmed_vocal \\
      --out data/sets/ahmed_all_captions.jsonl
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

from scripts.build_scale_dataset import (
    PEAK,
    QUIET_DROP_DB,
    SR,
    TARGET_LUFS,
    decode_mono32,
    song_splits,
    tempo_bpm,
    tempo_word,
)
from scripts.pentatonic import detect_from_audio

REPO = Path(__file__).resolve().parents[3]

SETS = ("ahmed_oud", "ahmed_mix", "ahmed_vocal", "harvard_full")
AHMED_SETS = ("ahmed_oud", "ahmed_mix", "ahmed_vocal")
SET_CONTENT = {"ahmed_oud": "oud", "ahmed_mix": "full_mix", "ahmed_vocal": "voice"}
SPLITS = ("train", "val", "test")

DEFAULT_CLASSIFIED = "data/inventory/ahmed_classified.jsonl"
DEFAULT_MANIFEST = "data/harvard_raw/manifest.jsonl"
DEFAULT_CATALOG = "data/harvard_catalog/mus00044.csv"
DEFAULT_OUT_ROOT = "data/sets"
DATA_DIR = "data"
AHMED_ROOTS = ("data/ahmed_raw", "data/raw_incoming/oud_ilkacase")
HARVARD_ROOTS = ("data/harvard_raw",)

RIGHTS_AHMED = "ahmed_ilkacase_consented"
RIGHTS_HARVARD = "harvard_research_only"
PERFORMER_AHMED = "Ahmed Ilkacase"
RECORDING_TAG_AHMED = "studio recording, clean"
RECORDING_TAG_HARVARD = "vintage cassette"
TRADITION = "Somali traditional song"
CAPTION_VERSION = 1
"""Bump when the caption template changes: rows built with another version are re-cut, not resumed."""
GENRE_DEFAULT = {
    "ahmed_oud": "qaraami",
    "ahmed_mix": "Somali song",
    "ahmed_vocal": "Somali song",
    "harvard_full": "Somali song",
}
GENRE_MAP = {
    "qaraami": "qaraami", "qarami": "qaraami",
    "balwo": "balwo",
    "heello": "heello", "heelo": "heello", "heele": "heello", "hele": "heello",
    "dhaanto": "dhaanto", "dhanto": "dhaanto",
    "buraanbur": "buraanbur",
}
GENRE_STEMS = ("qaraami", "qarami", "balwo", "heello", "heelo", "dhaanto", "dhanto", "buraanbur")
"""Genre words that may carry a Somali suffix (Qaraamiga, Dhaantada, Buraanburka)."""
GENRE_WHOLE_WORDS = ("heele", "hele")
"""Short heello variants: whole words only, so 'Heeleelooy' (an interjection) is not a genre."""
GENRE_RE = re.compile(
    r"(?<![a-z])(?:(?P<stem>" + "|".join(sorted(map(re.escape, GENRE_STEMS), key=len, reverse=True)) + r")[a-z]*"
    r"|(?P<whole>" + "|".join(sorted(map(re.escape, GENRE_WHOLE_WORDS), key=len, reverse=True)) + r")(?![a-z]))"
)
INSTRUMENT_PHRASE = {
    "oud": "the oud (kaban)", "kaban": "the oud (kaban)",
    "voice": "vocals", "vocal": "vocals", "vocals": "vocals",
    "drums": "hand drums", "drum": "hand drums", "percussion": "hand drums", "hand drums": "hand drums",
}
FULL_MIX_INSTRUMENTS = ("vocals", "the oud (kaban)", "hand drums")
PERCUSSIVE_MIN = 0.35
SILENT_RMS_DBFS = -40.0
"""A source whose whole-file RMS (before peak normalisation) is under this is skipped as silent."""

TRACK_TITLE_RE = re.compile(r"^\s*\[?\s*Side\s+\S+.*?\bTrack\s+\[?\d+", re.I)
"""A finding-aid track title: "Side A. Track 1: X", "Side A: Track 4: X", "[Side B. Track 1: X], 1963",
"Side B. Track [6?]: X", "Side A. (Songs of ...) Track 2: X", "Side A: <performer>. Track 3: X"."""
SIDE_TRACK_RE = TRACK_TITLE_RE  # earlier name, kept for importers
CASSETTE_RE = re.compile(r"AWM\s*SC\s*(\d+)", re.I)
SEG_RE = re.compile(r"_seg(\d{3})\.wav$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")


# ---------------------------------------------------------------------------
# Source records
# ---------------------------------------------------------------------------


@dataclass
class SourceFile:
    """One source recording selected for a set (song identity = full sha256)."""

    set_name: str
    path: Path
    name: str
    sha256: str
    song_group: str
    project: str
    content: str
    rights: str
    genre_text: str
    percussive_ratio: float | None = None
    instruments: list[str] | None = None
    duration_s: float | None = None
    extra: dict = field(default_factory=dict)

    @property
    def sha12(self) -> str:
        return self.sha256[:12]


@dataclass
class Selection:
    """Files chosen for a set, the reasons others were skipped, and the split universe."""

    files: list[SourceFile]
    skipped: Counter
    universe: set[str]


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def full_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def rel_str(path: Path, root: Path) -> str:
    """Repo-relative posix path when inside root, else the absolute path."""
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def is_under(path: Path, roots: Iterable[Path]) -> bool:
    resolved = path.resolve()
    for root in roots:
        try:
            resolved.relative_to(root.resolve())
            return True
        except ValueError:
            continue
    return False


def resolve_path(raw: str, root: Path) -> Path:
    p = Path(raw).expanduser()
    return p if p.is_absolute() else root / p


def row_excluded(row: dict) -> bool:
    if row.get("excluded") or row.get("exclude"):
        return True
    if row.get("exclude_reason"):
        return True
    return str(row.get("status", "")).lower() == "excluded"


def row_sha256(row: dict, path: Path | None) -> str:
    sha = str(row.get("sha256") or row.get("sha") or "").lower()
    if SHA_RE.match(sha):
        return sha
    if path is None or not path.exists():
        raise FileNotFoundError(f"no sha256 on the row and no file to hash: {row.get('name')}")
    return full_sha256(path)


def group_key(row: dict) -> str:
    """Song-group key of a classified row: song_group, else the file's own identity."""
    for key in ("song_group", "sha256", "sha", "sha256_16"):
        val = row.get(key)
        if val:
            return str(val)
    return str(row.get("name") or row.get("path") or "")


def ahmed_project(row: dict, path: Path, root: Path) -> str:
    if row.get("project"):
        return str(row["project"])
    rel = rel_str(path, root)
    parts = Path(rel).parts
    if "GarageBand" in parts:
        return parts[parts.index("GarageBand") + 1].removesuffix(".band")
    if "Logic" in parts:
        return parts[parts.index("Logic") + 1]
    if "oud_ilkacase" in parts:
        return "ahmed_collection"
    return Path(rel).parent.name


def ahmed_source_group(row: dict, path: Path, root: Path) -> str:
    if row.get("source_group"):
        return str(row["source_group"])
    return "ahmed_collection" if "oud_ilkacase" in Path(rel_str(path, root)).parts else "ahmed_sessions"


def select_ahmed(rows: list[dict], set_name: str, root: Path = REPO) -> Selection:
    """Pick the classified rows of one Ahmed set (unique by sha256, sorted by sha).

    A collection file named "..._mixed" belongs to ahmed_mix only: the other
    two sets skip it with reason "collection_mix" even when the classifier
    labelled it oud or voice, so a merged run never holds one song twice with
    two captions."""
    want = SET_CONTENT[set_name]
    roots = [root / r for r in AHMED_ROOTS]
    skipped: Counter = Counter()
    universe: set[str] = set()
    chosen: dict[str, SourceFile] = {}
    for row in rows:
        if row_excluded(row):
            skipped["excluded"] += 1
            continue
        universe.add(group_key(row))
        raw = row.get("path") or ""
        if not raw:
            skipped["no_path"] += 1
            continue
        path = resolve_path(str(raw), root)
        name = str(row.get("name") or path.name)
        if name.lower().endswith(".ovw"):
            skipped["overview_cache"] += 1
            continue
        content = str(row.get("content") or "")
        source_group = ahmed_source_group(row, path, root)
        is_collection_mix = source_group == "ahmed_collection" and "mixed" in name.lower()
        if is_collection_mix:
            if set_name != "ahmed_mix":
                skipped["collection_mix"] += 1
                continue
            content = "full_mix"
        elif content != want:
            skipped[f"content_{content or 'none'}"] += 1
            continue
        if not is_under(path, roots):
            skipped["outside_roots"] += 1
            continue
        if not path.exists():
            skipped["missing_file"] += 1
            continue
        sha = row_sha256(row, path)
        if sha in chosen:
            skipped["duplicate_sha256"] += 1
            continue
        chosen[sha] = SourceFile(
            set_name=set_name, path=path, name=name, sha256=sha, song_group=group_key(row),
            project=ahmed_project(row, path, root), content=content, rights=RIGHTS_AHMED,
            genre_text=f"{ahmed_project(row, path, root)} {name}",
            percussive_ratio=_float_or_none(row.get("percussive_ratio")),
            instruments=list(row["instruments"]) if isinstance(row.get("instruments"), list) else None,
            duration_s=_float_or_none(row.get("duration_s")),
            extra={"source_group": source_group},
        )
    files = [chosen[s] for s in sorted(chosen)]
    return Selection(files=files, skipped=skipped, universe=universe)


def _float_or_none(val: object) -> float | None:
    try:
        return None if val is None else float(val)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Harvard
# ---------------------------------------------------------------------------


def load_catalog(path: Path) -> dict[str, dict]:
    """The finding-aid export keyed by Database Number (header row found by its first cell)."""
    if not path.exists():
        return {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header: list[str] | None = None
        out: dict[str, dict] = {}
        for cells in reader:
            if header is None:
                if cells and cells[0].strip() == "Database Number":
                    header = [c.strip() for c in cells]
                continue
            if not cells or not cells[0].strip():
                continue
            row = dict(zip(header, cells))
            out[cells[0].strip()] = row
    return out


def catalog_cassette(container: str) -> str:
    m = CASSETTE_RE.search(container or "")
    return m.group(1) if m else ""


def harvard_cassette(row: dict, cat: dict | None) -> str:
    return str(row.get("cassette") or catalog_cassette((cat or {}).get("Container Info", "")))


def is_whole_side(row: dict, cat: dict | None) -> bool:
    """True for a cassette-level object (a superset of its cassette's track files).

    The manifest/catalog type decides: Item = whole side, Track = one track.
    A Track row that carries its own "AWM SC" container (Track rows normally
    have none, the container sits on the cassette Item) and whose title is not
    track-like is a mis-typed cassette and counts as a whole side. Without a
    type the title decides: anything that is not "Side X ... Track N"."""
    typ = str(row.get("type") or (cat or {}).get("Component Type") or "")
    title = str(row.get("title") or (cat or {}).get("Component Title") or "")
    track_title = bool(TRACK_TITLE_RE.match(title))
    if typ == "Item":
        return True
    if typ == "Track":
        own_container = bool(catalog_cassette((cat or {}).get("Container Info", "")))
        return own_container and not track_title
    return not track_title


HARVARD_OUD_RE = re.compile(r"\b(kaban|oud|cuud|kabanle)\b", re.IGNORECASE)


def harvard_instruments(text: str) -> list[str]:
    """No classifier runs on the Harvard tracks, so the caption claims only what the
    catalog supports: sung ensemble recordings, with the oud named when the title says so."""
    return ["vocals", "the oud (kaban)"] if HARVARD_OUD_RE.search(text or "") else ["vocals", "ensemble"]


def select_harvard(manifest_rows: list[dict], catalog: dict[str, dict], root: Path = REPO) -> Selection:
    """Fetched + legacy rows on disk, minus superseded whole-side files and sha duplicates."""
    roots = [root / r for r in HARVARD_ROOTS]
    skipped: Counter = Counter()
    eligible: list[tuple[dict, Path, str, bool]] = []
    for row in manifest_rows:
        status = str(row.get("status") or "")
        if status not in ("fetched", "legacy"):
            skipped[f"status_{status or 'none'}"] += 1
            continue
        raw = row.get("file") or ""
        if not raw:
            skipped["no_file"] += 1
            continue
        path = resolve_path(str(raw), root)
        if not is_under(path, roots):
            skipped["outside_roots"] += 1
            continue
        if not path.exists():
            skipped["missing_file"] += 1
            continue
        cat = catalog.get(str(row.get("cid") or ""))
        eligible.append((row, path, harvard_cassette(row, cat), is_whole_side(row, cat)))

    fetched_track_cassettes = {c for r, _, c, whole in eligible if c and not whole and r["status"] == "fetched"}
    legacy_track_cassettes = {c for r, _, c, whole in eligible if c and not whole and r["status"] == "legacy"}
    chosen: dict[str, SourceFile] = {}
    for row, path, cassette, whole in eligible:
        if whole and cassette in fetched_track_cassettes:
            skipped["superseded_by_fetched_tracks"] += 1
            continue
        if whole and cassette in legacy_track_cassettes:
            skipped["superseded_by_legacy_tracks"] += 1
            continue
        sha = row_sha256(row, path)
        if sha in chosen:
            skipped["duplicate_sha256"] += 1
            continue
        cid = str(row.get("cid") or sha)
        title = str(row.get("title") or "")
        parent = str(row.get("parent") or "")  # cassette title, often a performer list: caption text only
        chosen[sha] = SourceFile(
            set_name="harvard_full", path=path, name=path.name, sha256=sha, song_group=cid,
            project=f"AWM SC {cassette}" if cassette else f"AWM SC unknown ({cid})", content="full_mix",
            rights=RIGHTS_HARVARD, genre_text=f"{title} {parent}", instruments=harvard_instruments(f"{title} {parent}"),
            duration_s=_float_or_none(row.get("duration_s")),
            extra={"cid": cid, "status": row["status"], "title": title, "cassette": cassette, "whole_side": whole},
        )
    if catalog:
        universe = {cid for cid, c in catalog.items() if c.get("Component Type") in ("Item", "Track")}
    else:
        universe = {str(r.get("cid")) for r in manifest_rows if r.get("cid")}
    files = [chosen[s] for s in sorted(chosen)]
    return Selection(files=files, skipped=skipped, universe=universe)


# ---------------------------------------------------------------------------
# Splits and leakage
# ---------------------------------------------------------------------------


def group_split_map(universe: Iterable[str]) -> dict[str, str]:
    """Deterministic song_splits ratios over the sorted group keys.

    Keys are sha256-hashed before sorting: catalog ids are sequential and
    project names alphabetical, so sorting them raw would hand whole cassette
    ranges or letter ranges to one split; the hash spreads val/test evenly
    while keeping the assignment a pure function of the key."""
    hashed = {hashlib.sha256(key.encode("utf-8")).hexdigest(): key for key in set(universe)}
    by_hash = song_splits(sorted(hashed))
    return {key: by_hash[h] for h, key in hashed.items()}


def split_ratio_label() -> str:
    """The train/val/test percentages song_splits actually produces (e.g. "80/10/10")."""
    counts = Counter(song_splits([f"{i:03d}" for i in range(100)]).values())
    return "/".join(str(counts.get(s, 0)) for s in SPLITS)


def assign_splits(files: list[SourceFile], universe: Iterable[str] = ()) -> dict[str, str]:
    """sha256 -> split; every file of one song_group shares the group's split."""
    keys = set(universe) | {f.song_group for f in files}
    by_group = group_split_map(keys)
    return {f.sha256: by_group[f.song_group] for f in files}


def find_leakage(rows: Iterable[dict]) -> dict[str, list[str]]:
    """Keys (song_sha256, song_group) that appear in more than one split."""
    seen: dict[str, dict[str, set[str]]] = {"song_sha256": {}, "song_group": {}}
    for r in rows:
        for key in seen:
            val = r.get(key)
            if val:
                seen[key].setdefault(str(val), set()).add(str(r.get("split")))
    return {key: sorted(k for k, s in vals.items() if len(s) > 1) for key, vals in seen.items()}


def assert_no_leakage(rows: Iterable[dict]) -> None:
    leaks = find_leakage(rows)
    total = sum(len(v) for v in leaks.values())
    if total:
        print(json.dumps({"leakage": leaks}, indent=2))
        raise SystemExit(f"LEAKAGE DETECTED: {total} keys in multiple splits")
    print("LEAKAGE CHECK PASSED")


# ---------------------------------------------------------------------------
# Captions
# ---------------------------------------------------------------------------


def detect_genre(text: str) -> str | None:
    """First genre word by position in text, mapped to its canonical spelling.

    Words match at a word start and may carry a suffix ("Qaraamiga"); the
    short variants "heele"/"hele" only as whole words ("Heeleelooy" is not one)."""
    m = GENRE_RE.search(text.lower())
    if not m:
        return None
    return GENRE_MAP[m.group("stem") or m.group("whole")]


def join_phrase(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def instrument_phrase(content: str, percussive_ratio: float | None = None, override: list[str] | None = None) -> str:
    if override:
        parts = [INSTRUMENT_PHRASE.get(str(x).lower(), str(x)) for x in override]
    elif content == "full_mix":
        parts = list(FULL_MIX_INSTRUMENTS)
    elif content in INSTRUMENT_PHRASE:
        parts = [INSTRUMENT_PHRASE[content]]
    else:
        parts = ["ensemble"]
    if percussive_ratio is not None and percussive_ratio >= PERCUSSIVE_MIN and "hand drums" not in parts:
        parts.append("hand drums")
    uniq: list[str] = []
    for p in parts:
        if p not in uniq:
            uniq.append(p)
    return join_phrase(uniq)


def build_caption(src: SourceFile, bpm: float | None, tonic: str | None) -> str:
    """The Stage 2 caption; bpm/tonic None gives the dry-run template with placeholders."""
    genre = detect_genre(src.genre_text) or GENRE_DEFAULT.get(src.set_name, "Somali song")
    harvard = src.set_name == "harvard_full"
    tempo = f"{tempo_word(bpm)} at {round(bpm)} BPM" if bpm is not None else "<tempo-word> at <N> BPM"
    parts = [
        genre,
        TRADITION if genre != "Somali song" else None,
        f"led by {instrument_phrase(src.content, src.percussive_ratio, src.instruments)}",
        tempo,
        f"pentatonic melody rooted on {tonic or '<tonic>'}",
        RECORDING_TAG_HARVARD if harvard else RECORDING_TAG_AHMED,
        None if harvard else f"performed by {PERFORMER_AHMED}",
    ]
    return ", ".join(p for p in parts if p)


def describe_clip(clip: np.ndarray) -> tuple[float, str]:
    """(bpm, tonic) with the same fallbacks as build_scale_dataset."""
    try:
        det = detect_from_audio(clip, SR)
        tonic = str(det["tonic_name"]) if isinstance(det, dict) else str(det)
    except Exception:
        tonic = "A"
    try:
        bpm = tempo_bpm(clip)
    except Exception:
        bpm = 100.0
    return bpm, tonic


# ---------------------------------------------------------------------------
# Cutting
# ---------------------------------------------------------------------------


def window_hop(seconds: float) -> tuple[int, int]:
    """(window, hop) in samples: build_scale_dataset's `win = seconds * SR`, `hop = win // 2`."""
    win = int(seconds * SR)
    return win, win // 2


def rms_dbfs(audio: np.ndarray) -> float:
    """Whole-signal RMS in dBFS (-180 for an empty or all-zero signal)."""
    if audio.size == 0:
        return -180.0
    return float(20 * np.log10(np.sqrt(np.mean(np.asarray(audio, dtype=np.float64) ** 2)) + 1e-9))


def is_silent_source(audio: np.ndarray, floor_dbfs: float = SILENT_RMS_DBFS) -> bool:
    """True when the decoded file (before any normalisation) is silence or a bare noise floor.

    The upstream inventory only flags files whose frames sit under -50 dBFS
    for 95 % of their length; an armed but unplayed take with a -45 dBFS noise
    floor passes that and would be peak-normalised into captioned noise."""
    return rms_dbfs(audio) < floor_dbfs


def cut_clips(audio: np.ndarray, seconds: float, meter: pyln.Meter | None = None) -> Iterator[tuple[int, np.ndarray]]:
    """Yield (segment index, clip) exactly as build_scale_dataset.main cuts a file:
    whole-file peak normalisation, windows of `seconds` with 50 % overlap, clips
    more than QUIET_DROP_DB under the file RMS dropped, TARGET_LUFS, re-limited
    to PEAK. A clip whose integrated loudness is not finite (silence under the
    meter's absolute gate) is dropped instead of written unnormalised."""
    meter = meter or pyln.Meter(SR)
    win, hop = window_hop(seconds)
    audio = np.asarray(audio, dtype=np.float32)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0:
        audio = audio * (PEAK / peak)
    file_rms = rms_dbfs(audio)
    for si, start in enumerate(range(0, max(1, len(audio) - win + 1), hop)):
        clip = audio[start:start + win]
        if clip.shape[0] < win:
            break
        rms = rms_dbfs(clip)
        if rms < file_rms - QUIET_DROP_DB:
            continue
        loud = meter.integrated_loudness(clip.astype(np.float64))
        if not np.isfinite(loud):
            continue
        clip = clip * (10 ** ((TARGET_LUFS - loud) / 20))
        p2 = float(np.max(np.abs(clip)))
        if p2 > PEAK:
            clip = clip * (PEAK / p2)
        yield si, clip.astype(np.float32)


# ---------------------------------------------------------------------------
# Building a set
# ---------------------------------------------------------------------------


def clip_stem(set_name: str, sha256: str, seg: int) -> str:
    return f"{set_name}_{sha256[:12]}_seg{seg:03d}"


def seg_index(clip_path: str) -> int | None:
    m = SEG_RE.search(clip_path)
    return int(m.group(1)) if m else None


def make_row(src: SourceFile, split: str, seg: int, caption: str, set_dir: Path, root: Path, seconds: float) -> dict:
    stem = clip_stem(src.set_name, src.sha256, seg)
    return {
        "clip_path": rel_str(set_dir / "clips" / split / f"{stem}.wav", root),
        "caption": caption,
        "song_sha256": src.sha256,
        "song_group": src.song_group,
        "split": split,
        "source": src.set_name,
        "source_name": src.name,
        "source_path": rel_str(src.path, root),
        "rights": src.rights,
        "content": src.content,
        "project": src.project,
        "tokens_dir": rel_str(set_dir / "tokens", root),
        "seconds": seconds,
        "caption_version": CAPTION_VERSION,
    }


def write_jsonl(path: Path, rows: Iterable[dict]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    os.replace(tmp, path)


def row_is_resumable(old: dict, seconds: float) -> bool:
    """An earlier row can be reused only if it was cut with the same window and caption template."""
    old_seconds = _float_or_none(old.get("seconds"))
    if old_seconds is None or abs(old_seconds - seconds) > 1e-6:
        return False
    return old.get("caption_version") == CAPTION_VERSION


def _resume_rows(
    src: SourceFile, split: str, previous: list[dict], set_dir: Path, root: Path, seconds: float,
) -> list[dict] | None:
    """Reuse earlier rows of this source when every clip is on disk (moving clips whose split changed).

    None (= re-cut) when there are no rows, a row lacks a segment index, was
    cut with another --seconds or caption template version, or its clip is gone."""
    if not previous:
        return None
    rows: list[dict] = []
    for old in sorted(previous, key=lambda r: seg_index(r["clip_path"]) or 0):
        seg = seg_index(old["clip_path"])
        if seg is None or not row_is_resumable(old, seconds):
            return None
        new = make_row(src, split, seg, old["caption"], set_dir, root, seconds)
        old_path = resolve_path(old["clip_path"], root)
        new_path = resolve_path(new["clip_path"], root)
        if not new_path.exists():
            if not old_path.exists():
                return None
            new_path.parent.mkdir(parents=True, exist_ok=True)
            os.replace(old_path, new_path)
        rows.append(new)
    return rows


def _cut_source(
    src: SourceFile, split: str, set_dir: Path, root: Path, seconds: float, meter: pyln.Meter, failed: Counter,
) -> list[dict] | None:
    """Decode, gate and cut one source into clip files + rows; None (counted in `failed`) when it is skipped."""
    try:
        audio = decode_mono32(src.path)
    except (subprocess.CalledProcessError, FileNotFoundError, OSError) as exc:
        failed["decode_error"] += 1
        print(f"decode failed: {src.name}: {exc}", file=sys.stderr, flush=True)
        return None
    if src.duration_s is None:
        src.duration_s = len(audio) / SR
    if is_silent_source(audio):
        failed["silent_source"] += 1
        print(f"silent source skipped ({rms_dbfs(audio):.1f} dBFS RMS): {src.name}", file=sys.stderr, flush=True)
        return None
    src_rows: list[dict] = []
    for seg, clip in cut_clips(audio, seconds, meter):
        bpm, tonic = describe_clip(clip)
        row = make_row(src, split, seg, build_caption(src, bpm, tonic), set_dir, root, seconds)
        sf.write(resolve_path(row["clip_path"], root), clip, SR, subtype="PCM_16")
        src_rows.append(row)
    return src_rows


def find_orphan_clips(set_dir: Path, rows: Iterable[dict], root: Path) -> list[Path]:
    """Clip files under set_dir/clips/<split>/ that no caption row references."""
    referenced = {resolve_path(r["clip_path"], root).resolve() for r in rows}
    orphans: list[Path] = []
    for s in SPLITS:
        for p in sorted((set_dir / "clips" / s).glob("*.wav")):
            if p.resolve() not in referenced:
                orphans.append(p)
    return orphans


def build_set(
    set_name: str,
    selection: Selection,
    out_root: Path,
    seconds: float = 30.0,
    limit: int = 0,
    dry_run: bool = False,
    root: Path = REPO,
    prune_orphans: bool = False,
) -> dict:
    """Cut clips + captions for one set, resumably; returns the JSON summary.

    With `limit` the run is partial: rows of sources outside the first `limit`
    files are kept from the existing captions file untouched. Without it the
    captions file holds exactly the selected sources; clips no row references
    are reported as orphans and deleted only when `prune_orphans` is set."""
    files = selection.files[:limit] if limit else selection.files
    splits = assign_splits(files, selection.universe)
    set_dir = out_root / set_name
    captions_path = set_dir / "captions.jsonl"
    summary: dict = {
        "set": set_name, "files": len(files), "selected_files": len(selection.files),
        "songs": len({f.sha256 for f in files}),
        "groups": len({f.song_group for f in files}), "skipped": dict(selection.skipped),
        "split_universe": len(selection.universe) or len({f.song_group for f in files}),
        "seconds": seconds, "caption_version": CAPTION_VERSION,
        "captions": rel_str(captions_path, root), "dry_run": dry_run,
    }
    if dry_run:
        counts = Counter(splits[f.sha256] for f in files)
        summary["files_per_split"] = {s: counts.get(s, 0) for s in SPLITS}
        summary["preview"] = [
            {"name": f.name, "sha12": f.sha12, "group": f.song_group, "split": splits[f.sha256],
             "content": f.content, "caption": build_caption(f, None, None)}
            for f in files[:10]
        ]
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return summary

    set_dir.mkdir(parents=True, exist_ok=True)
    for s in SPLITS:
        (set_dir / "clips" / s).mkdir(parents=True, exist_ok=True)
    existing_rows = [r for r in load_jsonl(captions_path) if r.get("source") == set_name]
    existing: dict[str, list[dict]] = {}
    for r in existing_rows:
        existing.setdefault(str(r.get("song_sha256")), []).append(r)
    selected_shas = {f.sha256 for f in files}
    # a --limit run must not throw away the rows of the sources it does not touch
    kept_rows = [r for r in existing_rows if str(r.get("song_sha256")) not in selected_shas] if limit else []
    meter = pyln.Meter(SR)
    rows: list[dict] = []
    reused = 0
    failed: Counter = Counter()
    for fi, src in enumerate(files, 1):
        split = splits[src.sha256]
        src_rows = _resume_rows(src, split, existing.get(src.sha256, []), set_dir, root, seconds)
        if src_rows is not None:
            reused += 1
        else:
            src_rows = _cut_source(src, split, set_dir, root, seconds, meter, failed)
        rows.extend(src_rows or [])
        write_jsonl(captions_path, rows + kept_rows)
        if fi % 10 == 0 or fi == len(files):
            print(f"{fi}/{len(files)} files ({len(rows)} clips, {reused} resumed, {sum(failed.values())} skipped)", flush=True)

    all_rows = rows + kept_rows
    write_jsonl(captions_path, all_rows)
    orphans = find_orphan_clips(set_dir, all_rows, root)
    if orphans:
        action = "deleting" if prune_orphans else "left in place (pass --prune-orphans to delete)"
        print(f"{len(orphans)} orphan clip files under {rel_str(set_dir / 'clips', root)}: {action}",
              file=sys.stderr, flush=True)
        if prune_orphans:
            for p in orphans:
                p.unlink()
    summary.update({
        "clips_total": len(all_rows),
        "clips_this_run": len(rows),
        "kept_rows": len(kept_rows),
        "kept_sources": len({str(r.get("song_sha256")) for r in kept_rows}),
        "songs_per_split": {s: len({r["song_sha256"] for r in all_rows if r["split"] == s}) for s in SPLITS},
        "clips_per_split": {s: sum(1 for r in all_rows if r["split"] == s) for s in SPLITS},
        "hours": round(len(all_rows) * seconds / 3600, 2),
        "resumed_files": reused,
        "failed": dict(failed),
        "orphan_clips": len(orphans),
        "orphan_examples": [rel_str(p, root) for p in orphans[:5]],
        "pruned_clips": len(orphans) if prune_orphans else 0,
        "leakage": find_leakage(all_rows),
    })
    write_set_card(set_dir / "SET_CARD.md", summary, all_rows, files)
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    assert_no_leakage(all_rows)
    return summary


def write_set_card(path: Path, summary: dict, rows: list[dict], files: list[SourceFile]) -> None:
    set_name = summary["set"]
    rights = RIGHTS_HARVARD if set_name == "harvard_full" else RIGHTS_AHMED
    rights_line = (
        "Harvard Aryette collection, research-only: never served, never published, never leaves the machine."
        if set_name == "harvard_full"
        else "Ahmed Ilkacase's own sessions, consented for training; an adapter may be published, the audio may not."
    )
    src_hours = sum(f.duration_s or 0.0 for f in files) / 3600
    examples: list[str] = []
    for s in SPLITS:
        for r in rows:
            if r["split"] == s:
                examples.append(f"- `{s}`: {r['caption']}")
                break
    by_content = Counter(f.content for f in files)
    by_genre = Counter(detect_genre(f.genre_text) or GENRE_DEFAULT.get(set_name, "Somali song") for f in files)
    seconds = float(summary["seconds"])
    win, hop = window_hop(seconds)
    overlap_pct = 100.0 * (1 - hop / win) if win else 0.0
    lines = [
        f"# Set card: {set_name}",
        "",
        f"Built {dt.datetime.now().astimezone().isoformat(timespec='seconds')} by `scripts/build_sets.py`.",
        "",
        f"- Rights: `{rights}` — {rights_line}",
        f"- Source files this run: {summary['files']} of {summary.get('selected_files', summary['files'])} selected "
        f"(unique songs by sha256: {summary['songs']}, song groups: {summary['groups']})",
        f"- Source audio: {src_hours:.2f} h (manifest/inventory durations)",
        f"- Clips: {summary.get('clips_total', 0)} × {seconds:g} s = {summary.get('hours', 0)} h "
        f"(this run: {summary.get('clips_this_run', 0)}, kept from the previous build: {summary.get('kept_rows', 0)})",
        f"- Clips per split: {json.dumps(summary.get('clips_per_split', {}))}",
        f"- Songs per split: {json.dumps(summary.get('songs_per_split', {}))}",
        f"- Content labels: {json.dumps(dict(by_content))}",
        f"- Genres (caption): {json.dumps(dict(by_genre))}",
        f"- Skipped at selection: {json.dumps(summary.get('skipped', {}))}",
        f"- Skipped at cut (decode errors, silent sources): {json.dumps(summary.get('failed', {}))}",
        f"- Orphan clip files (no caption row): {summary.get('orphan_clips', 0)} "
        f"(deleted: {summary.get('pruned_clips', 0)})",
        f"- Caption template version: {summary.get('caption_version', CAPTION_VERSION)}",
        "",
        "## Splits",
        "",
        f"Song-level {split_ratio_label()} by `build_scale_dataset.song_splits` over the sorted (sha256-hashed) "
        "song-group keys of the",
        f"split universe ({summary['split_universe']} groups); every take, mixdown or variant of one song shares",
        "the split. Leakage check: no song_sha256 and no song_group in two splits.",
        "",
        "## Caption examples",
        "",
        *(examples or ["- (no clips)"]),
        "",
        "## Notes",
        "",
        f"- Cut like `build_scale_dataset.py`: {seconds:g} s windows, {overlap_pct:.0f} % overlap, "
        f"peak-normalised to {PEAK:g}, clips {QUIET_DROP_DB:g} dB under the file RMS dropped, "
        f"{TARGET_LUFS:g} LUFS; sources under {SILENT_RMS_DBFS:g} dBFS RMS skipped as silent.",
        "- Resumable: sources whose clips and caption rows exist with the same window and caption version are "
        "reused; a song whose split moved has its clips renamed; a `--limit` run keeps the other sources' rows.",
    ]
    if set_name == "harvard_full":
        lines.append("- Built from the manifest as it was at build time; rebuild after the fetch job finishes to pick up new tracks.")
        lines.append("- Whole-cassette-side files (manifest/catalog type Item) are excluded when track files of the same cassette exist (superset leakage).")
    path.write_text("\n".join(lines) + "\n")


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------


def merge_sets(names: list[str], out_root: Path, out_path: Path, root: Path = REPO) -> dict:
    """Concatenate several sets' captions, re-check leakage across the union, write one file.

    A song_sha256 present in more than one set would train the same audio twice
    under two captions, so it is an error (nothing is written)."""
    rows: list[dict] = []
    per_set: dict[str, dict[str, int]] = {}
    for name in names:
        set_rows = load_jsonl(out_root / name / "captions.jsonl")
        if not set_rows:
            raise SystemExit(f"no captions for set {name!r} under {out_root}")
        for r in set_rows:
            r.setdefault("tokens_dir", rel_str(out_root / name / "tokens", root))
        counts = Counter(r["split"] for r in set_rows)
        per_set[name] = {s: counts.get(s, 0) for s in SPLITS}
        rows.extend(set_rows)
    sha_sets: dict[str, set[str]] = {}
    for r in rows:
        sha_sets.setdefault(r["song_sha256"], set()).add(r["source"])
    dup_songs = sorted(s for s, v in sha_sets.items() if len(v) > 1)
    leaks = find_leakage(rows)
    summary = {
        "merge": out_path.stem, "sets": names, "rows": len(rows),
        "per_set": per_set,
        "per_split": {s: sum(1 for r in rows if r["split"] == s) for s in SPLITS},
        "songs": len(sha_sets), "songs_in_several_sets": len(dup_songs),
        "leakage": leaks, "out": rel_str(out_path, root),
    }
    print(json.dumps(summary, indent=2))
    if dup_songs:
        print(json.dumps({"songs_in_several_sets": [
            {"song_sha256": s, "sets": sorted(sha_sets[s])} for s in dup_songs[:20]]}, indent=2))
        raise SystemExit(f"DUPLICATE SONGS ACROSS SETS: {len(dup_songs)} song_sha256 values appear in more than one set")
    assert_no_leakage(rows)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_jsonl(out_path, rows)
    return summary


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--set", choices=SETS, help="build this set")
    mode.add_argument("--merge", metavar="NAME", help="merge several sets' captions into one run captions file")
    ap.add_argument("--classified", default=DEFAULT_CLASSIFIED, help="Ahmed classified inventory (jsonl)")
    ap.add_argument("--harvard-manifest", default=DEFAULT_MANIFEST)
    ap.add_argument("--harvard-catalog", default=DEFAULT_CATALOG, help="finding-aid CSV (split universe + titles)")
    ap.add_argument("--out-root", default=DEFAULT_OUT_ROOT, help=f"must lie under <repo>/{DATA_DIR} (see --allow-outside-data)")
    ap.add_argument("--allow-outside-data", action="store_true",
                    help=f"permit an --out-root outside <repo>/{DATA_DIR}: synthesised fixtures only, never corpus audio")
    ap.add_argument("--seconds", type=float, default=30.0)
    ap.add_argument("--limit", type=int, default=0, help="only the first N selected files (partial run: other rows are kept)")
    ap.add_argument("--dry-run", action="store_true", help="select, split and preview captions without decoding")
    ap.add_argument("--prune-orphans", action="store_true", help="delete clip files under the set that no caption row references")
    ap.add_argument("--sets", nargs="*", default=[], help="--merge: set names to concatenate")
    ap.add_argument("--out", default=None, help="--merge: output captions path")
    args = ap.parse_args(argv)
    out_root = resolve_path(args.out_root, REPO)
    if not is_under(out_root, [REPO / DATA_DIR]) and not args.allow_outside_data:
        ap.error(f"--out-root {out_root} is outside {REPO / DATA_DIR}: cut corpus audio stays under {DATA_DIR}/ "
                 "(pass --allow-outside-data for synthesised fixtures only)")

    if args.merge:
        if not args.sets:
            ap.error("--merge needs --sets a b c")
        out = resolve_path(args.out, REPO) if args.out else out_root / f"{args.merge}_captions.jsonl"
        merge_sets(args.sets, out_root, out, root=REPO)
        return

    if args.set == "harvard_full":
        manifest = load_jsonl(resolve_path(args.harvard_manifest, REPO))
        if not manifest:
            raise SystemExit(f"no manifest rows at {args.harvard_manifest}")
        selection = select_harvard(manifest, load_catalog(resolve_path(args.harvard_catalog, REPO)), root=REPO)
    else:
        classified = load_jsonl(resolve_path(args.classified, REPO))
        if not classified:
            raise SystemExit(f"no classified rows at {args.classified}")
        selection = select_ahmed(classified, args.set, root=REPO)
    if not selection.files:
        raise SystemExit(f"{args.set}: no source files selected (skipped: {dict(selection.skipped)})")
    build_set(args.set, selection, out_root, seconds=args.seconds, limit=args.limit, dry_run=args.dry_run,
              root=REPO, prune_orphans=args.prune_orphans)


if __name__ == "__main__":
    main()
