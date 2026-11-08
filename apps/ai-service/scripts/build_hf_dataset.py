"""Assemble the public, rights-clean Hugging Face dataset
"QaraamiGen — Somali Music Reference Dataset" (v0.1) from the repository.

The dataset holds ONLY material the project may publish:

1. model output already published on the public website: audio listed in
   `apps/web/public-audio-rights.json` with `kind: model_output` and
   `rights: releasable`, cross-checked against the adapter's model card
   (`docs/eval/MODEL_CARD_<adapter>.md` must say ``**Rights class:** `releasable` ``);
2. the project's own synthesised transcription benchmark
   (`data/eval_qormada/synth/*.wav` + `truth.json`, made by
   `apps/ai-service/scripts/synth_somali_bench.py`, which is shipped with it);
3. only with `--include-symbolic`, the Beerdilaacshe engraving
   (`apps/web/public/scores/beerdilaacshe/`), left out by default because the
   credit to the composer rests on one secondary source and no permission
   from his estate is on file;
4. the Somali music glossary (`apps/web/lib/learn/glossary.json`);
5. the blind listening records (`data/listening/*.json`: votes, not audio),
   `docs/eval/TABLES.md` and the releasable model cards.

Nothing else is ever read for copying. Every path the script opens or copies
passes `assert_readable()`: it must lie under one of the ALLOWED_* roots and
must not match DENY_RE (archival Harvard audio, performer source audio and
its clips/tokens/sets, `.band` imports, annotation packs, the listening-room
`public/audio/` folder, run artefacts). A violation is a hard error.

Usage (from the repo root, with the research env):

    ~/ai/musicgen-env/bin/python apps/ai-service/scripts/build_hf_dataset.py \
        --repo-root . --data-root /path/to/checkout-with-data --out dist/hf_dataset --copy-audio
    ... --check                       # validate dist/hf_dataset, exit non-zero on any failure
    ... --push --repo-id <ns>/<name> [--public]   # owner only; needs `hf auth login` or HF_TOKEN

Standard library only. Deterministic: sorted file order, UTF-8, no trailing
whitespace, `ensure_ascii=False`. The README (dataset card) is rendered from the
built manifest, so no count in it is typed by hand.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path, PurePosixPath

DATASET_NAME = "QaraamiGen — Somali Music Reference Dataset"
DATASET_VERSION = "0.1"
GITHUB_URL = "https://github.com/KhalidIbrahem/somali-music-archive"
SITE_URL = "https://www.qaraamigen.com"
DEFAULT_REPO_ID = "<namespace>/qaraamigen-somali-music-reference"

# ─── rights ──────────────────────────────────────────────────────────────────
# Anything matching this must never be read for copying (DATA_PROVENANCE.md §1,
# §4, §8; CLAUDE.md hard rules). Matched against the posix path relative to the
# repo root or the data root, and against the absolute path.
DENY_RE = re.compile(
    r"(^|/)("
    r"data/(raw_incoming|harvard[^/]*|ahmed[^/]*|sets[^/]*|scale_clips|scale_tokens|clips[^/]*|"
    r"tokens[^/]*|oud_clips|oud_tokens|v3|v4|annotation|incoming|internet|separated|"
    r"transcription_[^/]*|proof_generation|embeddings[^/]*|reward)"
    r"|apps/web/public/audio|apps/web/public/demos/audio|runs|services/musicgen-api/outputs"
    r"|[^/]*\.band|[^/]*\.logic"
    r")(/|$)",
    re.IGNORECASE,
)
# Substrings that must never appear in a readable path at all (belt and braces).
DENY_WORDS = ("harvard", "ahmed", "raw_incoming", "ilkacase", ".band", "/public/audio/")

# What the script may open, relative to the repo root …
ALLOWED_REPO = (
    "apps/web/public/demos/gallery",
    "apps/web/public/demos/generated",
    "apps/web/public/study",
    "apps/web/public/scores/beerdilaacshe",
    "apps/web/public-audio-rights.json",
    "apps/web/lib/gallery-clips.json",
    "apps/web/lib/published-clips.json",
    "apps/web/lib/study/stimuli.json",
    "apps/web/lib/learn/glossary.json",
    "apps/ai-service/study/key.json",
    "apps/ai-service/scripts/synth_somali_bench.py",
    "apps/ai-service/scripts/build_hf_dataset.py",
    "docs/eval",
)
# … and relative to the data root (the checkout that holds the git-ignored data/).
ALLOWED_DATA = (
    "data/eval_qormada/synth",
    "data/listening",
)

RIGHTS_RE = re.compile(r"\*\*Rights class:\*\*\s*`(releasable|research_only)`")
AUDIO_RE = re.compile(r"\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm|aif|aiff)$", re.IGNORECASE)

# Licence of the model output by base-model family (read from the model card's
# "Base model" section, never from the adapter name alone):
#   MusicGen weights are CC-BY-NC 4.0 (Meta) → outputs published non-commercially;
#   ACE-Step 1.5 is MIT and its card allows commercial use of outputs → CC BY 4.0.
LICENSE_BY_FAMILY = {"musicgen": "cc-by-nc-4.0", "ace-step": "cc-by-4.0"}
DATA_LICENSE = "cc-by-4.0"  # glossary, synth bench, listening records, metadata, engraving

# Base-model names for the card's adapter table (the cards' own wording is a paragraph).
BASE_MODEL_NAMES = {
    "oud": "MusicGen small (`facebook/musicgen-small`)",
    "musicgen_small_base": "MusicGen small (`facebook/musicgen-small`)",
    "ace_clean_oud": "ACE-Step 1.5 `xl-sft` (4 B DiT)",
    "ace_songs_v4": "ACE-Step 1.5 `xl-sft` (4 B DiT)",
    "acestep_base": "ACE-Step 1.5 `xl-sft` (4 B DiT)",
}
# Display names for base models that have no gallery clip to borrow them from.
BASE_MODEL_LABELS = {
    "musicgen_small_base": ("MusicGen small (facebook/musicgen-small)", "none (base model)"),
    "acestep_base": ("ACE-Step 1.5 xl-sft (4 B)", "none (base model)"),
}
# Short training-corpus descriptions for the card, one per known adapter; the
# model card is the authority, these are its summary. Unknown adapters fall back
# to the card's own "Training data" paragraph.
CORPUS_SUMMARY = {
    "oud": "a privately shared oud (kaban) qaraami collection, 28 songs, ~8 h, performers unlisted; "
    "song-level splits (DATA_PROVENANCE.md §4)",
    "ace_clean_oud": "isolated oud stems from one consenting performer's own recordings "
    "(`clean_oud`, 5.67 unique h, 1,362 30-s windows), song-level splits (DATA_PROVENANCE.md §8)",
    "ace_songs_v4": "the same performer's own songs with machine-transcribed Somali lyrics "
    "(412 songs, ≈31 h unique audio, 60-s windows), song-level splits (DATA_PROVENANCE.md §8)",
    "musicgen_small_base": "none — the public checkpoint exactly as published",
    "acestep_base": "none — the public checkpoint exactly as published",
}

GENERATED_COLUMNS = [
    "file_name", "id", "subset", "model", "adapter", "adapter_id", "checkpoint", "prompt", "seed",
    "duration_sec", "vocals", "pcs", "voiced", "band_snr_db", "auto_pick", "rights_class",
    "model_card", "source_set", "pair", "comparison", "loudness_lufs", "license",
]
SYNTH_COLUMNS = [
    "file_name", "item", "voice", "condition", "scale_pcs", "tonic", "bpm", "offset_cents",
    "note_count", "duration_sec", "sample_rate", "channels", "license",
]
SYMBOLIC_COLUMNS = [
    "title", "composer", "composed", "engraver", "files", "note_count", "bpm", "time_signature",
    "duration_sec", "license_engraving", "note",
]
GLOSSARY_COLUMNS = [  # mirrors apps/web/lib/learn/glossaryTypes.ts GlossaryEntry, in order
    "id", "term", "variants", "english", "category", "definition", "definitionSo", "etymology",
    "related", "tags", "sources", "confidence", "listen",
]
GLOSSARY_REQUIRED = ("id", "term", "variants", "english", "category", "definition", "related",
                     "tags", "sources", "confidence")
GLOSSARY_CATEGORIES = {"genre", "form", "poetry", "dance", "ritual", "instrument", "performance", "theory",
                       "rhythm", "people", "institution", "production"}
GLOSSARY_CONFIDENCE = {"attested", "reported", "uncertain"}
TRIAL_BASE_COLUMNS = ["set", "title", "listener", "date", "seed", "protocol", "question", "pair",
                      "a_file", "b_file", "choice"]


class BuildError(Exception):
    """A hard failure: the dataset must not be built."""


class RightsError(BuildError):
    """An audio file without releasable rights evidence."""


class DenyListError(BuildError):
    """A source path on the deny list, or outside the allowed roots."""


# ─── small helpers ───────────────────────────────────────────────────────────
def deny_reason(path_str: str) -> str | None:
    """Why a path may not be read, or None. Directory patterns always apply; the
    deny words apply to every directory component and, for audio files, to the
    file name too (a listening *record* may be named after a Harvard set — it holds
    votes, not audio — but a Harvard audio file never passes)."""
    c = path_str.replace("\\", "/")
    if DENY_RE.search(c):
        return f"deny-listed path pattern: {path_str}"
    parts = c.lower().rsplit("/", 1)
    scope = c.lower() if (len(parts) == 1 or AUDIO_RE.search(parts[-1])) else parts[0]
    hit = [w for w in DENY_WORDS if w in scope]
    return f"deny-listed word {hit[0]!r} in {path_str}" if hit else None


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def posix(path: Path) -> str:
    return PurePosixPath(path).as_posix()


def rel_to(path: Path, root: Path) -> str | None:
    try:
        return posix(path.resolve().relative_to(root.resolve()))
    except ValueError:
        return None


def git_describe(repo: Path) -> dict[str, str | None]:
    out: dict[str, str | None] = {"commit": None, "branch": None}
    env = {**os.environ}
    env.setdefault("DEVELOPER_DIR", "/Library/Developer/CommandLineTools")
    for key, args in (("commit", ["rev-parse", "--short", "HEAD"]), ("branch", ["rev-parse", "--abbrev-ref", "HEAD"])):
        try:
            out[key] = subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True,
                                      text=True, env=env, timeout=20).stdout.strip() or None
        except (OSError, subprocess.SubprocessError):
            out[key] = None
    return out


def write_jsonl(path: Path, rows: list[dict], columns: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for row in rows:
            if columns is not None:
                extra = [k for k in row if k not in columns]
                if extra:
                    raise BuildError(f"{path.name}: undocumented columns {extra}")
                row = {k: row.get(k) for k in columns}
            f.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    clean = "\n".join(line.rstrip() for line in text.splitlines()).rstrip("\n") + "\n"
    path.write_text(clean, encoding="utf-8", newline="\n")


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            line = line.rstrip("\n")
            if not line:
                raise BuildError(f"{path}: blank line {n}")
            rows.append(json.loads(line))
    return rows


# ─── audio headers (stdlib only) ─────────────────────────────────────────────
_MP3_BITRATES = {  # kbps by (mpeg version 1|2, layer 1|2|3), bitrate index 1..14
    (1, 1): [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    (1, 2): [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    (1, 3): [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    (2, 1): [32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    (2, 2): [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    (2, 3): [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
_MP3_RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def _mp3_frame(b: bytes, i: int) -> tuple[int, int, int, int] | None:
    """(samples_per_frame, sample_rate, frame_length, side_info_length) of a frame header, or None."""
    if i + 4 > len(b):
        return None
    h = int.from_bytes(b[i:i + 4], "big")
    if (h >> 21) & 0x7FF != 0x7FF:
        return None
    vbits, lbits = (h >> 19) & 3, (h >> 17) & 3
    bidx, sidx, pad, mode = (h >> 12) & 15, (h >> 10) & 3, (h >> 9) & 1, (h >> 6) & 3
    if vbits == 1 or lbits == 0 or bidx in (0, 15) or sidx == 3:
        return None
    layer = 4 - lbits
    mpeg = 1 if vbits == 3 else 2
    br = _MP3_BITRATES[(mpeg, layer)][bidx - 1] * 1000
    sr = _MP3_RATES[vbits][sidx]
    if layer == 1:
        spf, flen = 384, (12 * br // sr + pad) * 4
    else:
        spf = 1152 if (layer == 2 or mpeg == 1) else 576
        flen = spf // 8 * br // sr + pad
    side = 0
    if layer == 3:
        side = (17 if mode == 3 else 32) if mpeg == 1 else (9 if mode == 3 else 17)
    return spf, sr, flen, side


def mp3_duration(path: Path) -> float | None:
    """Decoded length in seconds from the Xing/Info/VBRI frame count or a frame walk.

    Encoder delay/padding are not subtracted (ffprobe does), so values agree with
    ffprobe to within one or two frames (≤ 0.05 s). None when no frame is found.
    """
    data = path.read_bytes()
    pos, end = 0, len(data)
    if data[:3] == b"ID3" and len(data) >= 10:
        size = ((data[6] & 0x7F) << 21) | ((data[7] & 0x7F) << 14) | ((data[8] & 0x7F) << 7) | (data[9] & 0x7F)
        pos = 10 + size + (10 if data[5] & 0x10 else 0)
    if end >= 128 and data[end - 128:end - 125] == b"TAG":
        end -= 128
    frames = samples = 0
    first = True
    while pos + 4 <= end:
        fr = _mp3_frame(data, pos)
        if fr is None or (first and _mp3_frame(data, pos + fr[2]) is None and pos + fr[2] < end):
            pos += 1
            continue
        spf, sr, flen, side = fr
        if first:
            first = False
            x = pos + 4 + side
            if data[x:x + 4] in (b"Xing", b"Info"):
                flags = int.from_bytes(data[x + 4:x + 8], "big")
                if flags & 1:
                    return int.from_bytes(data[x + 8:x + 12], "big") * spf / sr
            v = pos + 4 + 32
            if data[v:v + 4] == b"VBRI":
                return int.from_bytes(data[v + 14:v + 18], "big") * spf / sr
        frames += 1
        samples += spf
        pos += flen
    return samples / sr if frames else None


def wav_info(path: Path) -> dict:
    """{duration_sec, sample_rate, channels, bits, format} from the RIFF header (PCM or float)."""
    with open(path, "rb") as f:
        head = f.read(12)
        if len(head) < 12 or head[:4] != b"RIFF" or head[8:12] != b"WAVE":
            raise BuildError(f"{path}: not a RIFF/WAVE file")
        fmt = None
        while True:
            chunk = f.read(8)
            if len(chunk) < 8:
                raise BuildError(f"{path}: no data chunk")
            cid, size = struct.unpack("<4sI", chunk)
            if cid == b"fmt ":
                fmt = struct.unpack("<HHIIHH", f.read(size)[:16])
                if size & 1:
                    f.seek(1, 1)
            elif cid == b"data":
                if fmt is None:
                    raise BuildError(f"{path}: data chunk before fmt chunk")
                audio_format, channels, sr, _rate, block_align, bits = fmt
                return {
                    "duration_sec": size // block_align / sr,
                    "sample_rate": sr,
                    "channels": channels,
                    "bits": bits,
                    "format": {1: "pcm", 3: "float", 0xFFFE: "extensible"}.get(audio_format, str(audio_format)),
                }
            else:
                f.seek(size + (size & 1), 1)


# ─── the builder ─────────────────────────────────────────────────────────────
class Builder:
    def __init__(self, repo_root: Path, data_root: Path, out: Path, copy_audio: bool, date: str, repo_id: str | None = None,
                 include_symbolic: bool = False) -> None:
        self.repo_id = repo_id or DEFAULT_REPO_ID
        self.include_symbolic = include_symbolic
        self.repo = repo_root.resolve()
        self.data = data_root.resolve()
        self.out = out.resolve()
        self.copy_audio = copy_audio
        self.date = date
        self.files: list[dict] = []  # MANIFEST entries
        self.warnings: list[str] = []
        self.subsets: dict[str, dict] = {}
        self.card_facts: dict = {}
        self._cards: dict[str, str | None] = {}

    # rights gate --------------------------------------------------------------
    def assert_readable(self, path: Path) -> Path:
        """The one gate every read and copy goes through. Returns the resolved path."""
        resolved = path.resolve()
        candidates = [posix(resolved)]
        rel_repo, rel_data = rel_to(resolved, self.repo), rel_to(resolved, self.data)
        candidates += [c for c in (rel_repo, rel_data) if c]
        for c in candidates:
            reason = deny_reason(c)
            if reason:
                raise DenyListError(reason)
        allowed = (rel_repo is not None and any(rel_repo == a or rel_repo.startswith(a + "/") for a in ALLOWED_REPO)) or (
            rel_data is not None and any(rel_data == a or rel_data.startswith(a + "/") for a in ALLOWED_DATA)
        )
        if not allowed:
            raise DenyListError(f"source outside the allowed roots: {path}")
        return resolved

    def read_json(self, path: Path):
        path = self.assert_readable(path)
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def read_text(self, path: Path) -> str:
        return self.assert_readable(path).read_text(encoding="utf-8")

    def source_label(self, src: Path) -> str:
        return rel_to(src, self.repo) or rel_to(src, self.data) or posix(src)

    def add_file(self, dst_rel: str, subset: str, source: str, evidence: str) -> None:
        dst = self.out / dst_rel
        self.files.append({
            "path": dst_rel, "subset": subset, "sha256": sha256_of(dst), "size": dst.stat().st_size,
            "source": source, "evidence": evidence,
        })

    def copy_file(self, src: Path, dst_rel: str, subset: str, evidence: str) -> None:
        src = self.assert_readable(src)
        if not evidence:
            raise RightsError(f"no rights evidence for {src}")
        dst = self.out / dst_rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        self.add_file(dst_rel, subset, self.source_label(src), evidence)

    def emit_jsonl(self, dst_rel: str, rows: list[dict], columns: list[str] | None, subset: str, source: str, evidence: str) -> None:
        write_jsonl(self.out / dst_rel, rows, columns)
        self.add_file(dst_rel, subset, source, evidence)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)
        print(f"warning: {msg}", file=sys.stderr)

    # model cards --------------------------------------------------------------
    def card_text(self, adapter: str) -> str | None:
        if adapter not in self._cards:
            p = self.repo / "docs/eval" / f"MODEL_CARD_{adapter}.md"
            self._cards[adapter] = self.read_text(p) if p.exists() else None
        return self._cards[adapter]

    @staticmethod
    def card_rights(text: str | None) -> str | None:
        if text is None:
            return None
        m = RIGHTS_RE.search(text)
        return m.group(1) if m else None

    @staticmethod
    def card_section(text: str, heading_prefix: str) -> str | None:
        """Body of the first `## <heading_prefix>…` section, or None."""
        m = re.search(rf"^## {re.escape(heading_prefix)}[^\n]*\n(.*?)(?=^## |\Z)", text, re.S | re.M)
        return m.group(1).strip() if m else None

    def card_family(self, adapter: str, text: str) -> str:
        """'musicgen' or 'ace-step' from the Base model section (or the header for base models)."""
        scope = self.card_section(text, "Base model") or "\n".join(text.splitlines()[:6])
        low = scope.lower()
        hits = [fam for fam, keys in (("musicgen", ("musicgen",)), ("ace-step", ("ace-step", "acestep"))) if any(k in low for k in keys)]
        if len(hits) != 1:
            raise RightsError(f"MODEL_CARD_{adapter}.md: cannot determine the base-model family (found {hits or 'none'})")
        return hits[0]

    def require_releasable(self, repo_rel: str, rights: dict) -> dict:
        """The rights entry of a shipped audio file, or a RightsError. Mirrors check-public-audio-rights.mjs."""
        entry = rights.get("files", {}).get(repo_rel)
        if entry is None:
            raise RightsError(f"{repo_rel}: not listed in public-audio-rights.json")
        if entry.get("kind") != "model_output":
            raise RightsError(f"{repo_rel}: kind {entry.get('kind')!r} is not model_output")
        adapter = entry.get("adapter")
        if not adapter:
            raise RightsError(f"{repo_rel}: model_output without an adapter")
        if entry.get("rights") != "releasable":
            raise RightsError(f"{repo_rel}: adapter {adapter} is {entry.get('rights') or 'unclassified'}, not releasable")
        text = self.card_text(adapter)
        if text is None:
            raise RightsError(f"{repo_rel}: no model card docs/eval/MODEL_CARD_{adapter}.md (treated as research_only)")
        from_card = self.card_rights(text)
        if from_card != "releasable":
            raise RightsError(f"{repo_rel}: MODEL_CARD_{adapter}.md says {from_card or 'nothing'} (treated as research_only)")
        family = self.card_family(adapter, text)
        return {
            "adapter": adapter, "family": family, "license": LICENSE_BY_FAMILY[family], "source": entry.get("source"),
            "evidence": (f"public-audio-rights.json[{repo_rel}]: kind=model_output, rights=releasable, adapter={adapter}; "
                         f"docs/eval/MODEL_CARD_{adapter}.md: **Rights class:** `releasable`"),
        }

    # subset 1: generated audio -------------------------------------------------
    @staticmethod
    def _source_set(prov: str | None) -> tuple[str | None, int | None]:
        if not prov:
            return None, None
        p = PurePosixPath(prov)
        folder = posix(p.parent)
        folder = folder[5:] if folder.startswith("data/") else folder
        m = re.match(r"pair(\d+)_", p.name)
        return folder, int(m.group(1)) if m else None

    def collect_generated(self) -> list[dict]:
        rights = self.read_json(self.repo / "apps/web/public-audio-rights.json")
        gallery = self.read_json(self.repo / "apps/web/lib/gallery-clips.json")
        published = self.read_json(self.repo / "apps/web/lib/published-clips.json")
        stimuli = self.read_json(self.repo / "apps/web/lib/study/stimuli.json")
        key_path = self.repo / "apps/ai-service/study/key.json"
        key = self.read_json(key_path) if key_path.exists() else {}
        if not key:
            self.warn("apps/ai-service/study/key.json not found: study clips get no prompt/seed")
        rows: list[dict] = []
        adapters: dict[str, dict] = {}
        by_provenance: dict[str, dict] = {}
        labels: dict[str, tuple[str, str]] = dict(BASE_MODEL_LABELS)

        def common(repo_rel: str, subset: str) -> tuple[dict, dict]:
            ev = self.require_releasable(repo_rel, rights)
            adapters.setdefault(ev["adapter"], {"family": ev["family"], "license": ev["license"], "rows": 0})
            adapters[ev["adapter"]]["rows"] += 1
            folder, pair = self._source_set(ev["source"])
            base = {
                "file_name": f"{subset}/{PurePosixPath(repo_rel).name}", "subset": subset, "adapter_id": ev["adapter"],
                "rights_class": "releasable", "model_card": f"results/MODEL_CARD_{ev['adapter']}.md",
                "source_set": folder, "pair": pair, "comparison": None, "loudness_lufs": None, "license": ev["license"],
                "_src": self.repo / repo_rel, "_evidence": ev["evidence"], "_prov": ev["source"],
            }
            return base, ev

        for group in gallery.get("groups", []):
            for section in group.get("sections", []):
                for c in section.get("clips", []):
                    repo_rel = "apps/web/public" + c["file"]
                    row, _ = common(repo_rel, "gallery")
                    row.update({
                        "id": c["id"], "model": c.get("model"), "adapter": c.get("adapter"), "checkpoint": c.get("checkpoint"),
                        "prompt": c.get("prompt"), "seed": c.get("seed"), "duration_sec": c.get("durationSec"),
                        "vocals": c.get("vocals"), "pcs": c.get("pcs"), "voiced": c.get("voiced"),
                        "band_snr_db": c.get("bandSnrDb"), "auto_pick": c.get("autoPick"),
                    })
                    labels.setdefault(row["adapter_id"], (c.get("model"), c.get("adapter")))
                    if row["_prov"]:
                        by_provenance.setdefault(row["_prov"], row)
                    rows.append(row)

        listen_extra = {c["id"]: c for c in published.get("listen", {}).get("clips", [])}
        for c in published.get("generate", []):
            repo_rel = "apps/web/public" + c["file"]
            row, _ = common(repo_rel, "generate")
            extra = listen_extra.get(c["id"], {})
            row.update({
                "id": c["id"], "model": c.get("model"), "adapter": c.get("adapter"), "checkpoint": c.get("checkpoint"),
                "prompt": c.get("prompt"), "seed": c.get("seed"), "duration_sec": c.get("durationSec"),
                "vocals": c.get("vocals", False), "pcs": c.get("pcs"), "voiced": c.get("voiced"),
                "band_snr_db": c.get("bandSnrDb", extra.get("bandSnrDb")), "auto_pick": None,
            })
            rows.append(row)

        lufs = stimuli.get("loudnessLufs")
        for comp in stimuli.get("comparisons", []):
            for pair in comp.get("pairs", []):
                for clip_id in pair.get("clips", []):
                    repo_rel = f"apps/web/public/study/{clip_id}.mp3"
                    row, ev = common(repo_rel, "study")
                    k = key.get(clip_id, {})
                    if k and (k.get("set") != comp["id"] or k.get("pair") != pair.get("pair")):
                        self.warn(f"study clip {clip_id}: key.json says {k.get('set')}/{k.get('pair')}, stimuli.json says {comp['id']}/{pair.get('pair')}")
                    twin = by_provenance.get(ev["source"] or "")
                    model, adapter_label = labels.get(ev["adapter"], (None, None))
                    row.update({
                        "id": clip_id, "model": twin["model"] if twin else model,
                        "adapter": twin["adapter"] if twin else adapter_label,
                        "checkpoint": twin["checkpoint"] if twin else None,
                        "prompt": k.get("caption") if k else (twin["prompt"] if twin else None),
                        "seed": k.get("seed") if k else (twin["seed"] if twin else None),
                        "duration_sec": None, "vocals": comp["id"] == "songs",
                        "pcs": twin["pcs"] if twin else None, "voiced": twin["voiced"] if twin else None,
                        "band_snr_db": twin["band_snr_db"] if twin else None, "auto_pick": None,
                        "pair": pair.get("pair"), "comparison": comp["id"], "loudness_lufs": lufs,
                    })
                    rows.append(row)

        # Study durations come from the MP3 itself (no durationSec in stimuli.json).
        for row in rows:
            if row["subset"] == "study":
                d = mp3_duration(self.assert_readable(row["_src"]))
                row["duration_sec"] = round(d, 2) if d is not None else (key.get(row["id"], {}).get("seconds"))

        # Releasable files listed in the rights manifest but absent from the site's JSON have no metadata: skipped, not silently.
        covered = {rel_to(r["_src"], self.repo) for r in rows}
        for repo_rel, e in sorted(rights.get("files", {}).items()):
            if e.get("kind") == "model_output" and e.get("rights") == "releasable" and repo_rel not in covered and any(
                repo_rel.startswith(p) for p in ("apps/web/public/demos/gallery/", "apps/web/public/demos/generated/", "apps/web/public/study/")
            ):
                self.warn(f"{repo_rel} is releasable but has no metadata in gallery-clips/published-clips/stimuli: not included")

        order = {"gallery": 0, "generate": 1, "study": 2}
        rows.sort(key=lambda r: (order[r["subset"]], r["file_name"]))
        seen = set()
        for r in rows:
            if r["file_name"] in seen:
                raise BuildError(f"duplicate output file {r['file_name']}")
            seen.add(r["file_name"])
        self.card_facts["adapters"] = adapters
        self.card_facts["study_lufs"] = lufs
        return rows

    def build_generated(self) -> None:
        rows = self.collect_generated()
        n_bytes = 0
        for r in rows:
            if self.copy_audio:
                self.copy_file(r["_src"], f"generated_audio/{r['file_name']}", "generated_audio", r["_evidence"])
                n_bytes += r["_src"].stat().st_size
        public = [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows]
        self.emit_jsonl("generated_audio/metadata.jsonl", public, GENERATED_COLUMNS, "generated_audio",
                        "apps/web/lib/gallery-clips.json + apps/web/lib/published-clips.json + apps/web/lib/study/stimuli.json + apps/ai-service/study/key.json + apps/web/public-audio-rights.json",
                        "metadata written by this script; every row's audio passed the rights gate (see its own manifest entry)")
        self.subsets["generated_audio"] = {
            "rows": len(public), "audio_files": len(public) if self.copy_audio else 0, "audio_bytes": n_bytes,
            "by_subset": {s: sum(1 for r in public if r["subset"] == s) for s in ("gallery", "generate", "study")},
        }

    # subset 2: synthetic benchmark ---------------------------------------------
    def build_synth(self) -> None:
        synth_dir = self.data / "data/eval_qormada/synth"
        truth_path = synth_dir / "truth.json"
        if not truth_path.exists():
            raise BuildError(f"synthetic benchmark truth missing: {truth_path}")
        truth = self.read_json(truth_path)
        wavs = sorted(p.name for p in synth_dir.glob("*.wav"))
        missing = sorted(set(truth) - set(wavs))
        extra = sorted(set(wavs) - set(truth))
        if missing or extra:
            raise BuildError(f"synth bench: truth/wav mismatch (missing {missing[:3]}, untracked {extra[:3]})")
        evidence = "synthesised by apps/ai-service/scripts/synth_somali_bench.py (Karplus-Strong / additive voice; no recording involved); truth.json entry present"
        meta_rows, truth_rows, n_bytes = [], [], 0
        for name in wavs:
            t = truth[name]
            src = self.assert_readable(synth_dir / name)
            info = wav_info(src)
            notes = [
                {"onset": n["onset"], "offset": n["offset"], "midi": n["midi"], "cents": n["cents"],
                 "pitch_hz": 440.0 * 2 ** ((n["midi"] + n["cents"] / 100 - 69) / 12)}
                for n in t["notes"]
            ]
            meta_rows.append({
                "file_name": name, "item": t["item"], "voice": t["register"], "condition": t["condition"],
                "scale_pcs": t["scale_pcs"], "tonic": t["tonic"], "bpm": t["bpm"], "offset_cents": t["offset_cents"],
                "note_count": len(notes), "duration_sec": round(info["duration_sec"], 4),
                "sample_rate": info["sample_rate"], "channels": info["channels"], "license": DATA_LICENSE,
            })
            truth_rows.append({"file_name": name, "notes": notes})
            if self.copy_audio:
                self.copy_file(src, f"synth_bench/{name}", "synth_bench", evidence)
                n_bytes += src.stat().st_size
        self.emit_jsonl("synth_bench/metadata.jsonl", meta_rows, SYNTH_COLUMNS, "synth_bench", "data/eval_qormada/synth/truth.json", evidence)
        self.emit_jsonl("synth_bench/truth.jsonl", truth_rows, ["file_name", "notes"], "synth_bench", "data/eval_qormada/synth/truth.json", evidence)
        gen = self.repo / "apps/ai-service/scripts/synth_somali_bench.py"
        if not gen.exists():
            raise BuildError(f"generator script missing: {gen}")
        self.copy_file(gen, "synth_bench/synth_somali_bench.py", "synth_bench", "the project's own generator script (Apache-2.0 repository)")
        fmt = {(r["sample_rate"], r["channels"]) for r in meta_rows}
        self.subsets["synth_bench"] = {
            "rows": len(meta_rows), "truth_rows": len(truth_rows), "audio_files": len(wavs) if self.copy_audio else 0,
            "audio_bytes": n_bytes, "items": len({r["item"] for r in meta_rows}),
            "conditions": sorted({r["condition"] for r in meta_rows}), "voices": sorted({r["voice"] for r in meta_rows}),
            "notes": sum(r["note_count"] for r in meta_rows), "formats": sorted(f"{sr} Hz, {ch} ch" for sr, ch in fmt),
            "wav_encoding": info["format"] if wavs else None, "bits": info["bits"] if wavs else None,
        }

    # subset 3: symbolic ----------------------------------------------------------
    def build_symbolic(self) -> None:
        src_dir = self.repo / "apps/web/public/scores/beerdilaacshe"
        names = ["Beerdilaacshe.ly", "Beerdilaacshe.midi", "Beerdilaacshe.pdf", "Beerdilaacshe.png", "notes.json"]
        evidence = ("DATA_PROVENANCE.md §2: melody composed by Abdillahi Qarshe (1950s); engraving, MIDI and note list by "
                    "Khalid Ibrahim, public at www.qaraamigen.com/scores/beerdilaacshe")
        for n in names:
            p = src_dir / n
            if not p.exists():
                raise BuildError(f"symbolic: {p} missing")
            self.copy_file(p, f"symbolic/beerdilaacshe/{n}", "symbolic", evidence)
        notes = self.read_json(src_dir / "notes.json")
        row = {
            "title": "Beerdilaacshe", "composer": "Abdillahi Qarshe", "composed": "1950s", "engraver": "Khalid Ibrahim",
            "files": [f"beerdilaacshe/{n}" for n in names], "note_count": notes.get("noteCount", len(notes.get("notes", []))),
            "bpm": notes.get("bpm"), "time_signature": notes.get("timeSignature"), "duration_sec": notes.get("durationSec"),
            "license_engraving": DATA_LICENSE,
            "note": ("The engraving (LilyPond source, PDF, PNG), the MIDI rendering and notes.json are the project's own work, "
                     "CC BY 4.0. The melody itself is a 1950s composition by Abdillahi Qarshe: its copyright status must be "
                     "confirmed by the dataset owner before anyone relies on it beyond study and citation."),
        }
        self.emit_jsonl("symbolic/metadata.jsonl", [row], SYMBOLIC_COLUMNS, "symbolic", "apps/web/public/scores/beerdilaacshe/notes.json", evidence)
        self.subsets["symbolic"] = {"rows": 1, "files": len(names), "note_count": row["note_count"], "bpm": row["bpm"],
                                    "time_signature": row["time_signature"], "duration_sec": row["duration_sec"]}

    # subset 4: glossary ----------------------------------------------------------
    def build_glossary(self) -> None:
        p = self.repo / "apps/web/lib/learn/glossary.json"
        if not p.exists():
            self.warn("glossary: apps/web/lib/learn/glossary.json not present; subset skipped")
            return
        g = self.read_json(p)
        entries = g.get("entries", [])
        rows = []
        ids = set()
        for e in entries:
            for k in GLOSSARY_REQUIRED:
                if k not in e:
                    raise BuildError(f"glossary entry {e.get('id')!r}: missing field {k}")
            if e["category"] not in GLOSSARY_CATEGORIES:
                raise BuildError(f"glossary entry {e['id']}: unknown category {e['category']!r}")
            if e["confidence"] not in GLOSSARY_CONFIDENCE:
                raise BuildError(f"glossary entry {e['id']}: unknown confidence {e['confidence']!r}")
            unknown = [k for k in e if k not in GLOSSARY_COLUMNS]
            if unknown:
                raise BuildError(f"glossary entry {e['id']}: fields {unknown} are not in glossaryTypes.ts")
            if e["id"] in ids:
                raise BuildError(f"glossary: duplicate id {e['id']}")
            ids.add(e["id"])
            rows.append({k: e.get(k) for k in GLOSSARY_COLUMNS})
        rows.sort(key=lambda r: r["id"])
        dangling = sorted({r for e in rows for r in e["related"] if r not in ids})
        if dangling:
            self.warn(f"glossary: related ids without an entry: {dangling}")
        lic = str(g.get("license", ""))
        if re.sub(r"[^a-z0-9]", "", lic.lower()) != "ccby40":
            self.warn(f"glossary.json declares licence {lic!r}; the card states CC BY 4.0")
        self.emit_jsonl("glossary/glossary.jsonl", rows, GLOSSARY_COLUMNS, "glossary", "apps/web/lib/learn/glossary.json",
                        f"project-authored glossary (apps/web/lib/learn/glossary.json v{g.get('version')}, updated {g.get('updated')}, licence {lic})")
        from collections import Counter
        self.subsets["glossary"] = {
            "rows": len(rows), "version": g.get("version"), "updated": g.get("updated"), "file_license": lic,
            "by_confidence": dict(sorted(Counter(r["confidence"] for r in rows).items())),
            "by_category": dict(sorted(Counter(r["category"] for r in rows).items())),
            "with_somali_definition": sum(1 for r in rows if r.get("definitionSo")),
        }

    # subset 5: listening records -------------------------------------------------
    @staticmethod
    def _basename(value):
        if isinstance(value, str) and AUDIO_RE.search(value):
            return PurePosixPath(value).name
        return value

    def build_listening(self) -> None:
        rec_dir = self.data / "data/listening"
        records = sorted(rec_dir.glob("*.json")) if rec_dir.exists() else []
        if not records:
            self.warn("listening: no data/listening/*.json records found; subset skipped")
            return
        evidence = "blind listening record: captions, A/B order and votes only — no audio, file names reduced to basenames"
        trials, summaries, pair_keys = [], [], []
        parsed = []
        for p in records:
            d = self.read_json(p)
            parsed.append((p.name, d))
            for pair in d.get("pairs", []):
                for k in pair:
                    if k not in pair_keys and k != "pair":
                        pair_keys.append(k)
        extra_cols = [k for k in pair_keys if k not in TRIAL_BASE_COLUMNS]
        for name, d in parsed:
            head = {k: d.get(k) for k in ("set", "title", "listener", "date", "seed", "protocol", "question")}
            for pair in d.get("pairs", []):
                files = [self._basename(v) for v in pair.values() if isinstance(v, str) and AUDIO_RE.search(v)]
                preferred = pair.get("preferred")
                choice = {"none": "neither", "neither": "neither", "adapter": "adapter", "base": "base"}.get(preferred, preferred)
                # Basenames only: the records on file carry local directory names, which say
                # nothing a reader needs and must not leak storage layout.
                a_file = pair.get("a_file", files[0] if len(files) > 0 else None)
                b_file = pair.get("b_file", files[1] if len(files) > 1 else None)
                row = {**head, "pair": pair.get("pair"),
                       "a_file": PurePosixPath(a_file).name if isinstance(a_file, str) else a_file,
                       "b_file": PurePosixPath(b_file).name if isinstance(b_file, str) else b_file, "choice": choice}
                for k in extra_cols:
                    row[k] = self._basename(pair.get(k))
                row["record"] = name
                trials.append(row)
            s = {**head, "n_pairs": len(d.get("pairs", [])), "record": name}
            for k, v in (d.get("summary") or {}).items():
                if isinstance(v, list) and len(v) == 2 and all(isinstance(x, (int, float)) for x in v):
                    s[f"{k}_low"], s[f"{k}_high"] = v
                else:
                    s[k] = v
            summaries.append(s)
        trial_cols = TRIAL_BASE_COLUMNS + extra_cols + ["record"]
        sum_cols = []
        for s in summaries:
            for k in s:
                if k not in sum_cols:
                    sum_cols.append(k)
        self.emit_jsonl("listening/trials.jsonl", trials, trial_cols, "listening", "data/listening/*.json", evidence)
        self.emit_jsonl("listening/summary.jsonl", summaries, sum_cols, "listening", "data/listening/*.json", evidence)
        self.subsets["listening"] = {
            "rows": len(trials), "sittings": len(summaries), "sets": sorted({s["set"] for s in summaries if s.get("set")}),
            "listeners": sorted({s["listener"] for s in summaries if s.get("listener")}),
            "dates": [min(s["date"] for s in summaries if s.get("date"))[:10], max(s["date"] for s in summaries if s.get("date"))[:10]],
            "protocols": sorted({s["protocol"] for s in summaries if s.get("protocol")}),
        }

    # results, scripts ------------------------------------------------------------
    def build_results(self) -> None:
        tables = self.repo / "docs/eval/TABLES.md"
        n = 0
        if tables.exists():
            self.copy_file(tables, "results/TABLES.md", "results", "results tables (text, public in the GitHub repository)")
            n += 1
        else:
            self.warn("docs/eval/TABLES.md not found")
        cards = []
        for p in sorted((self.repo / "docs/eval").glob("MODEL_CARD_*.md")):
            text = self.read_text(p)
            rights = self.card_rights(text)
            if rights == "releasable":
                self.copy_file(p, f"results/{p.name}", "results", f"{p.name}: **Rights class:** `releasable`")
                cards.append(p.name)
                n += 1
            else:
                self.warn(f"{p.name}: Rights class {rights or 'missing'}; card not shipped (its outputs are not in this dataset)")
        self.subsets["results"] = {"files": n, "model_cards": cards}
        # The script copies itself for reproducibility. It is trusted by
        # construction (it IS this file), so it bypasses the source gate — the
        # gate is for data, and under pytest the script lives outside the
        # fixture's repo root.
        me = Path(__file__).resolve()
        dst_rel = "scripts/build_hf_dataset.py"
        dst = self.out / dst_rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(me, dst)
        self.add_file(dst_rel, "scripts", "apps/ai-service/scripts/build_hf_dataset.py", "this build script")
        self.subsets["scripts"] = {"files": 1}

    # README + MANIFEST ---------------------------------------------------------------
    def build(self) -> dict:
        marker = self.out / ".qaraamigen-build-in-progress"
        if self.out.exists():
            ours = (self.out / "MANIFEST.json").exists() or marker.exists() or not any(self.out.iterdir())
            if not ours:
                raise BuildError(f"{self.out} exists, is not empty and was not built by this script: refusing to overwrite")
            shutil.rmtree(self.out)
        self.out.mkdir(parents=True)
        marker.write_text("a build is running or failed; the folder may be deleted by the next build\n", encoding="utf-8")
        self.build_generated()
        self.build_synth()
        if self.include_symbolic:
            self.build_symbolic()
        self.build_glossary()
        self.build_listening()
        self.build_results()
        git = git_describe(self.repo)
        manifest = {
            "dataset": DATASET_NAME, "version": DATASET_VERSION, "built": self.date, "audio_copied": self.copy_audio,
            "repo_commit": git["commit"], "repo_branch": git["branch"], "github": GITHUB_URL,
            "skipped": sorted(self.warnings), "subsets": self.subsets, "files": [],
        }
        write_text(self.out / "README.md", render_card(manifest, self.files, self.card_facts, self))
        self.add_file("README.md", "card", "rendered by scripts/build_hf_dataset.py from MANIFEST.json data", "dataset card")
        manifest["files"] = sorted(self.files, key=lambda f: f["path"])
        with open(self.out / "MANIFEST.json", "w", encoding="utf-8", newline="\n") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=1)
            f.write("\n")
        marker.unlink()
        return manifest


# ─── dataset card ───────────────────────────────────────────────────────────────
def _mb(n: int) -> str:
    return f"{n / 1e6:.1f} MB"


def size_category(n: int) -> str:
    for limit, label in ((1_000, "n<1K"), (10_000, "1K<n<10K"), (100_000, "10K<n<100K"), (1_000_000, "100K<n<1M")):
        if n < limit:
            return label
    return "1M<n<10M"


def yaml_configs(audio_copied: bool, subsets: dict) -> str:
    """The Hub `configs:` block.

    Rules followed (checked 2026-11-07 against the Hub docs and the project's
    research note `docs/research/.../hf_dataset_reference_design.md`):
    - "Audio Dataset": extra columns come from a `metadata.jsonl` with a
      `file_name` column placed beside or above the audio files; when it sits in
      a parent directory, `file_name` is the full relative path
      (`gallery/x.mp3`). The folder-based builder only uses a metadata file that
      is among the config's data files, so each audio config lists the
      `metadata.jsonl` AND the audio glob.
    - "Manual Configuration": one `config_name` per subset (required even for
      one), `data_files` as `[{split, path}]` with globs, `default: true` on the
      subset the viewer opens first, builder parameters per config
      (`drop_labels: true`, because the gallery/generate/study sub-folders are
      not class labels).
    - Without `--copy-audio` the audio configs point only at their
      `metadata.jsonl` (plain JSON tables); builder parameters that the JSON
      builder does not know are then left out.
    """
    lines = ["configs:"]

    def audio_cfg(name: str, meta: str, glob: str, split: str, default: bool) -> None:
        lines.append(f"- config_name: {name}")
        if default:
            lines.append("  default: true")
        if audio_copied:
            lines.append("  drop_labels: true")
        lines.append("  data_files:")
        lines.append(f"  - split: {split}")
        if audio_copied:
            lines.append("    path:")
            lines.append(f'    - "{meta}"')
            lines.append(f'    - "{glob}"')
        else:
            lines.append(f'    path: "{meta}"')

    def table_cfg(name: str, path: str, split: str = "train") -> None:
        lines.append(f"- config_name: {name}")
        lines.append("  data_files:")
        lines.append(f"  - split: {split}")
        lines.append(f'    path: "{path}"')

    audio_cfg("generated_audio", "generated_audio/metadata.jsonl", "generated_audio/*/*.mp3", "train", True)
    audio_cfg("synth_bench", "synth_bench/metadata.jsonl", "synth_bench/*.wav", "test", False)
    table_cfg("synth_bench_truth", "synth_bench/truth.jsonl", "test")
    if "glossary" in subsets:
        table_cfg("glossary", "glossary/glossary.jsonl")
    if "symbolic" in subsets:
        table_cfg("symbolic", "symbolic/metadata.jsonl")
    if "listening" in subsets:
        table_cfg("listening_trials", "listening/trials.jsonl")
        table_cfg("listening_summary", "listening/summary.jsonl")
    return "\n".join(lines)


def render_card(manifest: dict, files: list[dict], facts: dict, b: Builder) -> str:
    s = manifest["subsets"]
    audio = manifest["audio_copied"]
    gen, syn, sym = s["generated_audio"], s["synth_bench"], s.get("symbolic")
    glo, lis, res = s.get("glossary"), s.get("listening"), s["results"]
    adapters = facts.get("adapters", {})
    n_rows = gen["rows"] + syn["rows"] + syn["truth_rows"] + (sym["rows"] if sym else 0) + (glo["rows"] if glo else 0) + (lis["rows"] + lis["sittings"] if lis else 0)
    bytes_by_subset: dict[str, int] = {}
    for f in files:
        bytes_by_subset[f["subset"]] = bytes_by_subset.get(f["subset"], 0) + f["size"]
    total_bytes = sum(bytes_by_subset.values())
    licences = sorted({a["license"] for a in adapters.values()} | {DATA_LICENSE})
    date, version, commit = manifest["built"], manifest["version"], manifest["repo_commit"] or "unknown"

    adapter_rows = []
    for name, a in sorted(adapters.items()):
        text = b.card_text(name) or ""
        base = BASE_MODEL_NAMES.get(name) or ((b.card_section(text, "Base model") or "").split("\n")[0].strip()[:90] or {"musicgen": "MusicGen", "ace-step": "ACE-Step 1.5"}[a["family"]])
        corpus = CORPUS_SUMMARY.get(name) or (b.card_section(text, "Training data") or "see the model card").split("\n")[0]
        adapter_rows.append(f"| `{name}` | {base} | {corpus} | releasable | {a['rows']} | `{a['license']}` |")
    adapter_table = "\n".join(adapter_rows) or "| — | — | — | — | — | — |"

    subset_rows = [
        f"| `generated_audio` | `generated_audio` | {gen['rows']} | {gen['audio_files']} MP3 | {_mb(bytes_by_subset.get('generated_audio', 0))} | per row: `cc-by-4.0` (ACE-Step outputs) or `cc-by-nc-4.0` (MusicGen outputs) | model output published on {SITE_URL}: gallery {gen['by_subset']['gallery']}, Generate page {gen['by_subset']['generate']}, blind-study stimuli {gen['by_subset']['study']} |",
        f"| `synth_bench` | `synth_bench`, `synth_bench_truth` | {syn['rows']} + {syn['truth_rows']} | {syn['audio_files']} WAV | {_mb(bytes_by_subset.get('synth_bench', 0))} | `cc-by-4.0` | synthetic pentatonic melodies with exact note truth; {syn['items']} items × {len(syn['conditions'])} conditions |",
    ]
    if sym:
        subset_rows.append(f"| `symbolic` | `symbolic` | {sym['rows']} | {sym['files']} | {_mb(bytes_by_subset.get('symbolic', 0))} | `cc-by-4.0` (engraving) | Beerdilaacshe: LilyPond, MIDI, PDF, PNG, note list |")
    if glo:
        subset_rows.append(f"| `glossary` | `glossary` | {glo['rows']} | 1 | {_mb(bytes_by_subset.get('glossary', 0))} | `cc-by-4.0` | Somali music terms with English glosses, definitions, sources, confidence |")
    if lis:
        subset_rows.append(f"| `listening` | `listening_trials`, `listening_summary` | {lis['rows']} + {lis['sittings']} | 2 | {_mb(bytes_by_subset.get('listening', 0))} | `cc-by-4.0` | blind paired-comparison votes from {lis['sittings']} sittings ({lis['dates'][0]} to {lis['dates'][1]}) |")
    subset_rows.append(f"| `results` | — | — | {res['files']} | {_mb(bytes_by_subset.get('results', 0))} | `cc-by-4.0` | `TABLES.md` and the releasable model cards |")
    subset_table = "\n".join(subset_rows)

    audio_note = (
        "Audio files are included." if audio
        else "**This build was made without `--copy-audio`: the audio files are not included, only their metadata.** Rebuild with `--copy-audio` to ship them."
    )
    skipped = manifest["skipped"]
    skipped_md = "\n".join(f"- {w}" for w in skipped) if skipped else "- none"
    tree_lines = ["README.md", "MANIFEST.json", "generated_audio/metadata.jsonl"]
    if audio:
        tree_lines += ["generated_audio/gallery/*.mp3", "generated_audio/generate/*.mp3", "generated_audio/study/*.mp3"]
    tree_lines += ["synth_bench/metadata.jsonl", "synth_bench/truth.jsonl"]
    if audio:
        tree_lines.append("synth_bench/*.wav")
    tree_lines.append("synth_bench/synth_somali_bench.py")
    if sym:
        tree_lines += ["symbolic/metadata.jsonl", "symbolic/beerdilaacshe/{Beerdilaacshe.ly,.midi,.pdf,.png,notes.json}"]
    if glo:
        tree_lines.append("glossary/glossary.jsonl")
    if lis:
        tree_lines += ["listening/trials.jsonl", "listening/summary.jsonl"]
    tree_lines += ["results/TABLES.md", "results/MODEL_CARD_*.md", "scripts/build_hf_dataset.py"]
    tree = "\n".join(tree_lines)
    gl_conf = ", ".join(f"{k} {v}" for k, v in glo["by_confidence"].items()) if glo else ""
    sym_summary = f"| engraved score (Beerdilaacshe) | {sym['rows']} | {sym['files']} | {_mb(bytes_by_subset.get('symbolic', 0))} |\n" if sym else ""
    remains_extra = "symbolic data, " if sym else ""
    engraving_claim = "engraving " if sym else ""
    plain_files = "symbolic files and the model cards are" if sym else "the model cards are"
    no_engraving = "" if sym else (
        "**No score of Beerdilaacshe in this version.** The project's engraving is public on the website, but the\n"
        "melody is a third party's composition: the credit to Abdillahi Qarshe rests on one secondary source (Geeska,\n"
        "2025), its date is unsourced, he died in the 1990s so any life-based copyright term is still running, and no\n"
        "permission from his estate is on file. A CC BY grant could not cover the melody, so the files are held back. "
    )
    symbolic_section = "" if not sym else (
        "### `symbolic` — Beerdilaacshe\n\n"
        f"A qaraami melody credited to **Abdillahi Qarshe** (the credit rests on one secondary source, Geeska 2025, and its date is\n"
        f"unsourced), engraved by **Khalid Ibrahim** in LilyPond (`Beerdilaacshe.ly`, with PDF and PNG renderings), rendered to MIDI,\n"
        f"and parsed to `notes.json` ({sym['note_count']} notes, {sym['bpm']} BPM, {sym['time_signature']}, {sym['duration_sec']} s). "
        f"The engraving, MIDI and note list are the\nproject's own work and public at {SITE_URL}/scores/beerdilaacshe. The "
        "melody's copyright status is the owner's to confirm before relying on it\nbeyond study and citation.\n\n"
    )
    symbolic_license_row = "" if not sym else "| `symbolic` | `cc-by-4.0` for the engraving, MIDI and note list | composer credit: Abdillahi Qarshe; the melody's copyright status is to be confirmed by the owner |\n"
    lis_sets = ", ".join(f"`{x}`" for x in lis["sets"]) if lis else ""
    lis_listeners = ", ".join(lis["listeners"]) if lis else ""
    study_lufs = facts.get("study_lufs")
    header = f"""---
pretty_name: "{DATASET_NAME}"
language:
- so
- en
multilinguality:
- multilingual
license:
{chr(10).join('- ' + lic for lic in licences)}
tags:
- music
- audio
- somali
- qaraami
- oud
- kaban
- pentatonic
- music-information-retrieval
- text-to-music
- transcription
- glossary
- terminology
- synthetic
task_categories:
- text-to-audio
- audio-classification
annotations_creators:
- machine-generated
- expert-generated
language_creators:
- expert-generated
source_datasets:
- original
size_categories:
- {size_category(n_rows)}
{yaml_configs(audio, s)}
---"""

    body = f"""
# {DATASET_NAME} (v{version})

Reference material from **QaraamiGen**, a research programme adapting open music-generation models and a
browser transcriber to Somali *qaraami* (the oud-and-voice song style of the 1940s–1970s) by Khalid Ibrahim.
Everything here is either model output that is already public on {SITE_URL}, or the project's own
synthesis, engraving, annotations, votes or vocabulary. Built {date} from commit `{commit}` of
[{GITHUB_URL}]({GITHUB_URL}) by `scripts/build_hf_dataset.py`; `MANIFEST.json` lists every file with its
SHA-256, size, source path and rights evidence.

## Summary

| what | rows | files | size |
| --- | --- | --- | --- |
| model-generated clips with prompt, seed, adapter, metrics | {gen['rows']} | {gen['audio_files']} MP3 | {_mb(bytes_by_subset.get('generated_audio', 0))} |
| synthetic transcription benchmark with note-level truth | {syn['rows']} | {syn['audio_files']} WAV | {_mb(bytes_by_subset.get('synth_bench', 0))} |
{sym_summary}| glossary entries | {glo['rows'] if glo else 'not built'} | {1 if glo else 0} | {_mb(bytes_by_subset.get('glossary', 0))} |
| blind listening trials / sittings | {f"{lis['rows']} / {lis['sittings']}" if lis else 'not built'} | {2 if lis else 0} | {_mb(bytes_by_subset.get('listening', 0))} |
| results tables and model cards | — | {res['files']} | {_mb(bytes_by_subset.get('results', 0))} |
| **total** | | **{len(files)} data files** (plus this card and `MANIFEST.json`) | **{_mb(total_bytes)}** |

{audio_note}

### What is deliberately absent, and why

**No archival recordings.** The Maryan "Aryette" Omar Ali Collection (Harvard Loeb Music Library, AWM Spec
Coll 103, ~24 h of 1955–1991 Somali song) is research-only until the Library's written permission is on
file; none of its audio, clips, tokens or derived stems is here, and none of the adapters trained on it
(`harvard_raw`, `medium`, `large`, `qaraami_all`, the DPO variants) has a single clip in this dataset.
**No performer source audio.** Ahmed Ilkacase's oud collection and session recordings were given to the
project for *training*; the consent covers publishing model outputs, not redistributing the recordings,
so the source audio, its 15/30/60-second clips, EnCodec tokens, stems and transcripts stay out.
**No `.band`/GarageBand imports or internet-acquired audio** (mixed or unverified rights). **No archive
members' uploads.** {no_engraving}What remains is model output, synthetic audio, {remains_extra}listening
records, evaluation tables and a glossary — and the build script refuses, with a non-zero exit, any file
whose rights evidence is missing (see *Rights gate* below).

## Subsets

| subset | viewer config(s) | rows | files | size | licence | contents |
| --- | --- | --- | --- | --- | --- | --- |
{subset_table}

Layout:

```
{tree}
```

Loading:

```python
from datasets import load_dataset
clips = load_dataset("{b.repo_id}", "generated_audio", split="train")
bench = load_dataset("{b.repo_id}", "synth_bench", split="test")
truth = load_dataset("{b.repo_id}", "synth_bench_truth", split="test")
# {plain_files} plain files: huggingface_hub.snapshot_download(..., repo_type="dataset")
```

## Provenance

### Rights gate

A clip enters `generated_audio` only if (1) it is listed in the website's `apps/web/public-audio-rights.json`
as `kind: model_output` with `rights: releasable`, (2) the adapter's model card
(`results/MODEL_CARD_<adapter>.md`) carries the line ``**Rights class:** `releasable` ``, and (3) the file is
copied from the public website folders, never from the research `data/` tree. The build script also carries
a deny list (Harvard, performer sources, clips, tokens, `.band`, annotation packs, run artefacts, the members'
listening room) that every read and copy is checked against. `MANIFEST.json` records the evidence per file.

### `generated_audio` — {gen['rows']} clips from {len(adapters)} models

| adapter_id | base model | training corpus (described, never distributed) | rights class | clips | licence |
| --- | --- | --- | --- | --- | --- |
{adapter_table}

Three site sources, kept apart by sub-folder and by the `subset` column: **gallery** ({gen['by_subset']['gallery']} clips,
{SITE_URL}/gallery: every releasable generation, including best-of-32 pools and per-epoch checkpoints, so
quality varies by design), **generate** ({gen['by_subset']['generate']} clips the Generate page shows when no
service is attached; a curated top-4-of-16 plus two MusicGen oud examples) and **study**
({gen['by_subset']['study']} loudness-matched stimuli of the blind study at {SITE_URL}/study, cut to 10–20 s,
EBU R128 {study_lufs} LUFS, opaque file names; `comparison` and `pair` say which base/adapter pair they form).
The same generation can appear in two sub-folders at different encodes (e.g. a gallery clip and its study
cut); `source_set` + `pair`/`id` identify the generation.

Columns: `file_name` (relative to `generated_audio/`), `id` (site id), `subset`, `model`, `adapter`,
`adapter_id`, `checkpoint`, `prompt` (the text caption given to the model; study base clips share the
caption and seed of their adapter twin by protocol), `seed`, `duration_sec` (the generation length recorded
on the site; for study clips the decoded MP3 length), `vocals`, `pcs`, `voiced`, `band_snr_db`, `auto_pick`
(true where an automatic score picked the clip out of a pool), `rights_class`, `model_card`, `source_set`
(the generation run or A/B set the clip came from), `pair`, `comparison`, `loudness_lufs`, `license`.

Automatic metrics (`apps/ai-service/scripts/pcs.py`, `showcase_final.py` in the repository):
**PCS** — Pentatonic Conformity Score, the duration-weighted fraction of voiced pitch frames (CREPE/torchcrepe
tracking, periodicity ≥ 0.5) within ±50 cents of the best-fitting anhemitonic pentatonic set after a per-clip
tuning-offset fit; **voiced** — the fraction of frames with a trackable pitch (how much melody there is;
PCS must be read together with it, since a clip with little melody can score high conformity on what is
left); **band_snr_db** — the ratio of in-band musical energy to the spectrally flat (hiss-like) residual, a
proxy for the noise the SFT adapters add. None of these is a quality claim; only blind listening is.
Seed-determinism and audit traces showing that the Generate page's output is model output rather than
playback are in `docs/eval/PROOF_OF_GENERATION.md` of the repository.

### `synth_bench` — {syn['rows']} files, {syn['items']} melodies × {len(syn['conditions'])} conditions, {syn['notes']} notes

Made by `synth_bench/synth_somali_bench.py` (shipped; `--items {syn['items']} --seed 2026`). Each item is a
pentatonic melody in one of the five rotations of the anhemitonic set (the scale family of qaraami and
heello), with a global tuning offset drawn from ±40 cents around A440 and a per-note deviation (sd 12 cents,
clipped at ±30), played by a Karplus–Strong plucked string in the oud register (`voice = oud`) or a
harmonic voice-like source with vibrato (`voice_low`, `voice_high`). Every melody is rendered in five
conditions: `clean`, `bass` (+ bass line), `bass_drums`, `noise` (+ white noise at 20 dB SNR) and `full_mix`
(bass, drums, reverb, noise). WAV {', '.join(syn['formats'])}, {syn['wav_encoding']} {syn['bits']}-bit.
Nothing comes from a recording.

`metadata.jsonl`: `file_name`, `item`, `voice`, `condition`, `scale_pcs` (the five pitch classes, 0 = C),
`tonic` (pitch class), `bpm`, `offset_cents` (the item's global tuning offset), `note_count`,
`duration_sec`, `sample_rate`, `channels`, `license`. `truth.jsonl` (config `synth_bench_truth`): one row
per file with `notes` = list of `{{onset, offset, midi, cents, pitch_hz}}` in seconds; `cents` is the note's
total deviation from the equal-tempered MIDI pitch at A440 (global offset plus per-note deviation), so the
rendered fundamental is `pitch_hz = 440 · 2^((midi + cents/100 − 69)/12)` — ready for
`mir_eval.transcription` (intervals + Hz). The project's browser transcriber (Qormada) is scored on this set
in `docs/eval/QORMADA_EVAL.md` of the repository (note F1 0.820 on the v1 set).

{symbolic_section}### `glossary` — {glo['rows'] if glo else 0} terms

{("Qaamuus: Somali music vocabulary (version " + str(glo['version']) + ", updated " + str(glo['updated']) + ") in standard Somali Latin orthography with variants, an English gloss, a definition (" + str(glo['with_somali_definition']) + " also in Somali), etymology where known, related terms, search tags in both languages, sources, and an honesty flag — `attested` (found in a cited scholarly or primary source), `reported` (widely used, documented in secondary sources), `uncertain` (heard or used, not yet verified): " + gl_conf + ". Categories: " + ", ".join(f"{k} {v}" for k, v in glo['by_category'].items()) + ". `listen` points to a studio groove preset, a scale, or a clip path on the website. Fields mirror `apps/web/lib/learn/glossaryTypes.ts` exactly.") if glo else "The glossary file was not present when this build ran; the subset is absent from this version."}

### `listening` — {lis['rows'] if lis else 0} trials from {lis['sittings'] if lis else 0} sittings

{("One row per pair of the on-record blind sittings (" + lis_sets + "; listener: " + lis_listeners + "; " + lis['dates'][0] + " to " + lis['dates'][1] + "). Columns: `set`, `title`, `listener`, `date`, `seed` (the order-randomisation seed), `protocol`, `question`, `pair`, `a_file`/`b_file` (basenames only; the records on file identify sides by condition, so these are null when no file name appears), `choice` (`adapter` / `base` / `neither`), the pair's own fields (`caption`, `A` = which condition played as A, `chosen` = A/B/none, `preferred`, `note`) and `record` (the source file). `summary.jsonl` has one row per sitting with its counts, adapter rate and Wilson 95 % interval. Most of these sets compared adapters whose audio is **not** in this dataset (Harvard-trained or unpublished): the votes are published as results, the audio is not.") if lis else "No listening records were found when this build ran."}

### `results`

`TABLES.md` (every fine-tuning run, plateau analysis, denoised control, PCS tables) and the model cards of the
releasable adapters and base models ({', '.join('`' + c + '`' for c in res['model_cards'])}). Cards of research-only adapters
are not shipped because their outputs are not here.

## Listening protocol

Paired comparison, same caption and seed on both sides, A/B order randomised per pair, scores and file
names hidden, question *"which sounds more like Somali qaraami?"*, "neither" allowed; one sitting = one set
sat in one go. The public study at {SITE_URL}/study (whose stimuli are the `study` clips) adds a background
questionnaire, 13 pairs per listener drawn from three comparisons plus an attention check (a clip against
itself), a second question (which sounds better as a recording), English and Somali text, loudness matching
at {study_lufs} LUFS, and stores no name, e-mail, IP address or user agent. Its responses are not in v{version}.

## Licences

| subset | licence | why |
| --- | --- | --- |
| `generated_audio` rows from ACE-Step 1.5 adapters and base (`ace_clean_oud`, `ace_songs_v4`, `acestep_base`) | `cc-by-4.0` | ACE-Step 1.5 is MIT-licensed and its model card permits commercial use of generated music; the LoRA training data was consented for publishing outputs |
| `generated_audio` rows from MusicGen adapters and base (`oud`, `musicgen_small_base`) | `cc-by-nc-4.0` | Meta's MusicGen weights are CC BY-NC 4.0 and say nothing about outputs; non-commercial is the conservative reading |
| `synth_bench`, `glossary`, `listening`, every `metadata.jsonl`, `MANIFEST.json`, this card | `cc-by-4.0` | the project's own synthesis, writing and records |
{symbolic_license_row}| `scripts/`, `synth_bench/synth_somali_bench.py` | Apache-2.0 | the repository's licence |

The `license` column carries the licence of every audio row. Who claims what: Khalid Ibrahim / QaraamiGen
asserts rights in the selection, arrangement, metadata, glossary, {engraving_claim}and synthesis
code, and makes no copyright claim over purely machine-generated waveforms beyond these terms; under
current US Copyright Office guidance, purely prompt-driven outputs may not be copyrightable at all, in
which case the row licence functions as terms of use rather than a copyright grant. Attribute as
"QaraamiGen — Somali Music Reference Dataset (Khalid Ibrahim, 2026)".

## Known limitations

- **One listener.** Every listening record so far is the author's own blind sitting; the multi-listener
  study is live but its responses are not in this version. Read the votes as pilot data.
- **Small n.** Sets of 8, 16 or 40 pairs; machine-metric margins at n = 16 are directional, not claims.
- **Generated, not recorded.** The clips show what adapted models produce, including a noise floor the
  MusicGen SFT adapter adds (spectral flatness 0.02–0.07 against 0.005 for the base model and 0.002 for
  real clips) and ACE-Step songs whose Somali lyrics are machine-transcribed from the performer's songs and
  can echo his words. They are not recordings of Somali music and must not be presented as archival.
- **The benchmark is cleaner than reality.** Synthetic plucked strings and additive voices have none of a
  cassette's wow, dropouts, bleed or ornamentation; scores on it bound a transcriber from above.
- **Machine metrics are proxies.** PCS, voiced ratio and band SNR come from a pitch tracker and a spectral
  heuristic; the pitch tracker's own errors (octave slips, unvoiced ornaments) are in the numbers.
- **Gallery pools are unfiltered.** Best-of-32 pools and per-epoch checkpoints include weak generations by
  design; `auto_pick` marks the ones an automatic score chose.
- **Glossary confidence varies.** Entries flagged `reported` or `uncertain` are exactly that; etymologies
  state whether they are attested or disputed.

## Ethics and community

The archive's communities are Somali musicians, poets and listeners at home and in the diaspora. Following the
CARE principles for Indigenous data governance — collective benefit, authority to control, responsibility,
ethics — the project publishes nothing recorded by a person without that person's consent for that use:
the performer whose recordings trained the releasable adapters consented to training and to publishing
*outputs*; his recordings stay private and his name is withheld from captions and metadata (the model
cards name him only as the rights holder of record). Harvard's collection waits for the Library's written
permission rather than being published under a "research use" banner. The website labels every generation
as AI model output, not a recording, and this dataset asks re-users to do the same. The glossary is a
living document that invites correction from Somali speakers and musicians; corrections and takedown
requests go to the contact below and are answered in a new version.

## Citation

```bibtex
@misc{{qaraamigen_reference_{date[:4]},
  author       = {{Ibrahim, Khalid}},
  title        = {{QaraamiGen — Somali Music Reference Dataset}},
  year         = {{{date[:4]}}},
  version      = {{{version}}},
  howpublished = {{Hugging Face dataset}},
  url          = {{{GITHUB_URL}}},
  note         = {{Model output, synthetic transcription benchmark, {remains_extra}glossary and listening records from the QaraamiGen programme; no archival recordings}}
}}
```

## Maintenance and versioning

v{version} — {date}. Built from commit `{commit}` of the repository. Future changes (new adapters, the
multi-listener study responses, glossary corrections, musician-corrected transcriptions) arrive as new
version tags on the Hub; files of a published version are never rewritten in place. Errata and the
rights decisions still open (the Harvard permission, the written consent record, the `.band` corpus,
the melody's copyright status) are tracked in the repository's `docs/DATA_PROVENANCE.md`.

Build notes for this version:
{skipped_md}

## Contact

Khalid Ibrahim — [[KHALID: contact e-mail or Hugging Face username]] — {GITHUB_URL}/issues
"""
    return header + "\n" + body


# ─── check ───────────────────────────────────────────────────────────────────────
def check(out: Path, repo_root: Path | None, data_root: Path | None) -> list[str]:
    """Validate a built folder. Returns the list of errors (empty = pass) and prints a summary table."""
    errors: list[str] = []
    out = out.resolve()
    manifest_path = out / "MANIFEST.json"
    if not manifest_path.exists():
        return [f"{manifest_path} missing"]
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return [f"MANIFEST.json does not parse: {e}"]
    entries = {f["path"]: f for f in manifest.get("files", [])}
    audio_copied = bool(manifest.get("audio_copied"))

    for rel, f in sorted(entries.items()):
        p = out / rel
        if not p.exists():
            errors.append(f"{rel}: listed in MANIFEST.json but missing")
            continue
        if p.stat().st_size != f.get("size"):
            errors.append(f"{rel}: size {p.stat().st_size} differs from manifest {f.get('size')}")
        if sha256_of(p) != f.get("sha256"):
            errors.append(f"{rel}: sha256 differs from manifest")
        src = str(f.get("source") or "")
        if not src:
            errors.append(f"{rel}: no source recorded")
        elif deny_reason(src):
            errors.append(f"{rel}: {deny_reason(src)}")
        if not f.get("evidence"):
            errors.append(f"{rel}: no rights evidence recorded")
    for p in sorted(out.rglob("*")):
        if p.is_file():
            rel = posix(p.relative_to(out))
            if rel != "MANIFEST.json" and rel not in entries and not rel.startswith(".cache/"):
                errors.append(f"{rel}: present in the folder but not in MANIFEST.json")

    jsonl_rows: dict[str, list[dict]] = {}
    for p in sorted(out.rglob("*.jsonl")):
        rel = posix(p.relative_to(out))
        try:
            jsonl_rows[rel] = read_jsonl(p)
        except (json.JSONDecodeError, BuildError) as e:
            errors.append(f"{rel}: does not parse ({e})")
            continue
        cols = {tuple(r.keys()) for r in jsonl_rows[rel]}
        if len(cols) > 1:
            errors.append(f"{rel}: rows do not share one column set")

    for meta_rel, folder in (("generated_audio/metadata.jsonl", "generated_audio"), ("synth_bench/metadata.jsonl", "synth_bench")):
        rows = jsonl_rows.get(meta_rel)
        if rows is None:
            errors.append(f"{meta_rel} missing")
            continue
        names = [r.get("file_name") for r in rows]
        if len(set(names)) != len(names):
            errors.append(f"{meta_rel}: duplicate file_name")
        for r in rows:
            if not r.get("license") or not r.get("file_name"):
                errors.append(f"{meta_rel}: row without license or file_name: {r.get('file_name')}")
        on_disk = sorted(posix(p.relative_to(out / folder)) for p in (out / folder).rglob("*") if p.is_file() and AUDIO_RE.search(p.name))
        if audio_copied:
            for n in names:
                if not (out / folder / n).exists():
                    errors.append(f"{meta_rel}: {n} listed but not on disk")
            for n in on_disk:
                if n not in names:
                    errors.append(f"{folder}/{n}: audio on disk without a metadata row")
        elif on_disk:
            errors.append(f"{folder}: audio present although MANIFEST says audio_copied=false")
    gen_rows = jsonl_rows.get("generated_audio/metadata.jsonl", [])
    for r in gen_rows:
        if r.get("rights_class") != "releasable":
            errors.append(f"generated_audio: {r.get('file_name')} rights_class {r.get('rights_class')!r}")
        if r.get("license") not in LICENSE_BY_FAMILY.values():
            errors.append(f"generated_audio: {r.get('file_name')} licence {r.get('license')!r} not in {sorted(LICENSE_BY_FAMILY.values())}")
    truth = jsonl_rows.get("synth_bench/truth.jsonl")
    if truth is not None:
        meta_names = {r.get("file_name") for r in jsonl_rows.get("synth_bench/metadata.jsonl", [])}
        if {r.get("file_name") for r in truth} != meta_names:
            errors.append("synth_bench: truth.jsonl and metadata.jsonl list different files")

    # Re-verify the rights evidence against the current checkout, when one is given.
    if repo_root is not None and (repo_root / "apps/web/public-audio-rights.json").exists():
        b = Builder(repo_root, data_root or repo_root, out, audio_copied, manifest.get("built", ""))
        rights = b.read_json(repo_root / "apps/web/public-audio-rights.json")
        for rel, f in sorted(entries.items()):
            if rel.startswith("generated_audio/") and AUDIO_RE.search(rel):
                try:
                    b.require_releasable(f["source"], rights)
                except (RightsError, DenyListError) as e:
                    errors.append(f"{rel}: {e}")
        for r in gen_rows:
            card = b.card_rights(b.card_text(r.get("adapter_id", "")))
            if card != "releasable":
                errors.append(f"generated_audio: {r.get('file_name')} adapter {r.get('adapter_id')} card says {card or 'nothing'}")

    # Summary table.
    by_subset: dict[str, dict] = {}
    for f in entries.values():
        d = by_subset.setdefault(f["subset"], {"files": 0, "bytes": 0})
        d["files"] += 1
        d["bytes"] += f["size"]
    rows_by_subset = {
        "generated_audio": len(gen_rows), "synth_bench": len(jsonl_rows.get("synth_bench/metadata.jsonl", [])),
        "symbolic": len(jsonl_rows.get("symbolic/metadata.jsonl", [])), "glossary": len(jsonl_rows.get("glossary/glossary.jsonl", [])),
        "listening": len(jsonl_rows.get("listening/trials.jsonl", [])),
    }
    print(f"{'subset':<16} {'rows':>6} {'files':>6} {'MB':>9}")
    total_files = total_bytes = 0
    for name in sorted(set(by_subset) | set(rows_by_subset)):
        d = by_subset.get(name, {"files": 0, "bytes": 0})
        total_files += d["files"]
        total_bytes += d["bytes"]
        print(f"{name:<16} {rows_by_subset.get(name, 0):>6} {d['files']:>6} {d['bytes'] / 1e6:>9.1f}")
    print(f"{'total':<16} {sum(rows_by_subset.values()):>6} {total_files:>6} {total_bytes / 1e6:>9.1f}")
    print(f"audio_copied={audio_copied} built={manifest.get('built')} commit={manifest.get('repo_commit')} skipped={len(manifest.get('skipped', []))}")
    if errors:
        print(f"CHECK FAILED ({len(errors)}):", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
    else:
        print("check passed")
    return errors


# ─── push (owner only) ───────────────────────────────────────────────────────────
def push(out: Path, repo_id: str, public: bool) -> int:
    try:
        from huggingface_hub import HfApi, get_token
    except ImportError:
        print("huggingface_hub is not installed in this interpreter", file=sys.stderr)
        return 2
    token = os.environ.get("HF_TOKEN") or get_token()
    if not token:
        print("No Hugging Face token found. Log in first:\n\n    hf auth login\n\n"
              "or export HF_TOKEN=hf_... and re-run with --push.", file=sys.stderr)
        return 2
    api = HfApi(token=token)
    api.create_repo(repo_id, repo_type="dataset", private=not public, exist_ok=True)
    print(f"uploading {out} to https://huggingface.co/datasets/{repo_id} ({'public' if public else 'private'})")
    if hasattr(api, "upload_large_folder"):
        api.upload_large_folder(repo_id=repo_id, folder_path=str(out), repo_type="dataset")
    else:
        api.upload_folder(repo_id=repo_id, folder_path=str(out), repo_type="dataset",
                          commit_message=f"{DATASET_NAME} v{DATASET_VERSION}")
    print("upload finished; review the card and the Dataset Viewer on the Hub before making it public")
    return 0


# ─── CLI ─────────────────────────────────────────────────────────────────────────
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo-root", type=Path, default=Path("."), help="checkout holding apps/, docs/ (default: .)")
    ap.add_argument("--data-root", type=Path, default=None, help="checkout holding the git-ignored data/ (default: --repo-root)")
    ap.add_argument("--out", type=Path, default=Path("dist/hf_dataset"), help="output folder (default: dist/hf_dataset)")
    ap.add_argument("--copy-audio", action="store_true", help="copy the MP3/WAV files (else only metadata)")
    ap.add_argument("--check", action="store_true", help="validate --out without building; non-zero exit on any failure")
    ap.add_argument("--push", action="store_true", help="upload --out to the Hub (owner only; runs --check first)")
    ap.add_argument("--repo-id", default=None, help="Hub dataset id, used in the card's loading example and by --push, e.g. <namespace>/qaraamigen-somali-music-reference")
    ap.add_argument("--public", action="store_true", help="create the Hub repo public (default: private)")
    ap.add_argument("--include-symbolic", action="store_true", help="also ship the Beerdilaacshe engraving (off by default: composition rights not cleared, DATA_PROVENANCE.md §2)")
    ap.add_argument("--date", default=None, help="build date YYYY-MM-DD (default: today)")
    args = ap.parse_args(argv)
    repo_root = args.repo_root.resolve()
    data_root = (args.data_root or args.repo_root).resolve()
    date = args.date or dt.date.today().isoformat()

    if args.check or args.push:
        errors = check(args.out, repo_root, data_root)
        if errors:
            return 1
        if not args.push:
            return 0
        if not args.repo_id:
            print("--push needs --repo-id <namespace>/<name>", file=sys.stderr)
            return 2
        return push(args.out.resolve(), args.repo_id, args.public)

    try:
        builder = Builder(repo_root, data_root, args.out, args.copy_audio, date, args.repo_id, include_symbolic=args.include_symbolic)
        manifest = builder.build()
    except BuildError as e:
        print(f"BUILD FAILED: {e}", file=sys.stderr)
        return 1
    print(f"built {DATASET_NAME} v{DATASET_VERSION} ({date}) into {args.out.resolve()}: {len(manifest['files'])} files")
    errors = check(args.out, repo_root, data_root)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
