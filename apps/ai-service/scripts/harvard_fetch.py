"""Complete the local copy of the Harvard Maryan "Aryette" Omar Ali collection
(AWM Spec Coll 103, EAD id mus00044) through the same public route the original
2025 download used — research-only material, never served, never committed.

Route (verified 2026-09-25, no credentials involved):
  finding-aid component  ->  NRS URN (https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:NNN)
  -> 303/302 to the Streaming Delivery Service (mps.lib.harvard.edu/sds/audio/<id>)
  -> the SDS "login/public" bounce only sets an anonymous session cookie
  -> the player page embeds an HLS playlist (playlist.m3u8) whose segments are
     plain MP3 (320 kb/s, 44.1 kHz, stereo); ffmpeg copies the stream, no re-encode.
A second public route exists for 66 catalog objects: their digital-content link
is a plain MP3 on the collection's public site
(somalisongs.share.library.harvard.edu/wp-content/uploads/...), which is saved
directly (the 2025 download used it for two files too).
Anything that lands on a real login (HarvardKey), returns non-200, or has no
playlist is SKIPPED and reported — nothing is bypassed.

Inputs: the finding-aid CSV export (data/harvard_catalog/mus00044.csv), the
older title/url export the 2025 notebook used (harvard_tracks_metadata.csv, whose
row index named the legacy track_NNNN files), and the legacy files already on
disk (data/harvard_raw/legacy/). Output: data/harvard_raw/<AWM_SC>_<side><track>_
<title>__<component>.mp3 + data/harvard_raw/manifest.jsonl (one row per catalog
object with a link: fetched / legacy / skipped + reason) + fetch.log.

Policy (logged as defaults in docs/archive/WORKLOG.md):
  * track-level objects are fetched; a cassette-level object is fetched only when
    the cassette has no linked track objects (otherwise it is the union of the
    tracks and would duplicate audio across song-level splits);
  * one page request every --sleep seconds (default 5) plus a pause proportional to the
    audio just streamed; HTTP 429 -> honour Retry-After or back off 2/5/10/15/30 min;
    resumable, idempotent (the manifest is compacted to one row per object on start;
    rows skipped for transient reasons — 429, network error, stalled stream, SDS
    server-error page, 5xx — are dropped so the next pass retries them).

Usage (from apps/ai-service):
  python -m scripts.harvard_fetch --plan            # counts only, no network
  python -m scripts.harvard_fetch --limit 2         # smoke
  python -m scripts.harvard_fetch                   # everything
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import re
import subprocess
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import requests

REPO = Path(__file__).resolve().parents[3]
CATALOG = REPO / "data/harvard_catalog/mus00044.csv"
META = REPO / "data/harvard_catalog/harvard_tracks_metadata.csv"
RAW = REPO / "data/harvard_raw"
LEGACY = RAW / "legacy"
MANIFEST = RAW / "manifest.jsonl"
LOG = RAW / "fetch.log"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
SIDE_RE = re.compile(r"^Side\s+([AB])\.?\s*Track\s+(\d+)\.?:?\s*(.*)$", re.IGNORECASE)
CASSETTE_RE = re.compile(r"AWM\s+SC\s+(\d+)", re.IGNORECASE)
M3U8_RE = re.compile(r'file:\s*"(https://mps\.lib\.harvard\.edu/vod/[^"]+playlist\.m3u8)"')
PERF_RE = re.compile(r"(Performer:.*?)(?:Now playing|<)", re.S)


def log(msg: str) -> None:
    line = f"{time.strftime('%F %T')} {msg}"
    print(line, flush=True)
    RAW.mkdir(parents=True, exist_ok=True)
    with open(LOG, "a") as f:
        f.write(line + "\n")


def norm_urn(url: str) -> str:
    """Case-insensitive URN key: 'fhcl.loeb:33897963' (hosts nrs.harvard.edu and nrs.lib.harvard.edu both occur)."""
    m = re.search(r"urn-3:([\w.]+:\d+)", url, re.IGNORECASE)
    return m.group(1).lower() if m else url.strip().lower()


def safe(s: str, n: int = 60) -> str:
    s = re.sub(r"[^\w\s-]", "", html.unescape(s)).strip()
    s = re.sub(r"\s+", "_", s)
    return s[:n].strip("_") or "untitled"


@dataclass
class Obj:
    cid: str
    title: str
    ctype: str          # Item (cassette) | Track
    link: str
    parent: str         # cassette title for tracks
    cassette: str       # AWM SC number when known
    side: str = ""
    track: str = ""
    song: str = ""
    children_linked: int = 0
    extra: dict = field(default_factory=dict)

    @property
    def urn(self) -> str:
        return norm_urn(self.link)

    def out_name(self) -> str:
        if self.ctype == "Track":
            core = f"AWM_SC_{self.cassette or 'x'}_{self.side}{self.track}_{safe(self.song or self.title)}"
        else:
            core = f"AWM_SC_{self.cassette or 'x'}_cassette_{safe(self.title)}"
        return f"{core}__{self.cid}.mp3"


def load_catalog(path: Path = CATALOG) -> list[Obj]:
    rows = list(csv.reader(open(path, encoding="utf-8", errors="ignore")))
    hi = next(i for i, r in enumerate(rows) if r and r[0] == "Database Number")
    hdr = rows[hi]
    data = [dict(zip(hdr, r)) for r in rows[hi + 1:] if len(r) >= len(hdr)]
    items = {r["Component Title"]: r for r in data if r["Component Type"] == "Item"}
    objs: list[Obj] = []
    linked_children: dict[str, int] = defaultdict(int)
    for r in data:
        if r["Component Type"] == "Track" and r["Digital Content Link"].strip():
            linked_children[r["Level 2"]] += 1
    for r in data:
        link = r["Digital Content Link"].strip()
        if not link or r["Component Type"] not in ("Item", "Track"):
            continue
        if r["Component Type"] == "Track":
            parent = r["Level 2"]
            cass = CASSETTE_RE.search(items.get(parent, {}).get("Container Info", "") or "")
            m = SIDE_RE.match(r["Component Title"].strip())
            o = Obj(r["Database Number"], r["Component Title"].strip(), "Track", link, parent,
                    cass.group(1) if cass else "", m.group(1).upper() if m else "", m.group(2) if m else "",
                    m.group(3).strip() if m else r["Component Title"].strip())
        else:
            cass = CASSETTE_RE.search(r.get("Container Info", "") or "")
            o = Obj(r["Database Number"], r["Component Title"].strip(), "Item", link, "",
                    cass.group(1) if cass else "", children_linked=linked_children.get(r["Component Title"], 0))
        objs.append(o)
    return objs


def legacy_index(meta_path: Path = META, legacy_dir: Path = LEGACY) -> dict[str, Path]:
    """URN key -> legacy file. Legacy names are track_NNNN_<title>; NNNN is the 1-based row of harvard_tracks_metadata.csv."""
    out: dict[str, Path] = {}
    if not meta_path.exists() or not legacy_dir.exists():
        return out
    rows = list(csv.DictReader(open(meta_path, encoding="utf-8", errors="ignore")))
    for f in sorted(legacy_dir.glob("*.mp3")):
        m = re.match(r"track_(\d{4})", f.name)
        if not m:
            continue
        i = int(m.group(1))
        if 1 <= i <= len(rows) and rows[i - 1]["url"].strip():
            out[norm_urn(rows[i - 1]["url"])] = f
    return out


def ffprobe_duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


AUDIO_SUFFIXES = (".mp3", ".m4a", ".wav", ".flac", ".aac")


def is_direct_audio(url: str, content_type: str = "") -> bool:
    """A link that IS the audio (the collection's public Somali Songs site serves plain
    MP3 files under wp-content/uploads) rather than a player page."""
    path = url.split("?", 1)[0].lower()
    return path.endswith(AUDIO_SUFFIXES) or content_type.lower().startswith("audio/")


def resolve(session: requests.Session, link: str, timeout: int = 30, save_audio_to: Path | None = None) -> tuple[str, int, str, float]:
    """Follow the link. Returns (final_url, status, html, retry_after_s). When the
    response is audio itself and save_audio_to is given, the bytes are streamed to
    that path and html is the marker "<direct-audio>"."""
    r = session.get(link, allow_redirects=True, timeout=timeout, stream=True)
    ra = r.headers.get("Retry-After", "")
    try:
        retry_after = float(ra) if ra else 0.0
    except ValueError:
        retry_after = 0.0
    ct = r.headers.get("Content-Type", "")
    if r.status_code == 200 and save_audio_to is not None and is_direct_audio(r.url, ct):
        tmp = save_audio_to.with_suffix(".part.mp3")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 16):
                f.write(chunk)
        if ffprobe_duration(tmp) <= 0:
            tmp.unlink(missing_ok=True)
            return r.url, r.status_code, "<direct-audio-unreadable>", retry_after
        tmp.rename(save_audio_to)
        return r.url, r.status_code, "<direct-audio>", retry_after
    return r.url, r.status_code, r.text, retry_after


BACKOFF_S = [120.0, 300.0, 600.0, 900.0, 1800.0]
STREAM_IO_TIMEOUT_S = 30      # ffmpeg gives up on a segment read that stalls this long
STREAM_MAX_S = 1800           # and on any single object that takes longer than this in total   # after HTTP 429: wait, retry; grows per consecutive 429


def resolve_with_backoff(session: requests.Session, link: str, on_wait, save_audio_to: Path | None = None) -> tuple[str, int, str]:
    """resolve() that treats HTTP 429 as "slow down": waits (Retry-After if given, else the
    growing schedule) and retries. Gives up after the schedule is exhausted and returns the 429."""
    final_url, status, text = "", 0, ""
    for attempt, wait in enumerate([0.0, *BACKOFF_S]):
        if wait:
            on_wait(wait, attempt)
            time.sleep(wait)
        final_url, status, text, retry_after = resolve(session, link, save_audio_to=save_audio_to)
        if status != 429:
            return final_url, status, text
        if retry_after > 0:
            on_wait(retry_after, attempt)
            time.sleep(retry_after)
            final_url, status, text, _ = resolve(session, link, save_audio_to=save_audio_to)
            if status != 429:
                return final_url, status, text
    return final_url, status, text


def parse_page(text: str) -> dict:
    playlists = M3U8_RE.findall(text)
    plain = re.sub(r"<script.*?</script>", "", text, flags=re.S)
    plain = html.unescape(re.sub(r"<[^>]+>", " ", plain))
    plain = re.sub(r"\s+", " ", plain)
    perf = re.search(r"(Performer:.*?)(?: Now playing| x Related)", plain)
    ident = re.search(r"Local identifier:\s*(\S+)", plain)
    dur = re.search(r"Duration:\s*([\d:]+)", plain)
    title = re.search(r"<title>(.*?)</title>", text, re.S)
    return {
        "playlists": playlists,
        "page_title": html.unescape(title.group(1)).strip() if title else "",
        "performer_line": perf.group(1).strip() if perf else "",
        "local_identifier": ident.group(1) if ident else "",
        "page_duration": dur.group(1) if dur else "",
    }


def download(m3u8: str, referer: str, out: Path) -> tuple[bool, str]:
    tmp = out.with_suffix(".part.mp3")
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-user_agent", UA,
           "-headers", f"Referer: {referer}\r\n", "-rw_timeout", str(STREAM_IO_TIMEOUT_S * 1_000_000),
           "-i", m3u8, "-vn", "-c:a", "copy", "-y", str(tmp)]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=STREAM_MAX_S)
    except subprocess.TimeoutExpired:
        tmp.unlink(missing_ok=True)
        return False, f"stream stalled: ffmpeg exceeded {STREAM_MAX_S} s"
    if p.returncode != 0:
        tmp.unlink(missing_ok=True)
        return False, (p.stderr or "ffmpeg failed").strip()[-300:]
    if ffprobe_duration(tmp) <= 0:
        tmp.unlink(missing_ok=True)
        return False, "empty stream"
    tmp.rename(out)
    return True, ""


def plan(objs: list[Obj], legacy: dict[str, Path]) -> dict[str, list[Obj]]:
    groups: dict[str, list[Obj]] = defaultdict(list)
    seen: set[str] = set()
    for o in objs:
        if o.urn in seen:
            groups["duplicate_link"].append(o)
            continue
        seen.add(o.urn)
        if o.urn in legacy:
            groups["legacy"].append(o)
        elif o.ctype == "Item" and o.children_linked > 0:
            groups["cassette_superseded_by_tracks"].append(o)
        else:
            groups["fetch"].append(o)
    return groups


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true", help="print the plan and exit (no network)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--sleep", type=float, default=5.0)
    ap.add_argument("--only", nargs="*", default=None, help="component ids to fetch")
    args = ap.parse_args()

    objs = load_catalog()
    legacy = legacy_index()
    groups = plan(objs, legacy)
    summary = {k: len(v) for k, v in groups.items()}
    summary["legacy_files_on_disk"] = len(list(LEGACY.glob("*.mp3"))) if LEGACY.exists() else 0
    print(json.dumps(summary, indent=2))
    if args.plan:
        return

    RAW.mkdir(parents=True, exist_ok=True)
    done: dict[str, dict] = {}
    if MANIFEST.exists():
        for line in open(MANIFEST):
            if line.strip():
                r = json.loads(line)
                done[r["cid"]] = r          # last row per cid wins
        # compact: one row per cid, and drop transient failures so they are retried
        transient = ("HTTP 429", "network error", "stream stalled", "SDS error page", "HTTP 5")
        keep = [r for r in done.values()
                if not (r["status"] == "skipped" and any(t in (r.get("reason") or "") for t in transient))]
        done = {r["cid"]: r for r in keep}
        MANIFEST.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in keep))
    mf = open(MANIFEST, "a")

    def record(row: dict) -> None:
        done[row["cid"]] = row
        mf.write(json.dumps(row, ensure_ascii=False) + "\n")
        mf.flush()

    # rows for objects we will never fetch, written once
    for o in groups["legacy"]:
        if o.cid not in done:
            f = legacy[o.urn]
            record({"cid": o.cid, "status": "legacy", "type": o.ctype, "title": o.title, "parent": o.parent,
                    "cassette": o.cassette, "side": o.side, "track": o.track, "link": o.link, "file": str(f.relative_to(REPO)),
                    "duration_s": round(ffprobe_duration(f), 2), "bytes": f.stat().st_size, "sha256": sha256(f)})
    for o in groups["cassette_superseded_by_tracks"]:
        if o.cid not in done:
            record({"cid": o.cid, "status": "skipped", "reason": f"cassette-level object; {o.children_linked} linked track objects fetched instead",
                    "type": o.ctype, "title": o.title, "cassette": o.cassette, "link": o.link})
    for o in groups["duplicate_link"]:
        if o.cid not in done:
            record({"cid": o.cid, "status": "skipped", "reason": "same digital object as another component (duplicate link)",
                    "type": o.ctype, "title": o.title, "cassette": o.cassette, "link": o.link})

    todo = [o for o in groups["fetch"] if o.cid not in done or done[o.cid]["status"] not in ("fetched",)]
    if args.only:
        todo = [o for o in todo if o.cid in set(args.only)]
    if args.limit:
        todo = todo[: args.limit]
    log(f"START fetch: {len(todo)} objects to fetch, {len(done)} manifest rows already")

    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Referer": "https://id.lib.harvard.edu/"})
    n_ok = n_skip = 0
    consecutive_429 = 0
    t_start = time.time()
    for i, o in enumerate(todo, 1):
        out = RAW / o.out_name()
        if out.exists() and ffprobe_duration(out) > 0:
            record({"cid": o.cid, "status": "fetched", "type": o.ctype, "title": o.title, "parent": o.parent, "cassette": o.cassette,
                    "side": o.side, "track": o.track, "link": o.link, "file": str(out.relative_to(REPO)),
                    "duration_s": round(ffprobe_duration(out), 2), "bytes": out.stat().st_size, "sha256": sha256(out), "note": "already on disk"})
            n_ok += 1
            continue
        try:
            final_url, status, text = resolve_with_backoff(
                session, o.link, lambda w, a, cid=o.cid: log(f"HTTP 429 from the media server on {cid}; waiting {w:.0f}s (attempt {a})"))
        except requests.RequestException as e:
            record({"cid": o.cid, "status": "skipped", "reason": f"network error: {type(e).__name__}", "type": o.ctype, "title": o.title,
                    "cassette": o.cassette, "link": o.link})
            n_skip += 1
            time.sleep(args.sleep)
            continue
        time.sleep(args.sleep)
        base = {"cid": o.cid, "type": o.ctype, "title": o.title, "parent": o.parent, "cassette": o.cassette, "side": o.side,
                "track": o.track, "link": o.link, "final_url": final_url, "http_status": status}
        if status == 429:
            record({**base, "status": "skipped", "reason": f"HTTP 429 at {final_url} (rate limit persisted through the back-off schedule)"})
            n_skip += 1
            consecutive_429 += 1
            if consecutive_429 >= 3:
                log("three objects in a row still rate-limited after back-off; stopping this pass (rerun later, rows are retried)")
                break
            continue
        consecutive_429 = 0
        if status != 200:
            record({**base, "status": "skipped", "reason": f"HTTP {status} at {final_url}"})
            n_skip += 1
            continue
        if "login" in final_url and "login/public" not in final_url or "key.harvard.edu" in final_url or "HarvardKey" in text:
            record({**base, "status": "skipped", "reason": "requires a Harvard login (HarvardKey); not public"})
            n_skip += 1
            continue
        if text == "<direct-audio-unreadable>":
            record({**base, "status": "skipped", "reason": "direct audio link answered but the file is unreadable"})
            n_skip += 1
            continue
        if text == "<direct-audio>":
            record({**base, "status": "fetched", "route": "direct", "file": str(out.relative_to(REPO)), "files": [str(out.relative_to(REPO))],
                    "duration_s": round(ffprobe_duration(out), 2), "bytes": out.stat().st_size, "sha256": sha256(out),
                    "fetched_at": time.strftime("%FT%T%z")})
            n_ok += 1
            time.sleep(max(args.sleep, done[o.cid]["duration_s"] / 15.0))
            if i % 10 == 0 or i == len(todo):
                el = time.time() - t_start
                log(f"{i}/{len(todo)} fetched={n_ok} skipped={n_skip} elapsed={el/60:.1f}min eta={(el/i)*(len(todo)-i)/60:.0f}min")
            continue
        page = parse_page(text)
        if not page["playlists"]:
            reason = ("SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate)"
                      if "your request could not be completed" in text else "no public stream on the SDS page (no playlist)")
            record({**base, "status": "skipped", "reason": reason, **{k: v for k, v in page.items() if k != "playlists"}})
            n_skip += 1
            continue
        files = []
        ok_all = True
        for pi, m3u8 in enumerate(page["playlists"]):
            target = out if len(page["playlists"]) == 1 else out.with_name(out.stem + f"_part{pi:02d}.mp3")
            ok, err = download(m3u8, final_url, target)
            if not ok:
                ok_all = False
                record({**base, "status": "skipped", "reason": f"stream download failed: {err}", "m3u8": m3u8})
                break
            files.append(target)
        if not ok_all:
            n_skip += 1
            continue
        f0 = files[0]
        record({**base, "status": "fetched", "file": str(f0.relative_to(REPO)),
                "files": [str(f.relative_to(REPO)) for f in files], "m3u8": page["playlists"],
                "duration_s": round(sum(ffprobe_duration(f) for f in files), 2), "bytes": sum(f.stat().st_size for f in files),
                "sha256": sha256(f0), "performer_line": page["performer_line"], "local_identifier": page["local_identifier"],
                "page_duration": page["page_duration"], "page_title": page["page_title"], "fetched_at": time.strftime("%FT%T%z")})
        n_ok += 1
        # be a slow client: pause in proportion to what was just streamed (~1 s per 15 s of audio)
        time.sleep(max(args.sleep, done[o.cid]["duration_s"] / 15.0))
        if i % 10 == 0 or i == len(todo):
            el = time.time() - t_start
            log(f"{i}/{len(todo)} fetched={n_ok} skipped={n_skip} elapsed={el/60:.1f}min eta={(el/i)*(len(todo)-i)/60:.0f}min")
    mf.close()
    log(f"DONE fetched={n_ok} skipped={n_skip}")
    print("HARVARD_FETCH_DONE", flush=True)


if __name__ == "__main__":
    sys.exit(main())
