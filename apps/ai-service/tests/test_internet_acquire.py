"""Unit tests for scripts/internet_acquire.py.

No network: ``internetarchive.search_items`` / ``get_item`` and ``yt_dlp.YoutubeDL``
are monkeypatched to fixtures, ``requests.Session.get`` is poisoned, the file
fetch writes synthesised WAVs (numpy + soundfile), ffprobe goes through
soundfile and the MERT embedding is a stub. Covered: licence decisions (IA
CC-BY / CC-BY-SA / CC0 / PD yes, CC-NC/ND no, none no, not-Somali no; YouTube
CC yes, Standard no, no field no, unavailable; negated rights text no), the
rate limiter, the sidecar / manifest / skipped schemas (exact key order), IA
download URL quoting, the --sources-file licence requirement, sha256 and MERT
near-duplicate dedupe, the Harvard title match, resumability (cached skips, the
--limit cursor) and caps, the fail-closed inventory tiers, the date column and
the report rendering.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import internetarchive
import numpy as np
import pytest
import requests
import soundfile as sf
import yt_dlp

from scripts import ahmed_extract as ax
from scripts import internet_acquire as ia

SR = 32000
IA_ITEMS = {
    "somali-qaraami-cc": {
        "identifier": "somali-qaraami-cc", "title": "Qaraami songs from Hargeisa (1972)", "creator": ["Radio Hargeisa"],
        "date": "1972", "licenseurl": "https://creativecommons.org/licenses/by/4.0/", "subject": ["Somali music", "qaraami"],
        "mediatype": "audio", "description": "Oud and voice.",
    },
    "somali-nc": {
        "identifier": "somali-nc", "title": "Somali oud improvisations", "creator": "A. Farah", "date": "2010",
        "licenseurl": "http://creativecommons.org/licenses/by-nc-nd/3.0/", "subject": "somali", "mediatype": "audio",
    },
    "somali-nolicence": {
        "identifier": "somali-nolicence", "title": "Heeso Soomaali", "creator": "unknown", "mediatype": "audio",
        "subject": ["Somalia"], "rights": "All rights reserved by the uploader",
    },
    "not-somali": {
        "identifier": "not-somali", "title": "Brass band marches", "creator": "Municipal band", "mediatype": "audio",
        "licenseurl": "https://creativecommons.org/licenses/by/4.0/",
    },
    "somali-pd-wisiisi": {
        "identifier": "somali-pd-wisiisi", "title": "Sahra Ahmed - Wisiisi (Longing), qaraami 78rpm",
        "creator": "Sahra Ahmed", "date": "1958", "mediatype": "audio", "rights": "Public domain in Somalia and the US",
        "subject": ["somali"],
    },
    "somali-noaudio": {
        "identifier": "somali-noaudio", "title": "Somali music programme notes", "mediatype": "audio",
        "licenseurl": "https://creativecommons.org/publicdomain/zero/1.0/", "subject": "somali",
    },
}
IA_FILES = {
    "somali-qaraami-cc": [
        {"name": "songA.wav", "format": "WAVE", "source": "original", "size": "1000", "length": "120.0"},
        {"name": "songA.mp3", "format": "VBR MP3", "source": "derivative", "size": "300", "length": "120.0"},
        {"name": "songB_dup.wav", "format": "WAVE", "source": "original", "size": "1000", "length": "90"},
        {"name": "cover.jpg", "format": "JPEG", "source": "original", "size": "10"},
    ],
    "somali-pd-wisiisi": [{"name": "wisiisi.wav", "format": "WAVE", "source": "original", "size": "500", "length": "3:00"}],
    "somali-noaudio": [{"name": "notes.pdf", "format": "Text PDF", "source": "original", "size": "500"}],
}
YT_LICENCES = {
    "ccvid00001": ia.YT_CC_LICENCE,
    "stdvid0001": "Standard YouTube License",
    "nolic00001": None,
    "gone000001": "unavailable",
}
HARVARD_TITLES = [("wisiisi", "Side A. Track 1: Wisiisi (Longing)"), ("carro edeg", "Side A. Track 2: Carro-edeg")]


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


def _tone(seconds: float, freq: float) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    return (0.4 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _freq_for(url: str) -> float:
    return 200.0 + (int(hashlib.sha1(url.encode()).hexdigest()[:4], 16) % 400)


def _write_tone(dest: Path, freq: float, seconds: float = 4.0) -> None:
    """4 s by default: shorter files are excluded as `silent` by ahmed_extract.finalize (MIN_DURATION_S)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    sf.write(dest, _tone(seconds, freq), SR, subtype="PCM_16")


def _rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


class FakeItem:
    def __init__(self, ident: str) -> None:
        self.metadata = IA_ITEMS.get(ident, {})
        self.files = IA_FILES.get(ident, [])


class FakeYDL:
    calls: list[tuple[str, bool, dict]] = []

    def __init__(self, opts: dict) -> None:
        self.opts = opts

    def __enter__(self) -> FakeYDL:
        return self

    def __exit__(self, *exc: object) -> bool:
        return False

    def extract_info(self, url: str, download: bool = False) -> dict:
        FakeYDL.calls.append((url, download, self.opts))
        if url.startswith("ytsearch") or url.startswith("https://www.youtube.com/results?"):
            return {"entries": [{"id": vid, "url": f"https://www.youtube.com/watch?v={vid}", "title": f"video {vid}",
                                 "uploader": "chan", "duration": 100} for vid in YT_LICENCES]}
        vid = url.rsplit("v=", 1)[1]
        lic = YT_LICENCES[vid]
        if lic == "unavailable":
            raise yt_dlp.utils.DownloadError("ERROR: Video unavailable")
        info = {"id": vid, "title": f"Heesta {vid}", "uploader": "Somali Archive Channel", "upload_date": "20200101",
                "webpage_url": url, "duration": 100, "license": lic}
        if download:
            out = Path(str(self.opts["outtmpl"]).replace("%(id)s", vid).replace("%(ext)s", "wav"))
            _write_tone(out, _freq_for(url))
            info["requested_downloads"] = [{"filepath": str(out)}]
        return info


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_a: object, **_k: object) -> None:
        raise AssertionError("network call attempted in a unit test")

    monkeypatch.setattr(requests.Session, "get", boom)
    monkeypatch.setattr(internetarchive, "search_items", boom)
    monkeypatch.setattr(internetarchive, "get_item", boom)
    monkeypatch.setattr(yt_dlp, "YoutubeDL", boom)


@pytest.fixture
def fakes(monkeypatch: pytest.MonkeyPatch) -> dict:
    """IA search/get_item, YoutubeDL, fetch_url, probe and the embedding stub."""
    searches: list[str] = []
    items: list[str] = []
    fetched: list[str] = []

    def search_items(query: str, fields: list[str] | None = None, params: dict | None = None, **_k: object) -> list[dict]:
        searches.append(query)
        assert params == {"rows": 100} or params
        return list(IA_ITEMS.values())

    def get_item(ident: str, **_k: object) -> FakeItem:
        items.append(ident)
        return FakeItem(ident)

    def fetch_url(url: str, dest: Path, limiter: ia.RateLimiter, session: object = None, **_k: object) -> int:
        limiter.wait("download")
        fetched.append(url)
        _write_tone(dest, _freq_for(url))
        return dest.stat().st_size

    def probe(path: Path) -> dict:
        info = sf.info(str(path))
        return {"bytes": path.stat().st_size, "sha256": ax.sha256_file(path), "duration_s": round(info.duration, 3),
                "sample_rate": info.samplerate, "channels": info.channels, "codec": "pcm_s16le"}

    e0 = np.zeros(768, dtype=np.float32)
    e0[0] = 1.0
    e1 = np.zeros(768, dtype=np.float32)
    e1[1] = 1.0
    near = ia.NearDupIndex(np.stack([e0, e1]).astype(np.float64), ["data/ahmed_raw/x/a.aif", "data/ahmed_raw/x/b.aif"])

    def embed(path: Path, device: str = "cpu") -> np.ndarray:
        if "dup" in path.name:
            return e0 * 3.0                      # same direction as a.aif -> cosine 1.0
        v = e0 + e1
        v[2] = 2.0                               # cosine to a.aif = 1/sqrt(6) ~ 0.41
        return v

    monkeypatch.setattr(internetarchive, "search_items", search_items)
    monkeypatch.setattr(internetarchive, "get_item", get_item)
    monkeypatch.setattr(yt_dlp, "YoutubeDL", FakeYDL)
    monkeypatch.setattr(ia, "fetch_url", fetch_url)
    monkeypatch.setattr(ia, "probe", probe)
    monkeypatch.setattr(ia, "embed_first_30s", embed)
    FakeYDL.calls = []
    return {"searches": searches, "items": items, "fetched": fetched, "near": near}


def _ctx(tmp_path: Path, fakes: dict, **kw: object) -> ia.Context:
    slept: list[float] = []
    limiter = ia.RateLimiter(5.0, 10.0, sleep=slept.append, clock=lambda: 1000.0 + sum(slept))
    limiter.slept = slept  # type: ignore[attr-defined]
    store = ia.Store(tmp_path / "internet")
    ctx = ia.Context(store=store, limiter=limiter, known={}, near=fakes["near"], harvard_titles=HARVARD_TITLES,
                     device="cpu", **kw)  # type: ignore[arg-type]
    return ctx


# ---------------------------------------------------------------------------
# pure decisions
# ---------------------------------------------------------------------------


def test_rate_limiter_spacing() -> None:
    slept: list[float] = []
    now = [1000.0]
    lim = ia.RateLimiter(5.0, 10.0, sleep=lambda s: (slept.append(s), now.__setitem__(0, now[0] + s)), clock=lambda: now[0])
    assert lim.wait("request") == 0.0                 # first call: no wait
    assert lim.wait("request") == 5.0                 # second request 5 s later
    assert lim.wait("download") == 5.0                # a download after a request: request gap applies
    assert lim.wait("download") == 10.0               # two downloads: 10 s
    now[0] += 7.0
    assert lim.wait("download") == 3.0                # 7 s already passed of the 10
    assert lim.wait("request") == 5.0
    assert [k for k, _ in lim.calls] == ["request", "request", "download", "download", "download", "request"]
    assert slept == [5.0, 5.0, 10.0, 3.0, 5.0]


@pytest.mark.parametrize(
    ("md", "accepted", "reason"),
    [
        ({"licenseurl": "https://creativecommons.org/licenses/by/4.0/"}, True, None),
        ({"licenseurl": "http://creativecommons.org/licenses/by-sa/3.0/"}, True, None),
        ({"licenseurl": "http://creativecommons.org/publicdomain/zero/1.0/"}, True, None),
        ({"licenseurl": "http://creativecommons.org/publicdomain/mark/1.0/"}, True, None),
        ({"rights": "This recording is in the public domain."}, True, None),
        ({"licenseurl": "http://creativecommons.org/licenses/by-nc/4.0/"}, False, ia.REASON_NC_ND),
        ({"licenseurl": "http://creativecommons.org/licenses/by-nc-sa/4.0/"}, False, ia.REASON_NC_ND),
        ({"licenseurl": "http://creativecommons.org/licenses/by-nd/4.0/"}, False, ia.REASON_NC_ND),
        ({"licenseurl": ["http://creativecommons.org/licenses/by-nc-nd/3.0/"]}, False, ia.REASON_NC_ND),
        ({}, False, ia.REASON_NO_LICENCE),
        ({"rights": "All rights reserved"}, False, ia.REASON_NO_LICENCE),
        ({"licenseurl": "https://example.org/custom-licence"}, False, "licence not recognised: https://example.org/custom-licence"),
        ({"rights": "Public domain in Somalia and the US"}, True, None),
        ({"rights": "CC0 1.0 Universal"}, True, None),
        ({"rights": "Released under CC BY 4.0"}, True, None),
        ({"rights": "Not in the public domain"}, False, "negated"),
        ({"rights": "This is NOT public domain; all rights reserved"}, False, "negated"),
        ({"rights": "Public domain? No. (c) the uploader"}, False, "negated"),
        ({"rights": "Public domain audio, non-commercial use only"}, False, ia.REASON_NC_ND),
        ({"rights": "CC BY-NC 4.0"}, False, ia.REASON_NC_ND),
        ({"rights": ["some text", "public domain"]}, True, None),
    ],
)
def test_decide_ia_licence(md: dict, accepted: bool, reason: str | None) -> None:
    ok, text, url, why = ia.decide_ia_licence(md)
    assert ok is accepted
    if reason == "negated":
        assert why is not None and why.startswith(ia.REASON_NO_LICENCE + ": rights text negated")
    else:
        assert why == reason
    if accepted:
        assert text
    if md.get("licenseurl"):
        assert url == ia._first(md["licenseurl"])


def test_ia_download_url_percent_encodes_the_name() -> None:
    assert ia.ia_download_url("itemA", "Track #1.mp3") == "https://archive.org/download/itemA/Track%20%231.mp3"
    assert ia.ia_download_url("itemA", "what?.mp3") == "https://archive.org/download/itemA/what%3F.mp3"
    assert ia.ia_download_url("itemA", "sub dir/a.flac") == "https://archive.org/download/itemA/sub%20dir/a.flac"
    assert requests.Request("GET", ia.ia_download_url("itemA", "Track #1.mp3")).prepare().url.endswith("/Track%20%231.mp3")


def test_skipped_row_follows_field_order() -> None:
    c = ia.Candidate(source="ia", item_id="i", url="u", reason="r")
    row = c.skipped_row("2026-01-01T00:00:00+00:00")
    assert list(row) == list(ia.SKIPPED_FIELDS)
    assert row["reason"] == "r" and row["seen_at"] == "2026-01-01T00:00:00+00:00"
    assert ia.Candidate(source="ia", item_id="i", url="u").skipped_row("t")["reason"] == "rejected"


def test_candidate_from_ia_checks_somali_and_mediatype() -> None:
    c = ia.candidate_from_ia(IA_ITEMS["not-somali"], "q")
    assert not c.accepted and c.reason == ia.REASON_NOT_SOMALI and c.url == "https://archive.org/details/not-somali"
    c = ia.candidate_from_ia({**IA_ITEMS["somali-qaraami-cc"], "mediatype": "texts"}, "q")
    assert not c.accepted and c.reason == "mediatype texts"
    c = ia.candidate_from_ia(IA_ITEMS["somali-qaraami-cc"], "q")
    assert c.accepted and c.tier == "internet_cc" and c.licence_text == "CC BY" and c.creator == "Radio Hargeisa"
    assert ia.is_somali({"language": "som"}) and ia.is_somali({"title": "Heeso xul ah"}) and not ia.is_somali({"title": "Jazz"})


def test_pick_ia_files_prefers_lossless_and_folds_derivatives() -> None:
    files = [
        {"name": "t01.mp3", "source": "derivative"}, {"name": "t01.flac", "source": "original"},
        {"name": "t01_64kb.mp3", "source": "derivative"}, {"name": "t01_spectrogram.png", "source": "derivative"},
        {"name": "t02_vbr.mp3", "source": "derivative"}, {"name": "t02.ogg", "source": "original"},
        {"name": "t03.mp3", "source": "original"}, {"name": "t03.m4a", "source": "original"},
        {"name": "readme.txt", "source": "original"}, {"name": "t04.wav", "source": "derivative"}, {"name": "t04.mp3", "source": "original"},
    ]
    # t02: the mp3 derivative outranks the ogg original; t04: a lossless derivative outranks an mp3 original
    assert [f["name"] for f in ia.pick_ia_files(files)] == ["t01.flac", "t02_vbr.mp3", "t03.mp3", "t04.wav"]
    assert ia.pick_ia_files([{"name": "notes.pdf"}, {"name": "cover.jpg"}]) == []


def test_decide_youtube() -> None:
    assert ia.decide_youtube({"license": ia.YT_CC_LICENCE}) == (True, ia.YT_CC_LICENCE, ia.YT_CC_URL, None)
    assert ia.decide_youtube({"license": "Standard YouTube License"})[3] == ia.REASON_YT_STANDARD
    assert ia.decide_youtube({"license": None})[3] == ia.REASON_YT_NO_FIELD
    assert ia.decide_youtube({"title": "x"})[3] == ia.REASON_YT_NO_FIELD
    assert ia.decide_youtube(None, "ERROR: Private video")[3].startswith("unavailable: ERROR: Private video")
    assert ia.decide_youtube({"license": "Some other licence"})[3] == "licence not recognised: Some other licence"


def test_candidate_from_source_row_applies_tier_and_licence_policy() -> None:
    base = {"url": "https://example.org/a/b/song.mp3?x=1", "rights_note": "CC BY 4.0 per site footer", "tier": "internet_cc"}
    # a rights note alone is provenance, not a licence
    note_only = ia.candidate_from_source_row(base)
    assert not note_only.accepted and note_only.reason == ia.REASON_FILE_NO_LICENCE
    ok = ia.candidate_from_source_row({**base, "licence_url": "https://creativecommons.org/licenses/by/4.0/"})
    assert ok.accepted and ok.files == [{"name": "song.mp3", "url": "https://example.org/a/b/song.mp3?x=1", "format": "mp3"}]
    assert ok.licence_text == "CC BY" and ok.licence_url == "https://creativecommons.org/licenses/by/4.0/" and ok.tier == "internet_cc"
    by_text = ia.candidate_from_source_row({**base, "licence_text": "CC BY-SA 3.0 (site footer)"})
    assert by_text.accepted and by_text.licence_text == "CC BY-SA 3.0 (site footer)"
    assert ia.candidate_from_source_row({**base, "licence_text": "Public domain (published 1935)"}).accepted
    nc = ia.candidate_from_source_row({**base, "licence_url": "https://creativecommons.org/licenses/by-nc/4.0/"})
    assert not nc.accepted and nc.reason == ia.REASON_NC_ND
    assert ia.candidate_from_source_row({**base, "licence_text": "CC BY-NC-ND 4.0"}).reason == ia.REASON_NC_ND
    negated = ia.candidate_from_source_row({**base, "licence_text": "Not in the public domain"})
    assert not negated.accepted and negated.reason.startswith(ia.REASON_NO_LICENCE)
    assert ia.candidate_from_source_row({**base, "licence_url": "https://example.org/terms"}).reason == "licence not recognised: https://example.org/terms"
    ro = ia.candidate_from_source_row({"url": "https://example.org/x.mp3", "rights_note": "unknown", "tier": "internet_research_only"})
    assert not ro.accepted and ro.reason == f"{ia.REASON_TIER}: internet_research_only"
    assert ia.candidate_from_source_row({"url": "https://example.org/x.mp3", "tier": "internet_cc"}).reason == "no rights_note"
    # contributor tiers never come in through a sources file: consent is checked by scripts/intake.py
    contrib = ia.candidate_from_source_row({"url": "https://artist.example/song.wav", "rights_note": "artist consent",
                                            "tier": "contrib_faadumo_qaasim_consented",
                                            "licence_url": "https://creativecommons.org/licenses/by/4.0/"})
    assert not contrib.accepted and contrib.reason == f"{ia.REASON_TIER}: contrib_faadumo_qaasim_consented"
    # rows without a url stay distinguishable in skipped.jsonl
    a = ia.candidate_from_source_row({"rights_note": "x", "tier": "internet_cc"}, 0)
    b = ia.candidate_from_source_row({"tier": "internet_cc"}, 1)
    assert a.reason == b.reason == "no url" and (a.item_id, b.item_id) == ("row0", "row1")


def test_load_sources_file_jsonl_and_csv(tmp_path: Path) -> None:
    j = tmp_path / "s.jsonl"
    j.write_text('# comment\n{"url": "https://a/x.mp3", "rights_note": "CC0", "tier": "internet_cc"}\n\n')
    assert ia.load_sources_file(j) == [{"url": "https://a/x.mp3", "rights_note": "CC0", "tier": "internet_cc"}]
    c = tmp_path / "s.csv"
    c.write_text("url,rights_note,tier\nhttps://a/y.mp3,PD,internet_cc\n")
    assert ia.load_sources_file(c) == [{"url": "https://a/y.mp3", "rights_note": "PD", "tier": "internet_cc"}]


def test_title_normalisation_and_harvard_match() -> None:
    assert ia.normalise_title("Side B. Track 3: Carro-edeg [qaraami]") == "carro edeg"
    assert ia.normalise_title("Wisiisi (Longing)") == "wisiisi"
    assert ia.harvard_matches("Sahra Ahmed – Wisiisi | qaraami classic", HARVARD_TITLES) == ["Side A. Track 1: Wisiisi (Longing)"]
    assert ia.harvard_matches("Carro-Edeg live 1975", HARVARD_TITLES) == ["Side A. Track 2: Carro-edeg"]
    assert ia.harvard_matches("Unrelated title", HARVARD_TITLES) == []
    assert ia.harvard_matches("", HARVARD_TITLES) == []


def test_load_harvard_titles_from_csv(tmp_path: Path) -> None:
    csv_path = tmp_path / "meta.csv"
    csv_path.write_text("title,url,date,identifier\nSahro Axmed and others,u,d,i\nSide A. Track 1: Wisiisi (Longing),u,d,i\n"
                        "Side A. Track 2: Ubax,u,d,i\nSide B. Track 1: Untitled,u,d,i\nSide B. Track 2: Wisiisi,u,d,i\n")
    assert ia.load_harvard_titles(csv_path) == [("wisiisi", "Side A. Track 1: Wisiisi (Longing)")]
    assert ia.load_harvard_titles(tmp_path / "missing.csv") == []


def test_near_dup_index_load_and_nearest(tmp_path: Path) -> None:
    emb = tmp_path / "emb"
    emb.mkdir()
    v = np.zeros(768, dtype=np.float32)
    v[5] = 7.0
    np.save(emb / "abc.npy", v)
    np.save(emb / "zero.npy", np.zeros(768, dtype=np.float32))
    classified = tmp_path / "classified.jsonl"
    classified.write_text(json.dumps({"path": "data/ahmed_raw/song.aif", "embedding_path": "data/embeddings_ahmed/abc.npy"}) + "\n")
    idx = ia.NearDupIndex.load(emb, classified)
    assert len(idx) == 1 and idx.labels == ["data/ahmed_raw/song.aif"]
    q = np.zeros(768)
    q[5] = 0.1
    assert idx.nearest(q) == (1.0, "data/ahmed_raw/song.aif")
    assert idx.nearest(np.zeros(768)) is None and idx.nearest(np.ones(10)) is None
    assert ia.NearDupIndex.load(tmp_path / "nowhere").nearest(q) is None


def test_with_retries_backs_off_on_429_then_succeeds() -> None:
    slept: list[float] = []
    lim = ia.RateLimiter(sleep=slept.append, clock=lambda: 0.0)
    attempts = {"n": 0}

    def flaky() -> str:
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise ia.RetryableHTTP(429, retry_after=7.0 if attempts["n"] == 1 else None)
        return "ok"

    assert ia.with_retries(flaky, lim, retries=4) == "ok"
    assert slept == [7.0, 15.0]
    with pytest.raises(ia.RetryableHTTP):
        ia.with_retries(lambda: (_ for _ in ()).throw(ia.RetryableHTTP(503)), lim, retries=1)


# ---------------------------------------------------------------------------
# acquisition end to end (fixtures, no network)
# ---------------------------------------------------------------------------


def test_ia_search_only_decides_and_downloads_nothing(tmp_path: Path, fakes: dict) -> None:
    ctx = _ctx(tmp_path, fakes, search_only=True)
    run = ia.acquire(["ia"], ctx, ["somali AND mediatype:audio", "qaraami"], [], rows=100, yt_n=40, max_items=200,
                     limit=0, sources_file=None)
    assert fakes["searches"] == ["somali AND mediatype:audio", "qaraami"]
    assert fakes["fetched"] == []
    assert sorted(fakes["items"]) == ["somali-noaudio", "somali-pd-wisiisi", "somali-qaraami-cc"]   # get_item only for accepted
    skipped = {r["item_id"]: r for r in _rows(ctx.store.skipped_path)}
    assert skipped["somali-nc"]["reason"] == ia.REASON_NC_ND
    assert skipped["somali-nc"]["licence_text"] == "http://creativecommons.org/licenses/by-nc-nd/3.0/"
    assert skipped["somali-nolicence"]["reason"] == ia.REASON_NO_LICENCE
    assert skipped["not-somali"]["reason"] == ia.REASON_NOT_SOMALI
    assert skipped["somali-noaudio"]["reason"] == ia.REASON_NO_AUDIO
    assert set(skipped["somali-nc"]) == set(ia.SKIPPED_FIELDS)
    cands = {r["item_id"]: r for r in _rows(ctx.store.candidates_path)}
    assert set(cands) == {"somali-qaraami-cc", "somali-pd-wisiisi"}
    assert cands["somali-qaraami-cc"]["pending_reason"] == "search-only run"
    assert [f["name"] for f in cands["somali-qaraami-cc"]["files"]] == ["songA.wav", "songB_dup.wav"]
    assert cands["somali-qaraami-cc"]["files"][0]["url"] == "https://archive.org/download/somali-qaraami-cc/songA.wav"
    assert not ctx.store.manifest_path.exists() or _rows(ctx.store.manifest_path) == []
    assert run["stats"]["accepted_pending"] == 2 and run["stats"]["candidates_ia"] == 6
    assert run["network_waits"] == len(ctx.limiter.calls) == 5                          # 2 searches + 3 get_item
    assert ctx.limiter.slept == [5.0, 5.0, 5.0, 5.0]  # type: ignore[attr-defined]     # every request spaced by 5 s
    assert _rows(ctx.store.runs_path)[-1]["search_only"] is True


def test_ia_download_run_writes_sidecars_manifest_and_dedupes(tmp_path: Path, fakes: dict) -> None:
    # songA of the CC item is byte-identical to a file the corpus already holds
    probe_a = tmp_path / "probe.wav"
    _write_tone(probe_a, _freq_for("https://archive.org/download/somali-qaraami-cc/songA.wav"))
    ctx = _ctx(tmp_path, fakes)
    ctx.known = {ax.sha256_file(probe_a): "harvard:mus00044c00081"}
    run = ia.acquire(["ia"], ctx, ["q1"], [], rows=100, yt_n=40, max_items=200, limit=0, sources_file=None)
    assert sorted(fakes["fetched"]) == sorted([
        "https://archive.org/download/somali-qaraami-cc/songA.wav",
        "https://archive.org/download/somali-qaraami-cc/songB_dup.wav",
        "https://archive.org/download/somali-pd-wisiisi/wisiisi.wav",
    ])
    manifest = {r["item_id"]: r for r in _rows(ctx.store.manifest_path)}
    assert set(manifest) == {"somali-qaraami-cc", "somali-pd-wisiisi"}
    m = manifest["somali-qaraami-cc"]
    assert list(m) == list(ia.MANIFEST_FIELDS)
    assert m["tier"] == "internet_cc" and m["licence_url"] == "https://creativecommons.org/licenses/by/4.0/" and m["licence_text"] == "CC BY"
    assert m["query"] == "q1" and m["creator"] == "Radio Hargeisa" and m["fetched_at"].endswith("+00:00")
    files = {f["name"]: f for f in m["files"]}
    assert set(files["songA.wav"]) == set(ia.FILE_FIELDS)
    assert files["songA.wav"]["excluded"] and files["songA.wav"]["exclude_reason"] == "duplicate_sha256"
    assert files["songA.wav"]["dup_of"] == "harvard:mus00044c00081"
    assert files["songB_dup.wav"]["excluded"] and files["songB_dup.wav"]["exclude_reason"] == "near_duplicate"
    assert files["songB_dup.wav"]["near_duplicate_of"] == "data/ahmed_raw/x/a.aif" and files["songB_dup.wav"]["nearest_ahmed_cos"] == 1.0
    assert m["hours"] == 0.0                                                     # both files excluded
    w = manifest["somali-pd-wisiisi"]
    wf = w["files"][0]
    assert not wf["excluded"] and wf["nearest_ahmed_cos"] == pytest.approx(0.4082, abs=1e-3)
    assert wf["duration_s"] == 4.0 and w["hours"] == round(4.0 / 3600, 4)
    assert w["possible_harvard_duplicate"] == ["Side A. Track 1: Wisiisi (Longing)"]
    assert w["licence_text"].startswith("Public domain") and w["licence_url"] == ""
    # files and sidecars on disk, under data/internet/<source>/<item>/
    wav = Path(ia.REPO / wf["path"]) if not Path(wf["path"]).is_absolute() else Path(wf["path"])
    assert wav.is_file() and wav.parent.name == "somali-pd-wisiisi" and wav.parent.parent.name == "ia"
    side = json.loads((wav.with_name(wav.name + ".json")).read_text())
    assert list(side) == list(ia.SIDECAR_FIELDS)
    assert side["sha256"] == wf["sha256"] and side["tier"] == "internet_cc" and side["url"] == wf["url"]
    assert side["item_url"] == "https://archive.org/details/somali-pd-wisiisi" and side["duration_s"] == 4.0
    # stats and rate limiting
    assert run["stats"]["downloaded_items"] == 2 and run["stats"]["downloaded_files"] == 3
    assert run["stats"]["dedupe_sha256"] == 1 and run["stats"]["dedupe_near"] == 1 and run["stats"]["possible_harvard_duplicate"] == 1
    kinds = [k for k, _ in ctx.limiter.calls]
    assert kinds.count("download") == 3 and kinds.count("request") == 4               # 1 search + 3 get_item
    assert all(s >= 5.0 for s in ctx.limiter.slept)  # type: ignore[attr-defined]
    # a second run finds everything already on disk or decided: nothing fetched, no get_item, nothing re-decided
    fakes["fetched"].clear()
    fakes["items"].clear()
    run2 = ia.acquire(["ia"], ctx, ["q1"], [], rows=100, yt_n=40, max_items=200, limit=0, sources_file=None)
    assert fakes["fetched"] == [] and fakes["items"] == [] and run2["stats"]["already_downloaded"] == 2
    assert run2["stats"]["skipped_cached"] == 4                                   # nc, nolicence, not-somali, noaudio
    assert len(_rows(ctx.store.manifest_path)) == 2 and len(_rows(ctx.store.runs_path)) == 2
    assert run2["request_gap"] == 5.0 and run2["download_gap"] == 10.0


def test_ia_download_quotes_file_names(tmp_path: Path, fakes: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ia, "ia_item", lambda ident, limiter: (IA_ITEMS[ident], [
        {"name": "Track #1.wav", "format": "WAVE", "source": "original", "size": "10", "length": "4"}]))
    ctx = _ctx(tmp_path, fakes)
    assert ia.process(ia.candidate_from_ia(IA_ITEMS["somali-pd-wisiisi"], "q"), ctx) == "downloaded"
    assert fakes["fetched"] == ["https://archive.org/download/somali-pd-wisiisi/Track%20%231.wav"]
    f = ctx.store.manifest[("ia", "somali-pd-wisiisi")]["files"][0]
    # the URL keeps the raw name (encoded); the on-disk name is sanitised by _safe_name
    assert f["name"] == "Track _1.wav" and f["url"].endswith("/Track%20%231.wav") and Path(ia.REPO / f["path"]).is_file()
    assert json.loads(Path(ia.REPO / f["sidecar"]).read_text())["url"] == f["url"]


def test_limit_is_a_cursor_over_reruns(tmp_path: Path, fakes: dict) -> None:
    ctx = _ctx(tmp_path, fakes)
    run1 = ia.acquire(["ia"], ctx, ["q"], [], rows=100, yt_n=40, max_items=200, limit=2, sources_file=None)
    assert run1["stats"]["candidates_ia"] == 2                                     # somali-qaraami-cc, somali-nc
    ctx.stats.clear()
    run2 = ia.acquire(["ia"], ctx, ["q"], [], rows=100, yt_n=40, max_items=200, limit=2, sources_file=None)
    assert run2["stats"]["candidates_ia"] == 2                                     # the next two, not the same two
    assert run2["stats"]["already_downloaded"] == 1 and run2["stats"]["skipped_cached"] == 1
    skipped = {r["item_id"] for r in _rows(ctx.store.skipped_path)}
    assert skipped == {"somali-nc", "somali-nolicence", "not-somali"}
    ctx.stats.clear()
    run3 = ia.acquire(["ia"], ctx, ["q"], [], rows=100, yt_n=40, max_items=200, limit=2, sources_file=None)
    assert run3["stats"]["candidates_ia"] == 2 and run3["stats"]["skipped_cached"] == 3
    assert {m["item_id"] for m in _rows(ctx.store.manifest_path)} == {"somali-qaraami-cc", "somali-pd-wisiisi"}
    ctx.stats.clear()
    run4 = ia.acquire(["ia"], ctx, ["q"], [], rows=100, yt_n=40, max_items=200, limit=2, sources_file=None)
    assert run4["stats"].get("candidates_ia", 0) == 0                              # every result is cached now
    assert run4["stats"]["already_downloaded"] == 2 and run4["stats"]["skipped_cached"] == 4


def test_limit_and_max_hours_caps(tmp_path: Path, fakes: dict) -> None:
    ctx = _ctx(tmp_path, fakes, max_hours=0.01)                                    # 36 s cap
    run = ia.acquire(["ia"], ctx, ["q"], [], rows=100, yt_n=40, max_items=200, limit=2, sources_file=None)
    assert run["stats"]["candidates_ia"] == 2                                       # --limit 2 candidates
    cands = _rows(ctx.store.candidates_path)
    assert len(cands) == 1 and cands[0]["item_id"] == "somali-qaraami-cc"
    assert cands[0]["pending_reason"].startswith("max-hours cap")
    assert fakes["fetched"] == []


def test_youtube_decisions_and_download(tmp_path: Path, fakes: dict) -> None:
    ctx = _ctx(tmp_path, fakes)
    run = ia.acquire(["yt"], ctx, [], ["qaraami"], rows=100, yt_n=40, max_items=200, limit=0, sources_file=None)
    search_calls = [c for c in FakeYDL.calls if c[0].startswith("https://www.youtube.com/results?")]
    assert search_calls[0][0] == "https://www.youtube.com/results?search_query=qaraami&sp=EgIwAQ%253D%253D"
    assert search_calls[0][2]["extract_flat"] == "in_playlist" and search_calls[0][2]["playlistend"] == 40
    skipped = {r["item_id"]: r for r in _rows(ctx.store.skipped_path)}
    assert skipped["stdvid0001"]["reason"] == ia.REASON_YT_STANDARD and skipped["stdvid0001"]["licence_text"] == "Standard YouTube License"
    assert skipped["nolic00001"]["reason"] == ia.REASON_YT_NO_FIELD
    assert skipped["gone000001"]["reason"].startswith("unavailable: ERROR: Video unavailable")
    manifest = _rows(ctx.store.manifest_path)
    assert [m["item_id"] for m in manifest] == ["ccvid00001"]
    m = manifest[0]
    assert m["licence_text"] == ia.YT_CC_LICENCE and m["licence_url"] == ia.YT_CC_URL and m["tier"] == "internet_cc"
    assert m["creator"] == "Somali Archive Channel" and m["url"] == "https://www.youtube.com/watch?v=ccvid00001"
    f = m["files"][0]
    assert f["path"].endswith("yt/ccvid00001/ccvid00001.wav") and not f["excluded"]
    dl = [c for c in FakeYDL.calls if c[1]]
    assert len(dl) == 1 and dl[0][2]["format"].startswith("bestaudio[ext=m4a]") and dl[0][2]["noplaylist"] is True
    assert run["stats"]["downloaded_items"] == 1
    kinds = [k for k, _ in ctx.limiter.calls]
    assert sorted(kinds) == ["download"] + ["request"] * 5                        # search + 4 infos + 1 download
    assert kinds[:3] == ["request", "request", "download"]                        # the CC video is fetched as soon as it is decided
    # resumable: neither the downloaded video nor the decided ones cost an info request on the next run;
    # only the "unavailable" one is retried (transient)
    FakeYDL.calls = []
    ctx.stats.clear()
    run2 = ia.acquire(["yt"], ctx, [], ["qaraami"], rows=100, yt_n=40, max_items=200, limit=0, sources_file=None)
    infos = [c[0].rsplit("v=", 1)[1] for c in FakeYDL.calls if "watch?v=" in c[0]]
    assert infos == ["gone000001"]
    assert run2["stats"]["already_downloaded"] == 1 and run2["stats"]["skipped_cached"] == 2
    assert run2["stats"]["candidates_yt"] == 1
    # a manifest row whose file vanished is fetched again
    Path(ia.REPO / f["path"]).unlink()
    FakeYDL.calls = []
    ctx.stats.clear()
    ia.acquire(["yt"], ctx, [], ["qaraami"], rows=100, yt_n=40, max_items=200, limit=0, sources_file=None)
    assert [c[0].rsplit("v=", 1)[1] for c in FakeYDL.calls if c[1]] == ["ccvid00001"]


def test_youtube_search_target_and_runtime_opts(monkeypatch: pytest.MonkeyPatch) -> None:
    assert ia.yt_search_target("somali oud", 40) == "https://www.youtube.com/results?search_query=somali+oud&sp=EgIwAQ%253D%253D"
    assert ia.yt_search_target("somali oud", 40, cc_filter=False) == "ytsearch40:somali oud"
    monkeypatch.setattr(ia.shutil, "which", lambda name: "/usr/bin/node" if name == "node" else None)
    opts = ia.ydl_opts(skip_download=True)
    assert opts["js_runtimes"] == {"deno": {}, "node": {"path": "/usr/bin/node"}} and opts["noplaylist"] is True and opts["skip_download"] is True
    monkeypatch.setattr(ia.shutil, "which", lambda name: None)
    assert "js_runtimes" not in ia.ydl_opts()


def test_youtube_plain_search_mode(tmp_path: Path, fakes: dict) -> None:
    ctx = _ctx(tmp_path, fakes)
    ia.acquire(["yt"], ctx, [], ["kaban"], rows=100, yt_n=7, max_items=200, limit=1, sources_file=None, yt_cc_filter=False)
    assert FakeYDL.calls[0][0] == "ytsearch7:kaban" and FakeYDL.calls[0][2]["playlistend"] == 7
    assert _rows(ctx.store.runs_path)[-1]["yt_cc_filter"] is False


def test_sources_file_flow(tmp_path: Path, fakes: dict) -> None:
    src = tmp_path / "urls.jsonl"
    src.write_text(json.dumps({"url": "https://archive.example.org/audio/qaraami_1965.wav", "rights_note": "CC BY 4.0 (site footer)",
                               "tier": "internet_cc", "title": "Qaraami 1965", "creator": "Archive X",
                               "licence_url": "https://creativecommons.org/licenses/by/4.0/"}) + "\n"
                   + json.dumps({"url": "https://other.example.org/b.mp3", "rights_note": "unknown", "tier": "internet_research_only"}) + "\n")
    ctx = _ctx(tmp_path, fakes)
    ia.acquire(["file"], ctx, [], [], rows=100, yt_n=40, max_items=200, limit=0, sources_file=src)
    assert fakes["fetched"] == ["https://archive.example.org/audio/qaraami_1965.wav"]
    manifest = _rows(ctx.store.manifest_path)
    assert len(manifest) == 1 and manifest[0]["rights_note"] == "CC BY 4.0 (site footer)" and manifest[0]["title"] == "Qaraami 1965"
    assert manifest[0]["files"][0]["name"] == "qaraami_1965.wav" and manifest[0]["files"][0]["path"].split("/")[-3] == "file"
    assert manifest[0]["licence_text"] == "CC BY" and manifest[0]["tier"] == "internet_cc"
    skipped = _rows(ctx.store.skipped_path)
    assert len(skipped) == 1 and skipped[0]["reason"] == f"{ia.REASON_TIER}: internet_research_only"
    # without --sources-file the source is skipped, not an error (fresh context: stats are per context)
    run = ia.acquire(["file"], _ctx(tmp_path, fakes), [], [], rows=100, yt_n=40, max_items=200, limit=0, sources_file=None)
    assert run["stats"].get("candidates_file", 0) == 0 and len(fakes["fetched"]) == 1


# ---------------------------------------------------------------------------
# inventory and report
# ---------------------------------------------------------------------------


def _fake_ffmpeg(monkeypatch: pytest.MonkeyPatch) -> None:
    def meta(path: Path) -> dict:
        info = sf.info(str(path))
        return {"duration_s": round(info.duration, 3), "sample_rate": info.samplerate, "channels": info.channels, "codec": "pcm_s16le"}

    def decode(path: Path) -> np.ndarray:
        audio, _ = sf.read(str(path), dtype="float32")
        return audio if audio.ndim == 1 else audio.mean(axis=1)

    monkeypatch.setattr(ax, "ffprobe_meta", meta)
    monkeypatch.setattr(ax, "decode_mono16", decode)


def test_build_inventory_schema(tmp_path: Path, fakes: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_ffmpeg(monkeypatch)
    ctx = _ctx(tmp_path, fakes)
    ia.acquire(["ia", "yt"], ctx, ["q"], ["qaraami"], rows=100, yt_n=40, max_items=200, limit=0, sources_file=None)
    out = tmp_path / "inventory" / "internet_files.jsonl"
    rows = ia.build_inventory(ctx.store, out)
    assert len(rows) == 4 and _rows(out) == rows
    by_name = {r["name"]: r for r in rows}
    for key in ("path", "source_group", "project", "project_kind", "location", "name", "ext", "take_number", "position",
                "mtime_iso", "bytes", "sha256", "duration_s", "sample_rate", "channels", "codec", "silence_fraction",
                "probe_error", "is_silent", "role_guess", "also_in", "dup_of", "dup_of_path", "excluded", "exclude_reason",
                *ia.INVENTORY_EXTRA):
        assert key in rows[0], key
    assert by_name["wisiisi.wav"]["source_group"] == "internet_ia" and by_name["ccvid00001.wav"]["source_group"] == "internet_yt"
    assert {r["role_guess"] for r in rows} == {"song"} and {r["rights"] for r in rows} == {"internet_cc"}
    assert {r["project_kind"] for r in rows} == {"internet"}
    assert by_name["wisiisi.wav"]["project"] == "somali-pd-wisiisi" and by_name["wisiisi.wav"]["possible_harvard_duplicate"] == ["Side A. Track 1: Wisiisi (Longing)"]
    assert by_name["wisiisi.wav"]["excluded"] is False and by_name["wisiisi.wav"]["url"].endswith("/wisiisi.wav")
    assert by_name["songB_dup.wav"]["excluded"] and by_name["songB_dup.wav"]["exclude_reason"] == "near_duplicate"
    assert by_name["songB_dup.wav"]["near_duplicate_of"] == "data/ahmed_raw/x/a.aif"
    assert by_name["ccvid00001.wav"]["licence_url"] == ia.YT_CC_URL and by_name["ccvid00001.wav"]["item_id"] == "ccvid00001"
    assert by_name["ccvid00001.wav"]["date"] == "20200101" and by_name["wisiisi.wav"]["date"] == "1958"   # build_sets.row_year reads it
    assert by_name["songA.wav"]["excluded"] is False                       # not a corpus duplicate in this run (known = {})
    # resumable: a second build reuses the measurements (same sha, same rows)
    assert ia.build_inventory(ctx.store, out) == rows


def test_build_inventory_fails_closed_on_blank_or_unknown_tier(tmp_path: Path, fakes: dict, monkeypatch: pytest.MonkeyPatch,
                                                              capsys: pytest.CaptureFixture[str]) -> None:
    _fake_ffmpeg(monkeypatch)
    ctx = _ctx(tmp_path, fakes)
    ia.acquire(["ia", "yt"], ctx, ["q"], ["qaraami"], rows=100, yt_n=40, max_items=200, limit=0, sources_file=None)
    # the documented hand edit: downgrade one item; two malformed edits: blank tier, misspelled tier
    ctx.store.manifest[("ia", "somali-pd-wisiisi")]["tier"] = ia.TIER_RESEARCH
    ctx.store.manifest[("yt", "ccvid00001")]["tier"] = ""
    ctx.store.manifest[("ia", "somali-qaraami-cc")]["tier"] = "internet_c"
    ctx.store.save()
    rows = ia.build_inventory(ia.Store(ctx.store.out_dir), tmp_path / "inv.jsonl")
    by_name = {r["name"]: r for r in rows}
    assert by_name["wisiisi.wav"]["rights"] == ia.TIER_RESEARCH and by_name["wisiisi.wav"]["excluded"] is False
    assert by_name["ccvid00001.wav"]["rights"] == ia.TIER_RESEARCH and by_name["ccvid00001.wav"]["tier"] == ""
    assert by_name["ccvid00001.wav"]["excluded"] and by_name["ccvid00001.wav"]["exclude_reason"] == ia.REASON_TIER_INVALID
    assert by_name["songA.wav"]["rights"] == ia.TIER_RESEARCH and by_name["songA.wav"]["exclude_reason"] == ia.REASON_TIER_INVALID
    assert by_name["songB_dup.wav"]["exclude_reason"] == "near_duplicate"        # an earlier exclusion keeps its reason
    assert {r["rights"] for r in rows} == {ia.TIER_RESEARCH}                      # nothing publishable slipped through
    printed = capsys.readouterr().out
    assert "yt/ccvid00001 tier=''" in printed and "ia/somali-qaraami-cc tier='internet_c'" in printed


def test_render_report(tmp_path: Path, fakes: dict) -> None:
    ctx = _ctx(tmp_path, fakes)
    ia.acquire(["ia", "yt"], ctx, ["q"], ["qaraami"], rows=100, yt_n=40, max_items=200, limit=0, sources_file=None)
    text = ia.render_report(ctx.store, ia.IA_QUERIES, ia.YT_QUERIES, ia._jsonl(ctx.store.runs_path), inventory_rows=4)
    assert text.startswith("# Internet sources")
    assert "## Policy" in text and "Only material whose licence is explicit" in text
    assert "## Internet Archive" in text and "## YouTube" in text and "## Hand-added URLs" in text
    assert "`somali AND mediatype:audio`" in text and "`Maxamed Suleebaan`" in text
    assert "| `somali-qaraami-cc` |" in text and "[CC BY](https://creativecommons.org/licenses/by/4.0/)" in text
    assert "| CC-NC/ND (training use unclear) | 1 |" in text and "| no licence metadata | 1 |" in text
    assert "| not Somali by metadata | 1 |" in text and "| Standard YouTube Licence | 1 |" in text and "| unavailable | 1 |" in text
    assert "possible Harvard duplicate: Side A. Track 1: Wisiisi (Longing)" in text
    assert "near-duplicate: `ia/somali-qaraami-cc/songB_dup.wav` ~ data/ahmed_raw/x/a.aif (cos 1.0)" in text
    assert "Near-duplicates of Ahmed's corpus (MERT last-layer cosine >= 0.97, excluded): 1" in text
    assert "`data/inventory/internet_files.jsonl` holds 4 rows" in text
    assert "## Runs" in text and "| ia yt | False |" in text and "| 5.0/10.0 |" in text
    assert "Creative Commons Attribution license (reuse allowed)" in text
    assert "Requests are spaced by at least 5 s and downloads by at least 10 s" in text
    # the policy numbers follow the latest run row, not hand-typed text
    runs = ia._jsonl(ctx.store.runs_path) + [{"ts": "t", "sources": ["ia"], "request_gap": 2.5, "download_gap": 30, "stats": {}}]
    assert "spaced by at least 2.5 s and downloads by at least 30 s (the latest run row's" in ia.render_report(ctx.store, [], [], runs)
    assert "2026-09-26" not in ia.POLICY_TEMPLATE
    empty = ia.render_report(ia.Store(tmp_path / "empty"), [], [], [])
    assert "No runs logged." in empty and "None." in empty and "at least 5 s" in empty


def test_parser_requires_a_source_value() -> None:
    with pytest.raises(SystemExit):
        ia.build_parser().parse_args(["--sources"])
    with pytest.raises(SystemExit):
        ia.build_parser().parse_args(["--sources", "soundcloud"])
    args = ia.build_parser().parse_args(["--sources", "ia", "yt", "--limit", "3"])
    assert args.sources == ["ia", "yt"] and args.limit == 3 and args.request_gap == 5.0
    assert ia.build_parser().parse_args(["--inventory"]).sources is None
