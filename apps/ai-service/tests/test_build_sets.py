"""Unit tests for scripts/build_sets.py — the Stage 2 set builder.

No corpus, GPU or network: sources are synthesised WAVs under tmp_path, the
ffmpeg decode and the tempo/tonic detectors are monkeypatched, and the
Harvard manifest/catalog are tiny fakes.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from scripts import build_sets as bs

SR = 32000


def _tone(seconds: float, freq: float = 220.0, amp: float = 0.3) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _noise(seconds: float, dbfs: float, seed: int = 0) -> np.ndarray:
    """White noise scaled to exactly `dbfs` RMS."""
    x = np.random.default_rng(seed).standard_normal(int(seconds * SR)).astype(np.float32)
    return (x / np.sqrt(np.mean(x**2)) * 10 ** (dbfs / 20)).astype(np.float32)


def _write_wav(path: Path, audio: np.ndarray) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, audio, SR, subtype="PCM_16")
    return path


def _read_rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _src(set_name: str = "ahmed_oud", **kw) -> bs.SourceFile:
    base = {
        "path": Path("/x/y.wav"), "name": "y.wav", "sha256": "ab" * 32, "song_group": "g",
        "project": "proj", "content": bs.SET_CONTENT.get(set_name, "full_mix"),
        "rights": bs.RIGHTS_HARVARD if set_name == "harvard_full" else bs.RIGHTS_AHMED,
        "genre_text": "",
    }
    base.update(kw)
    return bs.SourceFile(set_name=set_name, **base)


# ---------------------------------------------------------------------------
# Genre words and captions
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text, genre",
    [
        ("Side A. Track 3: Subcis Qaraami", "qaraami"),
        ("qarami culus xml.mp3", "qaraami"),
        ("balwo ilko No Effects#02.aif", "balwo"),
        ("_hele Qaraami Warya awliyo kaban kor 18.m4a", "heello"),  # first by position
        ("03 Qaraami awliyo heele.mp3", "qaraami"),
        ("heelo cod.m4a", "heello"),
        ("Heello Riftoon.mp3", "heello"),
        ("heele.mp3", "heello"),
        ("dhanto beat.m4a", "dhaanto"),
        ("Dhaanto kaban.m4a", "dhaanto"),
        ("buraanbur cod.m4a", "buraanbur"),
        ("Buraanburka.m4a", "buraanbur"),
        ("Output.aif", None),
        ("Laxanka Qaraamiga ah_mixed.mp3", "qaraami"),
        ("Side B. Track 3: Heeleelooy Qaraami", "qaraami"),  # 'Heeleelooy' is an interjection, not heello
        ("Heeleelooy", None),
        ("shele.mp3", None),  # 'hele' inside another word
    ],
)
def test_detect_genre(text: str, genre: str | None) -> None:
    assert bs.detect_genre(text) == genre


def test_caption_ahmed_oud_with_drums() -> None:
    src = _src("ahmed_oud", project="wadada", name="Qaraami kaban 200 wadada.m4a",
               genre_text="wadada Qaraami kaban 200 wadada.m4a", percussive_ratio=0.4)
    assert bs.build_caption(src, 100.0, "A") == (
        "qaraami, Somali traditional song, led by the oud (kaban) and hand drums, "
        "moderate at 100 BPM, pentatonic melody rooted on A, studio recording, clean, "
        "performed by Ahmed Ilkacase"
    )


def test_caption_ahmed_oud_default_genre_no_drums() -> None:
    src = _src("ahmed_oud", genre_text="18 may No Effects#02.aif", percussive_ratio=0.1)
    cap = bs.build_caption(src, 70.4, "D")
    assert cap.startswith("qaraami, Somali traditional song, led by the oud (kaban), slow at 70 BPM, ")
    assert "hand drums" not in cap
    assert cap.endswith("pentatonic melody rooted on D, studio recording, clean, performed by Ahmed Ilkacase")


def test_caption_ahmed_vocal_default_drops_tradition_phrase() -> None:
    src = _src("ahmed_vocal", genre_text="amare cod egland No Effects#03.aif")
    cap = bs.build_caption(src, 130.0, "G")
    assert cap == (
        "Somali song, led by vocals, lively at 130 BPM, pentatonic melody rooted on G, "
        "studio recording, clean, performed by Ahmed Ilkacase"
    )


def test_caption_ahmed_mix_full_instruments_and_project_genre() -> None:
    src = _src("ahmed_mix", genre_text="balwo ilko Output.aif", percussive_ratio=0.9)
    cap = bs.build_caption(src, 96.0, "C")
    assert cap.startswith("balwo, Somali traditional song, led by vocals, the oud (kaban) and hand drums, moderate at 96 BPM")
    assert cap.count("hand drums") == 1


def test_caption_harvard_has_tag_and_no_performer() -> None:
    src = _src("harvard_full", genre_text="Side A. Track 3: Subcis Qaraami Heeso Xul ah")
    cap = bs.build_caption(src, 96.0, "D")
    assert cap == (
        "qaraami, Somali traditional song, led by vocals, the oud (kaban) and hand drums, "
        "moderate at 96 BPM, pentatonic melody rooted on D, vintage cassette"
    )
    assert "performed by" not in cap
    plain = bs.build_caption(_src("harvard_full", genre_text="Side B. Track 1: Daalo"), 121.0, "E")
    assert plain == (
        "Somali song, led by vocals, the oud (kaban) and hand drums, lively at 121 BPM, "
        "pentatonic melody rooted on E, vintage cassette"
    )


def test_instrument_override_and_placeholders() -> None:
    src = _src("ahmed_oud", instruments=["oud", "vocals"], percussive_ratio=0.5)
    assert bs.instrument_phrase(src.content, src.percussive_ratio, src.instruments) == "the oud (kaban), vocals and hand drums"
    assert bs.instrument_phrase("voice", 0.2) == "vocals"
    assert bs.instrument_phrase("unknown", None) == "ensemble"
    template = bs.build_caption(src, None, None)
    assert "<tempo-word> at <N> BPM" in template and "rooted on <tonic>" in template


# ---------------------------------------------------------------------------
# Group-aware splits and leakage
# ---------------------------------------------------------------------------


def _files(n_groups: int, per_group: int) -> list[bs.SourceFile]:
    files = []
    for g in range(n_groups):
        for k in range(per_group):
            sha = f"{g:02d}{k:02d}".ljust(64, "f")
            files.append(_src(sha256=sha, song_group=f"song{g:03d}", name=f"f{g}_{k}"))
    return files


def test_group_splits_deterministic_and_group_consistent() -> None:
    files = _files(40, 3)
    a = bs.assign_splits(files)
    b = bs.assign_splits(list(reversed(files)))
    assert a == b
    assert set(a.values()) == {"train", "val", "test"}
    by_group: dict[str, set[str]] = {}
    for f in files:
        by_group.setdefault(f.song_group, set()).add(a[f.sha256])
    assert all(len(s) == 1 for s in by_group.values())
    groups = bs.group_split_map({f.song_group for f in files})
    assert sum(1 for v in groups.values() if v == "train") == 32
    assert sum(1 for v in groups.values() if v == "val") == 4
    assert sum(1 for v in groups.values() if v == "test") == 4
    assert bs.split_ratio_label() == "80/10/10"


def test_split_depends_on_universe_not_on_the_subset() -> None:
    files = _files(30, 2)
    universe = {f.song_group for f in files}
    full = bs.assign_splits(files, universe)
    subset = [f for f in files if f.song_group.endswith(("1", "5", "9"))]
    partial = bs.assign_splits(subset, universe)
    assert all(partial[f.sha256] == full[f.sha256] for f in subset)
    # without the universe the subset's own positions decide, and can differ
    assert bs.assign_splits(subset) != {f.sha256: full[f.sha256] for f in subset} or len(subset) < 3


def test_find_leakage_and_assert(capsys: pytest.CaptureFixture[str]) -> None:
    clean = [
        {"song_sha256": "a", "song_group": "g1", "split": "train"},
        {"song_sha256": "b", "song_group": "g1", "split": "train"},
        {"song_sha256": "c", "song_group": "g2", "split": "test"},
    ]
    assert bs.find_leakage(clean) == {"song_sha256": [], "song_group": []}
    bs.assert_no_leakage(clean)
    assert "LEAKAGE CHECK PASSED" in capsys.readouterr().out
    leaky = clean + [{"song_sha256": "d", "song_group": "g1", "split": "val"},
                     {"song_sha256": "a", "song_group": "g9", "split": "test"}]
    assert bs.find_leakage(leaky) == {"song_sha256": ["a"], "song_group": ["g1"]}
    with pytest.raises(SystemExit, match="LEAKAGE DETECTED"):
        bs.assert_no_leakage(leaky)


# ---------------------------------------------------------------------------
# Ahmed selection from a classified inventory
# ---------------------------------------------------------------------------


def _touch(path: Path) -> Path:
    """A stand-in source file whose bytes (and so sha256) depend on its path."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(str(path).encode("utf-8") * 4)
    return path


def test_select_ahmed_filters_and_universe(tmp_path: Path) -> None:
    root = tmp_path
    gb = root / "data/ahmed_raw/GarageBand"
    coll = root / "data/raw_incoming/oud_ilkacase"
    f_oud = _touch(gb / "wadada.band/Media/No Effects#02.aif")
    f_loop = _touch(gb / "wadada.band/Media/Cartoon Cymbal Hit.caf")
    f_voice = _touch(gb / "amare cod.band/Media/No Effects#03.aif")
    f_mix = _touch(gb / "wadada.band/Output/Output.aif")
    f_coll_oud = _touch(coll / "Qaraami kaban 200 wadada.m4a")
    f_coll_mixed = _touch(coll / "Laxanka Qaraamiga_mixed.mp3")
    f_coll_mixed_oud = _touch(coll / "QARAAMI ISKU SHUBAN KABAN BILAA COD AH 2022_mixed.mp3")
    f_outside = _touch(root / "elsewhere/oud.wav")
    f_ovw = _touch(root / "data/ahmed_raw/Logic/365/Audio Files/365_2#02.ovw")
    rows = [
        {"path": str(f_oud), "name": f_oud.name, "content": "oud", "song_group": "wadada", "percussive_ratio": 0.1},
        {"path": str(f_loop), "name": f_loop.name, "content": "oud", "excluded": True, "reason": "apple_loop"},
        {"path": str(f_voice), "name": f_voice.name, "content": "voice", "song_group": "amare", "sha256": "1" * 64},
        {"path": "data/ahmed_raw/GarageBand/wadada.band/Output/Output.aif", "name": f_mix.name, "content": "full_mix", "song_group": "wadada"},
        {"path": str(f_coll_oud), "name": f_coll_oud.name, "content": "oud", "source_group": "ahmed_collection", "sha256": "2" * 64},
        {"path": str(f_coll_oud), "name": "dup of the same bytes", "content": "oud", "source_group": "ahmed_collection", "sha256": "2" * 64},
        # collection "_mixed" files: ahmed_mix only, whatever the classifier said (voice here, oud there)
        {"path": str(f_coll_mixed), "name": f_coll_mixed.name, "content": "voice", "source_group": "ahmed_collection", "sha256": "3" * 64},
        {"path": str(f_coll_mixed_oud), "name": f_coll_mixed_oud.name, "content": "oud", "source_group": "ahmed_collection", "sha256": "a" * 64},
        {"path": str(f_outside), "name": f_outside.name, "content": "oud", "sha256": "4" * 64},
        {"path": str(f_ovw), "name": f_ovw.name, "content": "oud", "sha256": "5" * 64},
        {"path": str(gb / "missing.band/Media/x.aif"), "name": "x.aif", "content": "oud", "sha256": "6" * 64},
    ]
    sel = bs.select_ahmed(rows, "ahmed_oud", root=root)
    names = sorted(f.name for f in sel.files)
    assert names == sorted([f_oud.name, f_coll_oud.name])
    assert sel.skipped["excluded"] == 1
    assert sel.skipped["content_voice"] == 1 and sel.skipped["content_full_mix"] == 1
    assert sel.skipped["collection_mix"] == 2
    assert sel.skipped["duplicate_sha256"] == 1
    assert sel.skipped["outside_roots"] == 1
    assert sel.skipped["overview_cache"] == 1
    assert sel.skipped["missing_file"] == 1
    by_name = {f.name: f for f in sel.files}
    assert by_name[f_oud.name].sha256 == bs.full_sha256(f_oud)  # computed when the row has none
    assert by_name[f_oud.name].project == "wadada" and by_name[f_oud.name].song_group == "wadada"
    assert by_name[f_coll_oud.name].project == "ahmed_collection"
    assert by_name[f_coll_oud.name].extra["source_group"] == "ahmed_collection"
    assert all(f.rights == "ahmed_ilkacase_consented" for f in sel.files)
    # the split universe holds every non-excluded row's group, whatever its content
    assert {"wadada", "amare", "2" * 64, "3" * 64, "a" * 64} <= sel.universe
    assert sel.files == sorted(sel.files, key=lambda f: f.sha256)

    mix = bs.select_ahmed(rows, "ahmed_mix", root=root)
    assert sorted(f.name for f in mix.files) == sorted([f_mix.name, f_coll_mixed.name, f_coll_mixed_oud.name])
    assert all(f.content == "full_mix" for f in mix.files)
    assert "collection_mix" not in mix.skipped
    voc = bs.select_ahmed(rows, "ahmed_vocal", root=root)
    assert [f.name for f in voc.files] == [f_voice.name] and voc.files[0].project == "amare cod"
    assert voc.skipped["collection_mix"] == 2
    # no song lands in two sets, so a merge never sees one sha twice
    oud_shas, mix_shas, voc_shas = ({f.sha256 for f in s.files} for s in (sel, mix, voc))
    assert not (oud_shas & mix_shas) and not (oud_shas & voc_shas) and not (mix_shas & voc_shas)


# ---------------------------------------------------------------------------
# Harvard selection: superseded legacy sides, duplicates, catalog fallback
# ---------------------------------------------------------------------------


def _catalog_csv(path: Path, rows: list[tuple[str, str, str, str]]) -> Path:
    lines = [
        'Collection Title,"Somali Songs, 1955-1991"',
        "Collection Dates,1955-1991 (inclusive)",
        "Database Number,Component Title,Component Date,Container Info,Component Type,Digital Content Link,Level 2",
        "mus00044c00001,Audiocassettes,1955-1991,,Series,,",
    ]
    for cid, title, container, typ in rows:
        lines.append(f'{cid},"{title}",1955-1991,"{container}",{typ},https://x/{cid},')
    path.write_text("\n".join(lines) + "\n")
    return path


def test_select_harvard_excludes_superseded_sides(tmp_path: Path) -> None:
    root = tmp_path
    hr = root / "data/harvard_raw"
    files = {
        "side_12200": _touch(hr / "legacy/track_0001_Sahro_Axmed.mp3"),
        "trk_12200_legacy": _touch(hr / "legacy/track_0002_Side_A_Track_1_Wisiisi.mp3"),
        "trk_12200_fetched": _touch(hr / "AWM_SC_12200_B1_Daalo__c0090.mp3"),
        "trk_12200_bracket": _touch(hr / "AWM_SC_12200_B2_Durdur__c0095.mp3"),
        "side_12299": _touch(hr / "legacy/track_0500_Different_Singers.mp3"),
        "trk_12299_colon": _touch(hr / "legacy/track_0501_Side_A_Track_4_Dan_laaanta_dhaaxa.mp3"),
        "side_12250": _touch(hr / "legacy/track_0600_Legacy_only.mp3"),
        "trk_12250_legacy": _touch(hr / "legacy/track_0601_Side_A_Track_1_X.mp3"),
        "trk_12250_notype": _touch(hr / "legacy/track_0602_Side_A_Track_2_Colon.mp3"),
        "trk_12301_fetched": _touch(hr / "AWM_SC_12301_A1_Subcis__c0900.mp3"),
        "trk_12301_dup": _touch(hr / "AWM_SC_12301_A1_Subcis_again__c0901.mp3"),
        "mixed_tape_12301": _touch(hr / "AWM_SC_12301_Heeso_xul_ah__c0831.mp3"),
        "side_notype": _touch(hr / "legacy/track_0700_Notype.mp3"),
        "item_no_cassette": _touch(hr / "legacy/track_0258_Side_B_Track_1_Jacayl.mp3"),
    }
    manifest = [
        {"cid": "c0001", "status": "legacy", "type": "Item", "title": "Sahro Axmed and others", "cassette": "12200", "file": "data/harvard_raw/legacy/track_0001_Sahro_Axmed.mp3", "sha256": "a" * 64},
        {"cid": "c0081", "status": "legacy", "type": "Track", "title": "Side A. Track 1: Wisiisi", "parent": "Sahro Axmed and others", "cassette": "12200", "file": "data/harvard_raw/legacy/track_0002_Side_A_Track_1_Wisiisi.mp3", "sha256": "b" * 64},
        {"cid": "c0090", "status": "fetched", "type": "Track", "title": "Side B. Track 1: Daalo", "parent": "Sahro Axmed and others", "cassette": "12200", "file": "data/harvard_raw/AWM_SC_12200_B1_Daalo__c0090.mp3", "sha256": "c" * 64, "performer_line": "Performer: Somebody"},
        {"cid": "c0095", "status": "fetched", "type": "Track", "title": "[Side B. Track 2: Durdur], 1963-10-19", "parent": "Sahro Axmed and others", "cassette": "12200", "file": "data/harvard_raw/AWM_SC_12200_B2_Durdur__c0095.mp3", "sha256": "1" * 64},
        # the real cassette 12229 shape: a legacy whole side plus legacy tracks titled with colons
        {"cid": "c0500", "status": "legacy", "type": "Item", "title": "Different Singers", "cassette": "12299", "file": "data/harvard_raw/legacy/track_0500_Different_Singers.mp3", "sha256": "d" * 64},
        {"cid": "c0501", "status": "legacy", "type": "Track", "title": "Side A: Track 4: Dan la'aanta dhaaxa", "parent": "Different Singers", "cassette": "12299", "file": "data/harvard_raw/legacy/track_0501_Side_A_Track_4_Dan_laaanta_dhaaxa.mp3", "sha256": "2" * 64},
        {"cid": "c0600", "status": "legacy", "type": "Item", "title": "Legacy only", "cassette": "12250", "file": "data/harvard_raw/legacy/track_0600_Legacy_only.mp3", "sha256": "e" * 64},
        {"cid": "c0601", "status": "legacy", "type": "Track", "title": "Side A. Track 1: X", "cassette": "12250", "file": "data/harvard_raw/legacy/track_0601_Side_A_Track_1_X.mp3", "sha256": "f" * 64},
        {"cid": "c0602", "status": "legacy", "title": "Side A: Track 2: Colon", "cassette": "12250", "file": "data/harvard_raw/legacy/track_0602_Side_A_Track_2_Colon.mp3", "sha256": "3" * 64},
        {"cid": "c0900", "status": "fetched", "type": "Track", "title": "Side A. Track 1: Subcis Qaraami", "parent": "Heeso Xul ah", "cassette": "12301", "file": "data/harvard_raw/AWM_SC_12301_A1_Subcis__c0900.mp3", "sha256": "9" * 64},
        {"cid": "c0901", "status": "fetched", "type": "Track", "title": "Side A. Track 1: Subcis Qaraami (again)", "cassette": "12301", "file": "data/harvard_raw/AWM_SC_12301_A1_Subcis_again__c0901.mp3", "sha256": "9" * 64},
        # a Track-typed row that is really the cassette (own container, no track title): the finding aid has one
        {"cid": "c0831", "status": "fetched", "type": "Track", "title": "Heeso xul ah (Mixed Tape)", "cassette": "12301", "file": "data/harvard_raw/AWM_SC_12301_Heeso_xul_ah__c0831.mp3", "sha256": "4" * 64},
        {"cid": "c0700", "status": "legacy", "title": "Notype cassette", "file": "data/harvard_raw/legacy/track_0700_Notype.mp3", "sha256": "7" * 64},
        # an Item with a track-like title and no cassette anywhere: kept, and its project never carries the parent
        {"cid": "c0246", "status": "legacy", "type": "Item", "title": "Side B. Track 1: Jacayl Gaaxsannaa", "parent": "Samatar, Shamso and Qays", "cassette": "", "file": "data/harvard_raw/legacy/track_0258_Side_B_Track_1_Jacayl.mp3", "sha256": "5" * 64},
        {"cid": "c0999", "status": "skipped", "type": "Item", "title": "Skipped", "cassette": "12400", "reason": "cassette-level object"},
        {"cid": "c0998", "status": "fetched", "type": "Track", "title": "Side A. Track 2: Missing", "cassette": "12301", "file": "data/harvard_raw/AWM_SC_12301_A2_Missing.mp3", "sha256": "8" * 64},
        {"cid": "c0997", "status": "fetched", "type": "Track", "title": "Side A. Track 9: Outside", "cassette": "12301", "file": str(files["side_12200"].parent.parent.parent / "outside.mp3"), "sha256": "6" * 64},
    ]
    _touch(root / "data/outside.mp3")
    catalog = bs.load_catalog(_catalog_csv(tmp_path / "cat.csv", [
        ("c0001", "Sahro Axmed and others", "Box 1, Audiocassette AWM SC 12200", "Item"),
        ("c0700", "Notype cassette", "Box 3, Audiocassette AWM SC 12301", "Item"),
        ("c0900", "Side A. Track 1: Subcis Qaraami", "", "Track"),
        ("c0831", "Heeso xul ah (Mixed Tape)", "Box 1, Audiocassette AWM SC 12301", "Track"),
        ("c0246", "Side B. Track 1: Jacayl Gaaxsannaa", "", "Item"),
        ("c1234", "Never fetched track", "", "Track"),
    ]))
    assert set(catalog) == {"mus00044c00001", "c0001", "c0700", "c0900", "c0831", "c0246", "c1234"}
    sel = bs.select_harvard(manifest, catalog, root=root)
    kept = {f.extra["cid"] for f in sel.files}
    assert kept == {"c0081", "c0090", "c0095", "c0501", "c0601", "c0602", "c0900", "c0246"}
    assert sel.skipped["superseded_by_fetched_tracks"] == 3  # c0001 (12200), c0700 (12301 via the catalog container), c0831 (mis-typed cassette)
    assert sel.skipped["superseded_by_legacy_tracks"] == 2  # c0600 (12250), c0500 (12299: colon-titled legacy tracks)
    assert sel.skipped["duplicate_sha256"] == 1
    assert sel.skipped["status_skipped"] == 1
    assert sel.skipped["missing_file"] == 1
    assert sel.skipped["outside_roots"] == 1
    by_cid = {f.extra["cid"]: f for f in sel.files}
    assert by_cid["c0900"].project == "AWM SC 12301" and by_cid["c0900"].song_group == "c0900"
    assert by_cid["c0900"].rights == "harvard_research_only" and by_cid["c0900"].content == "full_mix"
    assert bs.detect_genre(by_cid["c0900"].genre_text) == "qaraami"
    assert "performed by" not in bs.build_caption(by_cid["c0090"], 100.0, "A")
    assert by_cid["c0246"].project == "AWM SC unknown (c0246)" and by_cid["c0246"].extra["whole_side"]
    assert all("Samatar" not in f.project for f in sel.files)
    assert not by_cid["c0501"].extra["whole_side"] and not by_cid["c0095"].extra["whole_side"]
    # split universe = every Item|Track of the finding aid, so unfetched tracks already have a slot
    assert sel.universe == {"c0001", "c0700", "c0900", "c0831", "c0246", "c1234"}
    assert bs.select_harvard(manifest, {}, root=root).universe == {r["cid"] for r in manifest}


@pytest.mark.parametrize(
    "title",
    [
        "Side A. Track 1: Wisiisi",
        "Side A: Track 4: Dan la'aanta dhaaxa",
        "Side B: Track 1: Suleekha",
        "[Side A. Track 1: Isa soo maqiiq], 1964-01-12",
        "[Side B. Track 4: Hayaan Qaraami]",
        "Side B. Track [6?]: Bal u fiiro yeesha",
        "Side A. (Songs of the Independence Struggle) Track 1: Way dagatay maantee",
        "Side A: Axmed Cali Cigaal (Ahmrf Ali Egal). Track 1: Nagi",
        "Side B: Cigaal, Seynab Cige and Khadra Daahir. Track 4: Sharcigu ma ku joojiyaa",
    ],
)
def test_track_title_shapes_of_the_finding_aid(title: str) -> None:
    assert bs.TRACK_TITLE_RE.match(title)
    assert not bs.is_whole_side({"title": title}, None)  # no type anywhere: the title decides
    assert not bs.is_whole_side({"type": "Track", "title": title}, None)
    assert bs.is_whole_side({"type": "Item", "title": title}, None)  # the type wins over the title


def test_is_whole_side_rules() -> None:
    assert bs.is_whole_side({"type": "Item", "title": "Side A. Track 1: X"}, None)
    assert bs.is_whole_side({"type": "Item", "title": "Sahro Axmed and others"}, None)
    # a Track row without its own container is a track whatever its title says
    assert not bs.is_whole_side({"type": "Track", "title": "Sahro Axmed and others"}, None)
    assert not bs.is_whole_side({"type": "Track", "title": "Sahro Axmed and others"}, {"Container Info": ""})
    # a Track row with its own AWM SC container and no track title is a mis-typed cassette
    assert bs.is_whole_side({"type": "Track", "title": "Heeso xul ah (Mixed Tape)"}, {"Container Info": "Box 1, Audiocassette AWM SC 12294"})
    assert not bs.is_whole_side({"type": "Track", "title": "Side A. Track 1: X"}, {"Container Info": "Box 1, Audiocassette AWM SC 12294"})
    # type and title from the catalog when the manifest row lacks them
    assert not bs.is_whole_side({"title": ""}, {"Component Type": "Track", "Component Title": "Side A. Track 2: Y"})
    assert bs.is_whole_side({}, {"Component Type": "Item", "Component Title": "Side A. Track 2: Y"})
    # no type anywhere: the title decides
    assert bs.is_whole_side({"title": "Different Singers"}, None)
    assert not bs.is_whole_side({"title": "Side A: Track 4: Dan la'aanta dhaaxa"}, None)
    assert not bs.TRACK_TITLE_RE.match("Different Singers")
    assert not bs.TRACK_TITLE_RE.match("Heeso xul ah (Mixed Tape)")
    assert bs.catalog_cassette("Box 1, Audiocassette AWM SC 12200") == "12200"
    assert bs.catalog_cassette("") == ""


# ---------------------------------------------------------------------------
# Cutting
# ---------------------------------------------------------------------------


def test_cut_clips_overlap_quiet_drop_and_loudness() -> None:
    audio = _tone(75.0)
    clips = list(bs.cut_clips(audio, 30.0))
    assert [i for i, _ in clips] == [0, 1, 2, 3]  # starts 0, 15, 30, 45 s
    assert all(c.shape == (30 * SR,) and c.dtype == np.float32 for _, c in clips)
    assert all(np.max(np.abs(c)) <= bs.PEAK + 1e-6 for _, c in clips)
    import pyloudnorm as pyln

    meter = pyln.Meter(SR)
    assert meter.integrated_loudness(clips[0][1].astype(np.float64)) == pytest.approx(bs.TARGET_LUFS, abs=0.5)
    quiet = audio.copy()
    quiet[30 * SR:60 * SR] *= 1e-4
    kept = [i for i, _ in bs.cut_clips(quiet, 30.0)]
    assert 2 not in kept and 0 in kept
    assert list(bs.cut_clips(_tone(10.0), 30.0)) == []
    assert bs.window_hop(30.0) == (30 * SR, 15 * SR)


def test_cut_clips_drops_clips_without_finite_loudness() -> None:
    # digital silence passes the relative quiet-drop gate (file RMS is silence too) but has -inf loudness
    assert list(bs.cut_clips(np.zeros(70 * SR, dtype=np.float32), 30.0)) == []


def test_silent_source_floor() -> None:
    assert bs.rms_dbfs(np.zeros(0, dtype=np.float32)) == -180.0
    assert bs.is_silent_source(np.zeros(70 * SR, dtype=np.float32))
    assert bs.is_silent_source(_noise(70.0, -45.0))  # armed-but-unplayed take: passes the inventory's silence test
    assert bs.is_silent_source(_tone(70.0, amp=0.005))  # -49 dBFS
    assert not bs.is_silent_source(_tone(70.0, amp=0.3))  # -13.5 dBFS
    assert not bs.is_silent_source(_tone(70.0, amp=0.02))  # -37 dBFS: quiet but real
    assert bs.rms_dbfs(_noise(10.0, -45.0)) == pytest.approx(-45.0, abs=0.01)


# ---------------------------------------------------------------------------
# End to end on synthesised sources (decode + detectors monkeypatched), resume, merge
# ---------------------------------------------------------------------------


def _patch_decode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bs, "decode_mono32", lambda p: sf.read(p, dtype="float32")[0])
    monkeypatch.setattr(bs, "tempo_bpm", lambda clip: 100.0)
    monkeypatch.setattr(bs, "detect_from_audio", lambda clip, sr: {"tonic_name": "A"})


def _forbid_decode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bs, "decode_mono32", lambda p: (_ for _ in ()).throw(AssertionError(f"decode called on resume: {p}")))


@pytest.fixture
def fake_corpus(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, list[dict]]:
    root = tmp_path
    coll = root / "data/raw_incoming/oud_ilkacase"
    a = _write_wav(coll / "Qaraami kaban wadada.wav", _tone(46.0, 220.0))
    b = _write_wav(coll / "riftoon qaraami hoos.wav", _tone(31.0, 330.0))
    v = _write_wav(root / "data/ahmed_raw/GarageBand/amare cod.band/Media/No Effects#02.wav", _tone(31.0, 440.0))
    rows = [
        {"path": str(a), "name": a.name, "content": "oud", "song_group": "wadada", "source_group": "ahmed_collection", "percussive_ratio": 0.5, "duration_s": 46.0},
        {"path": str(b), "name": b.name, "content": "oud", "song_group": "riftoon", "source_group": "ahmed_collection", "sha256": bs.full_sha256(b)},
        {"path": str(v), "name": v.name, "content": "voice", "song_group": "amare", "sha256": bs.full_sha256(v)},
    ]
    _patch_decode(monkeypatch)
    return root, rows


def test_build_set_end_to_end_resume_and_merge(fake_corpus: tuple[Path, list[dict]], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    root, rows = fake_corpus
    out_root = root / "data/sets"
    sel = bs.select_ahmed(rows, "ahmed_oud", root=root)
    summary = bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    out = capsys.readouterr().out
    assert "LEAKAGE CHECK PASSED" in out and summary["clips_total"] == 3  # 46 s -> 2 clips, 31 s -> 1
    assert summary["files"] == 2 and summary["resumed_files"] == 0 and summary["orphan_clips"] == 0
    caps = _read_rows(out_root / "ahmed_oud/captions.jsonl")
    assert len(caps) == 3
    required = {"clip_path", "caption", "song_sha256", "song_group", "split", "source", "source_name",
                "source_path", "rights", "content", "project", "tokens_dir", "seconds", "caption_version"}
    for r in caps:
        assert required <= set(r)
        assert r["source"] == "ahmed_oud" and r["rights"] == "ahmed_ilkacase_consented"
        assert r["tokens_dir"] == "data/sets/ahmed_oud/tokens"
        assert r["seconds"] == 30.0 and r["caption_version"] == bs.CAPTION_VERSION
        assert not Path(r["clip_path"]).is_absolute() and r["clip_path"].startswith(f"data/sets/ahmed_oud/clips/{r['split']}/ahmed_oud_")
        assert r["clip_path"].startswith(f"data/sets/ahmed_oud/clips/{r['split']}/ahmed_oud_{r['song_sha256'][:12]}_seg")
        assert r["source_path"].startswith("data/raw_incoming/oud_ilkacase/")
        assert (root / r["clip_path"]).exists()
        audio, sr = sf.read(root / r["clip_path"])
        assert sr == SR and len(audio) == 30 * SR
        assert "performed by Ahmed Ilkacase" in r["caption"] and "studio recording, clean" in r["caption"]
        assert r["caption"].startswith("qaraami, Somali traditional song, led by the oud (kaban)")
    drums = [r for r in caps if r["song_group"] == "wadada"]
    assert all("and hand drums" in r["caption"] for r in drums) and len(drums) == 2
    card = (out_root / "ahmed_oud/SET_CARD.md").read_text()
    assert "ahmed_ilkacase_consented" in card and "Caption examples" in card and "Clips per split" in card
    # the card's numbers come from the code, not from prose
    assert f"{bs.TARGET_LUFS:g} LUFS" in card and f"{bs.QUIET_DROP_DB:g} dB under" in card
    assert f"peak-normalised to {bs.PEAK:g}" in card and "50 % overlap" in card and "Song-level 80/10/10" in card

    # resume: nothing is decoded again, rows are identical
    _forbid_decode(monkeypatch)
    again = bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    assert again["resumed_files"] == 2 and again["clips_total"] == 3
    assert _read_rows(out_root / "ahmed_oud/captions.jsonl") == caps

    # a split change on resume moves the clips instead of re-cutting
    moved_split = "test" if caps[0]["split"] != "test" else "val"
    monkeypatch.setattr(bs, "assign_splits", lambda files, universe=(): {f.sha256: moved_split for f in files})
    moved = bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    assert moved["clips_per_split"][moved_split] == 3 and moved["resumed_files"] == 2 and moved["orphan_clips"] == 0
    assert all((root / r["clip_path"]).exists() for r in _read_rows(out_root / "ahmed_oud/captions.jsonl"))
    monkeypatch.undo()

    # merge with the vocal set: consistent splits come from the shared universe
    _patch_decode(monkeypatch)
    bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    bs.build_set("ahmed_vocal", bs.select_ahmed(rows, "ahmed_vocal", root=root), out_root, seconds=30.0, root=root)
    merged = bs.merge_sets(["ahmed_oud", "ahmed_vocal"], out_root, out_root / "ahmed_all_captions.jsonl", root=root)
    assert merged["rows"] == 4 and merged["per_set"]["ahmed_vocal"]["train"] + merged["per_set"]["ahmed_vocal"]["val"] + merged["per_set"]["ahmed_vocal"]["test"] == 1
    merged_rows = _read_rows(out_root / "ahmed_all_captions.jsonl")
    assert {r["tokens_dir"] for r in merged_rows} == {"data/sets/ahmed_oud/tokens", "data/sets/ahmed_vocal/tokens"}
    assert "LEAKAGE CHECK PASSED" in capsys.readouterr().out


def test_limit_run_keeps_the_other_sources_rows(fake_corpus: tuple[Path, list[dict]], monkeypatch: pytest.MonkeyPatch) -> None:
    root, rows = fake_corpus
    out_root = root / "data/sets"
    sel = bs.select_ahmed(rows, "ahmed_oud", root=root)
    bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    before = _read_rows(out_root / "ahmed_oud/captions.jsonl")
    assert len(before) == 3
    # a --limit 1 smoke run on the built set must not wipe the second source's rows
    _forbid_decode(monkeypatch)
    partial = bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, limit=1, root=root)
    assert partial["files"] == 1 and partial["selected_files"] == 2 and partial["resumed_files"] == 1
    assert partial["clips_total"] == 3 and partial["orphan_clips"] == 0
    first_sha = sel.files[0].sha256
    assert partial["kept_rows"] == sum(1 for r in before if r["song_sha256"] != first_sha)
    assert partial["kept_sources"] == 1
    after = _read_rows(out_root / "ahmed_oud/captions.jsonl")
    assert sorted(after, key=lambda r: r["clip_path"]) == sorted(before, key=lambda r: r["clip_path"])
    assert all((root / r["clip_path"]).exists() for r in after)
    # the merge still sees the whole set
    assert bs.merge_sets(["ahmed_oud"], out_root, out_root / "m.jsonl", root=root)["rows"] == 3


def test_resume_recuts_on_window_or_caption_version_change(fake_corpus: tuple[Path, list[dict]], monkeypatch: pytest.MonkeyPatch) -> None:
    root, rows = fake_corpus
    out_root = root / "data/sets"
    sel = bs.select_ahmed(rows, "ahmed_oud", root=root)
    bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    # another window: nothing is resumable, every source is re-cut with the new window
    recut = bs.build_set("ahmed_oud", sel, out_root, seconds=20.0, root=root)
    assert recut["resumed_files"] == 0 and recut["clips_total"] == 5  # 46 s -> 3 windows of 20 s, 31 s -> 2
    caps = _read_rows(out_root / "ahmed_oud/captions.jsonl")
    assert all(r["seconds"] == 20.0 for r in caps)
    assert all(len(sf.read(root / r["clip_path"])[0]) == 20 * SR for r in caps)
    # same window again: resumed
    _forbid_decode(monkeypatch)
    assert bs.build_set("ahmed_oud", sel, out_root, seconds=20.0, root=root)["resumed_files"] == 2
    # a caption template bump (or rows from before the version field existed) forces a re-cut
    stale = [dict(r, caption_version=0) for r in caps]
    (out_root / "ahmed_oud/captions.jsonl").write_text("".join(json.dumps(r) + "\n" for r in stale))
    _patch_decode(monkeypatch)
    assert bs.build_set("ahmed_oud", sel, out_root, seconds=20.0, root=root)["resumed_files"] == 0
    legacy = [{k: v for k, v in r.items() if k not in ("seconds", "caption_version")} for r in caps]
    (out_root / "ahmed_oud/captions.jsonl").write_text("".join(json.dumps(r) + "\n" for r in legacy))
    assert not bs.row_is_resumable(legacy[0], 20.0) and bs.row_is_resumable(caps[0], 20.0)
    assert bs.build_set("ahmed_oud", sel, out_root, seconds=20.0, root=root)["resumed_files"] == 0


def test_deselected_sources_leave_reported_orphans_pruned_on_request(fake_corpus: tuple[Path, list[dict]], capsys: pytest.CaptureFixture[str]) -> None:
    root, rows = fake_corpus
    out_root = root / "data/sets"
    sel = bs.select_ahmed(rows, "ahmed_oud", root=root)
    bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    all_rows = _read_rows(out_root / "ahmed_oud/captions.jsonl")
    stray = out_root / "ahmed_oud/clips/train/ahmed_oud_deadbeef0000_seg000.wav"
    _write_wav(stray, _tone(1.0))
    # a full (non-limit) rebuild with one source de-selected drops its rows; its clips become orphans
    smaller = bs.Selection(files=sel.files[:1], skipped=sel.skipped, universe=sel.universe)
    summary = bs.build_set("ahmed_oud", smaller, out_root, seconds=30.0, root=root)
    gone = [r for r in all_rows if r["song_sha256"] != sel.files[0].sha256]
    assert summary["clips_total"] == len(all_rows) - len(gone) and summary["kept_rows"] == 0
    assert summary["orphan_clips"] == len(gone) + 1 and summary["pruned_clips"] == 0
    assert all((root / r["clip_path"]).exists() for r in gone) and stray.exists()
    assert "orphan clip files" in capsys.readouterr().err
    assert {r["song_sha256"] for r in _read_rows(out_root / "ahmed_oud/captions.jsonl")} == {sel.files[0].sha256}
    assert set(summary["orphan_examples"]) <= {r["clip_path"] for r in gone} | {bs.rel_str(stray, root)}
    pruned = bs.build_set("ahmed_oud", smaller, out_root, seconds=30.0, root=root, prune_orphans=True)
    assert pruned["pruned_clips"] == len(gone) + 1 and pruned["orphan_clips"] == len(gone) + 1
    assert not any((root / r["clip_path"]).exists() for r in gone) and not stray.exists()
    assert f"(no caption row): {len(gone) + 1} (deleted: {len(gone) + 1})" in (out_root / "ahmed_oud/SET_CARD.md").read_text()
    assert bs.build_set("ahmed_oud", smaller, out_root, seconds=30.0, root=root)["orphan_clips"] == 0


def test_build_set_skips_silent_sources(fake_corpus: tuple[Path, list[dict]], capsys: pytest.CaptureFixture[str]) -> None:
    root, rows = fake_corpus
    coll = root / "data/raw_incoming/oud_ilkacase"
    zeros = _write_wav(coll / "No Effects#04.wav", np.zeros(70 * SR, dtype=np.float32))
    floor = _write_wav(coll / "No Effects#05.wav", _noise(70.0, -45.0))
    rows = rows + [
        {"path": str(zeros), "name": zeros.name, "content": "oud", "song_group": "take4", "source_group": "ahmed_collection", "sha256": bs.full_sha256(zeros)},
        {"path": str(floor), "name": floor.name, "content": "oud", "song_group": "take5", "source_group": "ahmed_collection", "sha256": bs.full_sha256(floor)},
    ]
    sel = bs.select_ahmed(rows, "ahmed_oud", root=root)
    assert len(sel.files) == 4
    summary = bs.build_set("ahmed_oud", sel, root / "data/sets", seconds=30.0, root=root)
    assert summary["failed"] == {"silent_source": 2} and summary["clips_total"] == 3
    caps = _read_rows(root / "data/sets/ahmed_oud/captions.jsonl")
    assert {r["source_name"] for r in caps} == {"Qaraami kaban wadada.wav", "riftoon qaraami hoos.wav"}
    err = capsys.readouterr().err
    assert "silent source skipped" in err and "No Effects#05.wav" in err
    assert not list((root / "data/sets/ahmed_oud/clips").rglob(f"*{bs.full_sha256(floor)[:12]}*"))


def test_dry_run_previews_without_writing(fake_corpus: tuple[Path, list[dict]], capsys: pytest.CaptureFixture[str]) -> None:
    root, rows = fake_corpus
    sel = bs.select_ahmed(rows, "ahmed_oud", root=root)
    summary = bs.build_set("ahmed_oud", sel, root / "data/sets", dry_run=True, limit=1, root=root)
    assert summary["files"] == 1 and summary["dry_run"] and len(summary["preview"]) == 1
    assert "<tonic>" in summary["preview"][0]["caption"]
    assert not (root / "data/sets").exists()
    assert json.loads(capsys.readouterr().out)["set"] == "ahmed_oud"


def test_merge_detects_cross_set_leakage_and_duplicates(tmp_path: Path) -> None:
    out_root = tmp_path / "sets"

    def _set(name: str, split: str, sha: str, group: str) -> None:
        (out_root / name).mkdir(parents=True, exist_ok=True)
        row = {"clip_path": f"data/sets/{name}/clips/{split}/{name}_{sha[:12]}_seg000.wav", "caption": "c",
               "song_sha256": sha, "song_group": group, "split": split, "source": name, "tokens_dir": f"data/sets/{name}/tokens"}
        (out_root / name / "captions.jsonl").write_text(json.dumps(row) + "\n")

    _set("a", "train", "1" * 64, "song1")
    _set("b", "test", "2" * 64, "song1")  # same song group, other split
    with pytest.raises(SystemExit, match="LEAKAGE DETECTED"):
        bs.merge_sets(["a", "b"], out_root, tmp_path / "ab.jsonl", root=tmp_path)
    assert not (tmp_path / "ab.jsonl").exists()
    _set("b", "train", "2" * 64, "song1")
    summary = bs.merge_sets(["a", "b"], out_root, tmp_path / "ab.jsonl", root=tmp_path)
    assert summary["rows"] == 2 and summary["per_split"] == {"train": 2, "val": 0, "test": 0}
    assert summary["songs_in_several_sets"] == 0
    # the same song in two sets (two captions for one audio) is an error, nothing is written
    _set("b", "train", "1" * 64, "song1")
    with pytest.raises(SystemExit, match="DUPLICATE SONGS ACROSS SETS"):
        bs.merge_sets(["a", "b"], out_root, tmp_path / "dup.jsonl", root=tmp_path)
    assert not (tmp_path / "dup.jsonl").exists()
    with pytest.raises(SystemExit, match="no captions"):
        bs.merge_sets(["a", "missing"], out_root, tmp_path / "x.jsonl", root=tmp_path)


# ---------------------------------------------------------------------------
# CLI: the out-root guard and an end-to-end run through main()
# ---------------------------------------------------------------------------


def test_main_refuses_out_root_outside_data_unless_allowed(fake_corpus: tuple[Path, list[dict]], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    root, rows = fake_corpus
    monkeypatch.setattr(bs, "REPO", root)
    classified = root / "data/inventory/ahmed_classified.jsonl"
    classified.parent.mkdir(parents=True)
    classified.write_text("".join(json.dumps(r) + "\n" for r in rows))
    outside = root / "scratch/sets"
    with pytest.raises(SystemExit) as exc:
        bs.main(["--set", "ahmed_oud", "--classified", str(classified), "--out-root", str(outside), "--dry-run"])
    assert exc.value.code == 2 and "outside" in capsys.readouterr().err
    assert not outside.exists()
    bs.main(["--set", "ahmed_oud", "--classified", str(classified), "--out-root", str(outside), "--dry-run", "--allow-outside-data"])
    assert json.loads(capsys.readouterr().out)["dry_run"] and not outside.exists()
    # the default out-root (data/sets, repo-relative) needs no flag; a real run writes clips and captions
    bs.main(["--set", "ahmed_oud", "--classified", "data/inventory/ahmed_classified.jsonl"])
    out = capsys.readouterr().out
    assert "LEAKAGE CHECK PASSED" in out
    caps = _read_rows(root / "data/sets/ahmed_oud/captions.jsonl")
    assert len(caps) == 3 and all((root / r["clip_path"]).exists() for r in caps)
    bs.main(["--set", "ahmed_vocal", "--classified", "data/inventory/ahmed_classified.jsonl", "--limit", "1"])
    capsys.readouterr()
    bs.main(["--merge", "ahmed_all", "--sets", "ahmed_oud", "ahmed_vocal"])
    assert "LEAKAGE CHECK PASSED" in capsys.readouterr().out
    assert len(_read_rows(root / "data/sets/ahmed_all_captions.jsonl")) == 4
