"""Unit tests for scripts/corpus_report.py — the Phase 1 corpus report.

No corpus, GPU or network: every input is a tiny JSONL/CSV fixture under
tmp_path, the Harvard "audio files" are empty placeholders (the manifest rows
carry the sha256, so nothing is hashed), and importlib.metadata is
monkeypatched where a version string is asserted.
"""

from __future__ import annotations

import csv
import json
from importlib import metadata
from pathlib import Path

import pytest

from scripts import corpus_report as cr

AHMED = cr.RIGHTS_AHMED
HARVARD = cr.RIGHTS_HARVARD


def _jsonl(path: Path, rows: list[dict]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return path


def _row(sha: str, dur: float, content: str | None, *, group: str = "garageband", project: str = "p",
         excluded: bool = False, reason: str | None = None, tp: str | None = None, unclassified: bool = False) -> dict:
    return {"path": f"data/ahmed_raw/{project}/{sha[:6]}.m4a", "name": f"{sha[:6]}.m4a", "source_group": group,
            "project": project, "sha256": sha, "duration_s": dur, "excluded": excluded, "exclude_reason": reason,
            "content": content, "unclassified": unclassified, "third_party_suspect": bool(tp), "third_party_reason": tp,
            "song_group": project}


CLASSIFIED = [
    _row("a1" * 32, 600, "oud", project="p1"),
    _row("a2" * 32, 1200, "full_mix", project="p1"),
    _row("a3" * 32, 300, "voice", project="p2", group="logic"),
    _row("a4" * 32, 300, "drums", project="p2", group="logic"),
    _row("a5" * 32, 180, "rap", project="p3"),
    _row("a6" * 32, 120, "synth", project="p4"),
    _row("a7" * 32, 240, None, project="p5", unclassified=True, tp="mixed"),
    _row("a1" * 32, 600, None, project="p1", excluded=True, reason="duplicate"),
    _row("a8" * 32, 60, None, project="p6", excluded=True, reason="silent"),
    _row("c1" * 32, 900, "oud", group="ahmed_collection", project="c1"),
    _row("c2" * 32, 300, None, group="ahmed_collection", project="c2", unclassified=True),
]


def _hrow(cid: str, status: str, typ: str, cassette: str, dur: float = 0.0, sha: str = "", file: str | None = None,
          title: str = "", reason: str | None = None) -> dict:
    r: dict = {"cid": cid, "status": status, "type": typ, "title": title, "cassette": cassette, "side": "A", "track": "1",
               "link": f"https://nrs.example/{cid}"}
    if status in ("fetched", "legacy"):
        r.update({"file": file, "duration_s": dur, "sha256": sha})
    if reason:
        r["reason"] = reason
    return r


MANIFEST = [
    _hrow("c1", "skipped", "Track", "12200", reason="network error: ReadTimeout"),  # superseded by the later c1 row
    _hrow("c1", "fetched", "Track", "12200", 300, "b1" * 32, "data/harvard_raw/AWM_SC_12200_A1_x__c1.mp3", "Side A. Track 1: X"),
    _hrow("c2", "fetched", "Track", "12200", 200, "b2" * 32, "data/harvard_raw/AWM_SC_12200_A2_y__c2.mp3", "Side A. Track 2: Y"),
    _hrow("c3", "legacy", "Item", "12200", 600, "b3" * 32, "data/harvard_raw/legacy/track_0001.mp3", "Sahro and others"),
    _hrow("c4", "legacy", "Track", "12300", 400, "b4" * 32, "data/harvard_raw/legacy/track_0002.mp3", "Side A. Track 1: Z"),
    _hrow("c5", "legacy", "Item", "12300", 900, "b5" * 32, "data/harvard_raw/legacy/track_0003.mp3", "Whole side"),
    _hrow("c6", "fetched", "Track", "12400", 100, "b2" * 32, "data/harvard_raw/AWM_SC_12400_A1_y__c6.mp3", "Side A. Track 1: Y again"),
    _hrow("c7", "skipped", "Item", "12500", reason="cassette-level object; 8 linked track objects fetched instead"),
    _hrow("c8", "skipped", "Item", "12600", reason="cassette-level object; 5 linked track objects fetched instead"),
    _hrow("c9", "skipped", "Track", "12700", reason="network error: ConnectionError"),
    _hrow("c10", "skipped", "Track", "12800", reason="no public stream on the SDS page (no playlist)"),
    _hrow("c11", "fetched", "Track", "12900", 50, "b9" * 32, "data/harvard_raw/AWM_SC_12900_A1_w__c11.mp3", "Side A. Track 1: W"),
]
HARVARD_FILES_ON_DISK = [r["file"] for r in MANIFEST if r.get("file") and r["cid"] != "c11"]

SEPARATED = [
    {"corpus": "ahmed_mix", "rights": AHMED, "duration_s": 1200, "oud_present": True, "vocals_present": True, "stems": {"other": "o.wav"}},
    {"corpus": "ahmed_mix", "rights": AHMED, "duration_s": 600, "oud_present": False, "vocals_present": True, "stems": {}},
    {"corpus": "harvard_full", "rights": HARVARD, "duration_s": 300, "oud_present": True, "vocals_present": True, "stems": {}},
    {"corpus": "mystery", "rights": "internet_cc", "duration_s": 100, "oud_present": True, "vocals_present": False, "stems": {}},
    {"corpus": "orphan", "rights": "weird_tier", "duration_s": 50, "oud_present": True, "vocals_present": True, "stems": {}},
    # separate_stems names an --extra-inventory corpus by its rights tier
    {"corpus": "contrib_hodan_consented", "rights": "contrib_hodan_consented", "duration_s": 360, "oud_present": True,
     "vocals_present": True, "stems": {}},
]
SEP_INDEX = f"{cr.DEFAULT_SEPARATED}/{cr.SEPARATED_INDEX}"
SEP_NOT_BUILT = f"not built yet (`{cr.DEFAULT_SEPARATED}/{cr.SEPARATED_INDEX}` or `{cr.DEFAULT_SEPARATED}/{cr.STEMS_GLOB}`)"

INTERNET_FILES = [
    {"sha256": "d1" * 32, "duration_s": 600, "rights": "internet_cc", "content": "full_mix", "excluded": False},
    {"sha256": "d2" * 32, "duration_s": 300, "rights": "internet_cc", "content": "oud", "excluded": False},
    {"sha256": "d3" * 32, "duration_s": 100, "rights": "internet_cc", "content": None, "excluded": True, "exclude_reason": "duplicate"},
    {"sha256": "d4" * 32, "duration_s": 200, "rights": "internet_research_only", "content": None, "excluded": False},
]
CONTRIB = [
    {"sha256": "e1" * 32, "duration_s": 300, "rights": "contrib_hodan_consented", "content": "voice"},
    {"sha256": "e2" * 32, "duration_s": 300, "rights": "contrib_hodan_consented", "content": "full_mix"},
]
INTERNET_MANIFEST = [{"id": "ia1", "status": "fetched"}, {"id": "ia2", "status": "fetched"}, {"id": "ia3", "status": "skipped"}]
INTERNET_SKIPPED = [
    {"id": "ia3", "reason": "licence not explicit", "duration_s": 300},
    {"id": "ia4", "reason": "licence not explicit"},
    {"id": "ia5", "reason": "download failed: HTTP 404"},
]


def _cap(set_name: str, sha: str, group: str, split: str, seconds: float = 30.0, source: str | None = None) -> dict:
    return {"clip_path": f"data/sets/{set_name}/clips/{split}/{set_name}_{sha[:12]}_seg000.wav", "caption": "qaraami, ...",
            "song_sha256": sha, "song_group": group, "split": split, "source": source or set_name, "source_name": "x",
            "source_path": "y", "rights": AHMED, "content": "oud", "project": "p", "tokens_dir": "t", "seconds": seconds,
            "caption_version": 1}


OUD_CAPS = [_cap("ahmed_oud", "a" * 64, "ga", "train"), _cap("ahmed_oud", "a" * 64, "ga", "train"),
            _cap("ahmed_oud", "b" * 64, "gb", "train"), _cap("ahmed_oud", "b" * 64, "gb", "train"),
            _cap("ahmed_oud", "c" * 64, "gc", "val"), _cap("ahmed_oud", "d" * 64, "gd", "test")]
MIX_CAPS = [_cap("ahmed_mix", "e" * 64, "ge", "train"), _cap("ahmed_mix", "e" * 64, "ge", "train")]
LEAKY_CAPS = [_cap("leaky", "f" * 64, "gf", "train"), _cap("leaky", "f" * 64, "gf", "val")]
TEN_CAPS = [_cap("ahmed_oud", "a" * 64, "ga", "train", seconds=10.0) for _ in range(3)]
MIDI_SKIPS = [{"clip": "x", "reason": "no_voiced_frames"}, {"clip": "y", "reason": "no_voiced_frames"}, {"clip": "z", "reason": "too_few_notes (3)"}]


def _catalog(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    header = ["Database Number", "Component Title", "Container Info", "Component Type", "Digital Content Link"]
    rows = [["Finding aid export", "", "", "", ""], header]
    for r in MANIFEST:
        rows.append([r["cid"], r["title"], "", r["type"], r["link"]])
    rows.append(["c12", "Side B. Track 1: pending", "", "Track", "https://nrs.example/c12"])  # linked, not in the manifest
    rows.append(["c13", "Side B. Track 2: no link", "", "Track", ""])  # unlinked: never pending
    rows.append(["s1", "Series", "", "Series", "https://nrs.example/s1"])
    with open(path, "w", newline="") as f:
        csv.writer(f).writerows(rows)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = tmp_path
    _jsonl(root / cr.DEFAULT_CLASSIFIED, CLASSIFIED)
    (root / cr.DEFAULT_CLASSIFIER_REPORT).write_text(json.dumps(
        {"model": "LogisticRegression(C=1)", "n_seeds": 7, "cv": {"n_splits": 5, "accuracy": 0.75, "balanced_accuracy": 0.5},
         "thresholds": {"PROB_MIN": 0.6}}))
    _jsonl(root / cr.DEFAULT_HARVARD_MANIFEST, MANIFEST)
    for f in HARVARD_FILES_ON_DISK:
        (root / f).parent.mkdir(parents=True, exist_ok=True)
        (root / f).write_bytes(b"")
    _catalog(root / cr.DEFAULT_HARVARD_CATALOG)
    _jsonl(root / SEP_INDEX, SEPARATED)
    _jsonl(root / cr.DEFAULT_INTERNET_FILES, INTERNET_FILES)
    _jsonl(root / "data/inventory/contrib_hodan_files.jsonl", CONTRIB)
    _jsonl(root / cr.DEFAULT_INTERNET_MANIFEST, INTERNET_MANIFEST)
    _jsonl(root / cr.DEFAULT_INTERNET_SKIPPED, INTERNET_SKIPPED)
    _jsonl(root / "data/sets/ahmed_oud/captions.jsonl", OUD_CAPS)
    (root / "data/sets/ahmed_oud/SET_CARD.md").write_text("# Set card: ahmed_oud\n")
    _jsonl(root / "data/sets/ahmed_mix/captions.jsonl", MIX_CAPS)
    _jsonl(root / "data/sets/leaky/captions.jsonl", LEAKY_CAPS)
    _jsonl(root / "data/sets/run_demo_captions.jsonl", OUD_CAPS + MIX_CAPS)
    _jsonl(root / "data/sets_10s/ahmed_oud/captions.jsonl", TEN_CAPS)
    _jsonl(root / "data/sets/ahmed_oud/midi/skipped.jsonl", MIDI_SKIPS)
    return root


def _by_corpus(rep: cr.Report) -> dict[str, cr.CorpusRow]:
    return {r.corpus: r for r in rep.headline}


# ---------------------------------------------------------------------------
# Missing inputs
# ---------------------------------------------------------------------------


def test_all_inputs_missing_renders_not_built_yet(tmp_path: Path) -> None:
    inp = cr.Inputs.defaults(tmp_path)
    rep = cr.load_report(inp)
    text = cr.render(rep, today="2026-01-01")
    assert rep.classified is None and rep.harvard is None and rep.separated is None
    assert text.count("not built yet") >= 12
    for name in (cr.DEFAULT_CLASSIFIED, cr.DEFAULT_INTERNET_FILES, cr.DEFAULT_HARVARD_MANIFEST,
                 cr.DEFAULT_INTERNET_SKIPPED, cr.DEFAULT_INTERNET_MANIFEST, "data/sets_10s/*/captions.jsonl",
                 "data/sets/*/captions.jsonl", "data/sets/*/midi/skipped.jsonl", cr.DEFAULT_CONTRIB_GLOB):
        assert f"not built yet (`{name}`)" in text, name
    assert SEP_NOT_BUILT in text  # the separation root: index or per-mix stems.json
    assert "not built yet (`data/sets/*captions.jsonl` or `data/sets_10s/*captions.jsonl`)" in text
    assert "No corpus is built yet" in text
    assert "## 4. Method" in text and "torch" in text  # method section renders without any data


def test_one_missing_input_does_not_hide_the_others(repo: Path) -> None:
    ns = cr.build_parser().parse_args(["--classified", "data/inventory/nope.jsonl"])
    rep = cr.load_report(cr.Inputs.from_args(repo, ns))
    text = cr.render(rep)
    assert "not built yet (`data/inventory/nope.jsonl`)" in text
    assert rep.harvard is not None and "| `ahmed_oud` | 30 s |" in text
    rows = _by_corpus(rep)
    assert rows["Ahmed sessions (GarageBand + Logic)"].status.startswith("not built yet")
    assert not rows["Harvard (Aryette collection)"].status


# ---------------------------------------------------------------------------
# Headline numbers
# ---------------------------------------------------------------------------


def test_ahmed_headline_rows(repo: Path) -> None:
    rows = _by_corpus(cr.load_report(cr.Inputs.defaults(repo)))
    s = rows["Ahmed sessions (GarageBand + Logic)"]
    assert (s.files_all, s.files_kept) == (9, 7)
    assert s.unique_h == pytest.approx(3000 / 3600)  # the duplicate row's sha counts once, silent rows count
    assert s.kept_h == pytest.approx(2940 / 3600)
    assert s.oud_rec_h == pytest.approx(600 / 3600)
    assert s.vocals_rec_h == pytest.approx(300 / 3600)
    assert s.full_mix_h == pytest.approx(1200 / 3600)
    assert s.drums_h == pytest.approx(300 / 3600)
    assert s.non_qaraami_h == pytest.approx(300 / 3600)
    assert s.unclassified_h == pytest.approx(240 / 3600)
    c = rows["Ahmed collection (oud_ilkacase)"]
    assert (c.files_all, c.files_kept) == (2, 2)
    assert c.oud_rec_h == pytest.approx(0.25) and c.unclassified_h == pytest.approx(300 / 3600)
    assert c.rights == AHMED and cr.publishable(c.rights).startswith("yes")


def test_internet_and_contributor_rows(repo: Path) -> None:
    rows = _by_corpus(cr.load_report(cr.Inputs.defaults(repo)))
    cc = rows["Internet `internet_cc`"]
    assert (cc.files_all, cc.files_kept) == (3, 2)
    assert cc.unique_h == pytest.approx(1000 / 3600) and cc.kept_h == pytest.approx(0.25)
    assert cc.oud_rec_h == pytest.approx(300 / 3600) and cc.full_mix_h == pytest.approx(600 / 3600)
    ro = rows["Internet `internet_research_only`"]
    assert ro.kept_h == pytest.approx(200 / 3600) and ro.unclassified_h == pytest.approx(200 / 3600)
    assert cr.publishable(ro.rights) == "no"
    h = rows["Contributor `hodan`"]
    assert h.rights == "contrib_hodan_consented" and cr.publishable(h.rights) == "yes (per CONTRIBUTOR.md)"
    assert h.kept_h == pytest.approx(600 / 3600) and h.vocals_rec_h == pytest.approx(300 / 3600)
    assert h.aliases == ("contrib_hodan", "hodan", "contrib_hodan_consented")


def test_internet_rows_without_rights_are_research_only(tmp_path: Path) -> None:
    """Policy: no explicit licence means research-only, never an 'unknown' tier with a CONTRIBUTOR.md pointer."""
    _jsonl(tmp_path / cr.DEFAULT_INTERNET_FILES, [
        {"sha256": "f1" * 32, "duration_s": 360, "content": "full_mix"},  # no rights field
        {"sha256": "f2" * 32, "duration_s": 360, "rights": "internet_cc", "content": "oud"},
        {"sha256": "f3" * 32, "duration_s": 360, "rights": "internet_odd", "content": "oud"},
    ])
    rep = cr.load_report(cr.Inputs.defaults(tmp_path))
    rows = _by_corpus(rep)
    ro = rows[f"Internet `{cr.RIGHTS_INTERNET_RESEARCH}`"]
    assert ro.kept_h == pytest.approx(0.1) and "1 inventory row(s) carry no `rights` field" in ro.note
    assert cr.publishable("internet_odd") == "no (no explicit licence)"
    text = cr.render(rep)
    headline = text.split("## 1. Headline")[1].split("## 2.")[0]
    assert "Internet `unknown`" not in headline and "`unknown`" not in headline
    assert "| Internet `internet_odd` | `internet_odd` | no (no explicit licence) |" in text


@pytest.mark.parametrize(
    "tier, expected",
    [(AHMED, "yes"), (HARVARD, "no"), ("internet_cc", "yes"), ("internet_research_only", "no"),
     ("internet_whatever", "no (no explicit licence)"),
     ("contrib_x_research_only", "no"), ("contrib_x_consented", "yes"), ("contrib_x", "unknown")],
)
def test_publishable_by_tier(tier: str, expected: str) -> None:
    assert cr.publishable(tier).startswith(expected)


# ---------------------------------------------------------------------------
# Tolerant JSONL reading
# ---------------------------------------------------------------------------


def test_torn_jsonl_line_is_skipped_and_reported(repo: Path) -> None:
    """The live fetch appends to the manifest while the report runs: a partial last line must not crash it."""
    manifest = repo / cr.DEFAULT_HARVARD_MANIFEST
    with manifest.open("a") as fh:
        fh.write('{"cid": "c99", "status": "fetched", "type": "Tra')  # torn, no newline
    caps = repo / "data/sets/ahmed_mix/captions.jsonl"
    caps.write_text(caps.read_text() + "[1, 2]\n" + "not json\n")  # a non-object row and garbage
    unreadable: cr.Unreadable = {}
    rows = cr.read_jsonl(manifest, unreadable)
    assert rows is not None and len(rows) == len(MANIFEST) and unreadable == {manifest: [len(MANIFEST) + 1]}
    assert cr.read_jsonl(repo / "data/none.jsonl") is None and cr.read_jsonl(_jsonl(repo / "data/empty.jsonl", [])) == []
    rep = cr.load_report(cr.Inputs.defaults(repo))
    assert rep.harvard is not None and rep.harvard.objects == 11  # unchanged: the torn row is dropped
    assert rep.unreadable == {manifest: [13], caps: [3, 4]}
    text = cr.render(rep)
    assert f"| Harvard manifest | `{cr.DEFAULT_HARVARD_MANIFEST}` | 12 rows, 11 objects (1 unreadable line(s) skipped: 13) |" in text
    assert "| 30 s sets | `data/sets/*/captions.jsonl` | 3 set(s) (2 unreadable line(s) skipped: 3, 4) |" in text
    # a classifier report that is not JSON renders as unreadable, not as "not built yet"
    (repo / cr.DEFAULT_CLASSIFIER_REPORT).write_text("{ torn")
    text2 = cr.render(cr.load_report(cr.Inputs.defaults(repo)))
    assert "| Ahmed classifier report | `data/inventory/ahmed_classifier.json` | unreadable (not valid JSON) |" in text2


# ---------------------------------------------------------------------------
# Harvard
# ---------------------------------------------------------------------------


def test_harvard_summary_last_row_per_cid_superseded_sides_and_duplicates(repo: Path) -> None:
    rep = cr.load_report(cr.Inputs.defaults(repo))
    h = rep.harvard
    assert h is not None
    assert h.objects == 11  # 12 rows, c1 twice
    assert dict(h.status_counts) == {"fetched": 4, "legacy": 3, "skipped": 4}
    assert h.unique_h == pytest.approx(2450 / 3600)  # b2 shared by c2 and c6 counts once; c11 counts (not on disk)
    assert h.kept_files == 3 and h.kept_h == pytest.approx(900 / 3600)  # c1, c2, c4
    reasons = {s["cid"]: s["reason"] for s in h.superseded}
    assert reasons == {"c3": "whole side superseded by fetched tracks", "c5": "whole side superseded by legacy tracks",
                       "c6": "duplicate sha256 of a kept file"}
    assert h.superseded_h == pytest.approx(1600 / 3600)
    assert h.select_skipped["missing_file"] == 1 and h.select_skipped["status_skipped"] == 4
    assert h.network_skips == 1  # c1's older network row is superseded by its fetched row
    assert h.skipped_by_reason == {"cassette-level object; N linked track objects fetched instead": 2,
                                   "network error: ConnectionError": 1, "no public stream on the SDS page (no playlist)": 1}
    assert h.linked == 12 and h.pending == 1  # c12 linked without a row; c13 has no link; the Series row is not an object
    row = _by_corpus(rep)["Harvard (Aryette collection)"]
    assert (row.files_all, row.files_kept) == (7, 3)
    assert row.full_mix_h == pytest.approx(h.kept_h) and row.oud_rec_h is None and row.unclassified_h is None
    text = cr.render(rep)
    assert "| `c3` | legacy | 12200 | Sahro and others | 0.17 | whole side superseded by fetched tracks |" in text
    assert "11 manifest objects (last row per cid): fetched 4, legacy 3, skipped 4; the catalog links 12 objects, 1 of them" in text


def test_harvard_without_catalog_has_no_pending_count(repo: Path) -> None:
    ns = cr.build_parser().parse_args(["--harvard-catalog", "data/none.csv"])
    rep = cr.load_report(cr.Inputs.from_args(repo, ns))
    assert rep.harvard is not None and rep.harvard.pending is None and rep.harvard.linked is None
    assert rep.harvard.kept_files == 3  # the manifest type is enough to tell a whole side from a track


def test_harvard_rows_without_cid_or_sha_and_outside_roots(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Keys follow select_harvard (cid, else sha256); a row without a sha256 is counted, never hashed;
    a file outside HARVARD_ROOTS is not called a duplicate."""
    monkeypatch.setattr(cr, "full_sha256", None, raising=False)  # the report must not even know the hasher

    def boom(path: Path) -> str:
        raise AssertionError(f"audio hashed: {path}")

    from scripts import build_sets
    monkeypatch.setattr(build_sets, "full_sha256", boom)
    legacy_no_cid = {"status": "legacy", "type": "Track", "title": "Side A. Track 3: no cid", "cassette": "12200",
                     "file": "data/harvard_raw/legacy/nocid.mp3", "duration_s": 120, "sha256": "b7" * 32}
    no_sha = {"cid": "c20", "status": "fetched", "type": "Track", "title": "Side A. Track 4: no sha", "cassette": "12200",
              "file": "data/harvard_raw/AWM_SC_12200_A4_nosha__c20.mp3", "duration_s": 240}
    outside = {"cid": "c21", "status": "fetched", "type": "Track", "title": "Side A. Track 5: elsewhere", "cassette": "12200",
               "file": "data/elsewhere/AWM_SC_12200_A5__c21.mp3", "duration_s": 60, "sha256": "b8" * 32}
    for r in (legacy_no_cid, no_sha, outside):
        (repo / r["file"]).parent.mkdir(parents=True, exist_ok=True)
        (repo / r["file"]).write_bytes(b"\x00" * 64)  # non-empty: hashing it would be visible
    _jsonl(repo / cr.DEFAULT_HARVARD_MANIFEST, MANIFEST + [legacy_no_cid, no_sha, outside, dict(legacy_no_cid)])
    h = cr.load_report(cr.Inputs.defaults(repo)).harvard
    assert h is not None
    assert h.objects == 14  # 11 + 3 new; the re-appended cid-less row is folded by its sha
    assert dict(h.status_counts) == {"fetched": 6, "legacy": 4, "skipped": 4}
    assert h.kept_files == 4 and h.kept_h == pytest.approx(1020 / 3600)  # c1, c2, c4 + the cid-less legacy track
    reasons = {s["cid"]: s["reason"] for s in h.superseded}
    assert "b7" * 32 not in reasons and "None" not in reasons and "c20" not in reasons and "c21" not in reasons
    assert h.select_skipped["no_sha256_on_row"] == 1 and h.select_skipped["outside_roots"] == 1
    assert cr.harvard_key(legacy_no_cid) == "b7" * 32 and cr.harvard_key({"cid": "x", "sha256": "b7" * 32}) == "x"
    assert cr.row_sha({"sha256": "B7" * 32}) == "b7" * 32 and cr.row_sha({"sha256": "abc"}) == ""


def test_unselected_eligible_row_is_not_called_a_duplicate(repo: Path) -> None:
    """A row select_harvard drops for another reason gets a neutral label, not a false sha claim."""
    rows = MANIFEST + [{"cid": "c30", "status": "fetched", "type": "Track", "title": "Side A. Track 9: q", "cassette": "12200",
                        "file": "data/harvard_raw/AWM_SC_12200_A9__c30.mp3", "duration_s": 10, "sha256": "b6" * 32}]
    (repo / rows[-1]["file"]).write_bytes(b"")
    _jsonl(repo / cr.DEFAULT_HARVARD_MANIFEST, rows)
    from scripts import build_sets
    real = build_sets.select_harvard

    def drop_c30(manifest_rows: list[dict], catalog: dict, root: Path = cr.REPO) -> build_sets.Selection:
        sel = real(manifest_rows, catalog, root=root)
        sel.files = [f for f in sel.files if f.extra.get("cid") != "c30"]
        sel.skipped["some_other_gate"] += 1
        return sel

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(cr, "select_harvard", drop_c30)
        h = cr.load_report(cr.Inputs.defaults(repo)).harvard
    assert h is not None
    assert {s["cid"]: s["reason"] for s in h.superseded}["c30"] == "not selected (see the selection skip counter)"


@pytest.mark.parametrize(
    "raw, folded",
    [
        ("cassette-level object; 28 linked track objects fetched instead", "cassette-level object; N linked track objects fetched instead"),
        ("stream download failed: e nor servname\n[in#0 @ 0xb43] Error opening input", "stream download failed: e nor servname"),
        ("", "unspecified"),
        ("x" * 120, "x" * 90 + "..."),
    ],
)
def test_normalise_reason(raw: str, folded: str) -> None:
    assert cr.normalise_reason(raw) == folded


# ---------------------------------------------------------------------------
# Separation
# ---------------------------------------------------------------------------


def test_separated_hours_attach_by_alias_then_rights_then_extra_row(repo: Path) -> None:
    rep = cr.load_report(cr.Inputs.defaults(repo))
    rows = _by_corpus(rep)
    s = rows["Ahmed sessions (GarageBand + Logic)"]
    assert s.sep_mixes == 2 and s.oud_sep_h == pytest.approx(1200 / 3600) and s.vocals_sep_h == pytest.approx(1800 / 3600)
    assert rows["Harvard (Aryette collection)"].oud_sep_h == pytest.approx(300 / 3600)
    assert rows["Internet `internet_cc`"].oud_sep_h == pytest.approx(100 / 3600)  # "mystery" matched by rights
    orphan = rows["separated: `orphan`"]
    assert orphan.rights == "weird_tier" and orphan.oud_sep_h == pytest.approx(50 / 3600) and orphan.oud_rec_h is None
    assert rows["Contributor `hodan`"].oud_sep_h == pytest.approx(0.1)  # matched by the tier alias
    text = cr.render(rep)
    assert "| 0.17 / 0.33 | 0.08 / 0.50 |" in text  # sessions: recorded / separated oud, recorded / separated vocals
    assert cr.separation_gate(SEPARATED)[0] == ["ahmed_mix", 2, "0.50", 1, "0.17"]
    assert "6 mixes separated, 1 fail the oud gate" in text


def test_separated_rows_never_land_on_a_not_built_headline_row(tmp_path: Path) -> None:
    """Only the separation index exists: its hours must show up as their own rows, not vanish."""
    _jsonl(tmp_path / SEP_INDEX, [
        {"corpus": "harvard_full", "rights": HARVARD, "duration_s": 3600, "oud_present": True},
        {"corpus": "ahmed", "rights": AHMED, "duration_s": 1800, "oud_present": True},
    ])
    rep = cr.load_report(cr.Inputs.defaults(tmp_path))
    rows = _by_corpus(rep)
    assert rows["Harvard (Aryette collection)"].status and rows["Harvard (Aryette collection)"].sep_mixes == 0
    assert rows["separated: `harvard_full`"].oud_sep_h == pytest.approx(1.0)
    assert rows["separated: `ahmed`"].oud_sep_h == pytest.approx(0.5) and rows["separated: `ahmed`"].rights == AHMED
    text = cr.render(rep)
    assert "| separated: `harvard_full` | `harvard_research_only` | no (research adapters only, never served) | 0 / 0 | 0.00 | 0.00 | – / 1.00 |" in text
    limits = text.split("## 5. What limits quality")[1]
    assert "No corpus is built yet" not in limits
    assert "only separation output exists: 2 separated mixes, 1.50 h of `other` stems pass the oud gate" in limits


def test_separation_root_without_index_reads_stems_json(tmp_path: Path) -> None:
    """build_sets accepts <root>/<corpus>/<sha12>/stems.json without an index; so does the report."""
    _jsonl(tmp_path / cr.DEFAULT_CLASSIFIED, CLASSIFIED)
    sep = tmp_path / cr.DEFAULT_SEPARATED
    for i, (corpus, present) in enumerate((("ahmed", True), ("ahmed", False))):
        d = sep / corpus / f"{i:012d}"
        d.mkdir(parents=True)
        (d / "stems.json").write_text(json.dumps({"corpus": corpus, "rights": AHMED, "duration_s": 600, "oud_present": present}))
    (sep / "ahmed" / "bad").mkdir()
    (sep / "ahmed" / "bad" / "stems.json").write_text("{ torn")  # build_sets skips it with a stderr note
    rep = cr.load_report(cr.Inputs.defaults(tmp_path))
    assert rep.separated is not None and len(rep.separated) == 2
    assert _by_corpus(rep)["Ahmed sessions (GarageBand + Logic)"].oud_sep_h == pytest.approx(600 / 3600)
    text = cr.render(rep)
    assert f"| Separation index | `{SEP_INDEX}` or `data/separated/*/*/stems.json` | 2 rows |" in text
    assert "2 mixes separated, 1 fail the oud gate" in text
    # an explicit index path is taken literally: no stems.json fallback, and the not-built text names only it
    ns = cr.build_parser().parse_args(["--separated", "data/separated/index.jsonl"])
    text2 = cr.render(cr.load_report(cr.Inputs.from_args(tmp_path, ns)))
    assert '"–" = not built yet (`data/separated/index.jsonl`).' in text2


def test_missing_separation_renders_dash_and_footnote(repo: Path) -> None:
    ns = cr.build_parser().parse_args(["--separated", "data/none.jsonl"])
    text = cr.render(cr.load_report(cr.Inputs.from_args(repo, ns)))
    assert "| 0.17 / – | 0.08 / – |" in text
    assert '"–" = not built yet (`data/none.jsonl`)' in text
    assert "### 3.7" in text and "not built yet (`data/none.jsonl`)" in text
    ns2 = cr.build_parser().parse_args(["--separated", "data/nowhere"])
    text2 = cr.render(cr.load_report(cr.Inputs.from_args(repo, ns2)))
    assert "not built yet (`data/nowhere/index.jsonl` or `data/nowhere/*/*/stems.json`)" in text2


# ---------------------------------------------------------------------------
# Sets
# ---------------------------------------------------------------------------


def test_set_summaries_and_merged_runs(repo: Path) -> None:
    rep = cr.load_report(cr.Inputs.defaults(repo))
    by = {s.name: s for s in rep.sets30}
    oud = by["ahmed_oud"]
    assert (oud.files, oud.songs, oud.total_clips) == (4, 4, 6)
    assert dict(oud.clips) == {"train": 4, "val": 1, "test": 1}
    assert oud.total_hours == pytest.approx(180 / 3600) and oud.window_s == 30.0 and oud.card
    assert not by["ahmed_mix"].card and cr.leakage_text(by["ahmed_mix"].leakage) == "none"
    assert cr.leakage_text(by["leaky"].leakage).endswith("in two splits")
    ten = {s.name: s for s in rep.sets10}["ahmed_oud"]
    assert ten.window_s == 10.0 and ten.total_clips == 3 and ten.total_hours == pytest.approx(30 / 3600)
    merged = {s.name: s for s in rep.merged}["run_demo"]
    assert merged.total_clips == 8 and dict(merged.sources) == {"ahmed_oud": 6, "ahmed_mix": 2} and merged.label == "sets"
    text = cr.render(rep)
    assert "| `ahmed_oud` | 30 s | 4 | 4 | 4 | 1 | 1 | 6 | 0.05 | ahmed_ilkacase_consented | none | n/a | yes |" in text
    assert ("| `sets/run_demo` | 30 s | 5 | 5 | 6 | 1 | 1 | 8 | 0.07 | ahmed_ilkacase_consented | none | n/a | "
            "ahmed_mix 2, ahmed_oud 6 |") in text
    assert "| `ahmed_oud` | 10 s | 1 | 1 | 3 | 0 | 0 | 3 | 0.01 |" in text


def _stem(set_name: str, sha: str, group: str, split: str, content: str = "sep_oud") -> dict:
    r = _cap(set_name, sha, group, split)
    r["content"] = content
    return r


def test_stem_sets_are_checked_against_their_mix_split(repo: Path) -> None:
    """find_leakage on one file says 'none' for a stem set whose clips sit in another split than
    their source mix; the report must run find_stem_split_mismatches against the mix set."""
    # ahmed_mix has song e in train; sep_oud puts e's stem in val (bad) and an unrelated stem in test (unchecked)
    _jsonl(repo / "data/sets/sep_oud/captions.jsonl", [_stem("sep_oud", "e" * 64, "ge", "val"), _stem("sep_oud", "z" * 64, "gz", "test")])
    _jsonl(repo / "data/sets/sep_vocal/captions.jsonl", [_stem("sep_vocal", "e" * 64, "ge", "train", "sep_vocal")])
    _jsonl(repo / "data/sets/harvard_sep_oud/captions.jsonl", [_stem("harvard_sep_oud", "h" * 64, "gh", "train")])  # no harvard_full
    _jsonl(repo / "data/sets/other_oud/captions.jsonl", [_stem("other_oud", "e" * 64, "ge", "val")])  # generic stem set
    _jsonl(repo / "data/sets/run_stems_captions.jsonl", MIX_CAPS + [_stem("sep_oud", "e" * 64, "ge", "val")])
    rep = cr.load_report(cr.Inputs.defaults(repo))
    by = {s.name: s for s in rep.sets30}
    assert not by["ahmed_oud"].is_stem_set and not by["ahmed_mix"].is_stem_set
    assert (by["sep_oud"].mix_set, by["sep_oud"].stems_checked, by["sep_oud"].stem_mismatches) == ("ahmed_mix", 1, 1)
    assert cr.leakage_text(by["sep_oud"].leakage) == "none"  # exactly the blind spot
    assert (by["sep_vocal"].stems_checked, by["sep_vocal"].stem_mismatches) == (1, 0)
    assert by["harvard_sep_oud"].mix_set == "harvard_full" and by["harvard_sep_oud"].stem_mismatches is None
    assert by["other_oud"].is_stem_set and by["other_oud"].stems_checked == 0 and by["other_oud"].stem_mismatches == 0
    merged = {s.name: s for s in rep.merged}["run_stems"]
    assert (merged.stems_checked, merged.stem_mismatches) == (1, 1)
    text = cr.render(rep)
    assert "| `sep_oud` | 30 s | 2 | 2 | 0 | 1 | 1 | 2 | 0.02 | ahmed_ilkacase_consented | none | 1 stem(s) in another split than their mix | no |" in text
    assert "| `sep_vocal` | 30 s | 1 | 1 | 1 | 0 | 0 | 1 | 0.01 | ahmed_ilkacase_consented | none | ok (1 stems) | no |" in text
    assert "| `harvard_sep_oud` | 30 s | 1 | 1 | 1 | 0 | 0 | 1 | 0.01 | ahmed_ilkacase_consented | none | mix set `harvard_full` not built | no |" in text
    assert "| `other_oud` | 30 s | 1 | 1 | 0 | 1 | 0 | 1 | 0.01 | ahmed_ilkacase_consented | none | no mix row to check against | no |" in text
    assert "| `sets/run_stems` | 30 s | 1 | 1 | 2 | 1 | 0 | 3 | 0.03 | ahmed_ilkacase_consented | 2 key(s) in two splits | 1 stem(s) in another split than their mix |" in text


def test_merged_captions_under_the_10s_root_are_listed(repo: Path) -> None:
    """build_sets --merge all_10s --out-root data/sets_10s writes data/sets_10s/all_10s_captions.jsonl."""
    _jsonl(repo / "data/sets_10s/all_10s_captions.jsonl", TEN_CAPS)
    rep = cr.load_report(cr.Inputs.defaults(repo))
    assert [(s.label, s.name) for s in rep.merged] == [("sets", "run_demo"), ("sets_10s", "all_10s")]
    text = cr.render(rep)
    assert "| `sets_10s/all_10s` | 10 s | 1 | 1 | 3 | 0 | 0 | 3 | 0.01 | ahmed_ilkacase_consented | none | n/a | ahmed_oud 3 |" in text
    assert "| Merged run captions | `data/sets/*captions.jsonl` or `data/sets_10s/*captions.jsonl` | 2 file(s) |" in text


def test_sparse_rows_render_guarded_text(tmp_path: Path) -> None:
    """Rows missing optional fields render honest text instead of 'None', '0 s', 'nan' or ': .'."""
    root = tmp_path
    caps = [{"clip_path": "a.wav", "song_sha256": "a" * 64, "caption": "x"}, {"clip_path": "b.wav", "song_sha256": "a" * 64, "caption": "x"}]
    _jsonl(root / "data/sets/ahmed_oud/captions.jsonl", caps)
    _jsonl(root / cr.DEFAULT_HARVARD_MANIFEST, [])
    (root / cr.DEFAULT_CLASSIFIED).parent.mkdir(parents=True, exist_ok=True)
    (root / cr.DEFAULT_CLASSIFIER_REPORT).write_text(json.dumps({"model": "lr", "n_seeds": 3}))
    _jsonl(root / cr.DEFAULT_CLASSIFIED, [_row("a5" * 32, 600, "rap", project="Cawo #1 | take `2`")])
    rep = cr.load_report(cr.Inputs.defaults(root))
    text = cr.render(rep)
    assert "| `ahmed_oud` | unknown | 1 | 0 | 0 | 0 | 0 | 2 (2 unsplit) | 0.00 | None | none | n/a | no |" in text
    assert "Classifier report: model `lr`, 3 seed rows, no CV block in the report; thresholds {}." in text
    assert "0 manifest objects (last row per cid): none. `network error` skips (0)" in text
    assert "(no recorded oud at all); recorded oud is 0 % of the 0.17 h kept" in text
    assert "| rap | 1 | 0.17 | 1 | `Cawo #1 \\| take '2'` |" in text
    (root / cr.DEFAULT_CLASSIFIER_REPORT).write_text(json.dumps({"model": "lr", "cv": {"n_splits": 5, "accuracy": "?"}}))
    assert "5-fold CV accuracy n/a, balanced n/a" in cr.render(cr.load_report(cr.Inputs.defaults(root)))


# ---------------------------------------------------------------------------
# Exclusions
# ---------------------------------------------------------------------------


def test_exclusion_tables(repo: Path) -> None:
    rep = cr.load_report(cr.Inputs.defaults(repo))
    assert rep.classified is not None
    assert cr.exclusions_by_reason(rep.classified) == [["duplicate", 1, "0.17"], ["silent", 1, "0.02"]]
    assert cr.third_party_table(rep.classified) == [["mixed", 1, "0.07", 1]]
    nq = cr.non_qaraami_table(rep.classified)
    assert [r[:4] for r in nq] == [["synth", 1, "0.03", 1], ["rap", 1, "0.05", 1]]
    assert nq[1][4] == "`p3`"
    assert rep.internet_skipped is not None
    assert cr.skipped_table(rep.internet_skipped) == [["licence not explicit", 2, "0.08"], ["download failed: HTTP N", 1, "0.00"]]
    assert cr.melody_skips([repo / "data/sets", repo / "data/sets_10s"]) == [
        ["`sets/ahmed_oud`", "no_voiced_frames", 2], ["`sets/ahmed_oud`", "too_few_notes (N)", 1]]
    text = cr.render(rep)
    assert "2 of 11 inventoried files are excluded (0.18 h of file time" in text
    assert "1 kept files (0.07 h) are flagged `third_party_suspect`" in text
    assert "3 objects in the download manifest, 3 skipped." in text
    assert "| `sets/ahmed_oud` | no_voiced_frames | 2 |" in text


# ---------------------------------------------------------------------------
# Method and limits
# ---------------------------------------------------------------------------


def test_method_versions_scripts_and_docstrings(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fake_version(name: str) -> str:
        if name == "demucs":
            raise metadata.PackageNotFoundError(name)
        return "1.2.3"

    monkeypatch.setattr(cr.metadata, "version", fake_version)
    versions = cr.package_versions(("torch", "demucs"))
    assert versions == {"torch": "1.2.3", "demucs": "not installed"}
    names = [n for n, _, _ in cr.method_scripts()]
    assert "build_sets" in names and "ahmed_classify" in names and "corpus_report" in names
    (tmp_path / "long.py").write_text('"""' + "word " * 60 + "\n\nsecond paragraph\n" + '"""\n')
    summary = cr.script_summary(tmp_path / "long.py", max_chars=40)
    assert summary.endswith(" ...") and len(summary) <= 44 and "second" not in summary
    assert cr.script_summary(tmp_path / "missing.py") == ""
    (tmp_path / "bad.py").write_text("def (:\n")
    assert cr.script_summary(tmp_path / "bad.py") == ""
    text = cr.render(cr.load_report(cr.Inputs.defaults(tmp_path)))
    assert "torch 1.2.3" in text and "demucs not installed" in text
    assert "| `scripts/build_sets.py` | sets and captions |" in text


def test_method_and_footnote_use_the_pipeline_constants() -> None:
    """Overlap, loudness target and split ratio come from build_sets / build_scale_dataset, not typed here."""
    from scripts import build_scale_dataset, build_sets

    text = cr.render(cr.load_report(cr.Inputs.defaults(Path("/nonexistent/root"))))
    method = text.split("## 4. Method")[1]
    assert f"peak then {build_scale_dataset.TARGET_LUFS:g} LUFS" in method
    assert f"song-group-aware {build_sets.split_ratio_label()} splits" in method and "80/10/10" in method
    win, hop = build_sets.window_hop(build_sets.DEFAULT_SECONDS)
    assert cr.overlap_pct() == pytest.approx(100 * (1 - hop / win)) == 50.0
    assert f"({cr.overlap_pct():g} % overlap, peak then" in method
    assert f"hours = clips × window ({cr.overlap_pct():g} % overlap" in text.split("## 2. Sets and splits")[1]
    assert "reruns `find_stem_split_mismatches`" in method


def test_limits_paragraph_is_derived_from_the_numbers(repo: Path) -> None:
    rep = cr.load_report(cr.Inputs.defaults(repo))
    text = cr.render(rep)
    limits = text.split("## 5. What limits quality")[1]
    # recorded oud: sessions 600 + collection 900 + internet_cc 300 = 1800 s;
    # separated oud gate: 1200 + 300 + 100 + 50 + 360 (contributor) = 2010 s
    assert "0.50 h of recorded oud plus 0.56 h of separated `other` stems" in limits
    # unclassified 240 + 300 + 200 s over the corpora that have a classifier (sessions, collection, internet, contributor)
    assert "0.21 h of the 1.62 h with a classifier (13 %)" in limits
    assert "1 files (0.07 h) are third-party suspects" in limits
    assert "4 fetched + 3 legacy objects give 0.25 h kept (4 skipped, 1 of them network errors" in limits
    assert "1 of 12 linked catalog objects not yet attempted" in limits
    assert "No internet material yet" not in limits and "No contributor recordings yet" not in limits
    assert "The smallest 30 s set is `ahmed_mix` with 2 clips" in limits  # ties with `leaky`; glob order decides
    # without the classified inventory the Ahmed sentences disappear and the Harvard ones stay
    ns = cr.build_parser().parse_args(["--classified", "none.jsonl", "--sets-10s-root", "nope"])
    limits2 = cr.render(cr.load_report(cr.Inputs.from_args(repo, ns))).split("## 5. What limits quality")[1]
    assert "third-party suspects" not in limits2 and "Harvard: 4 fetched" in limits2
    assert "No 10 s sets yet (`nope/*/captions.jsonl` not built yet)" in limits2


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def test_main_writes_atomically_and_prints_the_headline(repo: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out = cr.main(["--root", str(repo), "--out", "docs/data/CORPUS_REPORT.md"])
    assert out == repo / "docs/data/CORPUS_REPORT.md" and out.exists()
    assert not list(out.parent.glob("*.tmp"))
    text = out.read_text()
    assert text.startswith("# Corpus report (Phase 1, ")
    assert "## 1. Headline" in text and "## 2. Sets and splits" in text and "## 3. Everything excluded" in text
    captured = capsys.readouterr().out
    assert "| corpus | rights tier | publishable |" in captured
    summary = json.loads(captured.strip().splitlines()[-1])
    assert summary == {"out": "docs/data/CORPUS_REPORT.md", "bytes": len(text.encode()), "sets_30s": 3, "sets_10s": 1, "merged": 1}
    assert "torn" not in text and "Traceback" not in text
    # a second run overwrites in place and stays byte-identical
    cr.main(["--root", str(repo), "--quiet"])
    assert out.read_text() == text
    assert capsys.readouterr().out == ""


def test_absolute_overrides_and_out_outside_root(repo: Path, tmp_path_factory: pytest.TempPathFactory) -> None:
    elsewhere = tmp_path_factory.mktemp("elsewhere")  # not under the fixture root
    _jsonl(elsewhere / "sep.jsonl", SEPARATED[:1])
    out = cr.main(["--root", str(repo), "--separated", str(elsewhere / "sep.jsonl"), "--out", str(elsewhere / "R.md"), "--quiet"])
    assert out == elsewhere / "R.md"
    text = out.read_text()
    assert "1 mixes separated, 0 fail the oud gate" in text
    assert str(elsewhere / "sep.jsonl") in text  # a path outside the root renders absolute
