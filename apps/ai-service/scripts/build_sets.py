"""Build the Stage 2 training sets and merge their captions into run captions.

Sets, one directory each under <out-root>/<set>/ (default data/sets):

  ahmed_oud         classified Ahmed rows with content == "oud" (recorded takes,
                    imports and the oud_ilkacase collection), default genre qaraami
  ahmed_mix         content == "full_mix" plus every ahmed_collection file whose
                    name contains "mixed" (the vocal mixes of the collection; those
                    files belong to ahmed_mix only and are skipped by the other two
                    sets with reason "collection_mix", whatever the classifier says)
  ahmed_vocal       content == "voice" (cod takes)
  harvard_full      every manifest row with status fetched|legacy whose file is on
                    disk, minus superseded whole-cassette-side legacy files and
                    exact sha256 duplicates (research-only, never served)
  sep_oud           Demucs "other" stem (the oud) of every ahmed_mix source whose
  sep_vocal         separation index says oud_present / "vocals" stem where
                    vocals_present; rights follow the mixes (ahmed_ilkacase_consented)
  harvard_sep_oud   the same two stems of the harvard_full sources (research-only)
  harvard_sep_vocal
  <prefix>_oud      generic sets over any --classified inventory whose rows carry a
  <prefix>_mix      "rights" field (internet_cc, contrib_<name>_...): content oud |
  <prefix>_vocal    full_mix | voice as for Ahmed; the set's rights are the rows'
                    rights and a set that mixes tiers is refused. The prefixes
                    ahmed, harvard and sep are reserved for the sets above.

Every set is cut exactly like scripts/build_scale_dataset.py (30 s windows by
default, 50 % overlap, whole-file peak normalisation, clips QUIET_DROP_DB under
the file RMS dropped, TARGET_LUFS, tempo via build_scale_dataset.tempo_bpm);
the helpers are imported, not copied. Two guards that build_scale_dataset
lacks: a source whose pre-normalisation RMS is under SILENT_RMS_DBFS (an armed
but unplayed take, a noise floor) is skipped as "silent_source" instead of
being amplified into captioned noise, and a clip whose integrated loudness is
not finite is dropped. --seconds 10 works end to end: the clip stem then
carries a "_10s" infix (<set>_10s_<sha12>_segNNN) so token and chroma files of
the 10 s build never collide with the 30 s ones, and the SET_CARD names the
duration. Only the 30 s stems have no infix (the sets already built keep their
names).

Captions follow template v2 (docs/data/CAPTION_STYLE_GUIDE.md has the field
order, the vocabulary, one example per set and what is never claimed):

  "<genre>, Somali traditional song, led by <instruments>, <tempo-word> at
   <N> BPM, pentatonic melody rooted on <tonic>[, tuned <k> cents flat|sharp
   of A440], <recording tag>[, performed by <performer>]"

<genre> is the first genre word (by position) in the project/bundle name and
then the file name (Harvard: the catalog title, then the cassette title),
mapped to {qaraami, balwo, heello, dhaanto, buraanbur, shanto}; the Somali
definite forms (Qaraamiga, Dhaantada, Balwada, Heellada, Buraanburka,
Shantada) and the spelling variants qarami / dhanto / heelo / heele / hele
count, the short heello variants only as whole words so the interjection
"Heeleelooy" is not a genre. Without a genre word the set default applies
(ahmed_oud -> "qaraami", every other set -> "Somali song", which also drops
the "Somali traditional song" phrase). Instruments come from the content
label ("oud" -> the oud (kaban), "voice" -> vocals, "full_mix" -> vocals, the
oud (kaban) and hand drums, "sep_oud" -> the oud (kaban) alone, never hand
drums since Demucs removed them, "sep_vocal" -> vocals (unaccompanied)), with
"hand drums" added to a non-stem clip when percussive_ratio >= 0.35; a
classifier "instruments" list on the row overrides the default. The tonic
and the tuning come from scripts.pcs.score_frames on each clip (CREPE f0 ->
pitch-class histogram -> pentatonic correlator), then one answer per song is
taken (song_consensus: the clips vote with their absolute tonic pitch, so a
recording a quarter-tone off A440 no longer reads "C# 48 sharp" on one clip
and "D 48 flat" on the next; the majority cluster's circular mean becomes the
song's tonic and offset). A scored clip is tonic_source "scorer", a clip with
too few voiced frames in a song that has scored clips is "song"; when no clip
of the song scored, every clip keeps its pentatonic.detect_from_audio tonic
("histogram") and no tuning is claimed. The row keeps the clip's own reading
in clip_tonic / clip_tuning_offset_cents. The tuning tag appears only when
|tuning_offset_cents| >= 15. Recording tags:
"studio recording, clean" (Ahmed and contributors), "vintage cassette,
1955–1991" (Harvard), "archival recording" (internet rows with a year < 2000
or no year) or "studio recording" (internet rows with a year >= 2000). The
performer is "Ahmed Ilkacase" for his tier, the row's own "performer" field
for generic sets and never anything for Harvard (nor does any row field name
one: an unknown Harvard cassette gives project "AWM SC unknown (<cid>)").

Splits are song-level (build_scale_dataset.song_splits ratios) applied to the
sorted (sha256-hashed, so cassette and name order do not cluster) group keys
of a split universe, so every file of one song_group (takes, mixdowns, key
variants) lands in the same split. The universe is larger than the set on
purpose: for the Ahmed and sep sets it is every non-excluded row of the
classified inventory (so ahmed_oud, ahmed_mix, ahmed_vocal, sep_oud and
sep_vocal agree on the split of each song and can be merged), for the Harvard
sets it is every Item|Track object of the finding aid (so the split of a
track is fixed before the fetch job has downloaded it). A stem keeps
song_sha256 = its source mix's sha256 and song_group = the mix's group, so a
mix and its stems always share a split; the builder checks that invariant
against the mix set's captions on disk (fatal for a sep set, a warning when
the mix set is rebuilt) and again at merge time. A leakage check asserts that
no song_sha256 and no song_group appears in two splits and prints "LEAKAGE
CHECK PASSED".

Classified inventory rows (data/inventory/ahmed_classified.jsonl, one JSON per
line) are read with these keys: path (absolute or repo-relative), name,
sha256 (full; computed from the file when absent), content (oud | voice |
full_mix | ...), excluded / exclude_reason (truthy = skip), song_group,
percussive_ratio, source_group ("ahmed_collection" for the oud_ilkacase
files), project, optional instruments (list); generic inventories add rights
and optionally year / date / performer. Audio is read only under data/ahmed_raw
and data/raw_incoming/oud_ilkacase (Ahmed), data/harvard_raw (Harvard),
data/separated (stems) and data/ (generic sets); anything else is skipped
with reason "outside_roots".

Separation index (data/separated/index.jsonl, else every
data/separated/<corpus>/<sha12>/stems.json): source_path, source_sha256,
corpus, rights, duration_s, stems {other {rms_dbfs, voiced_fraction, pcs,
tuning_offset_cents, tonic}, vocals {...}}, oud_present, vocals_present and
the stem paths (paths.other_wav / paths.vocals_wav, or other_wav / vocals_wav,
default <corpus>/<sha12>/{other,vocals}.wav). A stem whose source mix is not
in the mix set (excluded, third-party, superseded whole side, missing) is
skipped with reason "source_not_in_mix_set". --dry-run works before the
separation step has run: 0 files and a note.

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

Outputs per set: clips/{train,val,test}/<set>[_<N>s]_<sha12>_segNNN.wav,
captions.jsonl (clip_path, caption, song_sha256, song_group, split, source,
source_name, source_path, rights, content, project, tokens_dir, seconds,
caption_version, tonic, tuning_offset_cents, tonic_source, clip_tonic,
clip_tuning_offset_cents[, stem, mix_path][, third_party_suspect,
third_party_reason][, chroma_dir]) and SET_CARD.md.
Resumable, per source: rows and clips that exist with the same --seconds and
caption template version are reused; clips that exist with the right window
under another caption version (the v1 sets) are re-captioned from the wavs on
disk without decoding or rewriting anything; otherwise the source is re-cut.
A chroma_dir set by scale_chroma --write-chroma-dir survives all three while
its .npy exists. The captions file is rewritten after every source together
with the untouched rows of the sources not yet reached, so an interrupted run
(battery, Ctrl-C) resumes everything but the source in flight. A --limit run
is partial: the caption rows of the sources it did not process are kept as
they are. A full run drops the rows of sources no longer selected; clip files
that no caption row references are reported as orphans (and deleted only with
--prune-orphans). A selected source that yields no clip (shorter than the
window, every window dropped) is counted under "failed" as no_clips_*.
--out-root must lie under <repo>/data unless --allow-outside-data is passed
(for synthesised fixtures only): cut audio of the corpus never leaves data/.
--include-third-party admits the classifier's third_party_suspect rows to the
Ahmed sets: their captions name no performer and their rows carry
third_party_suspect / third_party_reason (the tier stays Ahmed's, as
separate_stems and corpus_report expect; a run trained on such rows should
not be released, see the set card's count).

--merge concatenates sets from one or several out-roots (--out-root repeated,
or --sets entries given as paths to a set directory / captions.jsonl) and
refuses rows of different clip durations unless --allow-mixed-seconds; a song
present in two sets with the same content label is an error (a mix and its
stems, different content, may share a song_sha256).

Usage (from apps/ai-service):
  python -m scripts.build_sets --set ahmed_oud [--classified data/inventory/ahmed_classified.jsonl]
      [--out-root data/sets] [--seconds 30] [--limit N] [--dry-run] [--prune-orphans] [--no-scorer]
  python -m scripts.build_sets --set harvard_full [--harvard-manifest data/harvard_raw/manifest.jsonl]
      [--harvard-catalog data/harvard_catalog/mus00044.csv]
  python -m scripts.build_sets --set sep_oud [--separated data/separated] --dry-run
  python -m scripts.build_sets --set ahmed_oud --seconds 10 --out-root data/sets_10s
  python -m scripts.build_sets --set internet_oud --classified data/inventory/internet_classified.jsonl
  python -m scripts.build_sets --merge ahmed_all --sets ahmed_oud ahmed_mix ahmed_vocal sep_oud \\
      --out data/sets/ahmed_all_captions.jsonl
  python -m scripts.build_sets --merge all_10s --out-root data/sets_10s --out-root data/sets \\
      --sets ahmed_oud data/sets_10s/sep_oud [--allow-mixed-seconds]
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import math
import os
import re
import subprocess
import sys
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

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
from scripts.pentatonic import PC_NAMES, detect_from_audio

if TYPE_CHECKING:  # scripts.pcs pulls in torch + torchcrepe: imported lazily in score_clip
    from scripts.pcs import ClipPCS

REPO = Path(__file__).resolve().parents[3]

AHMED_SETS = ("ahmed_oud", "ahmed_mix", "ahmed_vocal")
SEP_SETS = ("sep_oud", "sep_vocal", "harvard_sep_oud", "harvard_sep_vocal")
HARVARD_SETS = ("harvard_full", "harvard_sep_oud", "harvard_sep_vocal")
SETS = AHMED_SETS + ("harvard_full",) + SEP_SETS
SET_CONTENT = {
    "ahmed_oud": "oud", "ahmed_mix": "full_mix", "ahmed_vocal": "voice",
    "sep_oud": "sep_oud", "sep_vocal": "sep_vocal",
    "harvard_sep_oud": "sep_oud", "harvard_sep_vocal": "sep_vocal",
}
SEP_CONTENT = ("sep_oud", "sep_vocal")
SEP_STEM = {"sep_oud": "other", "sep_vocal": "vocals"}
"""Demucs (htdemucs_ft) source per stem content label: the oud lands in 'other'."""
SEP_PRESENT = {"sep_oud": "oud_present", "sep_vocal": "vocals_present"}
MIX_SET_OF = {"sep_oud": "ahmed_mix", "sep_vocal": "ahmed_mix",
              "harvard_sep_oud": "harvard_full", "harvard_sep_vocal": "harvard_full"}
"""The set whose sources a sep set separates: its captions fix the stems' splits."""
RELATED_SETS = {
    "ahmed_mix": ("sep_oud", "sep_vocal"), "harvard_full": ("harvard_sep_oud", "harvard_sep_vocal"),
    **{sep: (mix,) for sep, mix in MIX_SET_OF.items()},
}
KIND_CONTENT = {"oud": "oud", "mix": "full_mix", "vocal": "voice"}
GENERIC_SET_RE = re.compile(r"^(?P<prefix>[a-z0-9]+(?:_[a-z0-9]+)*)_(?P<kind>oud|mix|vocal)$")
RESERVED_PREFIXES = ("ahmed", "harvard", "sep")
SPLITS = ("train", "val", "test")

DEFAULT_CLASSIFIED = "data/inventory/ahmed_classified.jsonl"
DEFAULT_MANIFEST = "data/harvard_raw/manifest.jsonl"
DEFAULT_CATALOG = "data/harvard_catalog/mus00044.csv"
DEFAULT_SEPARATED = "data/separated"
DEFAULT_OUT_ROOT = "data/sets"
DATA_DIR = "data"
AHMED_ROOTS = ("data/ahmed_raw", "data/raw_incoming/oud_ilkacase")
HARVARD_ROOTS = ("data/harvard_raw",)
DEFAULT_SECONDS = 30.0

RIGHTS_AHMED = "ahmed_ilkacase_consented"
RIGHTS_HARVARD = "harvard_research_only"
RIGHTS_INTERNET_CC = "internet_cc"
RIGHTS_INTERNET_RESEARCH = "internet_research_only"
RIGHTS_CONTRIB_PREFIX = "contrib_"
RIGHTS_UNKNOWN = "unknown"
RIGHTS_LINES = {
    RIGHTS_AHMED: "Ahmed Ilkacase's own sessions, consented for training; an adapter may be published, the audio may not.",
    RIGHTS_HARVARD: "Harvard Aryette collection, research-only: never served, never published, never leaves the machine.",
    RIGHTS_INTERNET_CC: "CC-BY / CC0 / public-domain downloads: train and publish, attribution recorded in the inventory.",
    RIGHTS_INTERNET_RESEARCH: "downloads without an explicit licence: by policy never downloaded; the tier exists for the manifest only.",
}
PERFORMER_AHMED = "Ahmed Ilkacase"
RECORDING_TAG_AHMED = "studio recording, clean"
RECORDING_TAG_HARVARD = "vintage cassette, 1955–1991"
RECORDING_TAG_ARCHIVAL = "archival recording"
RECORDING_TAG_STUDIO = "studio recording"
RECORDING_TAG_CONTRIB = "studio recording, clean"
MODERN_YEAR = 2000
"""An internet row recorded in this year or later is a "studio recording", earlier (or undated) "archival recording"."""
TRADITION = "Somali traditional song"
CAPTION_VERSION = 2
"""Bump when the caption template changes: rows built with another version are re-cut, not resumed."""
TUNING_MIN_CENTS = 15.0
"""The tuning tag is claimed only from this absolute offset (cents from A440)."""
TONIC_CLUSTER_CENTS = 60.0
"""Song consensus: scored clips whose absolute tonic pitch (pitch class × 100 + tuning offset, mod 1200)
lies within this many cents of each other vote together; the two readings of a quarter-tone recording
(C# +48 and D -48, 4 cents apart on that circle) land in one cluster instead of alternating."""
TONIC_SOURCE_SCORER = "scorer"
TONIC_SOURCE_SONG = "song"
TONIC_SOURCE_HISTOGRAM = "histogram"
GENRE_DEFAULT = {
    "ahmed_oud": "qaraami",
    "ahmed_mix": "Somali song",
    "ahmed_vocal": "Somali song",
    "harvard_full": "Somali song",
}
GENRE_MAP = {
    "qaraami": "qaraami", "qarami": "qaraami",
    "balwo": "balwo", "balwad": "balwo",
    "heello": "heello", "heelo": "heello", "heele": "heello", "hele": "heello",
    "heellad": "heello", "heelad": "heello",
    "dhaanto": "dhaanto", "dhanto": "dhaanto", "dhaantad": "dhaanto", "dhantad": "dhaanto",
    "buraanbur": "buraanbur",
    "shanto": "shanto", "shantad": "shanto",
}
GENRE_STEMS = (
    "qaraami", "qarami", "balwo", "balwad", "heello", "heelo", "heellad", "heelad",
    "dhaanto", "dhanto", "dhaantad", "dhantad", "buraanbur", "shanto", "shantad",
)
"""Genre words that may carry a Somali suffix (Qaraamiga, Buraanburka, Shantooyin); the -ad stems are the
definite forms of the -o genres (Dhaantada, Balwada, Heellada, Shantada, also Balwadii / Dhaantadu)."""
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
    "sep_oud": "the oud (kaban)", "sep_vocal": "vocals (unaccompanied)",
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
YEAR_RE = re.compile(r"(?<!\d)(1[89]\d\d|20\d\d)(?!\d)")


# ---------------------------------------------------------------------------
# Set names
# ---------------------------------------------------------------------------


def is_generic_set(set_name: str) -> bool:
    """A "<prefix>_oud|_mix|_vocal" set over a rights-carrying inventory (prefix not reserved)."""
    if set_name in SETS:
        return False
    m = GENERIC_SET_RE.match(set_name)
    return bool(m) and m.group("prefix").split("_")[0] not in RESERVED_PREFIXES


def validate_set_name(set_name: str) -> str:
    """The set name when it is a known set or a well-formed generic one; ValueError otherwise."""
    if set_name in SETS or is_generic_set(set_name):
        return set_name
    raise ValueError(
        f"unknown set {set_name!r}: one of {', '.join(SETS)} or <prefix>_oud | <prefix>_mix | <prefix>_vocal "
        f"(lower-case prefix, not {'/'.join(RESERVED_PREFIXES)}) over a --classified inventory with a rights field"
    )


def set_content(set_name: str) -> str:
    """The content label a set selects (oud | full_mix | voice | sep_oud | sep_vocal)."""
    if set_name in SET_CONTENT:
        return SET_CONTENT[set_name]
    if set_name == "harvard_full":
        return "full_mix"
    m = GENERIC_SET_RE.match(set_name)
    if not m:
        raise ValueError(f"no content label for set {set_name!r}")
    return KIND_CONTENT[m.group("kind")]


def set_default_rights(set_name: str) -> str | None:
    """The rights tier a set carries by construction; None for generic sets (their rows decide)."""
    if set_name in HARVARD_SETS:
        return RIGHTS_HARVARD
    if set_name in AHMED_SETS or set_name in SEP_SETS:
        return RIGHTS_AHMED
    return None


def rights_line(rights: str) -> str:
    """The SET_CARD sentence for a tier; a contributor line says consented or research-only by the suffix."""
    if rights in RIGHTS_LINES:
        return RIGHTS_LINES[rights]
    if rights.startswith("mixed: "):
        return "rows of several tiers (each row carries its own): research-only as a whole until split by tier."
    if rights.startswith(RIGHTS_CONTRIB_PREFIX):
        who = rights[len(RIGHTS_CONTRIB_PREFIX):].split("_")[0] or "unknown"
        if rights.endswith("_consented"):
            return f"contributor {who!r}: consented rows (train, publish an adapter) as written in their CONTRIBUTOR.md."
        if rights.endswith("_research_only"):
            return f"contributor {who!r}: research-only rows as written in their CONTRIBUTOR.md; never served or published."
        return f"contributor {who!r}: tier {rights!r} is not contrib_<name>_consented | _research_only: treat as research-only."
    return "unknown tier: treat as research-only until docs/DATA_PROVENANCE.md names it."


# ---------------------------------------------------------------------------
# Source records
# ---------------------------------------------------------------------------


@dataclass
class SourceFile:
    """One source recording selected for a set (song identity = full sha256).

    For a stem the path is the stem wav, the sha256 / song_group / project /
    genre_text those of the source mix, and extra holds stem + mix_path."""

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
    year: int | None = None
    performer: str | None = None

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


def row_year(row: dict) -> int | None:
    """The first plausible year (1800–2099) in the row's year/date fields, also under row["metadata"]."""
    sources = [row] + ([row["metadata"]] if isinstance(row.get("metadata"), dict) else [])
    for src in sources:
        for key in ("year", "date", "release_date", "upload_date", "recorded", "recording_date"):
            val = src.get(key)
            if val is None or val == "":
                continue
            text = str(val).strip()
            if re.fullmatch(r"\d{8}", text):  # yt-dlp upload_date: YYYYMMDD
                text = text[:4]
            m = YEAR_RE.search(text)
            if m:
                return int(m.group(1))
    return None


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


def select_ahmed(rows: list[dict], set_name: str, root: Path = REPO, include_third_party: bool = False) -> Selection:
    """Pick the classified rows of one Ahmed set (unique by sha256, sorted by sha).

    A collection file named "..._mixed" belongs to ahmed_mix only: the other
    two sets skip it with reason "collection_mix" even when the classifier
    labelled it oud or voice, so a merged run never holds one song twice with
    two captions.

    Two rules on top of the content label (defaults logged in docs/archive/WORKLOG.md):
    * every other file of Ahmed's separate collection (data/raw_incoming/oud_ilkacase,
      the corpus of the earlier `oud` adapter, oud-led qaraami with hand drums) counts
      as oud for ahmed_oud whatever the classifier said — the brief's "oud collection";
    * rows the classifier flagged `third_party_suspect` (numbered imports, "_mixed"
      downloads, "xml" instrumental bases) are left out of every set unless
      include_third_party is set, because the adapters may be published and those
      files' authorship is unverified. An admitted suspect row keeps the tier of
      Ahmed's sessions (the consent covers the folder; separate_stems and
      corpus_report rely on that and carry the flag separately) but its caption
      never names a performer, and its rows carry third_party_suspect /
      third_party_reason so register_adapter and corpus_report can act on them.
    """
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
        suspect = bool(row.get("third_party_suspect"))
        if suspect and not include_third_party:
            skipped[f"third_party_{row.get('third_party_reason') or 'suspect'}"] += 1
            continue
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
        elif source_group == "ahmed_collection" and set_name == "ahmed_oud":
            if content != "oud":
                skipped[f"collection_as_oud_from_{content or 'unclassified'}"] += 1
            content = "oud"
        elif source_group == "ahmed_collection" and set_name != "ahmed_oud":
            skipped["collection_reserved_for_ahmed_oud"] += 1
            continue
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
        extra: dict = {"source_group": source_group}
        if suspect:
            extra["third_party_suspect"] = True
            extra["third_party_reason"] = str(row.get("third_party_reason") or "suspect")
        chosen[sha] = SourceFile(
            set_name=set_name, path=path, name=name, sha256=sha, song_group=group_key(row),
            project=ahmed_project(row, path, root), content=content, rights=RIGHTS_AHMED,
            genre_text=f"{ahmed_project(row, path, root)} {name}",
            percussive_ratio=_float_or_none(row.get("percussive_ratio")),
            instruments=list(row["instruments"]) if isinstance(row.get("instruments"), list) else None,
            duration_s=_float_or_none(row.get("duration_s")),
            extra=extra,
            performer=None if suspect else PERFORMER_AHMED,
        )
    files = [chosen[s] for s in sorted(chosen)]
    return Selection(files=files, skipped=skipped, universe=universe)


def select_generic(rows: list[dict], set_name: str, root: Path = REPO, include_third_party: bool = False) -> Selection:
    """Pick the rows of a "<prefix>_oud|_mix|_vocal" set from an inventory whose rows carry `rights`.

    The content rule is the Ahmed one (content == oud | full_mix | voice); rows
    without a rights field are skipped ("no_rights"), rows of the tier
    internet_research_only are skipped by policy, third-party suspects as for
    Ahmed. Audio must lie under data/. The selected rows must all carry one
    tier: a set that mixes tiers is refused (SystemExit), build one set per
    tier instead. The split universe is every non-excluded row of the inventory."""
    want = set_content(set_name)
    roots = [root / DATA_DIR]
    skipped: Counter = Counter()
    universe: set[str] = set()
    chosen: dict[str, SourceFile] = {}
    prefix = GENERIC_SET_RE.match(set_name).group("prefix") if GENERIC_SET_RE.match(set_name) else set_name
    for row in rows:
        if row_excluded(row):
            skipped["excluded"] += 1
            continue
        universe.add(group_key(row))
        rights = str(row.get("rights") or "")
        if not rights:
            skipped["no_rights"] += 1
            continue
        if rights == RIGHTS_INTERNET_RESEARCH:
            skipped["rights_internet_research_only_by_policy"] += 1
            continue
        if row.get("third_party_suspect") and not include_third_party:
            skipped[f"third_party_{row.get('third_party_reason') or 'suspect'}"] += 1
            continue
        raw = row.get("path") or ""
        if not raw:
            skipped["no_path"] += 1
            continue
        path = resolve_path(str(raw), root)
        name = str(row.get("name") or path.name)
        content = str(row.get("content") or "")
        if content != want:
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
        project = str(row.get("project") or path.parent.name)
        title = str(row.get("title") or "")
        performer = row.get("performer") or row.get("artist")
        chosen[sha] = SourceFile(
            set_name=set_name, path=path, name=name, sha256=sha, song_group=group_key(row),
            project=project, content=content, rights=rights, genre_text=f"{project} {name} {title}".strip(),
            percussive_ratio=_float_or_none(row.get("percussive_ratio")),
            instruments=list(row["instruments"]) if isinstance(row.get("instruments"), list) else None,
            duration_s=_float_or_none(row.get("duration_s")),
            extra={"source_group": str(row.get("source_group") or prefix), "title": title},
            year=row_year(row),
            performer=str(performer) if performer else None,
        )
    tiers = sorted({f.rights for f in chosen.values()})
    if len(tiers) > 1:
        raise SystemExit(f"{set_name}: the selected rows mix rights tiers {tiers}: one set holds one tier, "
                         "build one set per tier (split the inventory or filter its rows)")
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
# Demucs stems (sep_oud, sep_vocal, harvard_sep_oud, harvard_sep_vocal)
# ---------------------------------------------------------------------------


def load_separated_index(sep_root: Path) -> list[dict]:
    """The separation rows: every <sep_root>/<corpus>/<sha12>/stems.json (each row remembers its
    directory in "_dir") plus the rows of <sep_root>/index.jsonl whose source the scan did not find.

    The stems.json files are the truth: separate_stems rebuilds index.jsonl only
    at the end of a run, so after a SIGKILL or a battery death the index is short
    and trusting it alone would silently drop the stems written since. A stale
    index is reported on stderr."""
    index = sep_root / "index.jsonl"
    indexed = load_jsonl(index) if index.exists() else []
    scanned: list[dict] = []
    for stems_json in sorted(sep_root.glob("*/*/stems.json")) if sep_root.exists() else []:
        try:
            row = json.loads(stems_json.read_text())
        except json.JSONDecodeError as exc:
            print(f"unreadable stems.json skipped: {stems_json}: {exc}", file=sys.stderr, flush=True)
            continue
        if isinstance(row, dict):
            row.setdefault("_dir", str(stems_json.parent))
            scanned.append(row)
    if not scanned:
        return indexed
    scanned_shas = {str(r.get("source_sha256") or r.get("sha256") or "").lower() for r in scanned}
    indexed_shas = {str(r.get("source_sha256") or r.get("sha256") or "").lower() for r in indexed}
    extra = [r for r in indexed if str(r.get("source_sha256") or r.get("sha256") or "").lower() not in scanned_shas]
    missing = len(scanned_shas - indexed_shas)
    if indexed and missing:
        print(f"{index} is stale: {missing} stems.json under {sep_root} are not in it "
              "(separate_stems rebuilds the index at the end of a run); the scanned rows are used",
              file=sys.stderr, flush=True)
    return scanned + extra


def separated_missing_note(sep_root: Path, root: Path) -> str:
    rel = rel_str(sep_root, root)
    return (f"no separation output: neither {rel}/index.jsonl nor any {rel}/<corpus>/<sha12>/stems.json exists; "
            "run the Demucs separation step first (0 files selected)")


def stem_wav_path(row: dict, stem: str, root: Path, sep_root: Path) -> Path:
    """Where a stem's wav is, in this order: the row's paths.<stem>_wav / <stem>_wav / <stem>_path /
    paths.<stem>; the directory its stems.json was scanned from ("_dir"); the row's own "stem_dir"
    (separate_stems writes it repo-relative, with the file name in stems.<stem>.file); else the
    default layout <sep_root>/<corpus>/<sha12>/<stem>.wav."""
    paths = row.get("paths") if isinstance(row.get("paths"), dict) else {}
    raw = paths.get(f"{stem}_wav") or row.get(f"{stem}_wav") or row.get(f"{stem}_path") or paths.get(stem)
    stems_dir = Path(str(row["_dir"])) if row.get("_dir") else None
    stems = row.get("stems") if isinstance(row.get("stems"), dict) else {}
    info = stems.get(stem) if isinstance(stems.get(stem), dict) else {}
    fname = str(info.get("file") or f"{stem}.wav")
    if raw:
        p = resolve_path(str(raw), root)
        if not p.exists() and stems_dir is not None and (stems_dir / Path(str(raw)).name).exists():
            return stems_dir / Path(str(raw)).name
        return p
    if stems_dir is not None:
        return stems_dir / fname
    if row.get("stem_dir"):
        return resolve_path(str(row["stem_dir"]), root) / fname
    corpus = str(row.get("corpus") or "")
    sha12 = str(row.get("source_sha256") or "")[:12]
    return sep_root / corpus / sha12 / fname


CORPUS_RIGHTS = {"ahmed": RIGHTS_AHMED, "ahmed_collection": RIGHTS_AHMED, "harvard": RIGHTS_HARVARD}
"""separate_stems' corpus directories whose tier is fixed; an extra inventory's corpus IS its rights tier."""


def separated_rights(row: dict) -> str:
    """The row's rights; without one, only a known corpus names the tier: separate_stems' `ahmed` /
    `ahmed_collection` (Ahmed), anything starting with `harvard` (research-only), or a corpus that is
    itself a tier string (internet_*, contrib_*). Any other corpus is RIGHTS_UNKNOWN, which
    select_separated skips as `rights_unknown`: a missing field never resolves to the consented tier."""
    rights = str(row.get("rights") or "")
    if rights:
        return rights
    corpus = str(row.get("corpus") or "").lower()
    if corpus in CORPUS_RIGHTS:
        return CORPUS_RIGHTS[corpus]
    if corpus.startswith("harvard"):
        return RIGHTS_HARVARD
    if corpus.startswith("internet_") or corpus.startswith(RIGHTS_CONTRIB_PREFIX):
        return corpus
    return RIGHTS_UNKNOWN


def select_separated(
    sep_rows: list[dict], set_name: str, mix_selection: Selection, root: Path = REPO, sep_root: Path | None = None,
) -> Selection:
    """Pick the stems of one sep set from the separation rows.

    The stem is "other" (sep_oud, where oud_present) or "vocals" (sep_vocal,
    where vocals_present). Its source mix must be a file of `mix_selection`
    (ahmed_mix for sep_*, harvard_full for harvard_sep_*): the stem inherits
    the mix's sha256 as song_sha256, its song_group, project and genre text,
    and the selection's split universe, so a mix and its stems always share a
    split and every exclusion of the mix set (third party, superseded whole
    sides, missing files) applies to the stems. Rights come from the row (else
    the corpus) and must match the set's tier."""
    if set_name not in SEP_SETS:
        raise ValueError(f"not a sep set: {set_name!r}")
    sep_root = sep_root or root / DEFAULT_SEPARATED
    content = SET_CONTENT[set_name]
    stem = SEP_STEM[content]
    present_key = SEP_PRESENT[content]
    want_rights = set_default_rights(set_name) or RIGHTS_AHMED
    mixes = {f.sha256: f for f in mix_selection.files}
    skipped: Counter = Counter()
    chosen: dict[str, SourceFile] = {}
    for row in sep_rows:
        sha = str(row.get("source_sha256") or row.get("sha256") or "").lower()
        if not SHA_RE.match(sha):
            skipped["no_source_sha256"] += 1
            continue
        rights = separated_rights(row)
        if rights != want_rights:
            skipped[f"rights_{rights}"] += 1
            continue
        if not row.get(present_key):
            skipped[f"{stem}_absent"] += 1
            continue
        mix = mixes.get(sha)
        if mix is None:
            skipped["source_not_in_mix_set"] += 1
            continue
        path = stem_wav_path(row, stem, root, sep_root)
        if not is_under(path, [sep_root]):
            skipped["outside_roots"] += 1
            continue
        if not path.exists():
            skipped["missing_stem"] += 1
            continue
        if sha in chosen:
            skipped["duplicate_source"] += 1
            continue
        stems = row.get("stems") if isinstance(row.get("stems"), dict) else {}
        info = stems.get(stem) if isinstance(stems.get(stem), dict) else {}
        chosen[sha] = SourceFile(
            set_name=set_name, path=path, name=mix.name, sha256=sha, song_group=mix.song_group,
            project=mix.project, content=content, rights=rights, genre_text=mix.genre_text,
            percussive_ratio=None, instruments=None,
            duration_s=_float_or_none(row.get("duration_s")) or mix.duration_s,
            extra={
                "stem": stem, "mix_path": rel_str(mix.path, root), "corpus": str(row.get("corpus") or ""),
                "stem_rms_dbfs": _float_or_none(info.get("rms_dbfs")),
                "stem_voiced_fraction": _float_or_none(info.get("voiced_fraction")),
                "stem_pcs": _float_or_none(info.get("pcs")),
                **{k: v for k, v in mix.extra.items() if k in ("cid", "source_group", "cassette")},
            },
            year=mix.year, performer=mix.performer,
        )
    files = [chosen[s] for s in sorted(chosen)]
    return Selection(files=files, skipped=skipped, universe=set(mix_selection.universe))


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


def find_stem_split_mismatches(rows: Iterable[dict], mix_rows: Iterable[dict] = ()) -> list[dict]:
    """Stems (content sep_oud | sep_vocal) whose split differs from a non-stem row of the same song_sha256.

    Both iterables are searched for stems and for mixes, so the check works on
    a merged union, on a sep set against its mix set's captions, and on a mix
    set against the sep sets already built. One entry per (song, content)."""
    all_rows = list(rows) + list(mix_rows)
    mix_splits: dict[str, set[str]] = {}
    for r in all_rows:
        sha = r.get("song_sha256")
        if sha and r.get("content") not in SEP_CONTENT:
            mix_splits.setdefault(str(sha), set()).add(str(r.get("split")))
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for r in all_rows:
        content = str(r.get("content") or "")
        sha = str(r.get("song_sha256") or "")
        if content not in SEP_CONTENT or not sha or (sha, content) in seen:
            continue
        splits = mix_splits.get(sha)
        if splits and splits != {str(r.get("split"))}:
            seen.add((sha, content))
            out.append({"song_sha256": sha, "content": content, "stem_split": str(r.get("split")),
                        "mix_splits": sorted(splits)})
    return out


def count_stems_with_mix(rows: Iterable[dict], mix_rows: Iterable[dict] = ()) -> int:
    """How many stem rows have a non-stem row of the same song to be checked against."""
    all_rows = list(rows) + list(mix_rows)
    mix_shas = {str(r.get("song_sha256")) for r in all_rows if r.get("content") not in SEP_CONTENT}
    return sum(1 for r in all_rows if r.get("content") in SEP_CONTENT and str(r.get("song_sha256")) in mix_shas)


def assert_stems_follow_mixes(rows: Iterable[dict], mix_rows: Iterable[dict] = ()) -> int:
    """SystemExit when a stem sits in another split than its source mix; returns the stems checked."""
    rows = list(rows)
    mix_rows = list(mix_rows)
    bad = find_stem_split_mismatches(rows, mix_rows)
    if bad:
        print(json.dumps({"stem_split_mismatches": bad[:20]}, indent=2))
        raise SystemExit(f"STEM/MIX SPLIT MISMATCH: {len(bad)} stems sit in another split than their source mix")
    n = count_stems_with_mix(rows, mix_rows)
    print(f"STEM/MIX SPLIT CHECK PASSED ({n} stem clips with a source mix row)")
    return n


# ---------------------------------------------------------------------------
# Captions
# ---------------------------------------------------------------------------


def detect_genre(text: str) -> str | None:
    """First genre word by position in text, mapped to its canonical spelling.

    Words match at a word start and may carry a suffix ("Qaraamiga", "Dhaantada");
    the short variants "heele"/"hele" only as whole words ("Heeleelooy" is not one)."""
    m = GENRE_RE.search(text.lower())
    if not m:
        return None
    return GENRE_MAP[m.group("stem") or m.group("whole")]


def join_phrase(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def instrument_phrase(content: str, percussive_ratio: float | None = None, override: list[str] | None = None) -> str:
    """The "led by ..." phrase. A stem names only what Demucs left in it: sep_oud is
    "the oud (kaban)" alone (the drums are removed, so no percussive rule and no
    override from the mix's classifier), sep_vocal "vocals (unaccompanied)"."""
    if content in SEP_CONTENT:
        return INSTRUMENT_PHRASE[content]
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


def tuning_tag(tuning_offset_cents: float | None) -> str | None:
    """"tuned <k> cents flat|sharp of A440" from TUNING_MIN_CENTS on; None below it or without a measurement."""
    if tuning_offset_cents is None:
        return None
    off = float(tuning_offset_cents)
    if not np.isfinite(off) or abs(off) < TUNING_MIN_CENTS:
        return None
    return f"tuned {int(round(abs(off)))} cents {'flat' if off < 0 else 'sharp'} of A440"


def recording_tag(rights: str, year: int | None = None) -> str:
    """The recording tag of a rights tier: Ahmed and contributors "studio recording, clean", Harvard
    "vintage cassette, 1955–1991", internet rows "studio recording" from MODERN_YEAR on, else
    (older or undated, and any unknown tier) "archival recording"."""
    if rights == RIGHTS_AHMED:
        return RECORDING_TAG_AHMED
    if rights == RIGHTS_HARVARD:
        return RECORDING_TAG_HARVARD
    if rights.startswith(RIGHTS_CONTRIB_PREFIX):
        return RECORDING_TAG_CONTRIB
    if rights.startswith("internet_"):
        return RECORDING_TAG_STUDIO if year is not None and year >= MODERN_YEAR else RECORDING_TAG_ARCHIVAL
    return RECORDING_TAG_ARCHIVAL


def performer_of(src: SourceFile) -> str | None:
    """Who is named: the row's performer, else Ahmed for his tier; never anyone for Harvard or for a
    third_party_suspect row admitted with --include-third-party (its authorship is unverified)."""
    if src.rights == RIGHTS_HARVARD or src.extra.get("third_party_suspect"):
        return None
    if src.performer:
        return src.performer
    return PERFORMER_AHMED if src.rights == RIGHTS_AHMED else None


def build_caption(src: SourceFile, bpm: float | None, tonic: str | None, tuning_offset_cents: float | None = None) -> str:
    """The template v2 caption; bpm/tonic None gives the dry-run template with placeholders."""
    genre = detect_genre(src.genre_text) or GENRE_DEFAULT.get(src.set_name, "Somali song")
    tempo = f"{tempo_word(bpm)} at {round(bpm)} BPM" if bpm is not None else "<tempo-word> at <N> BPM"
    performer = performer_of(src)
    # no classifier runs on the Harvard tracks: the catalog text alone names the instruments, never a percussive rule
    percussive = None if src.rights == RIGHTS_HARVARD else src.percussive_ratio
    parts = [
        genre,
        TRADITION if genre != "Somali song" else None,
        f"led by {instrument_phrase(src.content, percussive, src.instruments)}",
        tempo,
        f"pentatonic melody rooted on {tonic or '<tonic>'}",
        tuning_tag(tuning_offset_cents),
        recording_tag(src.rights, src.year),
        f"performed by {performer}" if performer else None,
    ]
    return ", ".join(p for p in parts if p)


_SCORER_DEVICE: str | None = None


def scorer_device() -> str:
    """mps when available, else cpu (torch imported here, not at module load)."""
    global _SCORER_DEVICE
    if _SCORER_DEVICE is None:
        import torch

        _SCORER_DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
    return _SCORER_DEVICE


def score_clip(clip: np.ndarray, device: str | None = None) -> ClipPCS | None:
    """scripts.pcs on one 32 kHz clip: CREPE f0 -> score_frames -> ClipPCS (tonic_name,
    tuning_offset_cents, pcs, ...), or None when the clip has too few voiced frames.
    Imported lazily so a --dry-run, a merge or a unit test never loads torch."""
    from scripts.pcs import extract_f0, score_frames

    f0, periodicity = extract_f0(np.asarray(clip, dtype=np.float32), device or scorer_device(), SR)
    return score_frames(f0, periodicity)


@dataclass
class ClipDescription:
    """What one clip's caption says about tempo, tonic and tuning, and where the tonic came from."""

    bpm: float
    tonic: str
    tonic_source: str  # "scorer" (scripts.pcs) | "histogram" (pentatonic.detect_from_audio)
    tuning_offset_cents: float | None = None
    scorer_error: str | None = None


def describe_clip(clip: np.ndarray, use_scorer: bool = True) -> ClipDescription:
    """Tempo, tonic and tuning of one clip.

    The scorer (score_clip) gives the tonic and the tuning offset when it scores;
    otherwise (too few voiced frames, scorer disabled, or a scorer error, which
    is recorded rather than raised) the tonic comes from detect_from_audio with
    the same fallbacks as build_scale_dataset and no tuning is claimed."""
    tonic: str | None = None
    source = "histogram"
    offset: float | None = None
    error: str | None = None
    if use_scorer:
        try:
            res = score_clip(clip)
        except Exception as exc:  # a failing CREPE must not stop a build: fall back to the histogram
            res = None
            error = f"{type(exc).__name__}: {exc}"
        if res is not None:
            tonic = str(res.tonic_name)
            source = "scorer"
            offset = round(float(res.tuning_offset_cents), 1)
    if tonic is None:
        try:
            det = detect_from_audio(clip, SR)
            tonic = str(det["tonic_name"]) if isinstance(det, dict) else str(det)
        except Exception:
            tonic = "A"
    try:
        bpm = tempo_bpm(clip)
    except Exception:
        bpm = 100.0
    return ClipDescription(bpm=bpm, tonic=tonic, tonic_source=source, tuning_offset_cents=offset, scorer_error=error)


def tonic_abs_cents(tonic: str, tuning_offset_cents: float) -> float:
    """The tonic's absolute pitch in cents from C, mod 1200: pitch class × 100 + tuning offset.

    pentatonic.tuning_offset lives in [-50, 50), so a recording a quarter-tone
    off A440 reads C# +48 on one clip and D -48 on the next; on this circle the
    two readings are 4 cents apart instead of a semitone."""
    return (PC_NAMES.index(tonic) * 100.0 + float(tuning_offset_cents)) % 1200.0


def song_consensus(descs: Iterable[ClipDescription]) -> tuple[str, float] | None:
    """One (tonic, tuning offset) for a song from its scored clips; None when no clip scored.

    Each scored clip votes with its absolute tonic pitch (tonic_abs_cents).
    Clips within TONIC_CLUSTER_CENTS of each other form a cluster; the largest
    cluster wins (ties: the lowest pitch) and its circular mean is re-expressed
    as the nearest pitch class plus an offset in [-50, 50]. One song then carries
    one tonic and one tuning direction, whichever side of the wrap each clip
    fell on, and a fifth-related tonic ambiguity (D on 11 clips, A on 4) resolves
    to the majority instead of the mean."""
    scored = [d for d in descs
              if d.tonic_source == TONIC_SOURCE_SCORER and d.tuning_offset_cents is not None and d.tonic in PC_NAMES]
    if not scored:
        return None
    cents = np.array([tonic_abs_cents(d.tonic, d.tuning_offset_cents) for d in scored], dtype=np.float64)
    dist = np.abs((cents[:, None] - cents[None, :] + 600.0) % 1200.0 - 600.0)
    members = dist <= TONIC_CLUSTER_CENTS
    counts = members.sum(axis=1)
    seed = int(np.lexsort((cents, -counts))[0])  # most members first, then the lowest pitch
    rel = (cents[members[seed]] - cents[seed] + 600.0) % 1200.0 - 600.0  # unwrapped around the seed
    centre = (cents[seed] + float(rel.mean())) % 1200.0
    nearest = round(centre / 100.0)
    offset = centre - nearest * 100.0
    return PC_NAMES[int(nearest) % 12], round(float(offset), 1)


# ---------------------------------------------------------------------------
# Cutting
# ---------------------------------------------------------------------------


def window_hop(seconds: float) -> tuple[int, int]:
    """(window, hop) in samples: build_scale_dataset's `win = seconds * SR`, `hop = win // 2`.

    ValueError for a window that is not a positive, finite number of seconds
    long enough to hop (a zero hop would loop forever, a negative window cuts
    nothing and still names a set directory)."""
    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError(f"clip window must be a positive number of seconds, not {seconds!r}")
    win = int(seconds * SR)
    if win < 2:
        raise ValueError(f"clip window of {seconds!r} s is under two samples at {SR} Hz")
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


def duration_infix(seconds: float) -> str:
    """"" for the default 30 s window (the sets already built keep their stems), "_<N>s" otherwise."""
    return "" if abs(seconds - DEFAULT_SECONDS) < 1e-6 else f"_{seconds:g}s"


def clip_stem(set_name: str, sha256: str, seg: int, seconds: float = DEFAULT_SECONDS) -> str:
    """<set>[_<N>s]_<sha12>_segNNN: the token and chroma files are named after this stem, so a
    10 s build never overwrites the 30 s features of the same song."""
    return f"{set_name}{duration_infix(seconds)}_{sha256[:12]}_seg{seg:03d}"


def seg_index(clip_path: str) -> int | None:
    m = SEG_RE.search(clip_path)
    return int(m.group(1)) if m else None


ROOTED_RE = re.compile(r"rooted on ([A-G]#?)(?:,|$)")


def caption_tonic(caption: str) -> str | None:
    """The tonic a caption names ("... rooted on D, ..."), for rows written before the `tonic` field."""
    m = ROOTED_RE.search(caption or "")
    return m.group(1) if m else None


def make_row(
    src: SourceFile, split: str, seg: int, caption: str, set_dir: Path, root: Path, seconds: float,
    tuning_offset_cents: float | None = None, tonic_source: str = TONIC_SOURCE_HISTOGRAM,
    tonic: str | None = None, clip_tonic: str | None = None, clip_tuning_offset_cents: float | None = None,
    chroma_dir: str | None = None,
) -> dict:
    """One caption row. `tonic` / `tuning_offset_cents` are what the caption says (the song consensus),
    `clip_tonic` / `clip_tuning_offset_cents` the raw reading of this clip; `chroma_dir` is carried
    from an earlier row when scale_chroma --write-chroma-dir set it and the .npy still exists."""
    stem = clip_stem(src.set_name, src.sha256, seg, seconds)
    row = {
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
        "tonic": tonic if tonic is not None else caption_tonic(caption),
        "tuning_offset_cents": tuning_offset_cents,
        "tonic_source": tonic_source,
        "clip_tonic": clip_tonic,
        "clip_tuning_offset_cents": clip_tuning_offset_cents,
    }
    if src.extra.get("stem"):
        row["stem"] = src.extra["stem"]
        row["mix_path"] = src.extra.get("mix_path")
    if src.extra.get("third_party_suspect"):
        row["third_party_suspect"] = True
        row["third_party_reason"] = src.extra.get("third_party_reason")
    if chroma_dir:
        row["chroma_dir"] = chroma_dir
    return row


def kept_chroma_dir(old: dict | None, stem: str, root: Path) -> str | None:
    """The earlier row's chroma_dir when <chroma_dir>/<stem>.npy still exists (the stem names the
    song, segment and window, not the split, so a split move keeps the chroma valid)."""
    if not old or not old.get("chroma_dir"):
        return None
    chroma_dir = str(old["chroma_dir"])
    return chroma_dir if (resolve_path(chroma_dir, root) / f"{stem}.npy").exists() else None


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


def clip_is_whole(path: Path, win: int) -> bool:
    """True when the wav at `path` holds exactly `win` frames at SR (a header read, no decode): a clip
    truncated by a kill mid-write, or cut with another window, must not be reused."""
    try:
        info = sf.info(path)
    except (RuntimeError, OSError):
        return False
    return info.frames == win and info.samplerate == SR


def _resume_rows(
    src: SourceFile, split: str, previous: list[dict], set_dir: Path, root: Path, seconds: float,
) -> list[dict] | None:
    """Reuse earlier rows of this source when every clip is on disk and whole (moving clips whose split changed).

    None (= re-caption or re-cut) when there are no rows, a row lacks a segment
    index, was cut with another --seconds or caption template version, or its
    clip is gone or not exactly one window long."""
    if not previous:
        return None
    win, _ = window_hop(seconds)
    rows: list[dict] = []
    for old in sorted(previous, key=lambda r: seg_index(r["clip_path"]) or 0):
        seg = seg_index(old["clip_path"])
        if seg is None or not row_is_resumable(old, seconds):
            return None
        stem = clip_stem(src.set_name, src.sha256, seg, seconds)
        new = make_row(src, split, seg, old["caption"], set_dir, root, seconds,
                       tuning_offset_cents=_float_or_none(old.get("tuning_offset_cents")),
                       tonic_source=str(old.get("tonic_source") or TONIC_SOURCE_HISTOGRAM),
                       tonic=old.get("tonic") or caption_tonic(old["caption"]),
                       clip_tonic=old.get("clip_tonic"),
                       clip_tuning_offset_cents=_float_or_none(old.get("clip_tuning_offset_cents")),
                       chroma_dir=kept_chroma_dir(old, stem, root))
        old_path = resolve_path(old["clip_path"], root)
        new_path = resolve_path(new["clip_path"], root)
        if not clip_is_whole(new_path if new_path.exists() else old_path, win):
            return None
        if not new_path.exists():
            new_path.parent.mkdir(parents=True, exist_ok=True)
            os.replace(old_path, new_path)
        rows.append(new)
    return rows


SCORER_CLIPS_PER_SONG = 0
"""When > 0, at most this many evenly spaced clips of a source are sent to the CREPE scorer; the
others take the song consensus (tonic_source "song"). 0 scores every clip. Set from --scorer-clips-per-song."""


def scored_segments(n_clips: int, budget: int) -> set[int]:
    """The clip indices (0..n_clips-1) that get the scorer under a per-song budget: all of them when
    budget is 0 or covers them, else `budget` evenly spaced indices starting at 0."""
    if n_clips <= 0:
        return set()
    if budget <= 0 or n_clips <= budget:
        return set(range(n_clips))
    return {round(i * (n_clips - 1) / (budget - 1)) for i in range(budget)} if budget > 1 else {0}


def _describe_or_warn(clip: np.ndarray, src: SourceFile, failed: Counter, use_scorer: bool, warned: list[bool]) -> ClipDescription:
    """describe_clip plus the per-source scorer-error accounting (counted per clip, printed once per source)."""
    desc = describe_clip(clip, use_scorer=use_scorer)
    if desc.scorer_error:
        failed["scorer_error_clips"] += 1
        if not warned[0]:
            print(f"scorer failed on {src.name} (histogram tonic used): {desc.scorer_error}", file=sys.stderr, flush=True)
            warned[0] = True
    return desc


def _rows_from_descriptions(
    src: SourceFile, split: str, descs: list[tuple[int, ClipDescription]], set_dir: Path, root: Path, seconds: float,
    previous: list[dict] = (),
) -> list[dict]:
    """Caption rows for the clips of one source from their descriptions, with one tonic and one
    tuning claim per song (song_consensus over the scored clips; a clip the scorer could not score
    takes the song's answer with tonic_source "song"; without any scored clip every clip keeps its own
    histogram tonic and no tuning is claimed). chroma_dir is carried from the previous row of the same stem."""
    consensus = song_consensus(d for _, d in descs)
    prev_by_stem = {Path(str(r.get("clip_path"))).stem: r for r in previous}
    rows: list[dict] = []
    for seg, desc in descs:
        if consensus is None:
            tonic, offset, source = desc.tonic, None, TONIC_SOURCE_HISTOGRAM
        else:
            tonic, offset = consensus
            source = TONIC_SOURCE_SCORER if desc.tonic_source == TONIC_SOURCE_SCORER else TONIC_SOURCE_SONG
        stem = clip_stem(src.set_name, src.sha256, seg, seconds)
        caption = build_caption(src, desc.bpm, tonic, offset)
        rows.append(make_row(src, split, seg, caption, set_dir, root, seconds,
                             tuning_offset_cents=offset, tonic_source=source, tonic=tonic,
                             clip_tonic=desc.tonic, clip_tuning_offset_cents=desc.tuning_offset_cents,
                             chroma_dir=kept_chroma_dir(prev_by_stem.get(stem), stem, root)))
    return rows


def _recaption_source(
    src: SourceFile, split: str, previous: list[dict], set_dir: Path, root: Path, seconds: float, failed: Counter,
    use_scorer: bool = True,
) -> list[dict] | None:
    """Re-caption a source whose clips are all on disk with the right window but whose rows were
    written under another caption template version (or before the version field existed): the clips
    are read back, described and captioned again; nothing is decoded or rewritten. None when any
    clip is missing, misnamed or of another length (the source is then re-cut)."""
    if not previous:
        return None
    win, _ = window_hop(seconds)
    items: list[tuple[int, Path, Path]] = []
    for old in sorted(previous, key=lambda r: seg_index(str(r.get("clip_path"))) or 0):
        clip_path = str(old.get("clip_path") or "")
        seg = seg_index(clip_path)
        if seg is None:
            return None
        stem = clip_stem(src.set_name, src.sha256, seg, seconds)
        if Path(clip_path).stem != stem:
            return None
        old_path = resolve_path(clip_path, root)
        new_path = set_dir / "clips" / split / f"{stem}.wav"
        if not clip_is_whole(new_path if new_path.exists() else old_path, win):
            return None
        items.append((seg, old_path, new_path))
    if not items:
        return None
    descs: list[tuple[int, ClipDescription]] = []
    warned = [False]
    score_idx = scored_segments(len(items), SCORER_CLIPS_PER_SONG)
    for i, (seg, old_path, new_path) in enumerate(items):
        if not new_path.exists():
            new_path.parent.mkdir(parents=True, exist_ok=True)
            os.replace(old_path, new_path)
        clip = sf.read(new_path, dtype="float32")[0]
        descs.append((seg, _describe_or_warn(clip, src, failed, use_scorer and i in score_idx, warned)))
    return _rows_from_descriptions(src, split, descs, set_dir, root, seconds, previous)


def _cut_source(
    src: SourceFile, split: str, set_dir: Path, root: Path, seconds: float, meter: pyln.Meter, failed: Counter,
    use_scorer: bool = True, previous: list[dict] = (),
) -> list[dict] | None:
    """Decode, gate and cut one source into clip files + rows; None (counted in `failed`) when it is
    skipped, [] (also counted, as no_clips_*) when the file is shorter than the window or every window
    was dropped. `previous` rows of the same source lend their chroma_dir to the clips they name."""
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
    win, hop = window_hop(seconds)
    descs: list[tuple[int, ClipDescription]] = []
    warned = [False]
    n_expected = max(1, 1 + (len(audio) - win) // hop) if len(audio) >= win else 0
    score_idx = scored_segments(n_expected, SCORER_CLIPS_PER_SONG)
    for seg, clip in cut_clips(audio, seconds, meter):
        descs.append((seg, _describe_or_warn(clip, src, failed, use_scorer and seg in score_idx, warned)))
        stem = clip_stem(src.set_name, src.sha256, seg, seconds)
        sf.write(set_dir / "clips" / split / f"{stem}.wav", clip, SR, subtype="PCM_16")
    if not descs:
        reason = "source_shorter_than_window" if len(audio) < win else "all_windows_dropped"
        failed[f"no_clips_{reason}"] += 1
        print(f"no clips from {src.name}: {len(audio) / SR:.1f} s decoded, {seconds:g} s window ({reason})",
              file=sys.stderr, flush=True)
        return []
    return _rows_from_descriptions(src, split, descs, set_dir, root, seconds, previous)


def find_orphan_clips(set_dir: Path, rows: Iterable[dict], root: Path) -> list[Path]:
    """Clip files under set_dir/clips/<split>/ that no caption row references."""
    referenced = {resolve_path(r["clip_path"], root).resolve() for r in rows}
    orphans: list[Path] = []
    for s in SPLITS:
        for p in sorted((set_dir / "clips" / s).glob("*.wav")):
            if p.resolve() not in referenced:
                orphans.append(p)
    return orphans


def related_rows(set_name: str, out_root: Path) -> dict[str, list[dict]]:
    """Captions on disk of the sets whose splits must agree with this one (a sep set's mix set,
    a mix set's sep sets), keyed by set name; only sets that have captions under out_root."""
    out: dict[str, list[dict]] = {}
    for other in RELATED_SETS.get(set_name, ()):
        rows = load_jsonl(out_root / other / "captions.jsonl")
        if rows:
            out[other] = rows
    return out


def set_rights(set_name: str, files: list[SourceFile]) -> str:
    tiers = sorted({f.rights for f in files})
    if tiers:
        return tiers[0] if len(tiers) == 1 else "mixed: " + ", ".join(tiers)
    return set_default_rights(set_name) or "unknown"


def build_set(
    set_name: str,
    selection: Selection,
    out_root: Path,
    seconds: float = DEFAULT_SECONDS,
    limit: int = 0,
    dry_run: bool = False,
    root: Path = REPO,
    prune_orphans: bool = False,
    use_scorer: bool = True,
    note: str | None = None,
) -> dict:
    """Cut clips + captions for one set, resumably; returns the JSON summary.

    Per source, in this order: reuse the rows on disk (same window and caption
    version, every clip present; clips move when the split changed); else
    re-caption the clips on disk (right window, another caption version: read
    back, described and captioned again, nothing decoded or rewritten); else
    decode and cut. The captions file is rewritten after every source with the
    new rows plus the untouched rows of every source not yet reached, so an
    interruption loses nothing but the source in flight. With `limit` the run
    is partial: rows of sources outside the first `limit` files are kept
    untouched. Without it the final captions file holds exactly the selected
    sources; clips no row references are reported as orphans and deleted only
    when `prune_orphans` is set. A sep set fails when a stem's split differs
    from its mix set's captions on disk; a mix set only warns about the sep
    sets that now need a rebuild."""
    window_hop(seconds)  # ValueError for a window that cannot be cut, before any directory is made
    files = selection.files[:limit] if limit else selection.files
    splits = assign_splits(files, selection.universe)
    set_dir = out_root / set_name
    captions_path = set_dir / "captions.jsonl"
    summary: dict = {
        "set": set_name, "files": len(files), "selected_files": len(selection.files),
        "songs": len({f.sha256 for f in files}),
        "groups": len({f.song_group for f in files}), "skipped": dict(selection.skipped),
        "split_universe": len(selection.universe) or len({f.song_group for f in files}),
        "seconds": seconds, "clip_stem": clip_stem(set_name, "<sha256>", 0, seconds),
        "caption_version": CAPTION_VERSION, "rights": set_rights(set_name, files),
        "scorer": use_scorer, "captions": rel_str(captions_path, root), "dry_run": dry_run,
    }
    if note:
        summary["note"] = note
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
    # rows of the selected sources this run has not reached yet: written back on every intermediate
    # write, so an interrupted run leaves them resumable instead of forcing a re-cut
    pending: dict[str, list[dict]] = {f.sha256: existing.get(f.sha256, []) for f in files}
    meter = pyln.Meter(SR)
    rows: list[dict] = []
    reused = 0
    recaptioned = 0
    failed: Counter = Counter()
    for fi, src in enumerate(files, 1):
        split = splits[src.sha256]
        previous = pending.pop(src.sha256, [])
        src_rows = _resume_rows(src, split, previous, set_dir, root, seconds)
        if src_rows is not None:
            reused += 1
        else:
            src_rows = _recaption_source(src, split, previous, set_dir, root, seconds, failed, use_scorer=use_scorer)
            if src_rows is not None:
                recaptioned += 1
            else:
                src_rows = _cut_source(src, split, set_dir, root, seconds, meter, failed, use_scorer=use_scorer,
                                       previous=previous)
        rows.extend(src_rows or [])
        write_jsonl(captions_path, rows + kept_rows + [r for rs in pending.values() for r in rs])
        if fi % 10 == 0 or fi == len(files):
            print(f"{fi}/{len(files)} files ({len(rows)} clips, {reused} resumed, {recaptioned} re-captioned, "
                  f"{sum(failed.values())} skipped)", flush=True)

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
    related = related_rows(set_name, out_root)
    related_flat = [r for rs in related.values() for r in rs]
    mismatches = find_stem_split_mismatches(all_rows, related_flat)
    summary.update({
        "clips_total": len(all_rows),
        "clips_this_run": len(rows),
        "kept_rows": len(kept_rows),
        "kept_sources": len({str(r.get("song_sha256")) for r in kept_rows}),
        "songs_per_split": {s: len({r["song_sha256"] for r in all_rows if r["split"] == s}) for s in SPLITS},
        "clips_per_split": {s: sum(1 for r in all_rows if r["split"] == s) for s in SPLITS},
        "hours": round(len(all_rows) * seconds / 3600, 2),
        "resumed_files": reused,
        "recaptioned_files": recaptioned,
        "rows_with_chroma_dir": sum(1 for r in all_rows if r.get("chroma_dir")),
        "third_party_rows": sum(1 for r in all_rows if r.get("third_party_suspect")),
        "failed": dict(failed),
        "orphan_clips": len(orphans),
        "orphan_examples": [rel_str(p, root) for p in orphans[:5]],
        "pruned_clips": len(orphans) if prune_orphans else 0,
        "tonic_sources": dict(Counter(str(r.get("tonic_source") or TONIC_SOURCE_HISTOGRAM) for r in all_rows)),
        "tuning_tagged_clips": sum(1 for r in all_rows if tuning_tag(_float_or_none(r.get("tuning_offset_cents")))),
        "tonic_consensus_changed_clips": sum(
            1 for r in all_rows if r.get("clip_tonic") and r.get("tonic") and r["clip_tonic"] != r["tonic"]),
        "tonics": dict(sorted(Counter(str(r.get("tonic")) for r in all_rows if r.get("tonic")).items())),
        "leakage": find_leakage(all_rows),
        "related_sets_checked": sorted(related),
        "stems_checked_against_mix": count_stems_with_mix(all_rows, related_flat),
        "stem_split_mismatches": len(mismatches),
        "stem_split_examples": mismatches[:5],
    })
    write_set_card(set_dir / "SET_CARD.md", summary, all_rows, files)
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    assert_no_leakage(all_rows)
    if set_name in SEP_SETS:
        assert_stems_follow_mixes(all_rows, related_flat)
    elif mismatches:
        print(f"WARNING: {len(mismatches)} stems in {', '.join(sorted(related))} now sit in another split than "
              f"this set's mixes: rebuild those sep sets (their clips are renamed on resume)",
              file=sys.stderr, flush=True)
    return summary


def write_set_card(path: Path, summary: dict, rows: list[dict], files: list[SourceFile]) -> None:
    set_name = summary["set"]
    rights = str(summary.get("rights") or set_rights(set_name, files))
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
        f"# Set card: {set_name} ({seconds:g} s clips)",
        "",
        f"Built {dt.datetime.now().astimezone().isoformat(timespec='seconds')} by `scripts/build_sets.py`.",
        "",
        f"- Rights: `{rights}` — {rights_line(rights)}",
        f"- Source files this run: {summary['files']} of {summary.get('selected_files', summary['files'])} selected "
        f"(unique songs by sha256: {summary['songs']}, song groups: {summary['groups']})",
        f"- Source audio: {src_hours:.2f} h (manifest/inventory durations)",
        f"- Clip duration: {seconds:g} s, {overlap_pct:.0f} % overlap; clip stem `{summary.get('clip_stem', clip_stem(set_name, '<sha256>', 0, seconds))}` "
        f"(tokens and chroma are named after the stem, so this build never collides with another duration)",
        f"- Clips: {summary.get('clips_total', 0)} × {seconds:g} s = {summary.get('hours', 0)} h "
        f"(this run: {summary.get('clips_this_run', 0)}, kept from the previous build: {summary.get('kept_rows', 0)})",
        f"- Sources this run: {summary.get('resumed_files', 0)} resumed, {summary.get('recaptioned_files', 0)} re-captioned "
        f"from their clips on disk, {summary['files'] - summary.get('resumed_files', 0) - summary.get('recaptioned_files', 0)} "
        f"decoded and cut; rows with a chroma pointer (`chroma_dir`, kept across rebuilds): {summary.get('rows_with_chroma_dir', 0)}",
        f"- Clips per split: {json.dumps(summary.get('clips_per_split', {}))}",
        f"- Songs per split: {json.dumps(summary.get('songs_per_split', {}))}",
        f"- Content labels: {json.dumps(dict(by_content))}",
        f"- Genres (caption): {json.dumps(dict(by_genre))}",
        f"- Tonic source (scorer = scripts.pcs CREPE + pentatonic correlator, song = the song's scorer consensus on a "
        f"clip the scorer could not score, histogram = chroma fallback): {json.dumps(summary.get('tonic_sources', {}))}; "
        f"one tonic and one tuning claim per song (consensus over its scored clips; clips whose own reading differed: "
        f"{summary.get('tonic_consensus_changed_clips', 0)}); clips with a tuning tag (|offset| ≥ {TUNING_MIN_CENTS:g} cents): "
        f"{summary.get('tuning_tagged_clips', 0)}",
        f"- Tonics (caption): {json.dumps(summary.get('tonics', {}))}",
        f"- Third-party-suspect rows admitted with --include-third-party: {summary.get('third_party_rows', 0)} "
        f"(authorship unverified: no performer in the caption, `third_party_suspect` on the row; not for a releasable adapter)",
        f"- Skipped at selection: {json.dumps(summary.get('skipped', {}))}",
        f"- Skipped at cut (decode errors, silent sources, scorer errors, sources that gave no clips): "
        f"{json.dumps(summary.get('failed', {}))}",
        f"- Orphan clip files (no caption row): {summary.get('orphan_clips', 0)} "
        f"(deleted: {summary.get('pruned_clips', 0)})",
        f"- Caption template version: {summary.get('caption_version', CAPTION_VERSION)} (docs/data/CAPTION_STYLE_GUIDE.md)",
        "",
        "## Splits",
        "",
        f"Song-level {split_ratio_label()} by `build_scale_dataset.song_splits` over the sorted (sha256-hashed) "
        "song-group keys of the",
        f"split universe ({summary['split_universe']} groups); every take, mixdown or variant of one song shares",
        "the split. Leakage check: no song_sha256 and no song_group in two splits.",
    ]
    if set_name in SEP_SETS:
        lines.append(f"Stem invariant: song_sha256 and song_group are the SOURCE MIX's, so a stem never sits in another split "
                     f"than its mix; checked against `{MIX_SET_OF[set_name]}/captions.jsonl` "
                     f"({summary.get('stems_checked_against_mix', 0)} stem clips checked, "
                     f"{summary.get('stem_split_mismatches', 0)} mismatches).")
    elif set_name in RELATED_SETS:
        lines.append(f"Stem sets built from these mixes ({', '.join(RELATED_SETS[set_name])}) must share the splits: "
                     f"{summary.get('stem_split_mismatches', 0)} mismatches found in "
                     f"{', '.join(summary.get('related_sets_checked', [])) or 'no sep set built yet'}.")
    lines += [
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
        "reused; clips on disk with the right window but another caption version are re-captioned in place "
        "(read back, never decoded or rewritten); a song whose split moved has its clips renamed; a `--limit` "
        "run keeps the other sources' rows; `chroma_dir` pointers survive every rebuild while the .npy exists.",
    ]
    if set_name in HARVARD_SETS:
        lines.append("- Built from the manifest as it was at build time; rebuild after the fetch job finishes to pick up new tracks.")
        lines.append("- Whole-cassette-side files (manifest/catalog type Item) are excluded when track files of the same cassette exist (superset leakage).")
    if set_name in SEP_SETS:
        stem = SEP_STEM[SET_CONTENT[set_name]]
        lines.append(f"- Demucs htdemucs_ft `{stem}` stems of the `{MIX_SET_OF[set_name]}` sources (data/separated); the caption names "
                     f"only what the stem holds ({INSTRUMENT_PHRASE[SET_CONTENT[set_name]]}), never the removed parts.")
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text("\n".join(lines) + "\n")
    os.replace(tmp, path)  # ahmed_report / model_report parse the card: never leave it half-written


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------


def resolve_set_captions(name: str, out_roots: list[Path], root: Path) -> tuple[Path, str]:
    """(captions path, label) of a --sets entry: a set name looked up in the out-roots (it must
    exist in exactly one), or a path to a set directory or its captions.jsonl."""
    looks_like_path = "/" in name or name.endswith(".jsonl") or name.startswith(".")
    if looks_like_path:
        p = resolve_path(name, root)
        if p.is_dir():
            p = p / "captions.jsonl"
        if not p.exists():
            raise SystemExit(f"no captions for set {name!r}: {p} does not exist")
        return p, p.parent.name
    hits = [r / name / "captions.jsonl" for r in out_roots if (r / name / "captions.jsonl").exists()]
    if len(hits) > 1:
        raise SystemExit(f"set {name!r} has captions under several out-roots ({', '.join(rel_str(h.parent.parent, root) for h in hits)}): "
                         "pass the set directory path instead of the name")
    if not hits:
        raise SystemExit(f"no captions for set {name!r} under {', '.join(rel_str(r, root) for r in out_roots)}")
    return hits[0], name


def merge_sets(
    names: list[str], out_root: Path | list[Path], out_path: Path, root: Path = REPO, allow_mixed_seconds: bool = False,
) -> dict:
    """Concatenate several sets' captions, re-check leakage across the union, write one file.

    Sets are named (looked up in the out-roots) or given as paths. Rows of
    different clip durations are refused unless `allow_mixed_seconds`. A song
    present in more than one set with the same content label would train the
    same audio twice under two captions, so it is an error (nothing is
    written); a mix and its stems (different content) may share a song_sha256,
    and every stem must sit in its mix's split."""
    out_roots = [out_root] if isinstance(out_root, Path) else list(out_root)
    rows: list[dict] = []
    per_set: dict[str, dict[str, int]] = {}
    for name in names:
        captions_path, label = resolve_set_captions(name, out_roots, root)
        set_rows = load_jsonl(captions_path)
        if not set_rows:
            raise SystemExit(f"no captions for set {name!r}: {rel_str(captions_path, root)} is empty")
        for r in set_rows:
            r.setdefault("tokens_dir", rel_str(captions_path.parent / "tokens", root))
        counts = Counter(r["split"] for r in set_rows)
        per_set[label] = {s: counts.get(s, 0) for s in SPLITS}
        rows.extend(set_rows)
    seconds_seen = sorted({_float_or_none(r.get("seconds")) for r in rows}, key=lambda x: (x is None, x or 0.0))
    sha_sets: dict[tuple[str, str], set[str]] = {}
    for r in rows:
        sha_sets.setdefault((r["song_sha256"], str(r.get("content") or "")), set()).add(r["source"])
    dup_songs = sorted(k for k, v in sha_sets.items() if len(v) > 1)
    leaks = find_leakage(rows)
    stem_mismatches = find_stem_split_mismatches(rows)
    summary = {
        "merge": out_path.stem, "sets": names, "rows": len(rows),
        "per_set": per_set,
        "per_split": {s: sum(1 for r in rows if r["split"] == s) for s in SPLITS},
        "seconds": seconds_seen,
        "songs": len({k[0] for k in sha_sets}), "songs_in_several_sets": len(dup_songs),
        "stem_split_mismatches": len(stem_mismatches),
        "leakage": leaks, "out": rel_str(out_path, root),
    }
    print(json.dumps(summary, indent=2))
    if len(seconds_seen) > 1 and not allow_mixed_seconds:
        raise SystemExit(f"MIXED CLIP DURATIONS: rows of {seconds_seen} s in one merge; pass --allow-mixed-seconds "
                         "only for a run whose loader handles several token lengths")
    if dup_songs:
        print(json.dumps({"songs_in_several_sets": [
            {"song_sha256": s, "content": c, "sets": sorted(sha_sets[(s, c)])} for s, c in dup_songs[:20]]}, indent=2))
        raise SystemExit(f"DUPLICATE SONGS ACROSS SETS: {len(dup_songs)} (song_sha256, content) pairs appear in more than one set")
    assert_no_leakage(rows)
    assert_stems_follow_mixes(rows)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_jsonl(out_path, rows)
    return summary


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--set", metavar="NAME",
                      help=f"build this set: {', '.join(SETS)} or <prefix>_oud|_mix|_vocal over a rights-carrying inventory")
    mode.add_argument("--merge", metavar="NAME", help="merge several sets' captions into one run captions file")
    ap.add_argument("--classified", default=DEFAULT_CLASSIFIED, help="classified inventory (jsonl): Ahmed, sep_* and generic sets")
    ap.add_argument("--harvard-manifest", default=DEFAULT_MANIFEST)
    ap.add_argument("--harvard-catalog", default=DEFAULT_CATALOG, help="finding-aid CSV (split universe + titles)")
    ap.add_argument("--separated", default=DEFAULT_SEPARATED, help="Demucs output root (index.jsonl or <corpus>/<sha12>/stems.json)")
    ap.add_argument("--out-root", action="append", default=None,
                    help=f"set directories root (default {DEFAULT_OUT_ROOT}); must lie under <repo>/{DATA_DIR} (see --allow-outside-data); "
                         "--merge accepts it several times")
    ap.add_argument("--allow-outside-data", action="store_true",
                    help=f"permit an --out-root outside <repo>/{DATA_DIR}: synthesised fixtures only, never corpus audio")
    ap.add_argument("--seconds", type=float, default=DEFAULT_SECONDS, help="clip window; 10 gives <set>_10s_... clip stems")
    ap.add_argument("--limit", type=int, default=0, help="only the first N selected files (partial run: other rows are kept)")
    ap.add_argument("--dry-run", action="store_true", help="select, split and preview captions without decoding")
    ap.add_argument("--include-third-party", action="store_true",
                    help="also use rows the classifier flagged third_party_suspect (default: left out of every set); "
                         "their captions name no performer and their rows carry third_party_suspect")
    ap.add_argument("--prune-orphans", action="store_true", help="delete clip files under the set that no caption row references")
    ap.add_argument("--scorer-clips-per-song", type=int, default=0,
                    help="send at most N evenly spaced clips per source to the CREPE scorer (0 = all); "
                         "the other clips take the song consensus")
    ap.add_argument("--no-scorer", action="store_true",
                    help="skip scripts.pcs (CREPE) per clip: tonic from the chroma histogram, no tuning tag")
    ap.add_argument("--sets", nargs="*", default=[], help="--merge: set names (looked up in the out-roots) or set paths")
    ap.add_argument("--out", default=None, help="--merge: output captions path")
    ap.add_argument("--allow-mixed-seconds", action="store_true", help="--merge: accept rows of different clip durations")
    args = ap.parse_args(argv)
    global SCORER_CLIPS_PER_SONG
    SCORER_CLIPS_PER_SONG = max(0, int(getattr(args, "scorer_clips_per_song", 0) or 0))
    try:
        window_hop(args.seconds)
    except ValueError as exc:
        ap.error(f"--seconds: {exc}")
    out_roots = [resolve_path(r, REPO) for r in (args.out_root or [DEFAULT_OUT_ROOT])]
    for out_root in out_roots:
        if not is_under(out_root, [REPO / DATA_DIR]) and not args.allow_outside_data:
            ap.error(f"--out-root {out_root} is outside {REPO / DATA_DIR}: cut corpus audio stays under {DATA_DIR}/ "
                     "(pass --allow-outside-data for synthesised fixtures only)")

    if args.merge:
        if not args.sets:
            ap.error("--merge needs --sets a b c")
        out = resolve_path(args.out, REPO) if args.out else out_roots[0] / f"{args.merge}_captions.jsonl"
        merge_sets(args.sets, out_roots, out, root=REPO, allow_mixed_seconds=args.allow_mixed_seconds)
        return

    if len(out_roots) > 1:
        ap.error("--set takes one --out-root")
    try:
        set_name = validate_set_name(args.set)
    except ValueError as exc:
        ap.error(str(exc))
    note: str | None = None
    if set_name in HARVARD_SETS:
        manifest = load_jsonl(resolve_path(args.harvard_manifest, REPO))
        if not manifest:
            raise SystemExit(f"no manifest rows at {args.harvard_manifest}")
        selection = select_harvard(manifest, load_catalog(resolve_path(args.harvard_catalog, REPO)), root=REPO)
    else:
        classified = load_jsonl(resolve_path(args.classified, REPO))
        if not classified:
            raise SystemExit(f"no classified rows at {args.classified}")
        if set_name in AHMED_SETS:
            selection = select_ahmed(classified, set_name, root=REPO, include_third_party=args.include_third_party)
        elif set_name in SEP_SETS:
            selection = select_ahmed(classified, MIX_SET_OF[set_name], root=REPO, include_third_party=args.include_third_party)
        else:
            selection = select_generic(classified, set_name, root=REPO, include_third_party=args.include_third_party)
    if set_name in SEP_SETS:
        sep_root = resolve_path(args.separated, REPO)
        sep_rows = load_separated_index(sep_root)
        if not sep_rows:
            note = separated_missing_note(sep_root, REPO)
        selection = select_separated(sep_rows, set_name, selection, root=REPO, sep_root=sep_root)
    if not selection.files:
        message = note or f"{set_name}: no source files selected (skipped: {dict(selection.skipped)})"
        if not args.dry_run:
            raise SystemExit(message)
        note = message
    build_set(set_name, selection, out_roots[0], seconds=args.seconds, limit=args.limit, dry_run=args.dry_run,
              root=REPO, prune_orphans=args.prune_orphans, use_scorer=not args.no_scorer, note=note)


if __name__ == "__main__":
    main()
