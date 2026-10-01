"""Rights-permitting acquisition of Somali music from the open internet:
Internet Archive, YouTube (Creative Commons uploads only) and hand-added URLs
that carry an explicit rights note. Rate-limited, logged, resumable.

Policy (the report restates it; nothing here bypasses it):
  * Only material whose licence is explicit and permits reuse is downloaded:
    Internet Archive items whose ``licenseurl`` is CC BY / CC BY-SA
    (creativecommons.org/licenses/by/ or /by-sa/), CC0 or the Public Domain
    Mark (creativecommons.org/publicdomain/), or whose ``rights`` text says
    public domain / CC0 / CC BY without any negation or reservation ("Not in
    the public domain", "all rights reserved" fail closed); YouTube videos
    whose ``license`` field is "Creative Commons Attribution license (reuse
    allowed)"; --sources-file rows only with a ``licence_url`` or
    ``licence_text`` that passes the same rules (the ``rights_note`` is the
    human provenance note, never the decision). Everything else is logged in
    ``skipped.jsonl`` with its reason ("no licence metadata", "CC-NC/ND
    (training use unclear)", "no audio file", "not Somali by metadata",
    "Standard YouTube Licence", "no licence field", "unavailable", "no
    explicit licence (licence_url or licence_text)").
  * Downloads carry the rights tier ``internet_cc`` (train + publish, attribution
    recorded in the sidecar and manifest). The tier ``internet_research_only``
    exists for the manifest schema only: by policy nothing is downloaded under
    it, and a --sources-file row asking for it is skipped. Contributor tiers
    (``contrib_<slug>_consented``) are never downloadable here: consented
    audio arrives through ``data/incoming/`` + ``CONTRIBUTOR.md`` and
    ``scripts/intake.py``, which is where the consent record is checked.
  * One network request every --request-gap seconds (default 5), one download
    every --download-gap seconds (default 10), HTTP 429/5xx retried with
    back-off (Retry-After honoured), at most --max-items candidates per source
    (default 200) and --max-hours of audio in total (default 40). Items already
    downloaded (manifest, files on disk) or already decided (``skipped.jsonl``,
    except reason "unavailable", which is transient) are neither re-fetched nor
    re-decided and do not count toward --limit / --max-items, so a bounded
    rerun advances through the search results instead of re-evaluating the
    first N; delete an item's ``skipped.jsonl`` row to have it decided again.

Sources:
  (a) ``ia``: ``internetarchive.search_items`` over IA_QUERIES (rows=--rows each,
      one request per query); the licence decision is taken on the search
      metadata, ``get_item`` is called only for accepted items to read the file
      list. Per item the best audio file per track is chosen (flac > wav > aiff
      > mp3 > ogg > m4a; IA's ``_64kb``/``_vbr`` derivatives fold into their
      original), fetched from ``https://archive.org/download/<id>/<name>`` with
      the name percent-encoded (``Track #1.mp3`` is common on IA and would
      otherwise be cut at the ``#``) and saved to
      ``data/internet/ia/<identifier>/<safe name>``.
  (b) ``yt``: ``yt_dlp`` over YT_QUERIES (the classic performers are spelled as
      in the Harvard Aryette catalog): by default one flat request per query to
      YouTube's own results page with its "Creative Commons" feature filter
      (``sp=EgIwAQ==``, first --yt-n entries; verified 2026-09-26: the plain
      ``ytsearch40:qaraami`` gave 0/15 CC videos, the filtered page 5/5), or
      ``ytsearch<N>:<query>`` with --no-yt-cc-filter. The filter is only a
      pre-filter: every candidate still costs one ``extract_info`` and is
      accepted only on its ``license`` field. Accepted videos are downloaded as
      bestaudio (m4a/opus, no video) to ``data/internet/yt/<video_id>/``. yt-dlp
      needs a JavaScript runtime for complete YouTube extraction; ``node`` is
      enabled when it is on PATH (deno stays the preferred default).
  (c) ``file``: --sources-file (.jsonl or .csv with url, rights_note, tier
      internet_cc, and licence_url or licence_text[, title, creator, date]) for
      artist sites and cultural archives; fetched with requests to
      ``data/internet/file/<sha1(url)[:16]>/``.

Every downloaded file gets a sidecar ``<file>.json`` (url, title, creator,
date, licence text and URL, tier, fetched_at, sha256, ffprobe duration, query).
``data/internet/manifest.jsonl`` holds one row per downloaded item (with its
``files`` list), ``skipped.jsonl`` one row per rejected candidate,
``candidates.jsonl`` the rights-permitting items a --search-only run found but
did not download, ``runs.jsonl`` one line per run. All three candidate files
are compacted to one row per (source, item_id) on every save.

Dedupe, after download: exact sha256 against the Ahmed inventory, the Harvard
manifest, the contributor inventories and the manifest itself (``excluded``
with ``dup_of``); a near-duplicate check against Ahmed's corpus in MERT space
(``nearest_ahmed_cos`` is always recorded; cosine >= --near-dup-threshold, default
0.97, sets ``near_duplicate_of`` and excludes the file); and a title-normalised
match against the Harvard catalog logged as ``possible_harvard_duplicate``
(never excluded: Harvard is research-only, the CC copy is the publishable one).
The Ahmed embeddings under data/embeddings_ahmed are MERT-v1-95M *last-layer*
means (``ahmed_classify.FeatureExtractor.embed``), so the new file's first 30 s
are embedded the same way (``embed_first_30s``) rather than with
``reward_model.embed_mert``, whose all-layer pooling lives in a different space.
Calibration on 2026-09-26: among Ahmed's own 1,003 files the median
nearest-neighbour cosine is 0.989 (takes of the same song) and the 99th
percentile of all pairs 0.955, so 0.97 sits above almost every unrelated pair.

``--inventory`` writes ``data/inventory/internet_files.jsonl`` in the
ahmed_files schema (source_group ``internet_<source>``, role ``song``, ``rights``
= the manifest row's ``tier``, ``date`` = upload/IA date so build_sets can pick
the studio/archival caption tag, plus url/licence fields) so
``ahmed_classify.py`` and ``build_sets.py`` consume it. The inventory fails
closed on rights: a manifest row whose ``tier`` is blank or not one of
``internet_cc`` / ``internet_research_only`` (a hand edit gone wrong) is written
with rights ``internet_research_only`` and ``excluded`` with reason
``tier_invalid``, and named on stdout. ``--report`` renders
``docs/data/INTERNET_SOURCES.md``; its policy paragraph takes the request and
download gaps from the latest run row, not from hand-typed numbers.

Git: audio never enters git. Patterns owned by the report component in the root
.gitignore: ``data/internet/*`` (every entry: the per-source audio dirs ia/, yt/,
file/ and their sidecars) followed by ``!data/internet/*.jsonl``, which
re-includes manifest.jsonl, skipped.jsonl, candidates.jsonl and runs.jsonl as
tracked text provenance; the inventory and the report are tracked outputs.

Usage (from apps/ai-service, HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false):
  python -m scripts.internet_acquire --search-only --limit 15          # decide, download nothing
  python -m scripts.internet_acquire --sources ia yt --limit 3          # bounded download run
  python -m scripts.internet_acquire --sources file --sources-file urls.jsonl
  python -m scripts.internet_acquire --inventory --report               # no network
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import time
from collections import Counter
from collections.abc import Callable, Iterable, Iterator
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote, quote_plus

import internetarchive
import numpy as np
import requests
import yt_dlp

from scripts import ahmed_extract as ax

REPO = Path(__file__).resolve().parents[3]
DEFAULT_OUT_DIR = "data/internet"
DEFAULT_INVENTORY_OUT = "data/inventory/internet_files.jsonl"
DEFAULT_REPORT = "docs/data/INTERNET_SOURCES.md"
DEFAULT_CATALOG = "data/harvard_catalog/harvard_tracks_metadata.csv"
DEFAULT_EMBEDDINGS = "data/embeddings_ahmed"
DEFAULT_CLASSIFIED = "data/inventory/ahmed_classified.jsonl"
DEFAULT_AHMED_INVENTORY = "data/inventory/ahmed_files.jsonl"
DEFAULT_HARVARD_MANIFEST = "data/harvard_raw/manifest.jsonl"
DEFAULT_INVENTORY_DIR = "data/inventory"

TIER_CC = "internet_cc"
TIER_RESEARCH = "internet_research_only"
VALID_TIERS = (TIER_CC, TIER_RESEARCH)
# the only tier a --sources-file row may ask for: contributor consent is checked by scripts/intake.py, not here
DOWNLOADABLE_TIER = re.compile(r"^internet_cc$")
SOURCES = ("ia", "yt", "file")
UA = "QaraamiGen-acquire/1.0 (research corpus builder; rights-permitting downloads only)"

IA_QUERIES = (
    "somali AND mediatype:audio",
    "qaraami AND mediatype:audio",
    "somali oud AND mediatype:audio",
    "kaban somali AND mediatype:audio",
    "somali music 1960s AND mediatype:audio",
    "hees somali AND mediatype:audio",
    "Radio Hargeisa AND mediatype:audio",
    "Radio Mogadishu AND mediatype:audio",
    "somali traditional song AND mediatype:audio",
    "balwo AND mediatype:audio",
    "heello somali AND mediatype:audio",
    "dhaanto AND mediatype:audio",
)
IA_FIELDS = ("identifier", "title", "creator", "date", "licenseurl", "rights", "subject", "description",
             "mediatype", "language", "collection")
# Classic performers as the Harvard Aryette catalog spells them (Somali orthography).
YT_PERFORMERS = (
    "Maxamed Suleebaan",
    "Xasan Aadan Samatar",
    "Maxamed Mooge Liibaan",
    "Axmed Cali Cigaal",
    "Hibo Maxamed",
    "Maryan Mursal",
)
YT_QUERIES = (
    "qaraami", "kaban", "somali oud", "heesta qaraami", "balwo", "heello", "dhaanto",
    "Somali music 1970s", "Somali oud solo", *YT_PERFORMERS,
)
YT_CC_LICENCE = "Creative Commons Attribution license (reuse allowed)"
YT_CC_URL = "https://creativecommons.org/licenses/by/3.0/legalcode"
YT_STANDARD = "Standard YouTube License"
# YouTube search "Features: Creative Commons" filter, as the site itself encodes it in the address bar.
YT_CC_FILTER = "EgIwAQ%253D%253D"

CC_OK_RE = re.compile(r"creativecommons\.org/licenses/(by|by-sa)/", re.IGNORECASE)
CC_NC_ND_RE = re.compile(r"creativecommons\.org/licenses/(by-)?(nc|nd|nc-sa|nc-nd|sa-nc)\b", re.IGNORECASE)
PD_RE = re.compile(r"creativecommons\.org/publicdomain/(zero|mark)", re.IGNORECASE)
PD_TEXT_RE = re.compile(r"public[\s-]+domain|\bCC0\b", re.IGNORECASE)
# free-text CC BY / CC BY-SA (not followed by NC/ND); NC/ND spelled out anywhere rejects the text
CC_TEXT_RE = re.compile(r"\bCC[\s-]*BY(?:[\s-]*SA)?\b(?![\s-]*N[CD]\b)", re.IGNORECASE)
CC_NC_ND_TEXT_RE = re.compile(r"\bBY[\s-]*(?:NC|ND)\b|non[\s-]*commercial|no[\s-]*derivatives?", re.IGNORECASE)
# a rights text that mentions public domain but negates or reserves it fails closed
LICENCE_NEGATION_RE = re.compile(r"\bnot\b|\bno\b|\bnon[\s-]|\bnever\b|reserved|©|\(c\)|restricted", re.IGNORECASE)
SOMALI_TERMS = (
    "somali", "somalia", "soomaali", "soomaaliya", "somaliland", "qaraami", "hargeisa", "hargeysa", "mogadishu",
    "muqdisho", "xamar", "kaban", "balwo", "heello", "dhaanto", "hees ", "heeso", "djibouti", "jabuuti", "waaberi",
)
AUDIO_RANK = {".flac": 0, ".wav": 1, ".aiff": 2, ".aif": 2, ".mp3": 3, ".ogg": 4, ".oga": 4, ".m4a": 5, ".opus": 6}
IA_DERIVATIVE_SUFFIX = re.compile(r"_(64kb|128kb|vbr|sample|spectrogram)$", re.IGNORECASE)
NEAR_DUP_THRESHOLD = 0.97
FIRST_SECONDS = 30.0
GENERIC_TITLES = {"untitled", "qaraami", "qaraami songs", "heeso xul ah", "unknown", "instrumental", "mixed tape",
                  "selection of songs", "miscellaneous", "songs"}
SIDE_TRACK_RE = re.compile(r"^\s*side\s+[ab]\.?\s*track\s+\d+\.?:?\s*", re.IGNORECASE)

REASON_NO_LICENCE = "no licence metadata"
REASON_NC_ND = "CC-NC/ND (training use unclear)"
REASON_NO_AUDIO = "no audio file"
REASON_NOT_SOMALI = "not Somali by metadata"
REASON_YT_STANDARD = "Standard YouTube Licence"
REASON_YT_NO_FIELD = "no licence field"
REASON_UNAVAILABLE = "unavailable"
REASON_TIER = "tier not downloadable by policy"
REASON_FILE_NO_LICENCE = "no explicit licence (licence_url or licence_text)"
REASON_DUP_SHA = "duplicate_sha256"
REASON_NEAR_DUP = "near_duplicate"
REASON_TIER_INVALID = "tier_invalid"

MANIFEST_FIELDS = ("source", "item_id", "url", "title", "creator", "date", "licence_text", "licence_url", "tier",
                   "rights_note", "query", "fetched_at", "files", "hours", "possible_harvard_duplicate")
FILE_FIELDS = ("path", "name", "url", "bytes", "sha256", "duration_s", "sample_rate", "channels", "codec", "sidecar",
               "excluded", "exclude_reason", "dup_of", "near_duplicate_of", "nearest_ahmed_cos", "nearest_ahmed_path")
SKIPPED_FIELDS = ("source", "item_id", "url", "title", "creator", "licence_text", "licence_url", "reason", "query",
                  "seen_at")
SIDECAR_FIELDS = ("url", "item_url", "source", "item_id", "title", "creator", "uploader", "date", "licence_text",
                  "licence_url", "tier", "rights_note", "query", "fetched_at", "sha256", "duration_s", "bytes",
                  "sample_rate", "channels", "codec")


# ────────────────────────────────────────────────────────────── rate limiting


class RetryableHTTP(Exception):
    """A 429 or 5xx answer; ``retry_after`` in seconds when the server said so."""

    def __init__(self, status: int, retry_after: float | None = None) -> None:
        super().__init__(f"HTTP {status}")
        self.status = status
        self.retry_after = retry_after


class RateLimiter:
    """>= request_gap s between any two network operations, >= download_gap s
    between two downloads. ``calls`` records every wait (kind, seconds slept)."""

    def __init__(self, request_gap: float = 5.0, download_gap: float = 10.0,
                 sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic) -> None:
        self.request_gap = request_gap
        self.download_gap = download_gap
        self.sleep = sleep
        self.clock = clock
        self._last_any: float | None = None
        self._last_download: float | None = None
        self.calls: list[tuple[str, float]] = []

    def wait(self, kind: str = "request") -> float:
        now = self.clock()
        due = now
        if self._last_any is not None:
            due = max(due, self._last_any + self.request_gap)
        if kind == "download" and self._last_download is not None:
            due = max(due, self._last_download + self.download_gap)
        delay = max(0.0, due - now)
        if delay > 0:
            self.sleep(delay)
        stamp = self.clock()
        self._last_any = stamp
        if kind == "download":
            self._last_download = stamp
        self.calls.append((kind, round(delay, 3)))
        return delay


BACKOFF_S = (5.0, 15.0, 45.0, 120.0)


def with_retries(fn: Callable[[], object], limiter: RateLimiter, retries: int = 4, what: str = "request") -> object:
    """Call ``fn`` until it does not raise RetryableHTTP / a connection error, backing off."""
    for attempt in range(retries + 1):
        try:
            return fn()
        except RetryableHTTP as exc:
            if attempt >= retries:
                raise
            pause = exc.retry_after if exc.retry_after else BACKOFF_S[min(attempt, len(BACKOFF_S) - 1)]
            print(f"  {what}: HTTP {exc.status}, retry {attempt + 1}/{retries} in {pause:.0f}s", flush=True)
            limiter.sleep(pause)
        except (requests.ConnectionError, requests.Timeout) as exc:
            if attempt >= retries:
                raise
            pause = BACKOFF_S[min(attempt, len(BACKOFF_S) - 1)]
            print(f"  {what}: {exc.__class__.__name__}, retry {attempt + 1}/{retries} in {pause:.0f}s", flush=True)
            limiter.sleep(pause)
    raise RuntimeError("unreachable")


def fetch_url(url: str, dest: Path, limiter: RateLimiter, session: requests.Session | None = None,
              timeout: float = 120.0, retries: int = 4) -> int:
    """Stream ``url`` to ``dest`` atomically (dest.tmp then rename); returns bytes."""
    sess = session or requests.Session()
    dest.parent.mkdir(parents=True, exist_ok=True)

    def once() -> object:
        limiter.wait("download")
        r = sess.get(url, stream=True, timeout=timeout, headers={"User-Agent": UA})
        if r.status_code == 429 or r.status_code >= 500:
            ra = r.headers.get("Retry-After")
            r.close()
            raise RetryableHTTP(r.status_code, float(ra) if ra and ra.isdigit() else None)
        r.raise_for_status()
        tmp = dest.with_name(dest.name + ".tmp")
        n = 0
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                if chunk:
                    f.write(chunk)
                    n += len(chunk)
        r.close()
        os.replace(tmp, dest)
        return n

    return int(with_retries(once, limiter, retries=retries, what=f"download {url}"))  # type: ignore[arg-type]


# ─────────────────────────────────────────────────────────────── candidates


@dataclass
class Candidate:
    """One item seen at a source, with the licence decision taken on its metadata."""

    source: str
    item_id: str
    url: str
    title: str = ""
    creator: str = ""
    date: str = ""
    licence_text: str = ""
    licence_url: str = ""
    tier: str = ""
    rights_note: str = ""
    query: str = ""
    accepted: bool = False
    reason: str | None = None
    files: list[dict] = field(default_factory=list)   # download targets: name, url, format, bytes
    meta: dict = field(default_factory=dict)

    def skipped_row(self, seen_at: str) -> dict:
        """The skipped.jsonl row, keys in SKIPPED_FIELDS order."""
        values = {**{k: getattr(self, k) for k in SKIPPED_FIELDS if k not in ("reason", "seen_at")},
                  "reason": self.reason or "rejected", "seen_at": seen_at}
        return {k: values[k] for k in SKIPPED_FIELDS}


def _text(value: object) -> str:
    """IA metadata values are strings or lists of strings; join them."""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return " ; ".join(_text(v) for v in value)
    return str(value)


def _first(value: object) -> str:
    if isinstance(value, (list, tuple)):
        return _first(value[0]) if value else ""
    return "" if value is None else str(value)


def is_somali(md: dict) -> bool:
    """Title, subject, description, creator, language or collection mention Somalia/Somali music."""
    blob = " ".join(_text(md.get(k)) for k in ("title", "subject", "description", "creator", "language",
                                               "collection")).lower()
    return any(term in blob for term in SOMALI_TERMS) or _text(md.get("language")).lower().strip() in ("som", "so")


def decide_licence_url(url: str) -> tuple[bool, str, str | None]:
    """(accepted, licence_text, reason) for a licence URL: CC BY / BY-SA, CC0 and
    the Public Domain Mark pass; NC/ND and anything else fail."""
    m = CC_OK_RE.search(url)
    if m:
        return True, f"CC {m.group(1).upper()}", None
    m = PD_RE.search(url)
    if m:
        return True, "CC0" if m.group(1).lower() == "zero" else "Public Domain Mark", None
    if CC_NC_ND_RE.search(url):
        return False, url, REASON_NC_ND
    return False, url, f"licence not recognised: {url}"


def decide_licence_text(text: str) -> tuple[bool, str | None]:
    """(accepted, reason) for free rights text, failing closed: CC0 / public
    domain / CC BY / CC BY-SA are accepted only when the text carries no
    negation or reservation ("Not in the public domain", "all rights reserved",
    "©"); NC/ND spelled out anywhere rejects it."""
    t = (text or "").strip()
    if not t:
        return False, REASON_NO_LICENCE
    if CC_NC_ND_TEXT_RE.search(t):
        return False, REASON_NC_ND
    if not (PD_TEXT_RE.search(t) or CC_TEXT_RE.search(t)):
        return False, REASON_NO_LICENCE
    m = LICENCE_NEGATION_RE.search(t)
    if m:
        return False, f"{REASON_NO_LICENCE}: rights text negated ({m.group(0)!r} in {t[:60]!r})"
    return True, None


def decide_ia_licence(md: dict) -> tuple[bool, str, str, str | None]:
    """(accepted, licence_text, licence_url, reason) from an item's metadata:
    the ``licenseurl`` decides when present, else the ``rights`` text."""
    url = _first(md.get("licenseurl")).strip()
    rights = _text(md.get("rights")).strip()
    if url:
        ok, text, reason = decide_licence_url(url)
        return ok, text, url, reason
    if rights:
        ok, reason = decide_licence_text(rights)
        return ok, rights[:200], "", reason
    return False, "", "", REASON_NO_LICENCE


def ia_download_url(item_id: str, name: str) -> str:
    """https://archive.org/download/<id>/<name> with the name percent-encoded
    (``#`` and ``?`` would otherwise end the path)."""
    return f"https://archive.org/download/{quote(item_id, safe='')}/{quote(name, safe='/')}"


def pick_ia_files(files: Iterable[dict]) -> list[dict]:
    """Best audio file per track: flac > wav > aiff > mp3 > ogg > m4a; IA
    derivatives (``name_64kb.mp3``, ``name_vbr.mp3``) fold into their original's
    track; ``source == original`` wins a tie. Sorted by name."""
    best: dict[str, tuple[tuple[int, int], dict]] = {}
    for f in files:
        name = str(f.get("name") or "")
        ext = Path(name).suffix.lower()
        if ext not in AUDIO_RANK:
            continue
        stem = IA_DERIVATIVE_SUFFIX.sub("", Path(name).stem).lower()
        rank = (AUDIO_RANK[ext], 0 if f.get("source") == "original" else 1)
        cur = best.get(stem)
        if cur is None or rank < cur[0]:
            best[stem] = (rank, f)
    return [f for _, f in sorted(best.values(), key=lambda t: str(t[1].get("name")))]


def candidate_from_ia(md: dict, query: str) -> Candidate:
    ident = _first(md.get("identifier"))
    c = Candidate(source="ia", item_id=ident, url=f"https://archive.org/details/{ident}", title=_text(md.get("title")),
                  creator=_text(md.get("creator")), date=_first(md.get("date")), query=query,
                  meta={k: md.get(k) for k in ("subject", "language", "collection", "mediatype") if md.get(k) is not None})
    if _first(md.get("mediatype")) not in ("", "audio", "etree"):
        c.reason = f"mediatype {_first(md.get('mediatype'))}"
        return c
    if not is_somali(md):
        c.reason = REASON_NOT_SOMALI
        c.licence_url = _first(md.get("licenseurl"))
        return c
    ok, text, url, reason = decide_ia_licence(md)
    c.licence_text, c.licence_url, c.accepted, c.reason = text, url, ok, reason
    if ok:
        c.tier = TIER_CC
    return c


def decide_youtube(info: dict | None, error: str | None = None) -> tuple[bool, str, str, str | None]:
    """(accepted, licence_text, licence_url, reason) from a full yt_dlp info dict."""
    if info is None:
        return False, "", "", f"{REASON_UNAVAILABLE}: {(error or 'no info')[:160]}"
    lic = info.get("license")
    if lic is None or str(lic).strip() == "":
        return False, "", "", REASON_YT_NO_FIELD
    if str(lic).strip() == YT_CC_LICENCE:
        return True, YT_CC_LICENCE, YT_CC_URL, None
    if str(lic).strip() == YT_STANDARD:
        return False, str(lic), "", REASON_YT_STANDARD
    return False, str(lic), "", f"licence not recognised: {lic}"


def candidate_from_youtube(entry: dict, info: dict | None, error: str | None, query: str) -> Candidate:
    vid = str((info or entry).get("id") or "")
    url = str(entry.get("url") or entry.get("webpage_url") or (info or {}).get("webpage_url") or
              f"https://www.youtube.com/watch?v={vid}")
    src = info or entry
    c = Candidate(source="yt", item_id=vid, url=url, title=str(src.get("title") or ""),
                  creator=str(src.get("uploader") or src.get("channel") or ""),
                  date=str(src.get("upload_date") or ""), query=query,
                  meta={"duration": src.get("duration"), "channel_id": src.get("channel_id")})
    ok, text, lurl, reason = decide_youtube(info, error)
    c.licence_text, c.licence_url, c.accepted, c.reason = text, lurl, ok, reason
    if ok:
        c.tier = TIER_CC
        c.files = [{"name": f"{vid}", "url": url, "format": "bestaudio"}]
    return c


def candidate_from_source_row(row: dict, index: int = 0) -> Candidate:
    """A --sources-file row. Accepted only with a url, a rights_note (human
    provenance), tier ``internet_cc`` and an explicit licence: ``licence_url``
    passing ``decide_licence_url`` or ``licence_text`` passing
    ``decide_licence_text``. A row without a url is keyed ``row<index>`` so
    every such row stays visible in skipped.jsonl."""
    url = str(row.get("url") or "").strip()
    item_id = hashlib.sha1(url.encode()).hexdigest()[:16] if url else f"row{index}"
    tier = str(row.get("tier") or "").strip()
    c = Candidate(source="file", item_id=item_id, url=url, title=str(row.get("title") or ""),
                  creator=str(row.get("creator") or ""), date=str(row.get("date") or ""),
                  licence_text=str(row.get("licence_text") or "").strip(),
                  licence_url=str(row.get("licence_url") or "").strip(), tier=tier,
                  rights_note=str(row.get("rights_note") or "").strip(), query="sources-file")
    if not url:
        c.reason = "no url"
        return c
    if not c.rights_note:
        c.reason = "no rights_note"
        return c
    if not DOWNLOADABLE_TIER.match(tier):
        c.reason = f"{REASON_TIER}: {tier or 'none'}"
        return c
    if c.licence_url:
        ok, text, reason = decide_licence_url(c.licence_url)
        c.licence_text = c.licence_text or text
    elif c.licence_text:
        ok, reason = decide_licence_text(c.licence_text)
    else:
        ok, reason = False, REASON_FILE_NO_LICENCE
    if not ok:
        c.reason = reason
        return c
    c.accepted = True
    name = Path(url.split("?")[0]).name or "download"
    c.files = [{"name": name, "url": url, "format": Path(name).suffix.lstrip(".").lower()}]
    return c


def load_sources_file(path: Path) -> list[dict]:
    """Rows of a .jsonl or .csv sources file (url, rights_note, tier, ...)."""
    if path.suffix.lower() == ".csv":
        with open(path, encoding="utf-8", newline="") as f:
            return [dict(r) for r in csv.DictReader(f)]
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.lstrip().startswith("#"):
            rows.append(json.loads(line))
    return rows


# ───────────────────────────────────────────────── network seams (patched in tests)


def ia_search(query: str, rows: int, limiter: RateLimiter) -> list[dict]:
    """One advancedsearch request (rows results) with the fields we decide on."""
    def once() -> object:
        limiter.wait("request")
        try:
            return [dict(r) for r in internetarchive.search_items(query, fields=list(IA_FIELDS), params={"rows": rows})]
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else 500
            if status == 429 or status >= 500:
                raise RetryableHTTP(status) from exc
            raise
    return list(with_retries(once, limiter, what=f"ia search {query!r}"))  # type: ignore[arg-type]


def ia_item(identifier: str, limiter: RateLimiter) -> tuple[dict, list[dict]]:
    """(metadata, files) of one item: a single metadata request."""
    def once() -> object:
        limiter.wait("request")
        try:
            item = internetarchive.get_item(identifier)
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else 500
            if status == 429 or status >= 500:
                raise RetryableHTTP(status) from exc
            raise
        return dict(item.metadata or {}), [dict(f) for f in (item.files or [])]
    return with_retries(once, limiter, what=f"ia item {identifier}")  # type: ignore[return-value]


YDL_QUIET = {"quiet": True, "no_warnings": True, "noprogress": True, "ignoreerrors": False, "noplaylist": True,
             "socket_timeout": 60}


def ydl_opts(**extra: object) -> dict:
    """YDL_QUIET plus ``extra``; enables the ``node`` JS runtime next to yt-dlp's
    default ``deno`` when node is on PATH (YouTube extraction without a runtime
    is deprecated and drops formats)."""
    opts: dict = {**YDL_QUIET, **extra}
    node = shutil.which("node")
    if node:
        opts["js_runtimes"] = {"deno": {}, "node": {"path": node}}
    return opts


def yt_search_target(query: str, n: int, cc_filter: bool = True) -> str:
    """The results-page URL with YouTube's Creative Commons filter, or ``ytsearchN:query``."""
    if cc_filter:
        return f"https://www.youtube.com/results?search_query={quote_plus(query)}&sp={YT_CC_FILTER}"
    return f"ytsearch{n}:{query}"


def yt_search(query: str, n: int, limiter: RateLimiter, cc_filter: bool = True) -> list[dict]:
    """Flat search entries (id, url, title, uploader, duration; no licence yet)."""
    limiter.wait("request")
    with yt_dlp.YoutubeDL(ydl_opts(extract_flat="in_playlist", skip_download=True, playlistend=n)) as ydl:
        info = ydl.extract_info(yt_search_target(query, n, cc_filter), download=False) or {}
    return [e for e in (info.get("entries") or []) if e][:n]


def yt_info(url: str, limiter: RateLimiter) -> tuple[dict | None, str | None]:
    """Full info dict (with ``license``) of one video, or (None, error)."""
    limiter.wait("request")
    try:
        with yt_dlp.YoutubeDL(ydl_opts(skip_download=True)) as ydl:
            return ydl.extract_info(url, download=False), None
    except yt_dlp.utils.DownloadError as exc:
        return None, str(exc)


def yt_download(url: str, out_dir: Path, limiter: RateLimiter) -> Path:
    """bestaudio (m4a, else opus, else best audio) into ``out_dir/<id>.<ext>``."""
    out_dir.mkdir(parents=True, exist_ok=True)
    limiter.wait("download")
    opts = ydl_opts(format="bestaudio[ext=m4a]/bestaudio[ext=opus]/bestaudio/best",
                    outtmpl=str(out_dir / "%(id)s.%(ext)s"), retries=3, writeinfojson=False)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True) or {}
    for d in info.get("requested_downloads") or []:
        p = Path(str(d.get("filepath") or ""))
        if p.is_file():
            return p
    found = sorted(p for p in out_dir.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_RANK)
    if not found:
        raise FileNotFoundError(f"yt_dlp reported success but no audio file is in {out_dir}")
    return found[0]


def probe(path: Path) -> dict:
    """ffprobe facts + sha256 + bytes (seam)."""
    meta = ax.ffprobe_meta(path)
    return {"bytes": path.stat().st_size, "sha256": ax.sha256_file(path), "duration_s": meta.get("duration_s", 0.0),
            "sample_rate": meta.get("sample_rate", 0), "channels": meta.get("channels", 0), "codec": meta.get("codec")}


def embed_first_30s(path: Path, device: str = "mps") -> np.ndarray | None:
    """MERT-v1-95M last-layer mean over the first 30 s at 24 kHz — the pooling of
    ``ahmed_classify.FeatureExtractor.embed`` so cosines against
    data/embeddings_ahmed are meaningful. None when under 1 s of audio."""
    import torch
    from scipy.signal import resample_poly

    from scripts.corpus_inventory import decode
    from scripts.reward_model import mert

    audio32 = decode(path, 32000, 0.0, FIRST_SECONDS)
    if audio32.size < 32000:
        return None
    audio24 = resample_poly(audio32.astype(np.float64), 3, 4).astype(np.float32)
    proc, model = mert(device)
    inputs = proc(audio24, sampling_rate=24000, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}
    with torch.no_grad():
        hidden = model(**inputs, output_hidden_states=True).hidden_states
    vec = hidden[-1][0].mean(dim=0).float().cpu().numpy().astype(np.float32)
    if device == "mps":
        torch.mps.empty_cache()
    return vec


# ──────────────────────────────────────────────────────────────── dedupe


class NearDupIndex:
    """Unit-normalised Ahmed embeddings with a label (inventory path) per row."""

    def __init__(self, matrix: np.ndarray | None, labels: list[str]) -> None:
        self.matrix = matrix
        self.labels = labels

    @classmethod
    def load(cls, emb_dir: Path, classified: Path | None = None) -> NearDupIndex:
        labels_by_stem: dict[str, str] = {}
        if classified and classified.is_file():
            for row in _jsonl(classified):
                ep = row.get("embedding_path")
                if ep:
                    labels_by_stem[Path(str(ep)).stem] = str(row.get("path") or ep)
        vecs: list[np.ndarray] = []
        labels: list[str] = []
        for npy in sorted(emb_dir.glob("*.npy")) if emb_dir.is_dir() else []:
            try:
                v = np.load(npy).astype(np.float64).ravel()
            except (OSError, ValueError):
                continue
            n = float(np.linalg.norm(v))
            if v.size == 0 or not np.isfinite(n) or n == 0.0:
                continue
            vecs.append(v / n)
            labels.append(labels_by_stem.get(npy.stem, npy.stem))
        if not vecs:
            return cls(None, [])
        return cls(np.stack(vecs), labels)

    def __len__(self) -> int:
        return len(self.labels)

    def nearest(self, vec: np.ndarray) -> tuple[float, str] | None:
        if self.matrix is None:
            return None
        v = vec.astype(np.float64).ravel()
        n = float(np.linalg.norm(v))
        if v.size != self.matrix.shape[1] or n == 0.0:
            return None
        sims = self.matrix @ (v / n)
        i = int(np.argmax(sims))
        return round(float(sims[i]), 4), self.labels[i]


def normalise_title(title: str) -> str:
    """Lower-case, drop the "Side A. Track 1:" prefix and bracketed glosses, keep [a-z0-9 ]."""
    s = SIDE_TRACK_RE.sub("", title or "")
    s = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", s)
    s = re.sub(r"[^0-9a-z\u00c0-\u024f]+", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def load_harvard_titles(path: Path) -> list[tuple[str, str]]:
    """(normalised song title, raw catalog title) for every track row of the
    Aryette catalog export; short or generic titles are dropped."""
    if not path.is_file():
        return []
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    with open(path, encoding="utf-8", errors="ignore", newline="") as f:
        for row in csv.DictReader(f):
            raw = str(row.get("title") or "").strip()
            if not SIDE_TRACK_RE.match(raw):
                continue
            norm = normalise_title(raw)
            if len(norm) < 6 or norm in GENERIC_TITLES or norm in seen:
                continue
            seen.add(norm)
            out.append((norm, raw))
    return out


def harvard_matches(title: str, titles: list[tuple[str, str]]) -> list[str]:
    """Catalog titles that occur as a whole phrase in the candidate's title (or equal it)."""
    n = f" {normalise_title(title)} "
    if len(n.strip()) < 4:
        return []
    return [raw for norm, raw in titles if f" {norm} " in n]


def load_known_sha256s(ahmed_inventory: Path, harvard_manifest: Path, inventory_dir: Path) -> dict[str, str]:
    known: dict[str, str] = {}

    def add(sha: object, label: str) -> None:
        if isinstance(sha, str) and len(sha) == 64 and sha not in known:
            known[sha] = label

    for row in _jsonl(ahmed_inventory):
        add(row.get("sha256"), f"ahmed:{row.get('path')}")
    for row in _jsonl(harvard_manifest):
        add(row.get("sha256"), f"harvard:{row.get('cid') or row.get('file')}")
    if inventory_dir.is_dir():
        for inv in sorted(inventory_dir.glob("contrib_*_files.jsonl")):
            for row in _jsonl(inv):
                add(row.get("sha256"), f"{row.get('source_group')}:{row.get('path')}")
    return known


def _jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(r, dict):
            rows.append(r)
    return rows


def write_jsonl(path: Path, rows: Iterable[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    os.replace(tmp, path)


def write_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


# ───────────────────────────────────────────────────────────────── store


class Store:
    """manifest / skipped / candidates under out_dir, one row per (source, item_id)."""

    def __init__(self, out_dir: Path) -> None:
        self.out_dir = out_dir
        self.manifest_path = out_dir / "manifest.jsonl"
        self.skipped_path = out_dir / "skipped.jsonl"
        self.candidates_path = out_dir / "candidates.jsonl"
        self.runs_path = out_dir / "runs.jsonl"
        self.manifest: dict[tuple[str, str], dict] = {(r["source"], r["item_id"]): r for r in _jsonl(self.manifest_path)
                                                      if r.get("source") and r.get("item_id")}
        self.skipped: dict[tuple[str, str], dict] = {(r["source"], r["item_id"]): r for r in _jsonl(self.skipped_path)
                                                     if r.get("source") and r.get("item_id")}
        self.candidates: dict[tuple[str, str], dict] = {(r["source"], r["item_id"]): r
                                                        for r in _jsonl(self.candidates_path)
                                                        if r.get("source") and r.get("item_id")}

    def hours(self) -> float:
        secs = sum(float(f.get("duration_s") or 0.0) for m in self.manifest.values()
                   for f in m.get("files") or [] if not f.get("excluded"))
        return secs / 3600.0

    def known_sha256s(self) -> dict[str, str]:
        out: dict[str, str] = {}
        for m in self.manifest.values():
            for f in m.get("files") or []:
                if f.get("sha256") and f["sha256"] not in out:
                    out[f["sha256"]] = f"internet:{m['source']}/{m['item_id']}/{f.get('name')}"
        return out

    def has_files(self, key: tuple[str, str]) -> bool:
        m = self.manifest.get(key)
        return bool(m) and bool(m.get("files")) and all(_abs(str(f.get("path"))).is_file() for f in m["files"])

    def save(self) -> None:
        write_jsonl(self.manifest_path, [self.manifest[k] for k in sorted(self.manifest)])
        write_jsonl(self.skipped_path, [self.skipped[k] for k in sorted(self.skipped)])
        write_jsonl(self.candidates_path, [self.candidates[k] for k in sorted(self.candidates)])

    def log_run(self, row: dict) -> None:
        self.runs_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.runs_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _abs(p: str) -> Path:
    path = Path(p)
    return path if path.is_absolute() else REPO / path


# ───────────────────────────────────────────────────────────── acquisition


@dataclass
class Context:
    store: Store
    limiter: RateLimiter
    known: dict[str, str]
    near: NearDupIndex
    harvard_titles: list[tuple[str, str]]
    search_only: bool = False
    max_hours: float = 40.0
    near_threshold: float = NEAR_DUP_THRESHOLD
    device: str = "mps"
    session: requests.Session | None = None
    stats: Counter = field(default_factory=Counter)
    downloaded: list[dict] = field(default_factory=list)

    @property
    def now(self) -> str:
        return datetime.now(tz=UTC).isoformat(timespec="seconds")


def cached_ids(store: Store, source: str) -> dict[str, str]:
    """item_id -> stat name for items a rerun must not re-evaluate: downloaded
    with files on disk (``already_downloaded``) or decided in skipped.jsonl
    (``skipped_cached``), except "unavailable" skips, which are transient and
    are retried."""
    out: dict[str, str] = {}
    for (src, item_id), row in store.skipped.items():
        if src == source and not str(row.get("reason") or "").startswith(REASON_UNAVAILABLE):
            out[item_id] = "skipped_cached"
    for key in store.manifest:
        if key[0] == source and store.has_files(key):
            out[key[1]] = "already_downloaded"
    return out


def ia_candidates(queries: Iterable[str], rows: int, limiter: RateLimiter, cap: int,
                  skip: dict[str, str] | None = None, stats: Counter | None = None) -> Iterator[Candidate]:
    """Candidates from the IA searches; ``cap`` counts only yielded candidates,
    items in ``skip`` (see ``cached_ids``) are counted under their stat name."""
    seen: set[str] = set()
    yielded = 0
    for q in queries:
        if yielded >= cap:
            return
        try:
            results = ia_search(q, rows, limiter)
        except Exception as exc:  # one query failing must not end the run
            print(f"  ia search {q!r} failed: {exc!r}", flush=True)
            continue
        print(f"  ia {q!r}: {len(results)} results", flush=True)
        for md in results:
            ident = _first(md.get("identifier"))
            if not ident or ident in seen:
                continue
            seen.add(ident)
            if skip and ident in skip:
                if stats is not None:
                    stats[skip[ident]] += 1
                continue
            yielded += 1
            yield candidate_from_ia(md, q)
            if yielded >= cap:
                return


def yt_candidates(queries: Iterable[str], n: int, limiter: RateLimiter, cap: int,
                  skip: dict[str, str] | None = None, cc_filter: bool = True,
                  stats: Counter | None = None) -> Iterator[Candidate]:
    """Candidates from the YouTube searches, one ``yt_info`` request each;
    ``cap`` counts only yielded candidates, ids in ``skip`` (see ``cached_ids``)
    cost no request and are counted under their stat name."""
    seen: set[str] = set()
    yielded = 0
    for q in queries:
        if yielded >= cap:
            return
        try:
            entries = yt_search(q, n, limiter, cc_filter)
        except Exception as exc:
            print(f"  yt search {q!r} failed: {exc!r}", flush=True)
            continue
        print(f"  yt {q!r}: {len(entries)} results", flush=True)
        for e in entries:
            vid = str(e.get("id") or "")
            if not vid or vid in seen:
                continue
            seen.add(vid)
            if skip and vid in skip:
                if stats is not None:
                    stats[skip[vid]] += 1
                continue
            url = str(e.get("url") or f"https://www.youtube.com/watch?v={vid}")
            info, err = yt_info(url, limiter)
            yielded += 1
            yield candidate_from_youtube(e, info, err, q)
            if yielded >= cap:
                return


def sidecar_for(c: Candidate, f: dict, facts: dict, fetched_at: str) -> dict:
    side = {"url": f.get("url") or c.url, "item_url": c.url, "source": c.source, "item_id": c.item_id,
            "title": c.title, "creator": c.creator, "uploader": c.creator, "date": c.date,
            "licence_text": c.licence_text, "licence_url": c.licence_url, "tier": c.tier,
            "rights_note": c.rights_note, "query": c.query, "fetched_at": fetched_at, **facts}
    return {k: side.get(k) for k in SIDECAR_FIELDS}


def dedupe_file(ctx: Context, path: Path, facts: dict) -> dict:
    """excluded / dup_of / near_duplicate_of / nearest_ahmed_* for one new file."""
    out: dict = {"excluded": False, "exclude_reason": None, "dup_of": None, "near_duplicate_of": None,
                 "nearest_ahmed_cos": None, "nearest_ahmed_path": None}
    label = ctx.known.get(facts.get("sha256", "")) or ctx.store.known_sha256s().get(facts.get("sha256", ""))
    if label:
        out.update({"excluded": True, "exclude_reason": REASON_DUP_SHA, "dup_of": label})
        ctx.stats["dedupe_sha256"] += 1
        return out
    if len(ctx.near):
        try:
            vec = embed_first_30s(path, ctx.device)
        except Exception as exc:  # embedding failure never blocks the download
            print(f"  near-dup embedding failed for {path.name}: {exc!r}", flush=True)
            vec = None
        hit = ctx.near.nearest(vec) if vec is not None else None
        if hit is not None:
            out["nearest_ahmed_cos"], out["nearest_ahmed_path"] = hit
            if hit[0] >= ctx.near_threshold:
                out.update({"excluded": True, "exclude_reason": REASON_NEAR_DUP, "near_duplicate_of": hit[1]})
                ctx.stats["dedupe_near"] += 1
    return out


def download_candidate(c: Candidate, ctx: Context) -> dict | None:
    """Fetch every chosen file of an accepted candidate; returns the manifest row."""
    item_dir = ctx.store.out_dir / c.source / _safe_id(c.item_id)
    fetched_at = ctx.now
    files: list[dict] = []
    for f in c.files:
        if c.source == "yt":
            path = yt_download(str(f["url"]), item_dir, ctx.limiter)
        else:
            path = item_dir / _safe_name(str(f["name"]))
            if not path.is_file():
                fetch_url(str(f["url"]), path, ctx.limiter, session=ctx.session)
        facts = probe(path)
        side = sidecar_for(c, f, facts, fetched_at)
        side_path = path.with_name(path.name + ".json")
        write_json(side_path, side)
        row = {"path": ax.rel(path), "name": path.name, "url": f.get("url") or c.url, **facts,
               "sidecar": ax.rel(side_path), **dedupe_file(ctx, path, facts)}
        files.append({k: row.get(k) for k in FILE_FIELDS})
        ctx.known.setdefault(str(facts.get("sha256")), f"internet:{c.source}/{c.item_id}/{path.name}")
    if not files:
        return None
    hours = sum(float(f.get("duration_s") or 0.0) for f in files if not f.get("excluded")) / 3600.0
    manifest = {"source": c.source, "item_id": c.item_id, "url": c.url, "title": c.title, "creator": c.creator,
                "date": c.date, "licence_text": c.licence_text, "licence_url": c.licence_url, "tier": c.tier,
                "rights_note": c.rights_note, "query": c.query, "fetched_at": fetched_at, "files": files,
                "hours": round(hours, 4), "possible_harvard_duplicate": harvard_matches(c.title, ctx.harvard_titles)}
    if manifest["possible_harvard_duplicate"]:
        ctx.stats["possible_harvard_duplicate"] += 1
    return {k: manifest.get(k) for k in MANIFEST_FIELDS}


def _safe_id(s: str) -> str:
    return re.sub(r"[^\w.-]+", "_", s)[:120] or "item"


def _safe_name(s: str) -> str:
    return re.sub(r"[^\w.\- ]+", "_", Path(s).name)[:180] or "download"


def process(c: Candidate, ctx: Context) -> str:
    """Route one candidate: skipped / candidate (search-only or cap) / downloaded / already."""
    key = (c.source, c.item_id)
    ctx.stats[f"candidates_{c.source}"] += 1
    if ctx.store.has_files(key):
        ctx.stats["already_downloaded"] += 1
        return "already"
    if not c.accepted:
        ctx.store.skipped[key] = c.skipped_row(ctx.now)
        ctx.stats[f"skipped:{(c.reason or 'rejected').split(':')[0]}"] += 1
        return "skipped"
    if c.source == "ia" and not c.files:
        try:
            md, files = ia_item(c.item_id, ctx.limiter)
        except Exception as exc:
            c.accepted, c.reason = False, f"{REASON_UNAVAILABLE}: {exc!r}"[:200]
            ctx.store.skipped[key] = c.skipped_row(ctx.now)
            ctx.stats[f"skipped:{REASON_UNAVAILABLE}"] += 1
            return "skipped"
        ok, text, url, reason = decide_ia_licence(md or {"licenseurl": c.licence_url, "rights": c.licence_text})
        if md and not ok:  # the item page disagrees with the search index: trust the item
            c.accepted, c.reason, c.licence_text, c.licence_url = False, reason, text, url
            ctx.store.skipped[key] = c.skipped_row(ctx.now)
            ctx.stats[f"skipped:{(reason or 'rejected').split(':')[0]}"] += 1
            return "skipped"
        c.files = [{"name": f.get("name"), "url": ia_download_url(c.item_id, str(f.get("name"))),
                    "format": f.get("format"), "bytes": int(f.get("size") or 0), "length": f.get("length")}
                   for f in pick_ia_files(files)]
        if not c.files:
            c.accepted, c.reason = False, REASON_NO_AUDIO
            ctx.store.skipped[key] = c.skipped_row(ctx.now)
            ctx.stats[f"skipped:{REASON_NO_AUDIO}"] += 1
            return "skipped"
    ctx.store.skipped.pop(key, None)
    pending = {**asdict(c), "seen_at": ctx.now}
    pending.pop("meta", None)
    if ctx.search_only:
        pending["pending_reason"] = "search-only run"
        ctx.store.candidates[key] = pending
        ctx.stats["accepted_pending"] += 1
        return "candidate"
    est_h = sum(_seconds(f.get("length")) for f in c.files) / 3600.0 if c.source == "ia" else \
        float(c.meta.get("duration") or 0.0) / 3600.0
    if ctx.store.hours() + est_h > ctx.max_hours:
        pending["pending_reason"] = f"max-hours cap {ctx.max_hours} h reached"
        ctx.store.candidates[key] = pending
        ctx.stats["accepted_over_cap"] += 1
        return "candidate"
    try:
        row = download_candidate(c, ctx)
    except Exception as exc:
        c.accepted, c.reason = False, f"{REASON_UNAVAILABLE}: {exc!r}"[:200]
        ctx.store.skipped[key] = c.skipped_row(ctx.now)
        ctx.stats[f"skipped:{REASON_UNAVAILABLE}"] += 1
        print(f"  download failed {c.source}/{c.item_id}: {exc!r}", flush=True)
        return "skipped"
    if row is None:
        c.accepted, c.reason = False, REASON_NO_AUDIO
        ctx.store.skipped[key] = c.skipped_row(ctx.now)
        return "skipped"
    ctx.store.manifest[key] = row
    ctx.store.candidates.pop(key, None)
    ctx.downloaded.append(row)
    ctx.stats["downloaded_items"] += 1
    ctx.stats["downloaded_files"] += len(row["files"])
    print(f"  downloaded {c.source}/{c.item_id}: {c.title[:60]!r} [{c.licence_text}] {row['hours']:.3f} h", flush=True)
    return "downloaded"


def _seconds(length: object) -> float:
    """IA file 'length' is seconds as a string, sometimes 'mm:ss'."""
    if length is None:
        return 0.0
    s = str(length)
    if ":" in s:
        parts = [float(p) for p in s.split(":") if p]
        return sum(p * 60 ** i for i, p in enumerate(reversed(parts)))
    try:
        return float(s)
    except ValueError:
        return 0.0


def acquire(sources: list[str], ctx: Context, ia_queries: Iterable[str], yt_queries: Iterable[str], rows: int,
            yt_n: int, max_items: int, limit: int, sources_file: Path | None, yt_cc_filter: bool = True) -> dict:
    """Run every requested source through ``process`` with the caps; saves after
    each item. Items already downloaded or already decided are skipped before
    any request and do not count toward ``cap`` (``cached_ids``)."""
    t0 = time.time()
    cap = min(max_items, limit) if limit else max_items
    for source in sources:
        if source == "ia":
            cands: Iterable[Candidate] = ia_candidates(ia_queries, rows, ctx.limiter, cap,
                                                       skip=cached_ids(ctx.store, "ia"), stats=ctx.stats)
        elif source == "yt":
            cands = yt_candidates(yt_queries, yt_n, ctx.limiter, cap, skip=cached_ids(ctx.store, "yt"),
                                  cc_filter=yt_cc_filter, stats=ctx.stats)
        elif source == "file":
            if sources_file is None:
                print("  source 'file' needs --sources-file; skipped", flush=True)
                continue
            cands = (candidate_from_source_row(r, i) for i, r in enumerate(load_sources_file(sources_file)[:cap]))
        else:
            raise SystemExit(f"unknown source {source!r}; choose from {SOURCES}")
        print(f"source {source}: up to {cap} candidates", flush=True)
        for c in cands:
            outcome = process(c, ctx)
            if outcome != "already":
                ctx.store.save()
    run = {"ts": ctx.now, "sources": sources, "search_only": ctx.search_only, "limit": limit, "max_items": max_items,
           "max_hours": ctx.max_hours, "yt_cc_filter": yt_cc_filter,
           "request_gap": ctx.limiter.request_gap, "download_gap": ctx.limiter.download_gap,
           "ia_queries": list(ia_queries) if "ia" in sources else [],
           "yt_queries": list(yt_queries) if "yt" in sources else [], "stats": dict(sorted(ctx.stats.items())),
           "network_waits": len(ctx.limiter.calls), "elapsed_s": round(time.time() - t0, 1),
           "hours_in_manifest": round(ctx.store.hours(), 3)}
    ctx.store.save()
    ctx.store.log_run(run)
    return run


# ───────────────────────────────────────────────────────────── inventory


INVENTORY_EXTRA = ("rights", "url", "item_url", "licence_text", "licence_url", "title", "creator", "date", "source",
                   "item_id", "tier", "rights_note", "near_duplicate_of", "nearest_ahmed_cos", "nearest_ahmed_path",
                   "possible_harvard_duplicate", "dup_of_corpus")


def build_inventory(store: Store, out: Path) -> list[dict]:
    """ahmed_files-schema rows for every manifest file that exists on disk.

    ``ahmed_extract.measure`` supplies stat/sha/probe/silence (reusing rows of
    ``out`` whose size and mtime match), ``finalize`` the positions, in-set
    duplicates and exclusions; the FileRef carries ``ahmed_collection`` only
    because ``finalize`` ranks by CANONICAL_RANK — the row's source_group is
    rewritten to ``internet_<source>`` afterwards. ``rights`` is the manifest
    row's ``tier``; a blank or unknown tier fails closed (rights
    ``internet_research_only``, ``excluded`` with reason ``tier_invalid``) and is
    printed, so a hand edit of the manifest can never widen rights by mistake.
    ``date`` (yt upload_date YYYYMMDD, IA date) is carried so build_sets can
    tell a studio recording from an archival one.
    """
    cache = ax.load_existing(out)
    measured: list[dict] = []
    origin: dict[str, tuple[dict, dict]] = {}
    for key in sorted(store.manifest):
        m = store.manifest[key]
        for f in m.get("files") or []:
            p = _abs(str(f.get("path") or ""))
            if not p.is_file():
                continue
            ref = ax.FileRef(p, "ahmed_collection", m["item_id"], "internet", "loose")
            try:
                row = ax.measure(ref, cache.get(ax.rel(p)))
            except Exception as exc:
                row = ax.measure_failed(ref, exc)
            measured.append(row)
            origin[row["path"]] = (m, f)
    rows = ax.finalize(measured)
    bad_tiers: list[str] = []
    for r in rows:
        m, f = origin[r["path"]]
        tier = str(m.get("tier") or "").strip()
        tier_ok = tier in VALID_TIERS
        r["source_group"] = f"internet_{m['source']}"
        r["project_kind"] = "internet"
        r["role_guess"] = "song"
        r.update({
            "rights": tier if tier_ok else TIER_RESEARCH, "url": f.get("url") or m.get("url"), "item_url": m.get("url"),
            "licence_text": m.get("licence_text"), "licence_url": m.get("licence_url"), "title": m.get("title"),
            "creator": m.get("creator"), "date": m.get("date") or None, "source": m["source"], "item_id": m["item_id"],
            "tier": m.get("tier"), "rights_note": m.get("rights_note"), "near_duplicate_of": f.get("near_duplicate_of"),
            "nearest_ahmed_cos": f.get("nearest_ahmed_cos"), "nearest_ahmed_path": f.get("nearest_ahmed_path"),
            "possible_harvard_duplicate": m.get("possible_harvard_duplicate") or [], "dup_of_corpus": f.get("dup_of"),
        })
        if f.get("excluded") and not r.get("excluded"):
            r["excluded"], r["exclude_reason"] = True, f.get("exclude_reason")
        if not tier_ok:
            bad_tiers.append(f"{m['source']}/{m['item_id']} tier={m.get('tier')!r}")
            if not r.get("excluded"):
                r["excluded"], r["exclude_reason"] = True, REASON_TIER_INVALID
    for what in bad_tiers:
        print(f"  inventory: {what} is not one of {VALID_TIERS}; row written as {TIER_RESEARCH} and excluded "
              f"({REASON_TIER_INVALID})", flush=True)
    write_jsonl(out, rows)
    return rows


# ─────────────────────────────────────────────────────────────── report


DEFAULT_REQUEST_GAP = 5.0
DEFAULT_DOWNLOAD_GAP = 10.0
POLICY_TEMPLATE = (
    "Only material whose licence is explicit and permits reuse is downloaded: Internet Archive items whose "
    "`licenseurl` is CC BY or CC BY-SA, CC0 or the Public Domain Mark, or whose rights text says public domain, CC0 "
    "or CC BY with no negation or reservation in it (\"Not in the public domain\" and \"all rights reserved\" fail "
    "closed); YouTube videos whose licence field reads \"Creative Commons Attribution license (reuse allowed)\"; "
    "hand-added URLs only with a rights note, the tier `internet_cc` and a `licence_url` or `licence_text` that "
    "passes the same rules (contributor tiers are never downloadable here: consented audio goes through "
    "`data/incoming/` and `scripts/intake.py`). Everything else is logged with its reason and not fetched. "
    "Downloads carry the tier `internet_cc` (train + publish, attribution recorded in the sidecar and the manifest). "
    "`internet_research_only` is never downloaded: the tier exists so the manifest can name the policy, not so the "
    "corpus can grow around it. Requests are spaced by at least {request_gap:g} s and downloads by at least "
    "{download_gap:g} s (the latest run row's --request-gap/--download-gap, else the script defaults), 429/5xx "
    "answers are retried with "
    "back-off, and every run is capped per source and by total hours; items already downloaded or already decided "
    "are not re-evaluated. Caveat: a YouTube \"Creative Commons Attribution\" flag is the uploader's declaration, "
    "not proof of ownership. Uploads of classic recordings by third-party channels (a private channel posting a "
    "Xasan Aadan Samatar song, say) are downloaded under `internet_cc` because the declared licence permits it, but "
    "before any adapter trained on them is published each such item must be reviewed by hand and, where the uploader "
    "plainly does not hold the rights, its `tier` in `data/internet/manifest.jsonl` set to "
    "`internet_research_only` and `--inventory` re-run (the inventory then carries that tier and build_sets keeps "
    "it out of publishable sets; a blank or misspelled tier makes the inventory row research-only and excluded)."
)


def policy_text(request_gap: float = DEFAULT_REQUEST_GAP, download_gap: float = DEFAULT_DOWNLOAD_GAP) -> str:
    return POLICY_TEMPLATE.format(request_gap=request_gap, download_gap=download_gap)


def _md_escape(s: object) -> str:
    return str(s or "").replace("|", "\\|").replace("\n", " ").strip()


def render_report(store: Store, ia_queries: Iterable[str], yt_queries: Iterable[str], runs: list[dict],
                  inventory_rows: int | None = None, near_threshold: float = NEAR_DUP_THRESHOLD) -> str:
    """The Markdown report; the policy's rate-limit numbers come from the latest
    run row (``request_gap`` / ``download_gap``), else the defaults."""
    manifest = list(store.manifest.values())
    skipped = list(store.skipped.values())
    candidates = list(store.candidates.values())
    now = datetime.now(tz=UTC).isoformat(timespec="seconds")
    last_run = runs[-1] if runs else {}
    policy = policy_text(float(last_run.get("request_gap") or DEFAULT_REQUEST_GAP),
                         float(last_run.get("download_gap") or DEFAULT_DOWNLOAD_GAP))
    lines = ["# Internet sources — rights-permitting acquisition", "",
             f"Generated {now} by `scripts/internet_acquire.py --report`. Data: `data/internet/manifest.jsonl`, "
             "`skipped.jsonl`, `candidates.jsonl`, `runs.jsonl` (audio and its sidecars are git-ignored).", "",
             "## Policy", "", policy, "",
             "## Summary", "",
             "| source | queries | candidates seen | rights-permitting | downloaded items | files | hours | "
             "pending (not downloaded) | skipped |",
             "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    per_source_queries = {"ia": list(ia_queries), "yt": list(yt_queries), "file": ["--sources-file rows"]}
    for source in SOURCES:
        ms = [m for m in manifest if m["source"] == source]
        sk = [s for s in skipped if s["source"] == source]
        cs = [c for c in candidates if c["source"] == source]
        n_files = sum(len(m.get("files") or []) for m in ms)
        hours = sum(float(m.get("hours") or 0.0) for m in ms)
        lines.append(f"| {source} | {len(per_source_queries[source])} | {len(ms) + len(sk) + len(cs)} | "
                     f"{len(ms) + len(cs)} | {len(ms)} | {n_files} | {hours:.2f} | {len(cs)} | {len(sk)} |")
    total_h = sum(float(m.get("hours") or 0.0) for m in manifest)
    lines += ["", f"Total downloaded: {len(manifest)} items, {total_h:.2f} h of non-excluded audio"
              + (f"; `data/inventory/internet_files.jsonl` holds {inventory_rows} rows." if inventory_rows is not None else "."), ""]
    for source, heading in (("ia", "Internet Archive"), ("yt", "YouTube"), ("file", "Hand-added URLs (--sources-file)")):
        lines += [f"## {heading}", ""]
        qs = per_source_queries[source]
        lines += ["Queries:", ""] + [f"- `{q}`" for q in qs] + [""]
        if source == "yt":
            lines += ["Search mode: YouTube's own \"Creative Commons\" results filter (`sp=EgIwAQ==`) is used as a "
                      "pre-filter unless a run passed `--no-yt-cc-filter`; the decision for every video is still its "
                      "`license` field read with yt-dlp (`Creative Commons Attribution license (reuse allowed)` accepted; "
                      "`Standard YouTube License` or no field rejected).", ""]
        ms = sorted((m for m in manifest if m["source"] == source), key=lambda m: m["item_id"])
        lines += [f"### Downloaded ({len(ms)})", ""]
        if ms:
            lines += ["| item | title | creator | licence | URL | hours | files | notes |",
                      "| --- | --- | --- | --- | --- | --- | --- | --- |"]
            for m in ms:
                notes = []
                for f in m.get("files") or []:
                    if f.get("excluded"):
                        notes.append(f"{f.get('name')}: {f.get('exclude_reason')} ({f.get('dup_of') or f.get('near_duplicate_of')})")
                if m.get("possible_harvard_duplicate"):
                    notes.append("possible Harvard duplicate: " + "; ".join(m["possible_harvard_duplicate"]))
                lic = _md_escape(m.get("licence_text"))
                if m.get("licence_url"):
                    lic = f"[{lic or 'licence'}]({m['licence_url']})"
                lines.append(f"| `{_md_escape(m['item_id'])}` | {_md_escape(m.get('title'))[:80]} | "
                             f"{_md_escape(m.get('creator'))[:50]} | {lic} | {m.get('url')} | {float(m.get('hours') or 0):.3f} | "
                             f"{len(m.get('files') or [])} | {_md_escape('; '.join(notes))} |")
        else:
            lines.append("None.")
        cs = [c for c in candidates if c["source"] == source]
        lines += ["", f"### Rights-permitting, not downloaded ({len(cs)})", ""]
        if cs:
            lines += ["| item | title | licence | URL | why pending |", "| --- | --- | --- | --- | --- |"]
            for c in sorted(cs, key=lambda c: c["item_id"]):
                lines.append(f"| `{_md_escape(c['item_id'])}` | {_md_escape(c.get('title'))[:80]} | "
                             f"{_md_escape(c.get('licence_text'))} | {c.get('url')} | {_md_escape(c.get('pending_reason'))} |")
        else:
            lines.append("None.")
        sk = [s for s in skipped if s["source"] == source]
        reasons = Counter(str(s.get("reason") or "").split(":")[0] for s in sk)
        lines += ["", f"### Skipped ({len(sk)})", ""]
        if sk:
            lines += ["| reason | count |", "| --- | --- |"]
            lines += [f"| {_md_escape(r)} | {n} |" for r, n in reasons.most_common()]
            lines += ["", "Examples (licence text as read from the source):", ""]
            shown: set[str] = set()
            for s in sk:
                r = str(s.get("reason") or "").split(":")[0]
                if r in shown:
                    continue
                shown.add(r)
                lines.append(f"- `{_md_escape(s['item_id'])}` — {_md_escape(s.get('title'))[:70]} — licence: "
                             f"{_md_escape(s.get('licence_text')) or '(none)'} {_md_escape(s.get('licence_url'))} → {_md_escape(s.get('reason'))}")
        else:
            lines.append("None.")
        lines.append("")
    dup_sha = [(m, f) for m in manifest for f in m.get("files") or [] if f.get("exclude_reason") == REASON_DUP_SHA]
    near = [(m, f) for m in manifest for f in m.get("files") or [] if f.get("exclude_reason") == REASON_NEAR_DUP]
    harv = [m for m in manifest if m.get("possible_harvard_duplicate")]
    cos_vals = [float(f["nearest_ahmed_cos"]) for m in manifest for f in m.get("files") or []
                if f.get("nearest_ahmed_cos") is not None]
    lines += ["## Dedupe", "",
              f"- Exact sha256 duplicates of the corpus (excluded): {len(dup_sha)}",
              f"- Near-duplicates of Ahmed's corpus (MERT last-layer cosine >= {near_threshold}, excluded): {len(near)}",
              f"- Possible Harvard duplicates by title (logged, kept): {len(harv)}",
              (f"- Nearest-Ahmed cosine over {len(cos_vals)} downloaded files: min {min(cos_vals):.3f}, "
               f"median {float(np.median(cos_vals)):.3f}, max {max(cos_vals):.3f}") if cos_vals else
              "- No nearest-Ahmed cosines recorded yet.", ""]
    for m, f in dup_sha:
        lines.append(f"- sha256 duplicate: `{m['source']}/{m['item_id']}/{f.get('name')}` = {f.get('dup_of')}")
    for m, f in near:
        lines.append(f"- near-duplicate: `{m['source']}/{m['item_id']}/{f.get('name')}` ~ {f.get('near_duplicate_of')} "
                     f"(cos {f.get('nearest_ahmed_cos')})")
    for m in harv:
        lines.append(f"- possible Harvard duplicate: `{m['source']}/{m['item_id']}` {_md_escape(m.get('title'))[:60]} ~ "
                     + "; ".join(m["possible_harvard_duplicate"]))
    lines += ["", "## Runs", ""]
    if runs:
        lines += ["| when | sources | search-only | limit | gaps (s) | candidates | downloaded | pending | skipped | "
                  "cached | waits | elapsed |",
                  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
        for r in runs[-12:]:
            st = r.get("stats") or {}
            cands = sum(v for k, v in st.items() if k.startswith("candidates_"))
            skips = sum(v for k, v in st.items() if k.startswith("skipped:"))
            gaps = f"{r.get('request_gap', '?')}/{r.get('download_gap', '?')}"
            lines.append(f"| {r.get('ts')} | {' '.join(r.get('sources') or [])} | {r.get('search_only')} | {r.get('limit')} | "
                         f"{gaps} | {cands} | {st.get('downloaded_items', 0)} | "
                         f"{st.get('accepted_pending', 0) + st.get('accepted_over_cap', 0)} | {skips} | "
                         f"{st.get('already_downloaded', 0) + st.get('skipped_cached', 0)} | {r.get('network_waits')} | "
                         f"{r.get('elapsed_s')} s |")
    else:
        lines.append("No runs logged.")
    lines.append("")
    return "\n".join(lines)


# ───────────────────────────────────────────────────────────────── main


def load_queries(path: Path | None) -> tuple[list[str], list[str]]:
    if path is None:
        return list(IA_QUERIES), list(YT_QUERIES)
    obj = json.loads(path.read_text(encoding="utf-8"))
    return [str(q) for q in obj.get("ia", IA_QUERIES)], [str(q) for q in obj.get("yt", YT_QUERIES)]


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sources", nargs="+", choices=SOURCES, default=None,
                    help="sources to query, at least one (default: ia yt when neither --inventory nor --report is given)")
    ap.add_argument("--sources-file", default=None, help=".jsonl/.csv of hand-added URLs (url, rights_note, tier, ...)")
    ap.add_argument("--queries-file", default=None, help='JSON {"ia": [...], "yt": [...]} overriding the module lists')
    ap.add_argument("--search-only", action="store_true", help="decide and log, download nothing")
    ap.add_argument("--limit", type=int, default=0,
                    help="new candidates per source this run (smoke; 0 = --max-items); items already downloaded or "
                         "already decided are not counted, so bounded reruns advance")
    ap.add_argument("--max-items", type=int, default=200, help="new candidates evaluated per source")
    ap.add_argument("--max-hours", type=float, default=40.0, help="cap on total downloaded hours")
    ap.add_argument("--rows", type=int, default=100, help="IA results per query")
    ap.add_argument("--yt-n", type=int, default=40, help="YouTube results per query")
    ap.add_argument("--no-yt-cc-filter", action="store_true",
                    help="plain ytsearchN instead of YouTube's Creative Commons results filter (the licence check still decides)")
    ap.add_argument("--request-gap", type=float, default=DEFAULT_REQUEST_GAP)
    ap.add_argument("--download-gap", type=float, default=DEFAULT_DOWNLOAD_GAP)
    ap.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    ap.add_argument("--inventory", action="store_true", help="write the ahmed_files-schema inventory")
    ap.add_argument("--inventory-out", default=DEFAULT_INVENTORY_OUT)
    ap.add_argument("--report", action="store_true", help="render docs/data/INTERNET_SOURCES.md")
    ap.add_argument("--report-out", default=DEFAULT_REPORT)
    ap.add_argument("--near-dup-threshold", type=float, default=NEAR_DUP_THRESHOLD)
    ap.add_argument("--embeddings", default=DEFAULT_EMBEDDINGS)
    ap.add_argument("--classified", default=DEFAULT_CLASSIFIED)
    ap.add_argument("--catalog", default=DEFAULT_CATALOG)
    ap.add_argument("--ahmed-inventory", default=DEFAULT_AHMED_INVENTORY)
    ap.add_argument("--harvard-manifest", default=DEFAULT_HARVARD_MANIFEST)
    ap.add_argument("--inventory-dir", default=DEFAULT_INVENTORY_DIR)
    ap.add_argument("--device", default="mps")
    return ap


def main() -> None:
    args = build_parser().parse_args()

    out_dir = _abs(args.out_dir)
    store = Store(out_dir)
    ia_q, yt_q = load_queries(_abs(args.queries_file) if args.queries_file else None)
    sources = args.sources
    if sources is None and not (args.inventory or args.report):
        sources = ["ia", "yt"]
    if sources:
        limiter = RateLimiter(args.request_gap, args.download_gap)
        ctx = Context(store=store, limiter=limiter,
                      known=load_known_sha256s(_abs(args.ahmed_inventory), _abs(args.harvard_manifest), _abs(args.inventory_dir)),
                      near=NearDupIndex(None, []) if args.search_only else NearDupIndex.load(_abs(args.embeddings), _abs(args.classified)),
                      harvard_titles=load_harvard_titles(_abs(args.catalog)), search_only=args.search_only,
                      max_hours=args.max_hours, near_threshold=args.near_dup_threshold, device=args.device,
                      session=requests.Session())
        print(f"known sha256s: {len(ctx.known)}; ahmed embeddings for near-dup: {len(ctx.near)}; "
              f"harvard titles: {len(ctx.harvard_titles)}; manifest holds {len(store.manifest)} items "
              f"({store.hours():.2f} h)", flush=True)
        run = acquire(sources, ctx, ia_q, yt_q, args.rows, args.yt_n, args.max_items, args.limit,
                      _abs(args.sources_file) if args.sources_file else None, yt_cc_filter=not args.no_yt_cc_filter)
        print(json.dumps(run, indent=2, ensure_ascii=False))
    inventory_rows: int | None = None
    if args.inventory:
        rows = build_inventory(store, _abs(args.inventory_out))
        inventory_rows = len(rows)
        kept = sum(1 for r in rows if not r.get("excluded"))
        print(f"inventory: {len(rows)} rows ({kept} kept) -> {ax.rel(_abs(args.inventory_out))}", flush=True)
    if args.report:
        runs = _jsonl(store.runs_path)
        text = render_report(store, ia_q, yt_q, runs, inventory_rows, args.near_dup_threshold)
        out = _abs(args.report_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_name(out.name + ".tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, out)
        print(f"report -> {ax.rel(out)}", flush=True)


if __name__ == "__main__":
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    main()
