"""Unit tests for the network-free logic of scripts/harvard_fetch.py and for
scripts/harvard_gap_report.py.

Everything runs on fixtures under tmp_path: a finding-aid CSV export in the real
shape (collection lines, then the "Database Number" header), a legacy directory
with the 2025 track_NNNN names, a saved SDS player page as a string, and a small
fetcher manifest. No corpus, no ffmpeg, no network (requests.Session.get is
poisoned for the whole module).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts import harvard_fetch as hf
from scripts import harvard_gap_report as gr

URN = "https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:"
HEADER = ("Database Number,Component Title,Component Date,Start Year,End Year,Component Identifier,"
          "Container Info,Component Type,Component Creator,Digital Content Link,Access Note,"
          "Physical Description,Level 1,Level 2,Level 3,Level 4,Level 5")
SAHRO = "Sahro Axmed (Sahra Ahmed) and others"
PLAY = "Songs of the Play: Ninkeeda ku amaahday"


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom(*_a: object, **_k: object) -> None:
        raise AssertionError("network call attempted in a unit test")

    monkeypatch.setattr(hf.requests.Session, "get", _boom)


def _row(cid: str, title: str, ctype: str, link: str = "", container: str = "", level2: str = "") -> str:
    cells = [cid, title, "1955-1991", "1955", "1991", "AWM Spec Coll 103", container, ctype, "", link, "", "",
             "Audiocassettes", level2, "", "", ""]
    return ",".join(f'"{c}"' if ("," in c or '"' in c) else c for c in cells)


def write_catalog(tmp_path: Path) -> Path:
    """A finding-aid export with two cassettes that have linked tracks, one cassette
    without linked tracks, one cassette without a link, tracks with and without
    links, and one track whose link repeats another component's (different host case)."""
    lines = [
        'Collection Title,"Somali Songs, 1955-1991: The Maryan ""Aryette"" Omar Ali Collection, 1955-1991"',
        "Call Number,AWM Spec Coll 103",
        "EAD ID,mus00044",
        HEADER,
        _row("mus00044c00001", "Audiocassettes", "Series"),
        _row("mus00044c00002", SAHRO, "Item", URN + "33901476", "Box 1, Audiocassette AWM SC 12200"),
        _row("mus00044c00081", "Side A. Track 1: Wisiisi (Longing)", "Track", URN + "33901491", level2=SAHRO),
        _row("mus00044c00082", "Side A. Track 2: Carro-edeg", "Track", URN + "33901479", level2=SAHRO),
        _row("mus00044c01307", "Side A. Track 4: Subcis [subgenre of qaraami songs]", "Track", level2=SAHRO),
        _row("mus00044c00003", PLAY, "Item", URN + "33897950", "Box 1, Audiocassette AWM SC 12201"),
        _row("mus00044c00092", "Side B. Track 1: Ayaamaha toddobada ah", "Track", URN + "33897963", level2=PLAY),
        _row("mus00044c00093", "Side B. Track 2: Same object again", "Track",
             "https://nrs.harvard.edu/urn-3:FHCL.LOEB:33897963", level2=PLAY),
        _row("mus00044c00004", "Lone cassette", "Item", URN + "33900000", "Box 2, Audiocassette AWM SC 12202"),
        _row("mus00044c00095", "Side A. Track 1: Orphan without link", "Track", level2="Lone cassette"),
        _row("mus00044c00005", "No link cassette", "Item", "", "Box 2, Audiocassette AWM SC 12203"),
        "mus00044c00099,short row",  # fewer cells than the header: dropped
    ]
    p = tmp_path / "mus00044.csv"
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return p


def write_legacy(tmp_path: Path) -> tuple[Path, Path]:
    meta = tmp_path / "harvard_tracks_metadata.csv"
    meta.write_text("title,url,date,identifier\n"
                    f"{SAHRO},{URN}33901476,1955-1991,AWM Spec Coll 103\n"
                    f"Side A. Track 1: Wisiisi (Longing),{URN}33901491,1955-1991,AWM Spec Coll 103\n"
                    "Row without url,,1955-1991,AWM Spec Coll 103\n", encoding="utf-8")
    legacy = tmp_path / "legacy"
    legacy.mkdir()
    for name in ("track_0001_Sahro_Axmed_Sahra_Ahmed_and_others.mp3", "track_0002_Side_A_Track_1_Wisiisi_Longing.mp3",
                 "track_0003_Row_without_url.mp3", "track_0009_beyond_the_csv.mp3", "stray.mp3", "notes.txt"):
        (legacy / name).write_bytes(b"\0")
    return meta, legacy


# ---------------------------------------------------------------------------
# harvard_fetch: catalog, legacy index, plan
# ---------------------------------------------------------------------------


def test_load_catalog_keeps_linked_items_and_tracks_with_cassette_numbers(tmp_path: Path) -> None:
    objs = hf.load_catalog(write_catalog(tmp_path))
    by_cid = {o.cid: o for o in objs}
    assert list(by_cid) == ["mus00044c00002", "mus00044c00081", "mus00044c00082", "mus00044c00003",
                            "mus00044c00092", "mus00044c00093", "mus00044c00004"]
    cass = by_cid["mus00044c00002"]
    assert cass.ctype == "Item" and cass.cassette == "12200" and cass.children_linked == 2 and cass.parent == ""
    t = by_cid["mus00044c00081"]
    assert (t.ctype, t.parent, t.cassette, t.side, t.track, t.song) == (
        "Track", SAHRO, "12200", "A", "1", "Wisiisi (Longing)")
    assert by_cid["mus00044c00093"].cassette == "12201"  # cassette number comes from the parent Item's container
    assert by_cid["mus00044c00004"].children_linked == 0  # its only track has no link
    assert by_cid["mus00044c00002"].urn == "fhcl.loeb:33901476"


def test_legacy_index_maps_urns_from_csv_row_numbers(tmp_path: Path) -> None:
    meta, legacy = write_legacy(tmp_path)
    idx = hf.legacy_index(meta, legacy)
    assert set(idx) == {"fhcl.loeb:33901476", "fhcl.loeb:33901491"}
    assert idx["fhcl.loeb:33901491"].name == "track_0002_Side_A_Track_1_Wisiisi_Longing.mp3"
    assert hf.legacy_index(tmp_path / "nope.csv", legacy) == {}
    assert hf.legacy_index(meta, tmp_path / "nowhere") == {}


def test_plan_groups_legacy_fetch_superseded_and_duplicates(tmp_path: Path) -> None:
    objs = hf.load_catalog(write_catalog(tmp_path))
    meta, legacy = write_legacy(tmp_path)
    groups = hf.plan(objs, hf.legacy_index(meta, legacy))
    cids = {k: [o.cid for o in v] for k, v in groups.items()}
    assert cids["legacy"] == ["mus00044c00002", "mus00044c00081"]
    assert cids["cassette_superseded_by_tracks"] == ["mus00044c00003"]
    assert cids["duplicate_link"] == ["mus00044c00093"]  # same URN as c00092, other host and upper case
    assert cids["fetch"] == ["mus00044c00082", "mus00044c00092", "mus00044c00004"]  # c00004: cassette without linked tracks


# ---------------------------------------------------------------------------
# harvard_fetch: page parsing, helpers
# ---------------------------------------------------------------------------

SDS_PAGE = """<html><head>
<title>Streaming Delivery Service: Songs of the Play: Ninkeeda ku amaahday</title>
<script>var listdata = 'Identifier: AWM_SC_12201<br/> Duration: 04:01.925';</script>
</head><body>
<div id="player"><script>
jwplayer("player").setup({ playlist: [
  { file: "https://mps.lib.harvard.edu/vod/_definst_/smil:s3/drs-delivery-prod/434915658.smil_ABC/playlist.m3u8", },
] });
</script></div>
<ul class='itemsList'><li class='item'>1. Ayaamaha toddobada ah <span class='ccs'>Performer: Khadra Daahir
(Khadra Dahir); Author: Maxamuud Cabdullaahi Sangub</span> </li></ul>
<div id="iteminfo"><h2>Now playing...</h2></div>
<div id="metadata-panel">
 <p><span style="font-weight: bold;">Local identifier:</span> AWM_SC_12201</p>
 <p><span style="font-weight: bold;">Duration:</span> 04:01</p>
</div>
<div id="footerp">Streaming Delivery Service<br>&copy; 2017 President and Fellows of Harvard College</div>
</body></html>"""


def test_parse_page_reads_playlist_performer_identifier_and_duration() -> None:
    page = hf.parse_page(SDS_PAGE)
    assert page["playlists"] == [
        "https://mps.lib.harvard.edu/vod/_definst_/smil:s3/drs-delivery-prod/434915658.smil_ABC/playlist.m3u8"]
    assert page["page_title"] == "Streaming Delivery Service: Songs of the Play: Ninkeeda ku amaahday"
    assert page["performer_line"] == "Performer: Khadra Daahir (Khadra Dahir); Author: Maxamuud Cabdullaahi Sangub"
    assert page["local_identifier"] == "AWM_SC_12201"
    assert page["page_duration"] == "04:01"  # the one in the <script> block is ignored


def test_parse_page_without_playlist_reports_nothing_to_download() -> None:
    page = hf.parse_page("<html><head><title>HarvardKey Login</title></head><body>Please log in</body></html>")
    assert page["playlists"] == [] and page["page_title"] == "HarvardKey Login"
    assert page["performer_line"] == "" and page["local_identifier"] == "" and page["page_duration"] == ""


def test_norm_urn_is_case_and_host_insensitive() -> None:
    assert hf.norm_urn("https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33897963") == "fhcl.loeb:33897963"
    assert hf.norm_urn("https://nrs.harvard.edu/urn-3:FHCL.LOEB:33897963") == "fhcl.loeb:33897963"
    assert hf.norm_urn("  Not-A-URN  ") == "not-a-urn"


def test_safe_makes_filename_stems() -> None:
    assert hf.safe("Side A. Track 1: Wisiisi (Longing)") == "Side_A_Track_1_Wisiisi_Longing"
    assert hf.safe("Rifdoor (R&ecirc;ve d'Or)") == "Rifdoor_Rêve_dOr"
    assert hf.safe("!!! ???") == "untitled"
    assert len(hf.safe("word " * 40)) <= 60


def test_out_name_for_track_and_cassette_objects() -> None:
    track = hf.Obj("mus00044c00081", "Side A. Track 1: Wisiisi (Longing)", "Track", URN + "33901491", SAHRO,
                   "12200", "A", "1", "Wisiisi (Longing)")
    assert track.out_name() == "AWM_SC_12200_A1_Wisiisi_Longing__mus00044c00081.mp3"
    cass = hf.Obj("mus00044c00002", SAHRO, "Item", URN + "33901476", "", "12200")
    assert cass.out_name() == "AWM_SC_12200_cassette_Sahro_Axmed_Sahra_Ahmed_and_others__mus00044c00002.mp3"
    unknown = hf.Obj("mus00044c00500", "Side B. Track 2: X", "Track", URN + "1", "", "", "B", "2", "X")
    assert unknown.out_name() == "AWM_SC_x_B2_X__mus00044c00500.mp3"


def test_resolve_uses_the_session_it_is_given_and_reads_retry_after() -> None:
    class Resp:
        url = "https://mps.lib.harvard.edu/sds/audio/1"
        status_code = 200
        text = "<html></html>"
        headers: dict[str, str] = {"Retry-After": "7"}

    class Session:
        def get(self, link: str, allow_redirects: bool, timeout: int) -> Resp:
            assert link.startswith(URN) and allow_redirects and timeout == 30
            return Resp()

    assert hf.resolve(Session(), URN + "1") == (Resp.url, 200, "<html></html>", 7.0)  # type: ignore[arg-type]
    Resp.headers = {"Retry-After": "soon"}
    assert hf.resolve(Session(), URN + "1")[3] == 0.0  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# harvard_gap_report
# ---------------------------------------------------------------------------

NO_LEGACY = "no_legacy"  # a folder under tmp_path that never exists: keeps every build off the real corpus


def _manifest_rows() -> list[dict[str, object]]:
    return [
        {"cid": "mus00044c00002", "status": "legacy", "type": "Item", "title": SAHRO, "cassette": "12200",
         "link": URN + "33901476", "file": "data/harvard_raw/legacy/track_0001_x.mp3", "duration_s": 1800.0},
        {"cid": "mus00044c00081", "status": "legacy", "type": "Track", "title": "Side A. Track 1: Wisiisi (Longing)",
         "cassette": "12200", "link": URN + "33901491", "file": "data/harvard_raw/legacy/track_0002_x.mp3",
         "duration_s": 600.0},
        {"cid": "mus00044c00082", "status": "skipped", "type": "Track", "title": "Side A. Track 2: Carro-edeg",
         "cassette": "12200", "link": URN + "33901479", "reason": "HTTP 429 at https://mps.lib.harvard.edu/sds/audio/1"},
        {"cid": "mus00044c00082", "status": "fetched", "type": "Track", "title": "Side A. Track 2: Carro-edeg",
         "cassette": "12200", "link": URN + "33901479", "file": "data/harvard_raw/AWM_SC_12200_A2.mp3",
         "duration_s": 300.0},
        {"cid": "mus00044c00003", "status": "skipped", "type": "Item", "title": PLAY, "cassette": "12201",
         "link": URN + "33897950", "reason": "cassette-level object; 2 linked track objects fetched instead"},
        {"cid": "mus00044c00093", "status": "skipped", "type": "Track", "title": "Side B. Track 2: Same | object",
         "cassette": "12201", "link": "https://nrs.harvard.edu/urn-3:FHCL.LOEB:33897963",
         "reason": "same digital object as another component (duplicate link)"},
        {"cid": "mus00044c00092", "status": "skipped", "type": "Track", "title": "Side B. Track 1: Ayaamaha toddobada ah",
         "cassette": "12201", "link": URN + "33897963", "reason": "HTTP 429 at https://mps.lib.harvard.edu/sds/audio/2"},
    ]


def _write_manifest(tmp_path: Path, rows: list[dict[str, object]]) -> Path:
    p = tmp_path / "manifest.jsonl"
    p.write_text("".join(json.dumps(r) + "\n" for r in rows) + "\n", encoding="utf-8")
    return p


def _build(tmp_path: Path, manifest: Path, catalog: Path, **kw: str) -> tuple[str, dict[str, object]]:
    """gr.build() with the legacy inputs pointed at paths that do not exist (never the repo's)."""
    return gr.build(manifest, catalog, legacy_dir=tmp_path / NO_LEGACY, legacy_meta=tmp_path / "no_meta.csv", **kw)


def test_reason_class_covers_every_fetcher_reason() -> None:
    assert gr.reason_class("cassette-level object; 8 linked track objects fetched instead") == "cassette_superseded_by_tracks"
    assert gr.reason_class("same digital object as another component (duplicate link)") == "duplicate_link"
    assert gr.reason_class("HTTP 429 at https://mps.lib.harvard.edu/sds/audio/1") == "http_429"
    assert gr.reason_class("HTTP 429 at https://x (rate limit persisted through the back-off schedule)") == "http_429"
    assert gr.reason_class("HTTP 404 at https://x") == "http_other"
    assert gr.reason_class("requires a Harvard login (HarvardKey); not public") == "requires_login"
    assert gr.reason_class("no public stream on the SDS page (no playlist)") == "no_playlist"
    assert gr.reason_class("stream download failed: empty stream") == "download_failed"
    assert gr.reason_class("network error: ConnectionError") == "network_error"
    assert gr.reason_class("something new") == "other"
    assert {k for k, _ in gr.REASON_CLASSES} >= {"http_429", "other", "duplicate_link"}
    assert {k for _, k in gr.FIXED_PREFIXES} <= {k for k, _ in gr.REASON_CLASSES}


def test_reason_class_prefers_the_fetcher_prefix_over_free_text_inside_it() -> None:
    # a download reason carries an ffmpeg stderr tail and the SDS bounce URL, which mention login / playlist
    assert gr.reason_class("stream download failed: HTTP error 401 Unauthorized, login required") == "download_failed"
    assert gr.reason_class("stream download failed: Server returned 403 Forbidden (no playlist)") == "download_failed"
    assert gr.reason_class("stream download failed: https://mps.lib.harvard.edu/sds/login/public?x ... 403 Forbidden") == "download_failed"
    assert gr.reason_class("network error: ConnectionError (login.harvard.edu)") == "network_error"
    assert gr.reason_class("HTTP 503 at https://mps.lib.harvard.edu/sds/login/public") == "http_other"
    # hand-written reasons still match on free text
    assert gr.reason_class("the page asked for HarvardKey") == "requires_login"
    assert gr.reason_class("player had no playlist") == "no_playlist"


def test_md_flattens_line_breaks_and_escapes_pipes() -> None:
    assert gr.md("Sahro ‘Axmed’ #1\r\nline2 | x\\y") == "Sahro ‘Axmed’ #1 line2 \\| x\\y"
    assert gr.md("a\rb\nc\r\n\r\nd") == "a b c d"
    assert gr.md("  tab\there  ") == "tab\there"
    t = gr.table(["a", "b"], [["x\ry", "z"]])  # an ffmpeg stderr tail with a bare CR stays on one physical line
    assert t.count("\n") == 2 and "| x y | z |" in t


def test_parse_duration_accepts_numbers_and_numeric_strings_only() -> None:
    assert gr.parse_duration(None) == 0.0 and gr.parse_duration("") == 0.0
    assert gr.parse_duration(12) == 12.0 and gr.parse_duration(300.5) == 300.5 and gr.parse_duration("300.5") == 300.5
    assert gr.parse_duration("1h") is None and gr.parse_duration(True) is None and gr.parse_duration([1]) is None


def test_load_manifest_keeps_last_row_per_cid_in_first_seen_order(tmp_path: Path) -> None:
    load = gr.load_manifest(_write_manifest(tmp_path, _manifest_rows()))
    assert load.raw_rows == 7 and [r.cid for r in load.rows] == ["mus00044c00002", "mus00044c00081", "mus00044c00082",
                                                                  "mus00044c00003", "mus00044c00093", "mus00044c00092"]
    r82 = next(r for r in load.rows if r.cid == "mus00044c00082")
    assert r82.status == "fetched" and r82.duration_s == 300.0 and r82.reason == "" and r82.duration_ok
    assert next(r for r in load.rows if r.cid == "mus00044c00003").duration_s == 0.0
    assert load.malformed_lines == [] and load.rows_without_cid == 0 and load.bad_durations == 0


def test_load_manifest_tolerates_half_written_lines_and_odd_rows(tmp_path: Path) -> None:
    p = tmp_path / "manifest.jsonl"
    p.write_text(
        json.dumps({"cid": "a", "status": "fetched", "type": "Track", "title": "t", "cassette": "1",
                    "link": URN + "1", "duration_s": "300.5"}) + "\n"
        + "{not json\n"
        + json.dumps(["a", "list"]) + "\n"
        + json.dumps({"status": "fetched", "duration_s": 300.5}) + "\n"  # no cid
        + "\n"
        + json.dumps({"cid": "c", "status": "legacy", "type": "Item", "title": "t", "cassette": "2",
                      "link": URN + "2", "duration_s": "1h"}) + "\n"
        + json.dumps({"cid": "d", "status": "skipped", "type": "Track", "title": "t", "cassette": "2",
                      "link": URN + "3", "reason": "HTTP 429 at x"}) + "\n"
        + '{"cid":"b","status":"fetch',  # the line the fetcher is still writing
        encoding="utf-8")
    load = gr.load_manifest(p)
    assert load.raw_rows == 7 and load.malformed_lines == [2, 3, 8] and load.rows_without_cid == 1
    assert [r.cid for r in load.rows] == ["a", "c", "d"]
    a, c, d = load.rows
    assert a.duration_s == 300.5 and a.duration_ok  # a numeric string counts
    assert c.duration_s == 0.0 and not c.duration_ok  # "1h" does not, and is flagged
    assert d.duration_s == 0.0 and d.duration_ok  # a skipped row carries no duration: fine
    assert load.bad_durations == 1


def test_read_catalog_rows_rejects_a_file_without_the_header(tmp_path: Path) -> None:
    empty = tmp_path / "empty.csv"
    empty.write_bytes(b"")
    other = tmp_path / "other.csv"
    other.write_text("a,b,c\n1,2,3\n", encoding="utf-8")
    for p in (empty, other):
        with pytest.raises(ValueError, match=p.name):
            gr.read_catalog_rows(p)
    assert len(gr.read_catalog_rows(write_catalog(tmp_path))) == 11  # 1 Series + 4 Item + 6 Track; the short row is dropped


def test_headline_plan_always_has_every_group(tmp_path: Path) -> None:
    lines = ["Collection Title,x", HEADER,
             _row("mus00044c00002", SAHRO, "Item", "", "Box 1, Audiocassette AWM SC 12200"),
             _row("mus00044c00081", "Side A. Track 1: Wisiisi (Longing)", "Track", URN + "33901491", level2=SAHRO)]
    catalog = tmp_path / "one.csv"
    catalog.write_text("\n".join(lines) + "\n", encoding="utf-8")
    text, counts = _build(tmp_path, _write_manifest(tmp_path, []), catalog)
    assert counts["plan"] == {"legacy": 0, "fetch": 1, "cassette_superseded_by_tracks": 0, "duplicate_link": 0}
    assert counts["manifest_rows"] == 0 and counts["pending"] == 1 and counts["skipped_by_reason"] == {}
    assert counts["legacy_cassette_overlaps"] == 0 and counts["legacy_cassettes_with_linked_tracks"] == 0
    assert counts["legacy_files_on_disk"] == 0 and counts["legacy_files_unaccounted"] == 0
    assert "| legacy | 0 | 2025 files, not re-fetched |" in text and "| duplicate_link | 0 |" in text
    assert "## 8. Legacy files on disk with no manifest row (0)" in text and "The legacy folder was not found" in text


def test_gap_report_counts_partial_manifest(tmp_path: Path) -> None:
    catalog = write_catalog(tmp_path)
    manifest = _write_manifest(tmp_path, _manifest_rows())
    text, counts = _build(tmp_path, manifest, catalog, generated="2026-09-25 16:00:00 -0500")
    assert counts["manifest_rows"] == 7 and counts["manifest_objects"] == 6
    assert (counts["malformed_lines"], counts["rows_without_cid"], counts["bad_durations"]) == (0, 0, 0)
    assert counts["catalog_rows"] == {"Series": 1, "Item": 4, "Track": 6}
    assert counts["linked_catalog_objects"] == 7 and counts["linked_items"] == 3 and counts["linked_tracks"] == 4
    assert (counts["fetched"], counts["legacy"], counts["skipped"]) == (1, 2, 3)
    assert counts["skipped_by_reason"] == {"http_429": 1, "cassette_superseded_by_tracks": 1, "duplicate_link": 1}
    assert counts["pending"] == 1 and counts["to_retry"] == 1 and counts["complete"] is False
    assert counts["plan"] == {"legacy": 2, "fetch": 3, "cassette_superseded_by_tracks": 1, "duplicate_link": 1}
    assert counts["hours_fetched"] == round(300 / 3600, 2)
    assert counts["hours_fetched_plus_legacy"] == 0.75
    assert counts["hours_unique_audio"] == 0.25  # the 0.5 h whole-cassette legacy file overlaps its tracks
    assert counts["tracks_without_digital_object"] == 2 and counts["items_without_digital_object"] == 1
    assert counts["legacy_cassette_overlaps"] == 1 and counts["legacy_cassettes_with_linked_tracks"] == 1

    assert "**Status: PARTIAL — the fetch is still running.** 1 of 7 linked catalog objects" in text
    assert "(7 rows, 6 objects after keeping the last row per cid" in text
    assert "Generated 2026-09-25 16:00:00 -0500" in text and "**Input problems:**" not in text
    assert "| catalog rows (Series / Item / Track) | 1 / 4 / 6 |" in text
    assert "| fetched (this run) | 1 |" in text and "| pending (linked objects with no manifest row yet) | 1 |" in text
    assert "| fetched + legacy | 0.75 h |" in text
    assert "| fetch | 3 | fetched 1, skipped 1, pending 1; 1 of them cassette-level objects" in text
    assert "### 4.2 Cassette-level objects superseded by their track objects (1) — `cassette_superseded_by_tracks`" in text
    assert "### 4.1 HTTP 429 at the player page (rate-limited by the streaming server) (1) — `http_429`" in text
    assert "| mus00044c00003 | 12201 | Item |" in text
    assert "| mus00044c00092 | 12201 | Track | Side B. Track 1: Ayaamaha toddobada ah | HTTP 429 at" in text
    assert "Side B. Track 2: Same \\| object" in text  # pipes in titles are escaped
    assert "1 files: 1 overlap tracks on disk now, 0 have no track on disk yet (0 linked track objects pending for them)." in text
    assert ("| mus00044c00002 | 12200 | " + SAHRO + " | data/harvard_raw/legacy/track_0001_x.mp3 | 2 | 1 | 1 | 0 | yes | 0.50 h |") in text
    assert "## 6. Catalog tracks with no digital object (2)" in text
    assert "| mus00044c01307 | 12200 | " + SAHRO + " | Side A. Track 4: Subcis [subgenre of qaraami songs] |" in text
    assert "| mus00044c00095 | 12202 | Lone cassette | Side A. Track 1: Orphan without link |" in text
    assert "| mus00044c00005 | 12203 | No link cassette |" in text
    assert "no digital object in the finding aid" in text and "not fetch failures" in text


def test_section_5_lists_legacy_cassettes_whose_tracks_are_still_pending(tmp_path: Path) -> None:
    catalog = write_catalog(tmp_path)
    rows = [r for r in _manifest_rows() if r["cid"] in ("mus00044c00002", "mus00044c00003")]  # no track rows yet
    text, counts = _build(tmp_path, _write_manifest(tmp_path, rows), catalog)
    assert counts["legacy_cassettes_with_linked_tracks"] == 1 and counts["legacy_cassette_overlaps"] == 0
    assert counts["hours_unique_audio"] == 0.5 and counts["hours_fetched_plus_legacy"] == 0.5  # nothing subtracted yet
    assert counts["pending"] == 5
    assert "1 files: 0 overlap tracks on disk now, 1 have no track on disk yet (2 linked track objects pending for them)." in text
    assert ("| mus00044c00002 | 12200 | " + SAHRO + " | data/harvard_raw/legacy/track_0001_x.mp3 | 2 | 0 | 0 | 2 | no | 0.50 h |") in text
    assert "`hours_unique_audio` falls as pending tracks arrive" in text


def test_gap_report_surfaces_input_problems_in_header_and_headline(tmp_path: Path) -> None:
    catalog = write_catalog(tmp_path)
    manifest = _write_manifest(tmp_path, _manifest_rows())
    with open(manifest, "a", encoding="utf-8") as f:
        f.write(json.dumps({"status": "fetched", "duration_s": 10.0}) + "\n")  # line 9 (line 8 is blank)
        f.write('{"cid":"mus00044c00004","status":"fetch')  # line 10, still being written
    text, counts = _build(tmp_path, manifest, catalog)
    assert counts["manifest_rows"] == 9 and counts["manifest_objects"] == 6
    assert (counts["malformed_lines"], counts["rows_without_cid"], counts["bad_durations"]) == (1, 1, 0)
    assert counts["pending"] == 1  # the half-written row for c00004 does not count as its row
    assert counts["hours_fetched"] == round(300 / 3600, 2)  # the cid-less row's 10 s are not counted
    assert ("**Input problems:** 1 manifest line(s) were not a JSON object and were skipped (line 10; "
            "a line the fetcher was still writing, or a hand edit); 1 manifest row(s) had no `cid` and were not "
            "counted as objects.") in text


def test_gap_report_says_complete_when_every_linked_object_has_a_row(tmp_path: Path) -> None:
    catalog = write_catalog(tmp_path)
    rows = _manifest_rows() + [{"cid": "mus00044c00004", "status": "fetched", "type": "Item", "title": "Lone cassette",
                                "cassette": "12202", "link": URN + "33900000",
                                "file": "data/harvard_raw/AWM_SC_12202_cassette.mp3", "duration_s": 3600.0}]
    text, counts = _build(tmp_path, _write_manifest(tmp_path, rows), catalog)
    assert counts["pending"] == 0 and counts["complete"] is True and counts["fetched"] == 2
    assert counts["hours_fetched"] == round((300 + 3600) / 3600, 2)
    assert "**Status: complete.** Every one of the 7 linked catalog objects has a manifest row" in text
    assert counts["legacy_cassette_overlaps"] == 1  # a fetched Item is not a track row, so no new overlap


def test_scan_legacy_lists_unaccounted_files_and_urn_collisions(tmp_path: Path) -> None:
    meta, legacy = write_legacy(tmp_path)
    # a fourth metadata row repeating the URN of row 1, and a file named after it (different bytes):
    # harvard_fetch.legacy_index keeps the last file per URN, so track_0001 never gets a manifest row
    with open(meta, "a", encoding="utf-8") as f:
        f.write(f"Wrong title for the same object,{URN}33901476,1955-1991,AWM Spec Coll 103\n")
    (legacy / "track_0004_Wrong_title_for_the_same_object.mp3").write_bytes(b"\0\0\0")
    assert hf.legacy_index(meta, legacy)["fhcl.loeb:33901476"].name == "track_0004_Wrong_title_for_the_same_object.mp3"
    rows = [gr.ManifestRow(cid="mus00044c00002", status="legacy", ctype="Item", title=SAHRO, cassette="12200",
                           link=URN + "33901476",
                           file="data/harvard_raw/legacy/track_0004_Wrong_title_for_the_same_object.mp3"),
            gr.ManifestRow(cid="mus00044c00081", status="legacy", ctype="Track", title="x", cassette="12200",
                           link=URN + "33901491",
                           file="data/harvard_raw/legacy/track_0002_Side_A_Track_1_Wisiisi_Longing.mp3")]
    scan = gr.scan_legacy(legacy, meta, rows)
    assert scan is not None and scan.files_on_disk == 6 and scan.meta_found and scan.directory == legacy
    names = {f.name: f for f in scan.unaccounted}
    assert set(names) == {"track_0001_Sahro_Axmed_Sahra_Ahmed_and_others.mp3", "track_0003_Row_without_url.mp3",
                          "track_0009_beyond_the_csv.mp3", "stray.mp3"}  # notes.txt is not audio
    f1 = names["track_0001_Sahro_Axmed_Sahra_Ahmed_and_others.mp3"]
    assert f1.urn == "fhcl.loeb:33901476" and f1.bytes == 1
    assert f1.note.startswith("identity unresolved: shares URN fhcl.loeb:33901476 with "
                              "track_0004_Wrong_title_for_the_same_object.mp3 (3 B, has a manifest row)")
    assert names["track_0003_Row_without_url.mp3"].note == "row 3 of harvard_tracks_metadata.csv has no url; identity unknown"
    assert names["track_0009_beyond_the_csv.mp3"].note == "row 9 is beyond the 4 rows of harvard_tracks_metadata.csv; identity unknown"
    assert names["stray.mp3"].note.startswith("no track_NNNN prefix") and names["stray.mp3"].urn == ""
    assert gr.scan_legacy(tmp_path / "nowhere", meta, rows) is None
    scan2 = gr.scan_legacy(legacy, tmp_path / "no_meta.csv", rows)  # without the metadata nothing can be identified
    assert scan2 is not None and not scan2.meta_found and len(scan2.unaccounted) == 4
    assert all("identity unknown" in f.note for f in scan2.unaccounted)


def test_gap_report_cli_writes_the_file_with_section_8_and_prints_counts(
        tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch) -> None:
    catalog = write_catalog(tmp_path)
    meta, legacy = write_legacy(tmp_path)
    rows = _manifest_rows()
    rows[0] = {**rows[0], "file": "data/harvard_raw/legacy/track_0001_Sahro_Axmed_Sahra_Ahmed_and_others.mp3"}
    rows[1] = {**rows[1], "file": "data/harvard_raw/legacy/track_0002_Side_A_Track_1_Wisiisi_Longing.mp3"}
    manifest = _write_manifest(tmp_path, rows)
    out = tmp_path / "docs" / "HARVARD_GAP_LIST.md"
    monkeypatch.setattr("sys.argv", ["harvard_gap_report", "--manifest", str(manifest), "--catalog", str(catalog),
                                     "--legacy-dir", str(legacy), "--legacy-meta", str(meta), "--out", str(out)])
    assert gr.main() == 0
    printed = capsys.readouterr().out
    counts = json.loads(printed[: printed.rindex("}") + 1])
    assert counts["fetched"] == 1 and counts["legacy_files_on_disk"] == 5 and counts["legacy_files_unaccounted"] == 3
    assert printed.rstrip().endswith(f"wrote {out}")
    text = out.read_text(encoding="utf-8")
    assert text.startswith("# Harvard collection fetch — gap list")
    assert f"and a listing of `{legacy}` (5 `*.mp3` files)" in text
    assert "| legacy files on disk / with no manifest row (see 8) | 5 / 3 |" in text
    assert "## 8. Legacy files on disk with no manifest row (3)" in text
    assert "| stray.mp3 | 1 | ? | no track_NNNN prefix" in text
    assert "| track_0003_Row_without_url.mp3 | 1 | ? | row 3 of harvard_tracks_metadata.csv has no url; identity unknown |" in text
    assert "| track_0009_beyond_the_csv.mp3 | 1 | ? | row 9 is beyond the 3 rows of harvard_tracks_metadata.csv; identity unknown |" in text
    assert "Legacy files with no manifest row (section 8) are in no figure here." in text


def test_gap_report_cli_exits_2_on_bad_inputs(tmp_path: Path, capsys: pytest.CaptureFixture[str],
                                              monkeypatch: pytest.MonkeyPatch) -> None:
    catalog = write_catalog(tmp_path)
    manifest = _write_manifest(tmp_path, _manifest_rows())
    out = tmp_path / "docs" / "HARVARD_GAP_LIST.md"

    def run(*argv: str) -> tuple[int, str]:
        monkeypatch.setattr("sys.argv", ["harvard_gap_report", *argv, "--legacy-dir", str(tmp_path / NO_LEGACY)])
        rc = gr.main()
        return rc, capsys.readouterr().err

    rc, err = run("--manifest", str(tmp_path / "missing.jsonl"), "--catalog", str(catalog), "--out", str(out))
    assert rc == 2 and "missing input" in err
    headerless = tmp_path / "headerless.csv"
    headerless.write_text("a,b,c\n1,2,3\n", encoding="utf-8")
    rc, err = run("--manifest", str(manifest), "--catalog", str(headerless), "--out", str(out))
    assert rc == 2 and "no 'Database Number' header row" in err and "headerless.csv" in err
    rc, err = run("--manifest", str(manifest), "--catalog", str(catalog), "--out", str(tmp_path))
    assert rc == 2 and "--out is a directory" in err
    assert not out.exists()
