"""Listening review of a transcribed recording, one phrase at a time.

A musician who does not read notation can still tell whether the machine
heard the tune. This module cuts a recording into phrases of about four bars
along the beat grid the score was snapped to, serves each phrase two ways
(the recording itself, and the score's notes played back on the same
timeline by a plucked-string synth), and keeps the listener's verdicts,
notes and recordings in data/annotation/<slug>/review_<annotator>.json. The
export lists what was marked wrong with the bar numbers and timestamps
needed to fix it in MuseScore.

A recording can come from an annotation pack (data/annotation/<slug>/), from
the transcription pool (data/transcription_pool/<slug>/) or from the demo
folders (data/transcription_demo/<name>/, slug demo_<name>); every transcribed
recording on disk is offered. Nothing leaves this machine: the source audio is
served only inside the local service.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

REPO = Path(__file__).resolve().parents[3]
ANNOTATION_ROOT = REPO / "data" / "annotation"
POOL_ROOT = REPO / "data" / "transcription_pool"
DEMO_ROOT = REPO / "data" / "transcription_demo"
HASH_RE = re.compile(r"^(?:oud|band)_([0-9a-f]{8})_")

SR = 44100
BEATS_PER_BAR = 4
BARS_PER_PHRASE = 4
MIN_TAIL_BARS = 2          # a shorter remainder joins the phrase before it
VERDICTS = ("correct", "wrong_notes", "wrong_rhythm")
SLUG_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}")
ANNOTATOR_RE = re.compile(r"[a-z0-9_-]{1,40}")
RECORDING_TYPES = {"audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "m4a",
                   "audio/webm": "webm", "audio/ogg": "ogg", "audio/wav": "wav", "audio/wave": "wav",
                   "audio/x-wav": "wav", "audio/mpeg": "mp3"}
MAX_RECORDING_BYTES = 30 << 20


@dataclass
class Phrase:
    index: int
    bar_from: int   # 1-based, as printed in the score
    bar_to: int     # inclusive
    start: float    # seconds of the pack's source audio
    end: float


def sanitize_annotator(name: str) -> str:
    """Lower-case, spaces to underscores, then only [a-z0-9_-]."""
    s = re.sub(r"\s+", "_", name.strip().lower())
    s = re.sub(r"[^a-z0-9_-]", "", s)[:40]
    if not s:
        raise ValueError("annotator name needs at least one letter or digit")
    return s


def pack_dir(slug: str, root: Path | None = None) -> Path:
    root = root or ANNOTATION_ROOT
    if not SLUG_RE.fullmatch(slug) or ".." in slug:
        raise KeyError(slug)
    d = root / slug
    if not (d / f"{slug}_pipeline.json").is_file():
        raise KeyError(slug)
    return d


def list_packs(root: Path | None = None) -> list[dict]:
    root = root or ANNOTATION_ROOT
    out: list[dict] = []
    if not root.is_dir():
        return out
    for d in sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith("_")):
        if not (d / "meta.json").is_file() or not (d / f"{d.name}_pipeline.json").is_file():
            continue
        src = _read_json(d / "source.json") if (d / "source.json").is_file() else {}
        out.append({
            "slug": d.name,
            "title": src.get("source_name") or d.name,
            "source": src.get("source"),
            "duration_s": src.get("duration_s"),
            "reviews": sorted(p.name[len("review_"):-len(".json")] for p in d.glob("review_*.json")),
        })
    return out


@dataclass(frozen=True)
class Item:
    """One transcribed recording the page can offer, wherever it lives."""
    slug: str
    kind: str            # pack | pool | demo
    dir: Path            # holds the pipeline JSON and the source wav
    pipeline: Path
    source: Path
    review_dir: Path     # data/annotation/<slug>/, created on the first save
    title: str
    source_kind: str | None
    duration_s: float | None
    legato: bool         # transcribed with the legato segmenter (after 2026-09-11)
    score_name: str      # the MusicXML the export's bar numbers refer to


def _head(p: Path, n: int = 16384) -> str:
    with open(p, "rb") as f:
        return f.read(n).decode("utf-8", "ignore")


def _head_fields(p: Path) -> tuple[bool, float | None, str | None]:
    """legato flag, duration and source file name from the start of a
    pipeline JSON (the frame arrays that follow are too big to parse for an
    index)."""
    h = _head(p)
    legato = re.search(r'"legato":\s*true', h) is not None
    m = re.search(r'"duration_sec":\s*([0-9.]+)', h)
    f = re.search(r'"file":\s*"([^"]+)"', h)
    return legato, (float(m.group(1)) if m else None), (Path(f.group(1)).name if f else None)


def _output_dir_files(d: Path) -> tuple[Path, Path] | None:
    """(pipeline json, input wav) of a transcribe.py output folder."""
    js = sorted(p for p in d.glob("*.json") if p.name != "pool_row.json" and not p.name.endswith("_pipeline.json"))
    for j in js:
        wav = d / (j.name[:-len(".json")] + ".input.wav")
        if wav.is_file():
            return j, wav
    return None


def _pack_item(d: Path) -> Item:
    src = _read_json(d / "source.json") if (d / "source.json").is_file() else {}
    pj = d / f"{d.name}_pipeline.json"
    legato, dur, _ = _head_fields(pj)
    return Item(slug=d.name, kind="pack", dir=d, pipeline=pj, source=d / f"{d.name}_source.wav",
                review_dir=d, title=src.get("source_name") or d.name, source_kind=src.get("source"),
                duration_s=src.get("duration_s") or dur, legato=legato, score_name=f"{d.name}_corrected.musicxml")


def _pool_item(d: Path, annotation_root: Path) -> Item | None:
    files = _output_dir_files(d)
    if files is None:
        return None
    pj, wav = files
    row = _read_json(d / "pool_row.json") if (d / "pool_row.json").is_file() else {}
    if row.get("error"):
        return None
    legato, dur, _ = _head_fields(pj)
    name = row.get("name") or pj.name[:-len(".json")]
    return Item(slug=d.name, kind="pool", dir=d, pipeline=pj, source=wav, review_dir=annotation_root / d.name,
                title=Path(name).stem, source_kind=row.get("source"), duration_s=row.get("duration_s") or dur,
                legato=legato, score_name=pj.name[:-len(".json")] + ".musicxml")


def _demo_item(d: Path, annotation_root: Path) -> Item | None:
    files = _output_dir_files(d)
    if files is None:
        return None
    pj, wav = files
    legato, dur, _ = _head_fields(pj)
    slug = f"demo_{d.name}"
    return Item(slug=slug, kind="demo", dir=d, pipeline=pj, source=wav, review_dir=annotation_root / slug,
                title=pj.name[:-len(".json")], source_kind="demo", duration_s=dur, legato=legato,
                score_name=pj.name[:-len(".json")] + ".musicxml")


def resolve(slug: str, annotation_root: Path | None = None, pool_root: Path | None = None,
            demo_root: Path | None = None) -> Item:
    """The recording behind a slug: an annotation pack first, then a pool
    folder, then a demo folder (slug demo_<name>)."""
    annotation_root = annotation_root or ANNOTATION_ROOT
    pool_root = pool_root or POOL_ROOT
    demo_root = demo_root or DEMO_ROOT
    if not SLUG_RE.fullmatch(slug) or ".." in slug:
        raise KeyError(slug)
    d = annotation_root / slug
    if (d / f"{slug}_pipeline.json").is_file():
        return _pack_item(d)
    d = pool_root / slug
    if d.is_dir():
        it = _pool_item(d, annotation_root)
        if it:
            return it
    if slug.startswith("demo_"):
        d = demo_root / slug[len("demo_"):]
        if d.is_dir():
            it = _demo_item(d, annotation_root)
            if it:
                return it
    raise KeyError(slug)


def _reviews(review_dir: Path) -> list[str]:
    if not review_dir.is_dir():
        return []
    return sorted(p.name[len("review_"):-len(".json")] for p in review_dir.glob("review_*.json"))


def _item_row(it: Item) -> dict:
    return {"slug": it.slug, "kind": it.kind, "title": it.title, "source": it.source_kind,
            "duration_s": it.duration_s, "legato": it.legato, "reviews": _reviews(it.review_dir)}


def list_items(annotation_root: Path | None = None, pool_root: Path | None = None,
               demo_root: Path | None = None) -> list[dict]:
    """Every transcribed recording on disk: the packs, then the pool folded
    to one entry per recording (duplicate files share the content hash in
    the slug), then the demos that are not already in the pool."""
    annotation_root = annotation_root or ANNOTATION_ROOT
    pool_root = pool_root or POOL_ROOT
    demo_root = demo_root or DEMO_ROOT
    out: list[dict] = []
    seen_slugs: set[str] = set()
    seen_hashes: set[str] = set()
    if annotation_root.is_dir():
        for d in sorted(p for p in annotation_root.iterdir() if p.is_dir() and not p.name.startswith("_")):
            if (d / "meta.json").is_file() and (d / f"{d.name}_pipeline.json").is_file():
                out.append(_item_row(_pack_item(d)))
                seen_slugs.add(d.name)
                m = HASH_RE.match(d.name)
                if m:
                    seen_hashes.add(m.group(1))
    pool_names: set[str] = set()
    if pool_root.is_dir():
        for d in sorted(p for p in pool_root.iterdir() if p.is_dir() and not p.name.startswith("_")):
            m = HASH_RE.match(d.name)
            if d.name in seen_slugs or (m and m.group(1) in seen_hashes):
                continue
            it = _pool_item(d, annotation_root)
            if it is None:
                continue
            if m:
                seen_hashes.add(m.group(1))
            row = _read_json(d / "pool_row.json") if (d / "pool_row.json").is_file() else {}
            if row.get("name"):
                pool_names.add(row["name"])
            out.append(_item_row(it))
    if demo_root.is_dir():
        for d in sorted(p for p in demo_root.iterdir() if p.is_dir() and not p.name.startswith("_")):
            it = _demo_item(d, annotation_root)
            if it is None:
                continue
            _, _, src_name = _head_fields(it.pipeline)
            if src_name and src_name in pool_names:
                continue
            out.append(_item_row(it))
    return out


def load_pipeline(it: Item) -> dict:
    return _read_json(it.pipeline)


def pack_title(it: Item) -> str:
    return it.title


# ---------------------------------------------------------------- the grid

class Grid:
    """Score positions (quarter lengths; one per beat, bar = 4) to seconds.

    transcribe.py snaps every onset to the beat axis of the tracked beats and
    shifts the whole grid right by whole bars for a pickup, so bar b of the
    score starts at beat position 4(b-1) - shift. With the tracked beat times
    the map back to seconds is piecewise-linear, the same interpolation the
    snap used, extrapolated at both ends. A pack written before the grid was
    stored gets a straight line fitted through its engraved notes instead.
    """

    def __init__(self, pipeline: dict):
        t = pipeline.get("tempo", {})
        notes = pipeline.get("notes", [])
        self.shift = float(t.get("pickup_shift_beats") or 0.0)
        bt = t.get("beat_times")
        if bt and len(bt) >= 2:
            self.kind = "beat-tracked"
            self.bt = np.asarray(bt, dtype=float)
            self.idx = np.arange(len(self.bt), dtype=float)
            return
        self.kind = "fitted"
        eng = [n for n in notes if n.get("engraved", True) and n.get("offset_ql") is not None]
        ql = np.array([n["offset_ql"] for n in eng], dtype=float)
        st = np.array([n["start"] for n in eng], dtype=float)
        beat = 60.0 / float(t.get("bpm") or 100.0)
        if len(eng) >= 2 and np.ptp(ql) > 0:
            self.slope, self.icpt = (float(x) for x in np.polyfit(ql, st, 1))
            if self.slope <= 0:  # cannot happen on a sane pack; keep the score playable
                self.slope, self.icpt = beat, float(st[0] - ql[0] * beat)
        else:
            self.slope, self.icpt = beat, (float(st[0] - ql[0] * beat) if len(eng) else 0.0)

    def seconds(self, ql) -> np.ndarray:
        q = np.atleast_1d(np.asarray(ql, dtype=float))
        if self.kind == "fitted":
            return self.icpt + self.slope * q
        b = q - self.shift
        out = np.interp(b, self.idx, self.bt)
        first, last = self.bt[1] - self.bt[0], self.bt[-1] - self.bt[-2]
        before, after = b < 0, b > self.idx[-1]
        out[before] = self.bt[0] + b[before] * first
        out[after] = self.bt[-1] + (b[after] - self.idx[-1]) * last
        return out


def engraved_notes(pipeline: dict) -> list[dict]:
    return [n for n in pipeline.get("notes", [])
            if n.get("engraved", True) and n.get("offset_ql") is not None and n.get("duration_ql")]


def score_bars(pipeline: dict) -> int:
    """Bars in the score: up to the end of the last engraved note."""
    ends = [n["offset_ql"] + n["duration_ql"] for n in engraved_notes(pipeline)]
    if not ends:
        return 1
    return max(1, int(np.ceil(max(ends) / BEATS_PER_BAR - 1e-9)))


def split_phrases(pipeline: dict, bars_per_phrase: int = BARS_PER_PHRASE,
                  min_tail_bars: int = MIN_TAIL_BARS) -> list[Phrase]:
    """Phrases of `bars_per_phrase` bars from bar 1; a remainder shorter than
    `min_tail_bars` joins the phrase before it. Times are clamped to the
    audio: the pickup bar starts at 0, and the last phrase runs to the end of
    the recording when the tail after its last bar line is under two bars."""
    grid = Grid(pipeline)
    n_bars = score_bars(pipeline)
    duration = float(pipeline.get("duration_sec") or grid.seconds(n_bars * BEATS_PER_BAR)[0])
    ranges = [(s, min(s + bars_per_phrase, n_bars)) for s in range(0, n_bars, bars_per_phrase)]
    if len(ranges) > 1 and ranges[-1][1] - ranges[-1][0] < min_tail_bars:
        ranges[-2:] = [(ranges[-2][0], n_bars)]
    bar_len = float(grid.seconds(BEATS_PER_BAR)[0] - grid.seconds(0)[0]) or 2.0
    phrases: list[Phrase] = []
    for i, (b0, b1) in enumerate(ranges):
        t0 = float(np.clip(grid.seconds(b0 * BEATS_PER_BAR)[0], 0.0, duration))
        t1 = float(np.clip(grid.seconds(b1 * BEATS_PER_BAR)[0], 0.0, duration))
        if i == len(ranges) - 1 and 0 < duration - t1 <= 2 * bar_len:
            t1 = duration
        if t1 <= t0:
            continue
        phrases.append(Phrase(index=len(phrases), bar_from=b0 + 1, bar_to=b1, start=round(t0, 3), end=round(t1, 3)))
    return phrases


# ---------------------------------------------------------------- audio

def _fade(x: np.ndarray, sr: int, ms: float = 10.0) -> np.ndarray:
    n = min(len(x) // 2, int(sr * ms / 1000))
    if n > 0:
        ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
        x[:n] *= ramp
        x[-n:] *= ramp[::-1]
    return x


def wav_bytes(x: np.ndarray, sr: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.clip(x, -1.0, 1.0).astype(np.float32), sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def original_audio(it: Item, ph: Phrase) -> bytes:
    """The phrase's window of the source recording, mono, faded."""
    src = it.source
    info = sf.info(src)
    a, b = int(round(ph.start * info.samplerate)), int(round(ph.end * info.samplerate))
    data, sr = sf.read(src, start=a, stop=b, dtype="float32", always_2d=True)
    mono = np.ascontiguousarray(data.mean(axis=1), dtype=np.float32)
    return wav_bytes(_fade(mono, sr), sr)


def pluck(freq: float, seconds: float, sr: int, seed: int, tau: float = 0.45) -> np.ndarray:
    """A plucked string: Karplus-Strong on a noise burst, one period at a
    time (the averaging filter dulls the upper partials as a real string
    does), under an exponential decay so the note dies like an oud course
    rather than ringing for ever. Deterministic for a given seed."""
    period = max(2, int(round(sr / freq)))
    rng = np.random.default_rng(seed)
    buf = rng.uniform(-1.0, 1.0, period).astype(np.float32)
    n = max(period, int(round(seconds * sr)))
    reps = n // period + 1
    out = np.empty(reps * period, dtype=np.float32)
    for r in range(reps):
        out[r * period:(r + 1) * period] = buf
        buf = 0.5 * (buf + np.roll(buf, 1))
    out = out[:n]
    t = np.arange(n, dtype=np.float32) / sr
    env = np.exp(-t / tau).astype(np.float32)
    attack = min(n, int(0.004 * sr))
    if attack > 1:
        env[:attack] *= np.linspace(0.0, 1.0, attack, dtype=np.float32)
    return out * env


def machine_audio(pipeline: dict, ph: Phrase, sr: int = SR) -> bytes:
    """The score's notes inside the phrase, on the recording's timeline:
    pitch from the engraved MIDI, onset and length from the snapped grid
    positions mapped back to seconds, so what is heard is what is written."""
    grid = Grid(pipeline)
    n_total = int(round((ph.end - ph.start) * sr))
    mix = np.zeros(n_total + sr, dtype=np.float32)  # a second of headroom for the last release
    lo, hi = (ph.bar_from - 1) * BEATS_PER_BAR, ph.bar_to * BEATS_PER_BAR
    notes = [n for n in engraved_notes(pipeline) if lo - 1e-6 <= n["offset_ql"] < hi - 1e-6]
    for k, n in enumerate(sorted(notes, key=lambda x: (x["offset_ql"], x["staff"]))):
        t0 = float(grid.seconds(n["offset_ql"])[0]) - ph.start
        t1 = float(grid.seconds(n["offset_ql"] + n["duration_ql"])[0]) - ph.start
        length = max(0.08, t1 - t0)
        freq = 440.0 * 2.0 ** ((float(n["midi"]) - 69.0) / 12.0)
        loud = 0.55 + 0.45 * float(np.clip(n.get("amp", 0.5), 0.0, 1.0))
        sig = pluck(freq, length + 0.25, sr, seed=1000 + k) * loud
        # release: the string is damped where the score ends the note
        rel = int(0.03 * sr)
        cut = int(round(length * sr))
        if cut + rel < len(sig):
            sig[cut:cut + rel] *= np.linspace(1.0, 0.0, rel, dtype=np.float32)
            sig = sig[:cut + rel]
        i0 = int(round(t0 * sr))
        if i0 < 0:
            sig, i0 = sig[-i0:], 0
        i1 = min(len(mix), i0 + len(sig))
        if i1 > i0:
            mix[i0:i1] += sig[:i1 - i0]
    out = mix[:n_total]
    peak = float(np.max(np.abs(out))) if n_total else 0.0
    if peak > 0:
        out = out * (0.7 / peak)
    return wav_bytes(_fade(np.ascontiguousarray(out), sr), sr)


def cached_audio(it: Item, ph: Phrase, kind: str, pipeline: dict) -> bytes:
    """Phrase audio, rendered once per transcription (the key carries the
    pipeline file's size and mtime, so a rerun renders afresh)."""
    st = it.pipeline.stat()
    key = hashlib.sha1(f"{kind}|{ph.index}|{ph.start}|{ph.end}|{st.st_size}|{int(st.st_mtime)}".encode()).hexdigest()[:12]
    cache = it.dir / ".review_cache"
    cache.mkdir(exist_ok=True)
    f = cache / f"{kind}_{ph.index:03d}_{key}.wav"
    if f.is_file():
        return f.read_bytes()
    data = original_audio(it, ph) if kind == "original" else machine_audio(pipeline, ph)
    tmp = f.with_suffix(".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, f)
    return data


# ---------------------------------------------------------------- review state

def review_path(it: Item, annotator: str) -> Path:
    return it.review_dir / f"review_{annotator}.json"


def recordings_dir(it: Item, annotator: str) -> Path:
    return it.review_dir / f"review_{annotator}_recordings"


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def load_review(it: Item, annotator: str) -> dict:
    p = review_path(it, annotator)
    if p.is_file():
        return _read_json(p)
    return {"slug": it.slug, "annotator": annotator, "created": _now(), "updated": None, "phrases": {}}


def save_phrase(it: Item, annotator: str, ph: Phrase, *, verdict: str | None = None,
                note: str | None = None, recording: str | None = None) -> dict:
    """Merge one phrase's verdict / note / recording into the review file and
    write it at once. The phrase bounds are stored with it, so the export
    stands on its own even after the pack is rebuilt."""
    if verdict is not None and verdict not in VERDICTS + ("",):
        raise ValueError(f"verdict must be one of {VERDICTS}")
    rev = load_review(it, annotator)
    entry = rev["phrases"].get(str(ph.index), {})
    entry.update({"bar_from": ph.bar_from, "bar_to": ph.bar_to, "start": ph.start, "end": ph.end})
    if verdict is not None:
        entry["verdict"] = verdict or None
    if note is not None:
        entry["note"] = note.strip()[:2000]
    if recording is not None:
        entry["recording"] = recording
    entry["updated"] = _now()
    rev["phrases"][str(ph.index)] = entry
    rev["updated"] = entry["updated"]
    it.review_dir.mkdir(parents=True, exist_ok=True)
    _write_json(review_path(it, annotator), rev)
    return rev


def save_recording(it: Item, annotator: str, ph: Phrase, data: bytes, content_type: str) -> str:
    if not data:
        raise ValueError("empty recording")
    if len(data) > MAX_RECORDING_BYTES:
        raise ValueError("recording too large")
    ext = RECORDING_TYPES.get((content_type or "").split(";")[0].strip().lower(), "bin")
    stamp = dt.datetime.now().strftime("%Y%m%dT%H%M%S")
    name = f"phrase_{ph.index:03d}_{stamp}.{ext}"
    rd = recordings_dir(it, annotator)
    rd.mkdir(parents=True, exist_ok=True)
    (rd / name).write_bytes(data)
    save_phrase(it, annotator, ph, recording=name)
    return name


def recording_file(it: Item, annotator: str, name: str) -> Path:
    if not re.fullmatch(r"phrase_\d{3}_\d{8}T\d{6}\.[a-z0-9]{1,5}", name):
        raise KeyError(name)
    p = recordings_dir(it, annotator) / name
    if not p.is_file():
        raise KeyError(name)
    return p


def _mmss(t: float) -> str:
    m, s = divmod(float(t), 60.0)
    return f"{int(m)}:{s:04.1f}"


def export_markdown(it: Item, annotator: str) -> str:
    """The phrases marked wrong, with the bar numbers and timestamps to find
    them in MuseScore, in phrase order."""
    rev = load_review(it, annotator)
    items = sorted(((int(k), v) for k, v in rev["phrases"].items()), key=lambda kv: kv[0])
    judged = [v for _, v in items if v.get("verdict")]
    wrong = [(k, v) for k, v in items if v.get("verdict") in ("wrong_notes", "wrong_rhythm")]
    label = {"wrong_notes": "wrong notes", "wrong_rhythm": "wrong rhythm", "correct": "correct"}
    lines = [
        f"# Listening review: {it.title}",
        "",
        f"Recording `{it.slug}`, reviewed by `{annotator}`, exported {dt.datetime.now().strftime('%Y-%m-%d %H:%M')}.",
        f"{len(judged)} phrase{'s' if len(judged) != 1 else ''} judged, {len(wrong)} marked wrong. Bar numbers are those of "
        f"`{it.score_name}`; times are seconds into `{it.source.name}`.",
        "",
    ]
    if not wrong:
        lines.append("Nothing was marked wrong.")
        return "\n".join(lines) + "\n"
    lines += ["| phrase | bars | time | verdict | note | recording |", "|---:|---|---|---|---|---|"]
    for k, v in wrong:
        note = (v.get("note") or "").replace("|", "\\|").replace("\n", " ")
        rec = v.get("recording") or ""
        lines.append(f"| {k + 1} | {v['bar_from']}–{v['bar_to']} | {_mmss(v['start'])}–{_mmss(v['end'])} "
                     f"| {label.get(v['verdict'], v['verdict'])} | {note} | {rec} |")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- helpers

def _read_json(p: Path) -> dict:
    return json.loads(p.read_text())


def _write_json(p: Path, obj: dict) -> None:
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(obj, indent=1, ensure_ascii=False))
    os.replace(tmp, p)


def phrases_payload(it: Item, pipeline: dict) -> dict:
    phrases = split_phrases(pipeline)
    t = pipeline.get("tempo", {})
    return {
        "slug": it.slug,
        "title": it.title,
        "kind": it.kind,
        "legato": it.legato,
        "duration_sec": pipeline.get("duration_sec"),
        "bpm": t.get("bpm"),
        "grid": Grid(pipeline).kind,
        "bars": score_bars(pipeline),
        "staves": sorted({n["staff"] for n in pipeline.get("notes", [])}),
        "phrases": [asdict(p) for p in phrases],
    }
