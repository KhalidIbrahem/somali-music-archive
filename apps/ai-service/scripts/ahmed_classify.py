"""Stage 1b of the Ahmed Ilkacase corpus programme: content classification of
every non-excluded, unique file in ``data/inventory/ahmed_files.jsonl``.

Per file, over up to ``--chunks`` evenly spaced 30 s windows (32 kHz mono
decode, resampled where a detector needs another rate):

* MERT-v1-95M embedding (``m-a-p/MERT-v1-95M``, ``trust_remote_code=True``,
  24 kHz): the last hidden layer averaged over time, then over chunks, saved
  raw as ``data/embeddings_ahmed/<sha16>.npy`` (git-ignored via ``*.npy``).
* Silero VAD ``vocal_fraction`` (``scripts.corpus_inventory.Analyzer``; a speech
  VAD, so sung Somali undercounts and the thresholds are conservative).
* librosa HPSS ``percussive_ratio`` and ``onset_strength_mean``, torchcrepe
  ``voiced_fraction`` and the pentatonic ``pcs`` / ``detected_tonic``
  (``Analyzer.descriptors``), and ``spectral_flatness_mean``.
* Name hints (``hints``) from the file name (word lists in ``HINT_WORDS``); a
  generic take name (``No Effects#NN``, ``AUDIO-…``, ``<project>_N#NN.aif``)
  inherits only the project's rap/tictok/dj tag, because a project called
  "… beat …" says the project has a beat, not that every take in it is one.
  A ``#N`` marker only makes a name generic on a recorded ``.aif``/``.wav``
  take: GarageBand appends ``#2`` to a collision-renamed import as well.

Seed labels (``seed_label``), one rule set per label; several rules firing on
one file is a ``seed_conflict`` (no seed, and the row is ``unclassified``):

* ``oud``      name has kaban/oud, or source_group ``ahmed_collection`` with
  vocal_fraction < OUD_VAD_MAX and no "mixed" in the name.
* ``voice``    name has cod/vocal/voice and (vocal_fraction >= VOICE_VAD_MIN, or
  voiced_fraction >= VOICE_VOICED_MIN with percussive_ratio < VOICE_PERC_MAX);
  or, name-free, vocal_fraction >= VOICE_VAD_STRONG with percussive_ratio <
  VOICE_PERC_MAX on a non-mixdown role (the speech VAD stays near 0 on oud and
  reaches 0.4-0.5 on dry sung takes, while the CREPE voiced fraction fires on
  both, so only the VAD may seed voice without a name).
* ``drums``    name has one of HINT_WORDS["drums"], or percussive_ratio
  >= DRUMS_PERC_MIN with voiced_fraction < DRUMS_VOICED_MAX.
* ``synth``    name has one of HINT_WORDS["synth"], or
  spectral_flatness_mean >= SYNTH_FLATNESS_MIN on a ``.caf`` file.
* ``full_mix`` role_guess is mixdown.
* ``rap``      name (or, for generic take names, the project) has
  rap/tictok/dj; rap takes precedence over every other rule because the tag
  marks the whole project as non-qaraami material.
* ``other``    never seeded; assigned only to files without features.

A LogisticRegression (C=1, class_weight="balanced") is trained on the seeds
over ``[unit-norm embedding x sqrt(768) || standardised scalar features]``
(StandardScaler on the scalars only), with stratified 5-fold
cross-validation reported in ``data/inventory/ahmed_classifier.json``. Every
file is then predicted: ``predicted_content`` = argmax, ``content_prob`` = max
probability, ``unclassified`` = content_prob < PROB_MIN or seed conflict, and
``content`` = ``predicted_content`` for confident rows and **None** for
unclassified ones, so a consumer that selects on ``content`` alone
(``build_sets.py``) never trains on a low-confidence or conflicting file.
Output rows carry every ahmed_files field, the scalar features both nested
under ``features`` and flat at top level (``percussive_ratio`` etc., which
``build_sets.py`` reads), ``hints``, ``embedding_path``, ``seed_label``,
``seed_conflict``, ``seed_candidates``, ``content``, ``predicted_content``,
``content_prob``, ``unclassified``, ``third_party_suspect``,
``third_party_reason``, ``song_group``, ``song_group_base``,
``shared_projects``, ``group_ambiguous`` and ``project_mixdown``.
Name hints are NOT classifier inputs (they define the seeds; feeding them back
would make the CV accuracy meaningless).

Rights flag: the Ahmed roots also hold audio that is not Ahmed's own
recording. ``third_party_suspect`` (with ``third_party_reason``) marks a
track-numbered import (``role_guess`` import: ``NN title.m4a`` files ripped
into a bundle, e.g. ``01 somaliland national antem.m4a``), a ``_mixed`` name
(the naming of downloaded mixes, including the collection's ``_mixed.mp3``
files that carry other performers' titles) and an ``xml`` imported
instrumental base. Flagged rows keep their content label; the doc lists them
and ``build_sets.py`` should skip them until their rights are settled
(``docs/DATA_PROVENANCE.md``).

Song grouping (the split key ``build_sets.py`` uses): ``song_group(name)``
normalises a project / bundle / file name to a song key: NFKD-folded ASCII
lowercase, numbers dropped, genre words, Somali function words and
take/variant/role tags removed, the first remaining word kept with doubled
vowels collapsed and ``ey`` -> ``ay`` (Ahmed's spelling varies: layla/leyla,
salugla/saluugla, cashaqu/caashaqu, naaya/nayaa), then ``ALIASES`` for the
pairs the collapse cannot catch (galdodob/galdogob, sanabeey/saynabeey,
365/caana/caanamaal/sadex boqol 365). "gayiga last beat 200 kor" and
"gayiga somaaliland" both map to "gayiga". Generic bundle names (``My Song
N``, ``untitled``, ``AUDIO-…``, a bare number) keep their digits so five "My
Song" bundles stay five songs.

``assign_song_groups()`` keys every row (``song_group_base``): a file whose
name carries a song word (an import ``NN title.m4a``, a named stem or
mixdown, a loose collection song) by its own title, a generic take
(``No Effects#NN``, ``<project>_N#NN``, ``Output.aif``) by its project. Keys
are then merged with a union-find on three kinds of evidence, each recorded
in the ``song_groups`` block of ``data/inventory/ahmed_projects.json``:

* a titled file merges with its host project when the two names share a
  content word (``05 xamari toxow caydaruus#2.m4a`` in ``caydaruus soo
  guree``), or when the project name is generic (``My Song 3``);
* two projects that hold a byte-identical recorded take (``#NN`` .aif) are one
  session lineage ("Save As" copies) and merge;
* a shared file of any other kind does NOT merge its hosts: on this corpus
  that closure chains 90 of 152 keys into one component through shared beats,
  drum stems and stale ``Output.aif`` copies. A shared titled file keeps its
  title's group; a shared generic file (``Output.aif`` left in five "Save As"
  bundles) gets the majority group of its hosts (ties: canonical order) and
  ``group_ambiguous`` = True with ``shared_projects`` listed when the hosts
  disagree, so the doc can show it for review.

Per project the chosen mixdown is the longest non-excluded mixdown-role file;
every other non-excluded file is a stem. Written per row (``song_group``,
``project_mixdown``) and per project to ``data/inventory/ahmed_projects.json``
(``{"projects": {...}, "song_groups": {...}}``).

Resumable: a file whose ``<sha16>.npy`` exists is not embedded again, and its
``<sha16>.json`` sidecar (the scalar features) is reused when present. Both are
written atomically (temp file + rename); an unreadable or misshapen cache
entry is deleted and recomputed. ``--limit N`` processes the first N eligible
files; excluded rows are always carried into the output, unprocessed rows are
left out and counted (``eligible_not_processed`` in the report, which the doc
turns into a warning).

Usage (from apps/ai-service):
  HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false python -m scripts.ahmed_classify \
      [--inventory data/inventory/ahmed_files.jsonl] \
      [--out data/inventory/ahmed_classified.jsonl] \
      [--embeddings data/embeddings_ahmed] [--limit N] [--device mps] [--chunks 4]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np

REPO = Path(__file__).resolve().parents[3]
DEFAULT_INVENTORY = "data/inventory/ahmed_files.jsonl"
DEFAULT_OUT = "data/inventory/ahmed_classified.jsonl"
DEFAULT_REPORT = "data/inventory/ahmed_classifier.json"
DEFAULT_PROJECTS = "data/inventory/ahmed_projects.json"
DEFAULT_EMBEDDINGS = "data/embeddings_ahmed"
MERT_ID = "m-a-p/MERT-v1-95M"
MERT_SR = 24000
VAD_SR = 16000
SR = 32000
CHUNK_S = 30.0
EMB_DIM = 768

LABELS = ("oud", "voice", "drums", "synth", "full_mix", "rap", "other")
OUD_VAD_MAX = 0.06
VOICE_VAD_MIN = 0.25
VOICE_VAD_STRONG = 0.5
VOICE_VOICED_MIN = 0.6
VOICE_PERC_MAX = 0.25
DRUMS_PERC_MIN = 0.6
DRUMS_VOICED_MAX = 0.2
SYNTH_FLATNESS_MIN = 0.2
PROB_MIN = 0.6
THRESHOLDS = {
    "OUD_VAD_MAX": OUD_VAD_MAX, "VOICE_VAD_MIN": VOICE_VAD_MIN, "VOICE_VAD_STRONG": VOICE_VAD_STRONG,
    "VOICE_VOICED_MIN": VOICE_VOICED_MIN,
    "VOICE_PERC_MAX": VOICE_PERC_MAX, "DRUMS_PERC_MIN": DRUMS_PERC_MIN, "DRUMS_VOICED_MAX": DRUMS_VOICED_MAX,
    "SYNTH_FLATNESS_MIN": SYNTH_FLATNESS_MIN, "PROB_MIN": PROB_MIN,
}

# Name-hint vocabulary: the single source of truth for the regexes below and
# for the doc's method section. "voice" also matches "cod" as a suffix
# (baricod, "bari cod" written as one word), hence its hand-written regex.
HINT_WORDS: dict[str, tuple[str, ...]] = {
    "oud": ("kaban", "oud"),
    "voice": ("cod", "codd", "vocal", "vocals", "voice"),
    "drums": ("beat", "beeat", "beats", "drum", "drums", "tarax", "sacab", "kick", "shaker", "percussion"),
    "synth": ("synth", "xml", "pad", "pads", "string", "strings", "piano", "keys"),
    "rap": ("rap", "tictok", "tiktok", "dj"),
    "mixed": ("mixed",),
    "xml": ("xml",),
}


def _word_re(words: tuple[str, ...]) -> re.Pattern[str]:
    return re.compile(r"(?<![a-z])(" + "|".join(re.escape(w) for w in words) + r")(?![a-z])")


HINT_PATTERNS: dict[str, re.Pattern[str]] = {k: _word_re(v) for k, v in HINT_WORDS.items()}
HINT_PATTERNS["voice"] = re.compile(r"cod{1,2}(?![a-z])|(?<![a-z])(vocal|vocals|voice)(?![a-z])")
GENERIC_PREFIX = re.compile(r"^(no effects|audio-\d|output)")
TAKE_MARKER = re.compile(r"#\d+")
RECORDED_EXTS = {".aif", ".aiff", ".wav"}
GENERIC_PROJECT = re.compile(r"^(my song|untitled|new project|audio-)|^\d+$")
THIRD_PARTY_REASONS = ("import", "mixed", "xml")
SCALAR_KEYS = ("vocal_fraction", "percussive_ratio", "onset_strength_mean", "voiced_fraction",
               "pcs", "spectral_flatness_mean")

# song_group(): tokens that never identify a song. Genre words and Somali
# function words are dropped everywhere; the rest are take / variant / role
# / tooling tags Ahmed appends to project names. Membership is tested on the
# raw lowercase token (digits removed) before the vowel collapse.
GENRE_TOKENS = {"qaraami", "qarami", "balwo", "heello", "heelo", "hele", "heele", "dhaanto", "dhanto",
                "buraanbur", "hees", "heestii", "heesta"}
STOP_TOKENS = {"waa", "ma", "ka", "ku", "la", "iyo", "in", "aan", "oo", "ah", "ee", "ay", "my", "page",
               "bal", "hadii", "hadu", "the", "ilaa"}
VARIANT_TOKENS = {
    "lgt", "lht", "kor", "kore", "hoos", "dhexe", "last", "final", "finalized", "cod", "codd", "vocal",
    "vocals", "beat", "beeat", "beats", "drum", "drums", "kaban", "oud", "mix", "mixed", "mul", "mixdown",
    "ton", "tone", "garage", "logic", "xml", "oraginal", "original", "og", "new", "cusub", "best", "up",
    "chip", "sax", "sal", "power", "powe", "autofill", "trio", "solo", "double", "one", "two", "three",
    "four", "five", "six", "slow", "fast", "hada", "hal", "mar", "llll", "bilaa", "awliyo", "subcis",
    "ilko", "asali", "tarax", "sacab", "gaas", "gaban", "kot", "kuul", "output", "no", "effects", "audio",
    "band", "bounce", "bip", "take", "string", "strings", "synth", "pad", "loop", "kick", "dj", "rap",
    "tictok", "music", "song", "tempo", "change", "jiib", "sadexley", "co", "lk", "but", "uniq",
}
# Song keys (already vowel-collapsed) that the collapse cannot unify: typos,
# suffixes, a title written from its second word, and the "365 caanamaal"
# song that appears as "365", "365 caana", "365 caanamaal" and
# "sadex boqol 365" (three hundred sixty-five). Checked by the unit tests.
ALIASES = {
    "galdodob": "galdogob",
    "galdodog": "galdogob",
    "saynabay": "sanabay",
    "xajinta": "xajin",
    "dilimalr": "dilimale",
    "hinasuhu": "zaki",
    "cana": "canamal",
    "sadex": "canamal",
    "365": "canamal",
}


# ── helpers shared with ahmed_inventory_doc.py (no heavy imports) ─────────────


def normalise(text: str) -> str:
    """NFKD-folded ASCII lowercase with every non-alphanumeric run as one space."""
    folded = unicodedata.normalize("NFKD", text)
    ascii_text = "".join(ch for ch in folded if not unicodedata.combining(ch))
    return re.sub(r"[^0-9a-z]+", " ", ascii_text.lower()).strip()


def norm_token(tok: str) -> str:
    """Digits removed, doubled vowels collapsed, ``ey`` -> ``ay`` (spelling variants)."""
    tok = re.sub(r"\d+", "", tok)
    tok = re.sub(r"([aeiou])\1+", r"\1", tok)
    return tok.replace("ey", "ay")


def content_tokens(name: str) -> list[str]:
    """Normalised tokens of a name that can identify a song (tags and stop words removed)."""
    out = []
    for raw in normalise(name).split():
        tok = re.sub(r"\d+", "", raw)
        if len(tok) < 2 or tok in GENRE_TOKENS or tok in STOP_TOKENS or tok in VARIANT_TOKENS:
            continue
        out.append(norm_token(tok))
    return out


def is_generic_project(project: str) -> bool:
    return bool(GENERIC_PROJECT.match(normalise(project)))


def song_group(name: str) -> str:
    """Song key from a project / bundle / file name (see the module docstring)."""
    low = normalise(name)
    if is_generic_project(name):
        key = low
    else:
        tokens = content_tokens(name)
        if tokens:
            key = tokens[0]
        else:
            words = [norm_token(t) for t in low.split() if not t.isdigit()]  # "03 Qaraami awliyo heele 2"
            key = " ".join(w for w in words if w) or low or "untitled"
    return ALIASES.get(key, key)


def is_generic_name(name: str) -> bool:
    """A take name that says nothing about the song: No Effects#NN, AUDIO-…, Output,
    or a ``#N`` marker on a recorded ``.aif``/``.wav`` (not on an import)."""
    stem = Path(name).stem.lower()
    ext = Path(name).suffix.lower()
    if GENERIC_PREFIX.search(stem):
        return True
    return bool(TAKE_MARKER.search(stem)) and (ext in RECORDED_EXTS or ext == "")


def name_hints(name: str, project: str = "") -> dict[str, bool]:
    """Boolean name hints from the file name; generic take names also inherit the
    project's rap tag (and only that, see the module docstring)."""
    stem = Path(name).stem.lower()
    hints = {k: bool(p.search(stem)) for k, p in HINT_PATTERNS.items()}
    hints["generic_name"] = is_generic_name(name)
    if hints["generic_name"] and project:
        hints["rap"] = hints["rap"] or bool(HINT_PATTERNS["rap"].search(project.lower()))
    return hints


def third_party(row: dict[str, Any]) -> tuple[bool, str | None]:
    """(suspect, reason) for the rights flag: import | mixed | xml (see the docstring)."""
    hints = row.get("hints") or name_hints(row["name"], row.get("project", ""))
    if row.get("role_guess") == "import":
        return True, "import"
    if hints.get("mixed"):
        return True, "mixed"
    if hints.get("xml"):
        return True, "xml"
    return False, None


def seed_rules(row: dict[str, Any]) -> list[str]:
    """Every seed rule that fires on a row (inventory fields + features + hints)."""
    hints = row.get("hints") or name_hints(row["name"], row.get("project", ""))
    feat = row.get("features") or {}
    vf = feat.get("vocal_fraction")
    voiced = feat.get("voiced_fraction")
    perc = feat.get("percussive_ratio")
    flat = feat.get("spectral_flatness_mean")
    fired = []
    if hints["rap"]:
        return ["rap"]
    if hints["oud"] or (row.get("source_group") == "ahmed_collection" and vf is not None
                        and vf < OUD_VAD_MAX and not hints["mixed"]):
        fired.append("oud")
    named_voice = hints["voice"] and ((vf is not None and vf >= VOICE_VAD_MIN)
                                      or (voiced is not None and perc is not None
                                          and voiced >= VOICE_VOICED_MIN and perc < VOICE_PERC_MAX))
    acoustic_voice = (vf is not None and perc is not None and vf >= VOICE_VAD_STRONG
                      and perc < VOICE_PERC_MAX and row.get("role_guess") != "mixdown")
    if named_voice or acoustic_voice:
        fired.append("voice")
    if hints["drums"] or (perc is not None and voiced is not None
                          and perc >= DRUMS_PERC_MIN and voiced < DRUMS_VOICED_MAX):
        fired.append("drums")
    if hints["synth"] or (flat is not None and flat >= SYNTH_FLATNESS_MIN and row.get("ext") == ".caf"):
        fired.append("synth")
    if row.get("role_guess") == "mixdown":
        fired.append("full_mix")
    return fired


def seed_label(row: dict[str, Any]) -> tuple[str | None, bool, list[str]]:
    """(seed_label, seed_conflict, candidates)."""
    fired = seed_rules(row)
    if len(fired) == 1:
        return fired[0], False, fired
    return None, len(fired) > 1, fired


def choose_mixdown(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Longest non-excluded mixdown-role file of a project, else None."""
    cands = [r for r in rows if not r.get("excluded") and r.get("role_guess") == "mixdown"]
    if not cands:
        return None
    return max(cands, key=lambda r: (r.get("duration_s") or 0.0, -rows.index(r)))


def project_key(row: dict[str, Any]) -> str:
    return f"{row['source_group']}/{row['project']}"


class UnionFind:
    """Minimal union-find over string keys, with the merge reasons kept."""

    def __init__(self) -> None:
        self.parent: dict[str, str] = {}
        self.reasons: list[tuple[str, str, str]] = []

    def find(self, key: str) -> str:
        self.parent.setdefault(key, key)
        while self.parent[key] != key:
            self.parent[key] = self.parent[self.parent[key]]
            key = self.parent[key]
        return key

    def union(self, a: str, b: str, reason: str) -> bool:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        self.parent[ra] = rb
        self.reasons.append((a, b, reason))
        return True


def has_title(name: str) -> bool:
    """A file name that carries a song word (not a generic take / Output name)."""
    return not is_generic_name(name) and bool(content_tokens(Path(name).stem))


def row_base_key(row: dict[str, Any]) -> str:
    """Pre-merge song key of a row: its own title when the name has one, else the project's."""
    if has_title(row["name"]):
        return song_group(Path(row["name"]).stem)
    return song_group(row["project"])


def assign_song_groups(rows: list[dict[str, Any]]) -> tuple[dict[str, str], dict[str, dict[str, Any]]]:
    """Song group per row path and the ``song_groups`` report (see the module docstring).

    Rows must carry path, name, project, source_group, role_guess, ext, sha256
    (the ahmed_files.jsonl fields); ``rows`` is expected in the extractor's
    canonical order, which breaks ties for shared files."""
    base = {r["path"]: row_base_key(r) for r in rows}
    proj = {project_key(r): song_group(r["project"]) for r in rows}
    uf = UnionFind()
    for key in list(base.values()) + list(proj.values()):
        uf.find(key)
    # a titled file merges with a host project that names the same song, or a generic one
    for r in rows:
        b, pg = base[r["path"]], proj[project_key(r)]
        if b == pg or not has_title(r["name"]):
            continue
        if is_generic_project(r["project"]):
            uf.union(b, pg, f"titled file in a generic project: {r['name']} in {r['project']}")
        elif set(content_tokens(Path(r["name"]).stem)) & set(content_tokens(r["project"])):
            uf.union(b, pg, f"title names the project's song: {r['name']} in {r['project']}")
    # byte-identical recorded takes across projects = one session lineage
    by_sha: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        if r.get("sha256"):
            by_sha[str(r["sha256"])].append(r)
    for members in by_sha.values():
        hosts = sorted({project_key(m) for m in members})
        if len(hosts) < 2:
            continue
        if all(m.get("role_guess") == "take" and m.get("ext") in RECORDED_EXTS for m in members):
            keys = [proj[h] for h in hosts]
            for k in keys[1:]:
                uf.union(keys[0], k, f"shared recorded take {members[0]['name']}: {' ~ '.join(hosts)}")
    # representative name per component: the most common base key among its rows
    comp_rows: dict[str, list[str]] = defaultdict(list)
    for path, key in base.items():
        comp_rows[uf.find(key)].append(key)
    rep = {root: Counter(keys).most_common(1)[0][0] if len(set(keys)) == 1 else
           sorted(Counter(keys).items(), key=lambda kv: (-kv[1], kv[0]))[0][0] for root, keys in comp_rows.items()}
    group_of = {path: rep[uf.find(key)] for path, key in base.items()}
    # a shared file gets exactly one group: its title's when it has one, else the
    # majority group of its hosts (ties: canonical order, i.e. the first copy's host)
    ambiguous: dict[str, list[str]] = {}
    for members in by_sha.values():
        hosts = sorted({project_key(m) for m in members})
        if len(hosts) < 2:
            continue
        first = rep[uf.find(base[members[0]["path"]])]
        if has_title(members[0]["name"]):
            chosen = first
        else:
            votes = Counter(rep[uf.find(proj[h])] for h in hosts)
            best = max(votes.values())
            winners = [g for g, n in votes.items() if n == best]
            chosen = first if first in winners else sorted(winners)[0]
            if len(votes) > 1:
                for m in members:
                    ambiguous[m["path"]] = hosts
        for m in members:
            group_of[m["path"]] = chosen
    report: dict[str, dict[str, Any]] = {}
    for r in rows:
        g = group_of[r["path"]]
        entry = report.setdefault(g, {"members": set(), "projects": set(), "files": 0, "kept": 0, "hours": 0.0,
                                      "merged_by": []})
        entry["members"].add(base[r["path"]])
        if rep[uf.find(proj[project_key(r)])] == g:
            entry["projects"].add(project_key(r))
        entry["files"] += 1
        if not r.get("excluded"):
            entry["kept"] += 1
            entry["hours"] += float(r.get("duration_s") or 0.0) / 3600.0
    for a, b, reason in uf.reasons:
        g = rep[uf.find(a)]
        if g in report:
            report[g]["merged_by"].append(f"{a} + {b}: {reason}")
    for g, entry in report.items():
        entry["members"] = sorted(entry["members"])
        entry["projects"] = sorted(entry["projects"])
        entry["hours"] = round(entry["hours"], 3)
        entry["ambiguous_files"] = sorted(p for p, hosts in ambiguous.items() if group_of[p] == g)
    for r in rows:
        r["song_group"] = group_of[r["path"]]
        r["song_group_base"] = base[r["path"]]
        r["shared_projects"] = ambiguous.get(r["path"], [])
        r["group_ambiguous"] = r["path"] in ambiguous
    return group_of, dict(sorted(report.items()))


def project_summary(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Per project: song_group, kind, chosen mixdown, stems, content counts, third-party count."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        groups.setdefault(project_key(r), []).append(r)
    out: dict[str, dict[str, Any]] = {}
    for key, members in groups.items():
        first = members[0]
        mix = choose_mixdown(members)
        kept = [r for r in members if not r.get("excluded")]
        stems = [r["path"] for r in kept if mix is None or r["path"] != mix["path"]]
        content: Counter[str] = Counter()
        for r in kept:
            content[r.get("content") or "unclassified"] += 1
        sg = Counter(str(r["song_group"]) for r in members if r.get("song_group"))
        out[key] = {
            "source_group": first["source_group"], "project": first["project"],
            "project_kind": first["project_kind"],
            "song_group": sg.most_common(1)[0][0] if sg else song_group(first["project"]),
            "files": len(members), "kept": len(kept),
            "hours_unique": round(sum(r.get("duration_s") or 0.0 for r in kept) / 3600, 3),
            "mixdown": mix["path"] if mix else None, "stems": stems,
            "content": dict(sorted(content.items())),
            "third_party_suspects": sum(1 for r in kept if r.get("third_party_suspect")),
        }
    return out


def chunk_starts(duration: float, n: int, chunk: float = CHUNK_S) -> list[float]:
    """Up to ``n`` evenly spaced chunk starts covering the file (one when it is short)."""
    if duration <= chunk or n <= 1:
        return [0.0]
    n = max(1, min(n, int(duration // chunk)))
    if n == 1:
        return [max(0.0, duration / 2 - chunk / 2)]
    step = (duration - chunk) / (n - 1)
    return [round(i * step, 3) for i in range(n)]


def sha16(row: dict[str, Any]) -> str:
    return str(row["sha256"])[:16]


def apply_predictions(processed: list[dict[str, Any]], usable: list[int], content: list[str],
                      prob: list[float]) -> None:
    """Write predicted_content / content_prob / unclassified / content onto the rows:
    ``content`` is None for every unclassified row (see the module docstring)."""
    for r in processed:
        r["predicted_content"], r["content_prob"], r["unclassified"] = "other", 0.0, True
    for j, i in enumerate(usable):
        r = processed[i]
        r["predicted_content"], r["content_prob"] = content[j], prob[j]
        r["unclassified"] = bool(prob[j] < PROB_MIN or r["seed_conflict"])
    for r in processed:
        r["content"] = None if r["unclassified"] else r["predicted_content"]


# ── feature extraction (heavy imports inside) ─────────────────────────────────


class FeatureExtractor:
    """MERT + Silero VAD + HPSS/CREPE/flatness on 30 s windows."""

    def __init__(self, device: str, mert: bool = True) -> None:
        import torch

        from scripts.corpus_inventory import Analyzer

        self.device = device
        self.analyzer = Analyzer(device)
        self.processor = None
        self.model = None
        if mert:
            from transformers import AutoModel, AutoProcessor

            self.processor = AutoProcessor.from_pretrained(MERT_ID, trust_remote_code=True)
            self.model = AutoModel.from_pretrained(MERT_ID, trust_remote_code=True).to(device)
            self.model.eval()
            self.torch = torch

    def embed(self, audio32: np.ndarray) -> np.ndarray:
        """Last-hidden-layer mean over time of one window, 768-d float32."""
        from scipy.signal import resample_poly

        assert self.model is not None and self.processor is not None
        audio24 = resample_poly(audio32.astype(np.float64), 3, 4).astype(np.float32)
        inputs = self.processor(audio24, sampling_rate=MERT_SR, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        with self.torch.no_grad():
            hidden = self.model(**inputs, output_hidden_states=True).hidden_states
        return hidden[-1][0].mean(dim=0).float().cpu().numpy().astype(np.float32)

    def scalars(self, audio32: np.ndarray) -> dict[str, Any]:
        import librosa
        from scipy.signal import resample_poly

        audio16 = resample_poly(audio32.astype(np.float64), 1, 2).astype(np.float32)
        out: dict[str, Any] = {"vocal_fraction": round(self.analyzer.vocal_fraction(audio16), 4)}
        d = self.analyzer.descriptors(audio32, crepe=True)
        out["percussive_ratio"] = d.get("percussive_ratio")
        out["onset_strength_mean"] = d.get("onset_strength_mean")
        out["voiced_fraction"] = d.get("trackable_melody_fraction")
        out["pcs"] = d.get("pcs")
        out["detected_tonic"] = d.get("detected_tonic")
        flat = librosa.feature.spectral_flatness(y=audio32)
        out["spectral_flatness_mean"] = round(float(np.mean(flat)), 4)
        return out


def aggregate_scalars(per_chunk: list[dict[str, Any]]) -> dict[str, Any]:
    """Mean of every numeric feature over chunks (None ignored), modal tonic."""
    out: dict[str, Any] = {}
    for k in SCALAR_KEYS:
        vals = [c[k] for c in per_chunk if c.get(k) is not None]
        out[k] = round(float(np.mean(vals)), 4) if vals else None
    tonics = [c["detected_tonic"] for c in per_chunk if c.get("detected_tonic")]
    out["detected_tonic"] = Counter(tonics).most_common(1)[0][0] if tonics else None
    out["chunks_analyzed"] = len(per_chunk)
    return out


def decode_audio(path: Path, sr: int, start: float, seconds: float) -> np.ndarray:
    """``scripts.corpus_inventory.decode`` behind a seam the tests can patch."""
    from scripts.corpus_inventory import decode

    return decode(path, sr, start, seconds)


def save_atomic_npy(path: Path, arr: np.ndarray) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as f:
        np.save(f, arr)
    os.replace(tmp, path)


def save_atomic_text(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


def load_cache(npy: Path, side: Path) -> tuple[np.ndarray | None, dict[str, Any] | None]:
    """Cached (embedding, features); a corrupt or misshapen entry is deleted so it is recomputed."""
    emb: np.ndarray | None = None
    feats: dict[str, Any] | None = None
    if npy.exists():
        try:
            emb = np.load(npy)
            if emb.ndim != 1 or emb.size != EMB_DIM or not np.isfinite(emb).all():
                raise ValueError(f"unexpected embedding shape {emb.shape}")
        except Exception as exc:  # any unreadable cache entry: drop both files
            print(f"  cache entry {npy.name} unreadable ({exc!r}): recomputing", flush=True)
            emb = None
            npy.unlink(missing_ok=True)
            side.unlink(missing_ok=True)
    if emb is not None and side.exists():
        try:
            loaded = json.loads(side.read_text())
            feats = loaded if isinstance(loaded, dict) and "chunks_analyzed" in loaded else None
        except (json.JSONDecodeError, OSError):
            feats = None
        if feats is None:
            side.unlink(missing_ok=True)
    return emb, feats


def analyse_file(row: dict[str, Any], ext: FeatureExtractor, emb_dir: Path, n_chunks: int) -> tuple[np.ndarray | None, dict[str, Any]]:
    """Embedding + scalar features for one inventory row, with the npy/json cache."""
    npy = emb_dir / f"{sha16(row)}.npy"
    side = emb_dir / f"{sha16(row)}.json"
    emb, cached_feats = load_cache(npy, side)
    if emb is not None and cached_feats is not None:
        return emb, cached_feats
    path = REPO / row["path"] if not Path(row["path"]).is_absolute() else Path(row["path"])
    embs, feats = [], []
    for start in chunk_starts(float(row.get("duration_s") or 0.0), n_chunks):
        a32 = decode_audio(path, SR, start, CHUNK_S)
        if a32.size < SR:
            continue
        if emb is None and ext.model is not None:
            embs.append(ext.embed(a32))
        feats.append(ext.scalars(a32))
    if emb is None and embs:
        emb = np.mean(np.stack(embs), axis=0).astype(np.float32)
        save_atomic_npy(npy, emb)
    features = aggregate_scalars(feats)
    if feats:
        save_atomic_text(side, json.dumps(features))
    return emb, features


# ── classifier ────────────────────────────────────────────────────────────────


def feature_matrix(embeddings: list[np.ndarray], features: list[dict[str, Any]]) -> np.ndarray:
    """[unit-norm embedding * sqrt(D) || standardised scalars (None -> 0, plus a pcs-missing flag)].

    The embedding keeps its own geometry (scaled so a component is O(1), commensurate
    with the standardised scalars); standardising every embedding dimension would
    inflate uninformative dimensions to unit variance and swamp the seeds."""
    from sklearn.preprocessing import StandardScaler

    E = np.stack([e / (np.linalg.norm(e) + 1e-12) for e in embeddings]).astype(np.float64)
    E *= np.sqrt(E.shape[1])
    S = np.array([[float(f.get(k) or 0.0) for k in SCALAR_KEYS] + [float(f.get("pcs") is None)] for f in features])
    return np.hstack([E, StandardScaler().fit_transform(S)])


def train_and_predict(X: np.ndarray, seeds: list[str | None], random_state: int = 0) -> tuple[list[str], list[float], dict[str, Any]]:
    """Seeds -> LogisticRegression with stratified CV -> (content, prob) for every row + report."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import (
        accuracy_score,
        balanced_accuracy_score,
        classification_report,
        confusion_matrix,
    )
    from sklearn.model_selection import StratifiedKFold, cross_val_predict

    idx = [i for i, s in enumerate(seeds) if s]
    y = [seeds[i] for i in idx]
    counts = Counter(y)
    classes = sorted(counts)
    report: dict[str, Any] = {"seed_counts": dict(sorted(counts.items())), "n_rows": int(X.shape[0]),
                              "n_seeds": len(y), "classes": classes, "model": "LogisticRegression(C=1, class_weight=balanced)",
                              "features": f"MERT-v1-95M last layer (768, unit norm x sqrt(768)) + standardised {list(SCALAR_KEYS)} + pcs_missing",
                              "cv": None}
    if len(classes) < 2:
        report["note"] = "fewer than two seed classes: no classifier trained, seeds passed through"
        content = [s or "other" for s in seeds]
        return content, [1.0 if s else 0.0 for s in seeds], report
    clf = LogisticRegression(C=1.0, class_weight="balanced", max_iter=5000, random_state=random_state)
    n_splits = min(5, min(counts.values()))
    if n_splits >= 2:
        cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=random_state)
        pred = cross_val_predict(clf, X[idx], y, cv=cv)
        report["cv"] = {
            "n_splits": n_splits,
            "accuracy": round(float(accuracy_score(y, pred)), 4),
            "balanced_accuracy": round(float(balanced_accuracy_score(y, pred)), 4),
            "per_class": classification_report(y, pred, labels=classes, output_dict=True, zero_division=0),
            "confusion": {"labels": classes, "matrix": confusion_matrix(y, pred, labels=classes).tolist()},
        }
    else:
        report["note"] = "a seed class has a single member: cross-validation skipped"
    clf.fit(X[idx], y)
    proba = clf.predict_proba(X)
    order = list(clf.classes_)
    content = [order[int(np.argmax(p))] for p in proba]
    prob = [round(float(np.max(p)), 4) for p in proba]
    return content, prob, report


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--inventory", default=DEFAULT_INVENTORY)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--report", default=DEFAULT_REPORT)
    ap.add_argument("--projects", default=DEFAULT_PROJECTS)
    ap.add_argument("--embeddings", default=DEFAULT_EMBEDDINGS)
    ap.add_argument("--limit", type=int, default=0, help="process only the first N eligible files")
    ap.add_argument("--device", default="mps")
    ap.add_argument("--chunks", type=int, default=4)
    ap.add_argument("--shard", default="", help="I/N: analyse only every N-th eligible file starting at I (0-based); "
                                                "combine with --features-only to fill the cache from several processes")
    ap.add_argument("--features-only", action="store_true",
                    help="stop after the per-file features/embeddings are cached; write no outputs")
    args = ap.parse_args()

    def absp(p: str) -> Path:
        return Path(p) if Path(p).is_absolute() else REPO / p

    import torch

    device = args.device
    if device == "mps" and not torch.backends.mps.is_available():
        print("mps not available, using cpu", flush=True)
        device = "cpu"
    rows = load_jsonl(absp(args.inventory))
    eligible = [r for r in rows if not r.get("excluded")]
    todo = eligible[: args.limit] if args.limit else eligible
    if args.shard:
        shard_i, shard_n = (int(x) for x in args.shard.split("/"))
        if not (shard_n > 0 and 0 <= shard_i < shard_n):
            raise SystemExit(f"bad --shard {args.shard!r}: want I/N with 0 <= I < N")
        todo = todo[shard_i::shard_n]
    emb_dir = absp(args.embeddings)
    emb_dir.mkdir(parents=True, exist_ok=True)
    print(f"{len(rows)} inventory rows, {len(eligible)} eligible, {len(todo)} to process on {device}", flush=True)

    t0 = time.time()
    ext = FeatureExtractor(device)
    print(f"models loaded in {time.time() - t0:.1f}s", flush=True)
    processed: list[dict[str, Any]] = []
    embeddings: list[np.ndarray] = []
    for i, r in enumerate(todo, 1):
        t1 = time.time()
        try:
            emb, feats = analyse_file(r, ext, emb_dir, args.chunks)
        except Exception as exc:  # keep going; the row records the failure
            emb, feats = None, {"error": repr(exc)}
        r = dict(r)
        r["features"] = feats
        # flat copies for downstream readers (build_sets.py reads row["percussive_ratio"])
        r.update({k: feats.get(k) for k in (*SCALAR_KEYS, "detected_tonic", "chunks_analyzed")})
        r["hints"] = name_hints(r["name"], r["project"])
        r["embedding_path"] = f"{args.embeddings}/{sha16(r)}.npy" if emb is not None else None
        processed.append(r)
        embeddings.append(emb if emb is not None else np.zeros(EMB_DIM, dtype=np.float32))
        print(f"  {i}/{len(todo)} {r['name']} ({time.time() - t1:.1f}s)", flush=True)

    if args.features_only:
        print(json.dumps({"features_only": True, "shard": args.shard or "all", "processed": len(processed),
                          "elapsed_s": round(time.time() - t0, 1)}, indent=2))
        return

    usable = [i for i, r in enumerate(processed) if embeddings[i].any() and "error" not in r["features"]]
    seeds: list[str | None] = []
    for r in processed:
        label, conflict, cands = seed_label(r)
        r["seed_label"], r["seed_conflict"], r["seed_candidates"] = label, conflict, cands
        seeds.append(label)
    if usable:
        X = feature_matrix([embeddings[i] for i in usable], [processed[i]["features"] for i in usable])
        content, prob, report = train_and_predict(X, [seeds[i] for i in usable])
    else:
        content, prob, report = [], [], {"note": "no usable rows", "seed_counts": {}, "cv": None}
    apply_predictions(processed, usable, content, prob)
    excluded = [dict(r) for r in rows if r.get("excluded")]
    out_rows = processed + excluded
    for r in out_rows:
        r["hints"] = r.get("hints") or name_hints(r["name"], r["project"])
        r["third_party_suspect"], r["third_party_reason"] = third_party(r)
    _, song_groups = assign_song_groups(out_rows)
    projects = project_summary(out_rows)
    for r in out_rows:
        r["project_mixdown"] = projects[project_key(r)]["mixdown"]
    skipped = len(eligible) - len(todo)
    report["thresholds"] = THRESHOLDS
    report["eligible"] = len(eligible)
    report["eligible_not_processed"] = skipped
    report["rows_processed"] = len(processed)
    report["rows_usable"] = len(usable)
    report["content_counts"] = dict(sorted(Counter(r["content"] or "unclassified" for r in processed).items()))
    report["predicted_counts"] = dict(sorted(Counter(r["predicted_content"] for r in processed).items()))
    report["unclassified"] = sum(r["unclassified"] for r in processed)
    report["seed_conflicts"] = sum(r["seed_conflict"] for r in processed)
    report["third_party_suspects"] = dict(sorted(Counter(r["third_party_reason"] for r in processed
                                                         if r["third_party_suspect"]).items()))
    report["group_ambiguous"] = sum(1 for r in processed if r["group_ambiguous"])
    report["song_groups"] = len({r["song_group"] for r in processed})
    report["device"] = device
    report["chunks"] = args.chunks
    report["elapsed_s"] = round(time.time() - t0, 1)

    absp(args.out).parent.mkdir(parents=True, exist_ok=True)
    save_atomic_text(absp(args.out), "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out_rows))
    save_atomic_text(absp(args.report), json.dumps(report, indent=2))
    save_atomic_text(absp(args.projects), json.dumps({"projects": projects, "song_groups": song_groups},
                                                     indent=2, ensure_ascii=False))
    print(json.dumps({"out": args.out, "report": args.report, "projects": args.projects, "processed": len(processed),
                      "excluded_carried": len(excluded), "eligible_not_processed": skipped,
                      "seed_counts": report.get("seed_counts"), "cv": report.get("cv") and {
                          "accuracy": report["cv"]["accuracy"], "balanced_accuracy": report["cv"]["balanced_accuracy"],
                          "n_splits": report["cv"]["n_splits"]},
                      "content_counts": report["content_counts"], "unclassified": report["unclassified"],
                      "third_party_suspects": report["third_party_suspects"], "group_ambiguous": report["group_ambiguous"],
                      "song_groups": report["song_groups"], "elapsed_s": report["elapsed_s"]}, indent=2))


if __name__ == "__main__":
    main()
