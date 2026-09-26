"""Unit tests for scripts/build_sets.py — the Stage 2 set builder (caption template v2).

No corpus, GPU or network: sources are synthesised WAVs under tmp_path, the
ffmpeg decode, the tempo/tonic detectors and the CREPE scorer are
monkeypatched, and the Harvard manifest/catalog, the classified inventories
and the Demucs separation index are tiny fakes.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

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
        "rights": bs.set_default_rights(set_name) or bs.RIGHTS_AHMED,
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
        # v2: shanto and the Somali definite forms
        ("Shanto beat 2.m4a", "shanto"),
        ("Shantada Hargeysa.mp3", "shanto"),
        ("Side A. Track 2: Dhaantada", "dhaanto"),
        ("Dhantada.m4a", "dhaanto"),
        ("Balwada iyo Heellada", "balwo"),
        ("Heellada Xamar.mp3", "heello"),
        ("Heelada.mp3", "heello"),
        ("Qaraamiga.m4a", "qaraami"),
        ("Balwadii hore", "balwo"),
        ("shan wiil.mp3", None),  # 'shan' (five) is not shanto
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


def _harvard_src(genre_text: str, **kw) -> bs.SourceFile:
    """A Harvard SourceFile as select_harvard builds it: the instruments come from the catalog text."""
    return _src("harvard_full", genre_text=genre_text, instruments=bs.harvard_instruments(genre_text), **kw)


def test_caption_harvard_has_tag_and_no_performer() -> None:
    src = _harvard_src("Side A. Track 3: Subcis Qaraami (kaban) Heeso Xul ah")
    cap = bs.build_caption(src, 96.0, "D")
    assert cap == (
        "qaraami, Somali traditional song, led by vocals and the oud (kaban), "
        "moderate at 96 BPM, pentatonic melody rooted on D, vintage cassette, 1955–1991"
    )
    assert "performed by" not in cap
    plain = bs.build_caption(_harvard_src("Side B. Track 1: Daalo"), 121.0, "E")
    assert plain == (
        "Somali song, led by vocals and ensemble, lively at 121 BPM, "
        "pentatonic melody rooted on E, vintage cassette, 1955–1991"
    )
    # Harvard rows carry no percussive_ratio and the catalog never supports drums: "hand drums" is never spoken
    assert "hand drums" not in bs.build_caption(_harvard_src("Side A. Track 1: Qaraami with kaban and drums", percussive_ratio=0.9), 96.0, "D")
    # a performer field on a Harvard row is never spoken
    assert "performed by" not in bs.build_caption(_harvard_src("x", performer="Somebody"), 96.0, "D")


def test_instrument_override_and_placeholders() -> None:
    src = _src("ahmed_oud", instruments=["oud", "vocals"], percussive_ratio=0.5)
    assert bs.instrument_phrase(src.content, src.percussive_ratio, src.instruments) == "the oud (kaban), vocals and hand drums"
    assert bs.instrument_phrase("voice", 0.2) == "vocals"
    assert bs.instrument_phrase("unknown", None) == "ensemble"
    template = bs.build_caption(src, None, None)
    assert "<tempo-word> at <N> BPM" in template and "rooted on <tonic>" in template
    assert "tuned" not in template


def test_caption_v2_tuning_tag() -> None:
    assert bs.tuning_tag(None) is None
    assert bs.tuning_tag(14.9) is None and bs.tuning_tag(-14.99) is None
    assert bs.tuning_tag(-15.0) == "tuned 15 cents flat of A440"
    assert bs.tuning_tag(22.6) == "tuned 23 cents sharp of A440"
    assert bs.tuning_tag(float("nan")) is None
    src = _src("ahmed_oud", genre_text="Qaraami kaban.m4a")
    assert bs.build_caption(src, 100.0, "D", -23.4) == (
        "qaraami, Somali traditional song, led by the oud (kaban), moderate at 100 BPM, "
        "pentatonic melody rooted on D, tuned 23 cents flat of A440, studio recording, clean, "
        "performed by Ahmed Ilkacase"
    )
    assert bs.build_caption(src, 100.0, "D", 4.0) == bs.build_caption(src, 100.0, "D")
    assert bs.CAPTION_VERSION == 2


def test_caption_sep_sets_name_only_the_stem() -> None:
    # the mix had drums (percussive 0.9) and a classifier instrument list: the oud stem claims neither
    oud = _src("sep_oud", genre_text="wadada Output.aif", percussive_ratio=0.9, instruments=["vocals", "oud", "drums"])
    assert bs.build_caption(oud, 100.0, "A") == (
        "Somali song, led by the oud (kaban), moderate at 100 BPM, pentatonic melody rooted on A, "
        "studio recording, clean, performed by Ahmed Ilkacase"
    )
    voc = _src("sep_vocal", genre_text="Laxanka Qaraamiga ah_mixed.mp3", percussive_ratio=0.9)
    assert bs.build_caption(voc, 88.0, "G", 17.0) == (
        "qaraami, Somali traditional song, led by vocals (unaccompanied), moderate at 88 BPM, "
        "pentatonic melody rooted on G, tuned 17 cents sharp of A440, studio recording, clean, "
        "performed by Ahmed Ilkacase"
    )
    hv = _src("harvard_sep_oud", genre_text="Side A. Track 1: Dhaantada")
    cap = bs.build_caption(hv, 130.0, "E")
    assert cap == ("dhaanto, Somali traditional song, led by the oud (kaban), lively at 130 BPM, "
                   "pentatonic melody rooted on E, vintage cassette, 1955–1991")
    assert bs.instrument_phrase("sep_vocal", 0.9, ["oud"]) == "vocals (unaccompanied)"
    assert "hand drums" not in bs.instrument_phrase("sep_oud", 0.99)


def test_recording_tag_and_performer_by_rights_tier() -> None:
    assert bs.recording_tag(bs.RIGHTS_AHMED) == "studio recording, clean"
    assert bs.recording_tag(bs.RIGHTS_HARVARD, 1963) == "vintage cassette, 1955–1991"
    assert bs.recording_tag("internet_cc") == "archival recording"
    assert bs.recording_tag("internet_cc", 1978) == "archival recording"
    assert bs.recording_tag("internet_cc", 1999) == "archival recording"
    assert bs.recording_tag("internet_cc", 2000) == "studio recording"
    assert bs.recording_tag("internet_cc", 2015) == "studio recording"
    assert bs.recording_tag("contrib_hodan_consented", 2024) == "studio recording, clean"
    assert bs.recording_tag("something_else") == "archival recording"
    internet = _src("internet_oud", rights="internet_cc", year=2015, performer="Cabdi Holland", genre_text="Qaraami")
    cap = bs.build_caption(internet, 100.0, "A")
    assert cap.endswith("pentatonic melody rooted on A, studio recording, performed by Cabdi Holland")
    assert "Ahmed" not in cap
    undated = _src("internet_mix", rights="internet_cc", genre_text="x")
    assert bs.build_caption(undated, 100.0, "A").endswith("archival recording")
    contrib = _src("hodan_vocal", rights="contrib_hodan_consented", genre_text="x")
    assert bs.build_caption(contrib, 100.0, "A").endswith("studio recording, clean")


def test_row_year() -> None:
    assert bs.row_year({"year": 1978}) == 1978
    assert bs.row_year({"date": "2015-03-01"}) == 2015
    assert bs.row_year({"upload_date": "20240115"}) == 2024
    assert bs.row_year({"metadata": {"year": "c. 1965"}}) == 1965
    assert bs.row_year({"year": "", "date": None}) is None
    assert bs.row_year({}) is None
    assert bs.row_year({"date": "12345"}) is None


def test_set_names_known_generic_and_reserved() -> None:
    assert bs.SETS == ("ahmed_oud", "ahmed_mix", "ahmed_vocal", "harvard_full",
                       "sep_oud", "sep_vocal", "harvard_sep_oud", "harvard_sep_vocal")
    for name in bs.SETS:
        assert bs.validate_set_name(name) == name and not bs.is_generic_set(name)
    assert bs.validate_set_name("internet_oud") == "internet_oud" and bs.is_generic_set("internet_oud")
    assert bs.is_generic_set("contrib_hodan_vocal") and bs.is_generic_set("yt_cc_2024_mix")
    for bad in ("harvard_oud", "ahmed_drums", "sep_mix", "Internet_oud", "internet-oud", "internet_", "oud"):
        with pytest.raises(ValueError, match="unknown set"):
            bs.validate_set_name(bad)
    assert bs.set_content("internet_oud") == "oud" and bs.set_content("x_mix") == "full_mix"
    assert bs.set_content("x_vocal") == "voice" and bs.set_content("harvard_full") == "full_mix"
    assert bs.set_content("harvard_sep_vocal") == "sep_vocal" and bs.set_content("sep_oud") == "sep_oud"
    assert bs.set_default_rights("harvard_sep_oud") == bs.RIGHTS_HARVARD
    assert bs.set_default_rights("sep_vocal") == bs.RIGHTS_AHMED
    assert bs.set_default_rights("internet_oud") is None


def test_clip_stem_duration_infix() -> None:
    sha = "ab" * 32
    assert bs.clip_stem("ahmed_oud", sha, 3) == "ahmed_oud_abababababab_seg003"
    assert bs.clip_stem("ahmed_oud", sha, 3, 30.0) == "ahmed_oud_abababababab_seg003"
    assert bs.clip_stem("sep_oud", sha, 0, 10.0) == "sep_oud_10s_abababababab_seg000"
    assert bs.clip_stem("x_mix", sha, 12, 7.5) == "x_mix_7.5s_abababababab_seg012"
    assert bs.duration_infix(30.0) == "" and bs.duration_infix(10) == "_10s"
    assert bs.seg_index("data/sets_10s/sep_oud/clips/train/sep_oud_10s_abababababab_seg012.wav") == 12
    assert Path(bs.clip_stem("x_mix", sha, 12, 7.5) + ".wav").stem == bs.clip_stem("x_mix", sha, 12, 7.5)


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


def test_stem_split_invariant_on_rows(capsys: pytest.CaptureFixture[str]) -> None:
    mix = [{"song_sha256": "a", "song_group": "g1", "split": "train", "content": "full_mix"},
           {"song_sha256": "b", "song_group": "g2", "split": "test", "content": "full_mix"}]
    stems = [{"song_sha256": "a", "song_group": "g1", "split": "train", "content": "sep_oud"},
             {"song_sha256": "a", "song_group": "g1", "split": "train", "content": "sep_vocal"},
             {"song_sha256": "c", "song_group": "g3", "split": "val", "content": "sep_oud"}]  # no mix row: nothing to check
    assert bs.find_stem_split_mismatches(stems, mix) == []
    assert bs.find_stem_split_mismatches(stems + mix) == []
    assert bs.count_stems_with_mix(stems, mix) == 2
    assert bs.assert_stems_follow_mixes(stems, mix) == 2
    assert "STEM/MIX SPLIT CHECK PASSED (2 stem clips" in capsys.readouterr().out
    bad = stems + [{"song_sha256": "b", "song_group": "g2", "split": "train", "content": "sep_vocal"},
                   {"song_sha256": "b", "song_group": "g2", "split": "train", "content": "sep_vocal"}]  # two clips, one entry
    found = bs.find_stem_split_mismatches(bad, mix)
    assert found == [{"song_sha256": "b", "content": "sep_vocal", "stem_split": "train", "mix_splits": ["test"]}]
    with pytest.raises(SystemExit, match="STEM/MIX SPLIT MISMATCH: 1 stems"):
        bs.assert_stems_follow_mixes(bad, mix)
    # the check is symmetric in its two arguments (a mix build checks the sep sets on disk)
    assert bs.find_stem_split_mismatches(mix, bad) == found
    # a stem alone (no mix rows anywhere) passes with 0 checked
    assert bs.assert_stems_follow_mixes(stems[2:]) == 0


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
    assert all(f.performer == "Ahmed Ilkacase" for f in sel.files)
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
# Generic "<prefix>_oud|_mix|_vocal" sets over a rights-carrying inventory
# ---------------------------------------------------------------------------


def _generic_rows(root: Path) -> list[dict]:
    d = root / "data/raw_incoming/internet"
    a = _write_wav(d / "Qaraami kaban 1978.wav", _tone(31.0, 220.0))
    b = _write_wav(d / "Heello 2015.wav", _tone(31.0, 330.0))
    c = _write_wav(d / "no rights.wav", _tone(31.0, 440.0))
    r = _write_wav(d / "unknown licence.wav", _tone(31.0, 550.0))
    h = _write_wav(root / "data/raw_incoming/contrib_hodan/hodan take.wav", _tone(31.0, 660.0))
    v = _write_wav(d / "vocal 2001.wav", _tone(31.0, 770.0))
    return [
        {"path": str(a), "name": a.name, "content": "oud", "song_group": "ia_qaraami", "rights": "internet_cc", "year": 1978,
         "performer": "Cabdi Holland", "sha256": bs.full_sha256(a), "percussive_ratio": 0.5, "duration_s": 31.0},
        {"path": str(b), "name": b.name, "content": "oud", "song_group": "yt_heello", "rights": "internet_cc", "date": "2015-06-01",
         "sha256": bs.full_sha256(b)},
        {"path": str(c), "name": c.name, "content": "oud", "song_group": "norights", "sha256": bs.full_sha256(c)},
        {"path": str(r), "name": r.name, "content": "oud", "song_group": "unknown", "rights": "internet_research_only", "sha256": bs.full_sha256(r)},
        {"path": str(h), "name": h.name, "content": "oud", "song_group": "hodan1", "rights": "contrib_hodan_consented", "sha256": bs.full_sha256(h)},
        {"path": str(v), "name": v.name, "content": "voice", "song_group": "v2001", "rights": "internet_cc", "year": 2001, "sha256": bs.full_sha256(v)},
        {"path": str(v), "name": "excluded.wav", "content": "oud", "excluded": True, "rights": "internet_cc", "sha256": "e" * 64},
    ]


def test_select_generic_rights_tiers(tmp_path: Path) -> None:
    root = tmp_path
    rows = _generic_rows(root)
    with pytest.raises(SystemExit, match="mix rights tiers"):
        bs.select_generic(rows, "internet_oud", root=root)  # internet_cc + contrib_hodan_consented both have oud rows
    internet_only = [r for r in rows if r.get("rights") != "contrib_hodan_consented"]
    sel = bs.select_generic(internet_only, "internet_oud", root=root)
    assert [f.name for f in sorted(sel.files, key=lambda f: f.name)] == ["Heello 2015.wav", "Qaraami kaban 1978.wav"]
    assert sel.skipped["no_rights"] == 1 and sel.skipped["rights_internet_research_only_by_policy"] == 1
    assert sel.skipped["content_voice"] == 1 and sel.skipped["excluded"] == 1
    assert all(f.rights == "internet_cc" for f in sel.files)
    by_name = {f.name: f for f in sel.files}
    assert by_name["Qaraami kaban 1978.wav"].year == 1978 and by_name["Qaraami kaban 1978.wav"].performer == "Cabdi Holland"
    assert by_name["Heello 2015.wav"].year == 2015 and by_name["Heello 2015.wav"].performer is None
    assert {"ia_qaraami", "yt_heello", "norights", "unknown", "v2001"} <= sel.universe
    old = bs.build_caption(by_name["Qaraami kaban 1978.wav"], 100.0, "A")
    assert old.startswith("qaraami, Somali traditional song, led by the oud (kaban) and hand drums, ")
    assert old.endswith("archival recording, performed by Cabdi Holland")
    new = bs.build_caption(by_name["Heello 2015.wav"], 100.0, "A")
    assert new.startswith("heello, ") and new.endswith("studio recording") and "performed by" not in new
    # the prefix names the set, the rows name the tier: the only voice row is internet_cc, so that is the set's tier
    voc = bs.select_generic(rows, "hodan_vocal", root=root)
    assert [f.name for f in voc.files] == ["vocal 2001.wav"] and voc.files[0].rights == "internet_cc"
    assert voc.skipped["content_oud"] == 3 and voc.skipped["no_rights"] == 1  # c and r are skipped before the content rule
    assert bs.build_caption(voc.files[0], 100.0, "A") == (
        "Somali song, led by vocals, moderate at 100 BPM, pentatonic melody rooted on A, studio recording"
    )
    contrib_oud = bs.select_generic([r for r in rows if r.get("rights") == "contrib_hodan_consented"], "hodan_oud", root=root)
    assert [f.rights for f in contrib_oud.files] == ["contrib_hodan_consented"]
    assert bs.build_caption(contrib_oud.files[0], 100.0, "A").endswith("studio recording, clean")
    assert bs.set_rights("hodan_oud", contrib_oud.files) == "contrib_hodan_consented"
    assert bs.set_rights("hodan_oud", []) == "unknown" and bs.set_rights("sep_oud", []) == bs.RIGHTS_AHMED


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

    # Harvard stems: song_group is the cid, rights research-only, superseded sides stay out
    sep = root / "data/separated"
    for sha, present in (("9" * 64, True), ("a" * 64, True), ("1" * 64, False)):
        d = sep / "harvard" / sha[:12]
        _write_wav(d / "other.wav", _tone(31.0))
        _write_wav(d / "vocals.wav", _tone(31.0))
        (d / "stems.json").write_text(json.dumps({
            "source_sha256": sha, "corpus": "harvard", "duration_s": 31.0, "oud_present": present, "vocals_present": True,
            "stems": {"other": {"rms_dbfs": -18.0, "voiced_fraction": 0.5, "pcs": 0.9, "tuning_offset_cents": -20.0, "tonic": "D"},
                      "vocals": {"rms_dbfs": -30.0}},
        }))
    sep_rows = bs.load_separated_index(sep)  # no index.jsonl: the stems.json files are scanned
    assert len(sep_rows) == 3 and all("_dir" in r for r in sep_rows)
    hs = bs.select_separated(sep_rows, "harvard_sep_oud", sel, root=root, sep_root=sep)
    assert [f.song_group for f in hs.files] == ["c0900"] and hs.files[0].rights == bs.RIGHTS_HARVARD
    assert hs.files[0].project == "AWM SC 12301" and hs.files[0].content == "sep_oud"
    assert hs.files[0].extra["stem"] == "other" and hs.files[0].extra["cid"] == "c0900"
    assert hs.files[0].extra["mix_path"] == "data/harvard_raw/AWM_SC_12301_A1_Subcis__c0900.mp3"
    assert hs.skipped["source_not_in_mix_set"] == 1  # 'a' * 64 = c0001, the superseded whole side
    assert hs.skipped["other_absent"] == 1
    assert hs.universe == sel.universe
    cap = bs.build_caption(hs.files[0], 100.0, "D", -20.0)
    assert cap == ("qaraami, Somali traditional song, led by the oud (kaban), moderate at 100 BPM, "
                   "pentatonic melody rooted on D, tuned 20 cents flat of A440, vintage cassette, 1955–1991")
    hv = bs.select_separated(sep_rows, "harvard_sep_vocal", sel, root=root, sep_root=sep)
    assert sorted(f.song_group for f in hv.files) == ["c0095", "c0900"]
    # the Ahmed sep sets refuse Harvard stems by tier
    assert bs.select_separated(sep_rows, "sep_oud", sel, root=root, sep_root=sep).skipped["rights_harvard_research_only"] == 3
    with pytest.raises(ValueError, match="not a sep set"):
        bs.select_separated(sep_rows, "harvard_full", sel, root=root, sep_root=sep)


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
    # 10 s windows keep the 50 % overlap: 46 s -> starts 0, 5, ..., 35 s = 8 clips
    ten = list(bs.cut_clips(_tone(46.0), 10.0))
    assert [i for i, _ in ten] == list(range(8)) and all(c.shape == (10 * SR,) for _, c in ten)
    assert bs.window_hop(10.0) == (10 * SR, 5 * SR)


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
# The scorer hook: tonic and tuning from scripts.pcs, histogram fallback
# ---------------------------------------------------------------------------


def test_describe_clip_scorer_and_fallbacks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bs, "tempo_bpm", lambda clip: 95.0)
    monkeypatch.setattr(bs, "detect_from_audio", lambda clip, sr: {"tonic_name": "A"})
    monkeypatch.setattr(bs, "score_clip", lambda clip, device=None: SimpleNamespace(tonic_name="D", tuning_offset_cents=-23.44))
    d = bs.describe_clip(_tone(30.0))
    assert (d.bpm, d.tonic, d.tonic_source, d.tuning_offset_cents, d.scorer_error) == (95.0, "D", "scorer", -23.4, None)
    # too few voiced frames: the scorer returns None and the histogram tonic is used, no tuning claimed
    monkeypatch.setattr(bs, "score_clip", lambda clip, device=None: None)
    d = bs.describe_clip(_tone(30.0))
    assert (d.tonic, d.tonic_source, d.tuning_offset_cents, d.scorer_error) == ("A", "histogram", None, None)
    # scorer disabled: never called
    monkeypatch.setattr(bs, "score_clip", lambda clip, device=None: (_ for _ in ()).throw(AssertionError("scorer called")))
    d = bs.describe_clip(_tone(30.0), use_scorer=False)
    assert (d.tonic, d.tonic_source, d.tuning_offset_cents) == ("A", "histogram", None)
    # a scorer error is recorded, not raised
    monkeypatch.setattr(bs, "score_clip", lambda clip, device=None: (_ for _ in ()).throw(RuntimeError("no MPS")))
    d = bs.describe_clip(_tone(30.0))
    assert d.tonic == "A" and d.tonic_source == "histogram" and d.scorer_error == "RuntimeError: no MPS"


# ---------------------------------------------------------------------------
# End to end on synthesised sources (decode + detectors monkeypatched), resume, merge
# ---------------------------------------------------------------------------


def _patch_decode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bs, "decode_mono32", lambda p: sf.read(p, dtype="float32")[0])
    monkeypatch.setattr(bs, "tempo_bpm", lambda clip: 100.0)
    monkeypatch.setattr(bs, "detect_from_audio", lambda clip, sr: {"tonic_name": "A"})
    monkeypatch.setattr(bs, "score_clip", lambda clip, device=None: None)  # no CREPE: histogram tonic, no tuning


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
    assert summary["rights"] == "ahmed_ilkacase_consented" and summary["clip_stem"] == "ahmed_oud_<sha256>_seg000"
    assert summary["tonic_sources"] == {"histogram": 3} and summary["tuning_tagged_clips"] == 0
    caps = _read_rows(out_root / "ahmed_oud/captions.jsonl")
    assert len(caps) == 3
    required = {"clip_path", "caption", "song_sha256", "song_group", "split", "source", "source_name",
                "source_path", "rights", "content", "project", "tokens_dir", "seconds", "caption_version",
                "tonic", "tuning_offset_cents", "tonic_source", "clip_tonic", "clip_tuning_offset_cents"}
    for r in caps:
        assert required <= set(r)
        assert r["source"] == "ahmed_oud" and r["rights"] == "ahmed_ilkacase_consented"
        assert r["tokens_dir"] == "data/sets/ahmed_oud/tokens"
        assert r["seconds"] == 30.0 and r["caption_version"] == bs.CAPTION_VERSION == 2
        assert r["tuning_offset_cents"] is None and r["tonic_source"] == "histogram"
        assert r["tonic"] == r["clip_tonic"] == "A" and r["clip_tuning_offset_cents"] is None and "chroma_dir" not in r
        assert not (root / "data/sets/ahmed_oud/SET_CARD.md.tmp").exists()
        assert "stem" not in r and "mix_path" not in r
        assert not Path(r["clip_path"]).is_absolute() and r["clip_path"].startswith(f"data/sets/ahmed_oud/clips/{r['split']}/ahmed_oud_")
        assert r["clip_path"].startswith(f"data/sets/ahmed_oud/clips/{r['split']}/ahmed_oud_{r['song_sha256'][:12]}_seg")
        assert r["source_path"].startswith("data/raw_incoming/oud_ilkacase/")
        assert (root / r["clip_path"]).exists()
        audio, sr = sf.read(root / r["clip_path"])
        assert sr == SR and len(audio) == 30 * SR
        assert "performed by Ahmed Ilkacase" in r["caption"] and "studio recording, clean" in r["caption"]
        assert r["caption"].startswith("qaraami, Somali traditional song, led by the oud (kaban)")
        assert "tuned" not in r["caption"]
    drums = [r for r in caps if r["song_group"] == "wadada"]
    assert all("and hand drums" in r["caption"] for r in drums) and len(drums) == 2
    card = (out_root / "ahmed_oud/SET_CARD.md").read_text()
    assert "ahmed_ilkacase_consented" in card and "Caption examples" in card and "Clips per split" in card
    assert card.startswith("# Set card: ahmed_oud (30 s clips)") and "Clip duration: 30 s, 50 % overlap" in card
    assert "- Source audio: 0.02 h (manifest/inventory durations)" in card  # the line ahmed_report.py parses
    # the card's numbers come from the code, not from prose
    assert f"{bs.TARGET_LUFS:g} LUFS" in card and f"{bs.QUIET_DROP_DB:g} dB under" in card
    assert f"peak-normalised to {bs.PEAK:g}" in card and "50 % overlap" in card and "Song-level 80/10/10" in card
    assert "Caption template version: 2" in card

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
    assert merged["seconds"] == [30.0] and merged["stem_split_mismatches"] == 0
    merged_rows = _read_rows(out_root / "ahmed_all_captions.jsonl")
    assert {r["tokens_dir"] for r in merged_rows} == {"data/sets/ahmed_oud/tokens", "data/sets/ahmed_vocal/tokens"}
    out = capsys.readouterr().out
    assert "LEAKAGE CHECK PASSED" in out and "STEM/MIX SPLIT CHECK PASSED (0 stem clips" in out


def test_scorer_tuning_tag_end_to_end_and_resume(fake_corpus: tuple[Path, list[dict]], monkeypatch: pytest.MonkeyPatch) -> None:
    root, rows = fake_corpus
    out_root = root / "data/sets"
    monkeypatch.setattr(bs, "score_clip", lambda clip, device=None: SimpleNamespace(tonic_name="D", tuning_offset_cents=-23.4))
    sel = bs.select_ahmed(rows, "ahmed_oud", root=root)
    summary = bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    assert summary["tonic_sources"] == {"scorer": 3} and summary["tuning_tagged_clips"] == 3 and summary["scorer"] is True
    caps = _read_rows(out_root / "ahmed_oud/captions.jsonl")
    for r in caps:
        assert r["tonic_source"] == "scorer" and r["tuning_offset_cents"] == -23.4
        assert "pentatonic melody rooted on D, tuned 23 cents flat of A440, studio recording, clean, performed by Ahmed Ilkacase" in r["caption"]
    card = (out_root / "ahmed_oud/SET_CARD.md").read_text()
    assert '"scorer": 3' in card and "clips with a tuning tag" in card and "tuned 23 cents flat of A440" in card
    # resume keeps the scorer fields and captions without calling the scorer or the decoder again
    _forbid_decode(monkeypatch)
    monkeypatch.setattr(bs, "score_clip", lambda clip, device=None: (_ for _ in ()).throw(AssertionError("scorer called on resume")))
    again = bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    assert again["resumed_files"] == 2 and _read_rows(out_root / "ahmed_oud/captions.jsonl") == caps
    # a small offset gives no tag but is still recorded on the row
    _patch_decode(monkeypatch)
    monkeypatch.setattr(bs, "score_clip", lambda clip, device=None: SimpleNamespace(tonic_name="G", tuning_offset_cents=6.0))
    fresh = bs.build_set("ahmed_oud", sel, root / "data/sets_b", seconds=30.0, root=root)
    assert fresh["tuning_tagged_clips"] == 0 and fresh["tonic_sources"] == {"scorer": 3}
    small = _read_rows(root / "data/sets_b/ahmed_oud/captions.jsonl")
    assert all(r["tuning_offset_cents"] == 6.0 and "rooted on G, studio recording" in r["caption"] for r in small)
    # --no-scorer: histogram tonic, no tuning, scorer never called
    monkeypatch.setattr(bs, "score_clip", lambda clip, device=None: (_ for _ in ()).throw(AssertionError("scorer called")))
    off = bs.build_set("ahmed_oud", sel, root / "data/sets_c", seconds=30.0, root=root, use_scorer=False)
    assert off["tonic_sources"] == {"histogram": 3} and off["scorer"] is False


def test_scorer_error_falls_back_and_is_counted(fake_corpus: tuple[Path, list[dict]], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    root, rows = fake_corpus
    monkeypatch.setattr(bs, "score_clip", lambda clip, device=None: (_ for _ in ()).throw(RuntimeError("MPS out of memory")))
    sel = bs.select_ahmed(rows, "ahmed_oud", root=root)
    summary = bs.build_set("ahmed_oud", sel, root / "data/sets", seconds=30.0, root=root)
    assert summary["failed"] == {"scorer_error_clips": 3} and summary["tonic_sources"] == {"histogram": 3}
    err = capsys.readouterr().err
    assert err.count("scorer failed on") == 2 and "MPS out of memory" in err  # once per source, not per clip


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
    assert all("/ahmed_oud_20s_" in r["clip_path"] for r in caps)
    # same window again: resumed
    _forbid_decode(monkeypatch)
    assert bs.build_set("ahmed_oud", sel, out_root, seconds=20.0, root=root)["resumed_files"] == 2
    # a caption template bump (or rows from before the version field existed) re-captions the clips on
    # disk: nothing is decoded, no clip is rewritten, the rows come back at the current version
    stale = [dict(r, caption_version=1, caption="old caption", tuning_offset_cents=None) for r in caps]
    (out_root / "ahmed_oud/captions.jsonl").write_text("".join(json.dumps(r) + "\n" for r in stale))
    before = {r["clip_path"]: (root / r["clip_path"]).stat().st_mtime_ns for r in caps}
    monkeypatch.setattr(bs, "score_clip", lambda clip, device=None: SimpleNamespace(tonic_name="D", tuning_offset_cents=-23.4))
    summary = bs.build_set("ahmed_oud", sel, out_root, seconds=20.0, root=root)
    assert summary["resumed_files"] == 0 and summary["recaptioned_files"] == 2 and summary["failed"] == {}
    recap = _read_rows(out_root / "ahmed_oud/captions.jsonl")
    assert [r["clip_path"] for r in recap] == [r["clip_path"] for r in caps]
    assert all(r["caption_version"] == 2 and "tuned 23 cents flat of A440" in r["caption"] and r["tonic"] == "D" for r in recap)
    assert {r["clip_path"]: (root / r["clip_path"]).stat().st_mtime_ns for r in recap} == before
    legacy = [{k: v for k, v in r.items() if k not in ("seconds", "caption_version")} for r in caps]
    (out_root / "ahmed_oud/captions.jsonl").write_text("".join(json.dumps(r) + "\n" for r in legacy))
    assert not bs.row_is_resumable(legacy[0], 20.0) and bs.row_is_resumable(caps[0], 20.0)
    assert bs.build_set("ahmed_oud", sel, out_root, seconds=20.0, root=root)["recaptioned_files"] == 2
    # a clip of the wrong length (a file half-written when the run was killed) is neither resumed nor
    # re-captioned: that source is re-cut, the other one resumes
    short = next(r for r in recap if r["song_group"] == "wadada")
    _write_wav(root / short["clip_path"], _tone(3.0))
    assert not bs.clip_is_whole(root / short["clip_path"], 20 * SR) and bs.clip_is_whole(root / recap[-1]["clip_path"], 20 * SR)
    assert not bs.clip_is_whole(root / "nowhere.wav", 20 * SR)
    _patch_decode(monkeypatch)
    recut = bs.build_set("ahmed_oud", sel, out_root, seconds=20.0, root=root)
    assert recut["resumed_files"] == 1 and recut["recaptioned_files"] == 0 and recut["clips_total"] == 5
    assert len(sf.read(root / short["clip_path"])[0]) == 20 * SR
    # a window that cannot be cut is refused before anything is written
    for bad in (0.0, -5.0, float("nan"), float("inf")):
        with pytest.raises(ValueError, match="positive number of seconds"):
            bs.window_hop(bad)
        with pytest.raises(ValueError):
            bs.build_set("ahmed_oud", sel, root / f"data/sets_{bad}", seconds=bad, root=root)
        assert not (root / f"data/sets_{bad}").exists()


def test_ten_second_build_has_infixed_stems_and_card(fake_corpus: tuple[Path, list[dict]], monkeypatch: pytest.MonkeyPatch) -> None:
    root, rows = fake_corpus
    sel = bs.select_ahmed(rows, "ahmed_oud", root=root)
    thirty = bs.build_set("ahmed_oud", sel, root / "data/sets", seconds=30.0, root=root)
    ten = bs.build_set("ahmed_oud", sel, root / "data/sets_10s", seconds=10.0, root=root)
    assert ten["clips_total"] == 13 and ten["hours"] == round(13 * 10 / 3600, 2)  # 46 s -> 8 windows, 31 s -> 5
    assert ten["clip_stem"] == "ahmed_oud_10s_<sha256>_seg000" and ten["seconds"] == 10.0
    caps = _read_rows(root / "data/sets_10s/ahmed_oud/captions.jsonl")
    stems = {Path(r["clip_path"]).stem for r in caps}
    for r in caps:
        assert r["seconds"] == 10.0 and r["tokens_dir"] == "data/sets_10s/ahmed_oud/tokens"
        assert r["clip_path"].startswith(f"data/sets_10s/ahmed_oud/clips/{r['split']}/ahmed_oud_10s_{r['song_sha256'][:12]}_seg")
        assert len(sf.read(root / r["clip_path"])[0]) == 10 * SR
    # the 10 s stems never collide with the 30 s ones (tokens/chroma are keyed by stem)
    stems30 = {Path(r["clip_path"]).stem for r in _read_rows(root / "data/sets/ahmed_oud/captions.jsonl")}
    assert not (stems & stems30) and all("_10s_" in s for s in stems) and not any("_10s_" in s for s in stems30)
    # both builds share the song splits (same universe), so a song is train in both or test in both
    split30 = {r["song_sha256"]: r["split"] for r in _read_rows(root / "data/sets/ahmed_oud/captions.jsonl")}
    assert all(split30[r["song_sha256"]] == r["split"] for r in caps)
    card = (root / "data/sets_10s/ahmed_oud/SET_CARD.md").read_text()
    assert card.startswith("# Set card: ahmed_oud (10 s clips)")
    assert "Clip duration: 10 s, 50 % overlap; clip stem `ahmed_oud_10s_<sha256>_seg000`" in card
    assert "Clips: 13 × 10 s" in card and "10 s windows, 50 % overlap" in card
    assert thirty["clips_total"] == 3
    # resume at 10 s: nothing decoded
    _forbid_decode(monkeypatch)
    assert bs.build_set("ahmed_oud", sel, root / "data/sets_10s", seconds=10.0, root=root)["resumed_files"] == 2


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
    # an empty selection in a dry run is a summary with 0 files and the note, not an error
    empty = bs.build_set("sep_oud", bs.Selection([], Counter(), set()),
                         root / "data/sets", dry_run=True, root=root, note="no separation output")
    assert empty["files"] == 0 and empty["note"] == "no separation output" and empty["files_per_split"] == {"train": 0, "val": 0, "test": 0}
    assert empty["rights"] == bs.RIGHTS_AHMED and json.loads(capsys.readouterr().out)["note"] == "no separation output"


# ---------------------------------------------------------------------------
# Demucs stems: selection, 10 s build, the stem/mix split invariant, merge with the mixes
# ---------------------------------------------------------------------------


def _stem_row(sep: Path, sha: str, corpus: str = "ahmed", oud: bool = True, voc: bool = True,
              write: tuple[str, ...] = ("other", "vocals"), rights: str | None = None, paths: bool = True) -> dict:
    d = sep / corpus / sha[:12]
    for stem in write:
        _write_wav(d / f"{stem}.wav", _tone(46.0 if stem == "other" else 31.0, 260.0))
    row = {
        "source_path": f"data/{corpus}/{sha[:12]}.wav", "source_sha256": sha, "corpus": corpus, "duration_s": 46.0,
        "stems": {"other": {"rms_dbfs": -18.0, "voiced_fraction": 0.6, "pcs": 0.9, "tuning_offset_cents": -20.0, "tonic": "D"},
                  "vocals": {"rms_dbfs": -28.0, "voiced_fraction": 0.4, "pcs": 0.8, "tuning_offset_cents": -19.0, "tonic": "D"}},
        "oud_present": oud, "vocals_present": voc,
    }
    if rights:
        row["rights"] = rights
    if paths:
        row["paths"] = {"other_wav": f"data/separated/{corpus}/{sha[:12]}/other.wav", "vocals_wav": f"data/separated/{corpus}/{sha[:12]}/vocals.wav"}
    (d / "stems.json").write_text(json.dumps(row))
    return row


@pytest.fixture
def fake_separated(fake_corpus: tuple[Path, list[dict]]) -> tuple[Path, list[dict], list[dict]]:
    """The fake corpus plus three mixes (a GarageBand mix, a collection '_mixed', a third-party import)
    and a separation index over them (+ a Harvard row, an unknown source and a missing stem)."""
    root, rows = fake_corpus
    m1 = _write_wav(root / "data/ahmed_raw/GarageBand/wadada.band/Output/Output.wav", _tone(46.0, 260.0))
    m2 = _write_wav(root / "data/raw_incoming/oud_ilkacase/Laxanka Qaraamiga ah_mixed.wav", _tone(31.0, 300.0))
    m3 = _write_wav(root / "data/ahmed_raw/GarageBand/import.band/Media/07 Track.wav", _tone(31.0, 320.0))
    m4 = _write_wav(root / "data/ahmed_raw/GarageBand/hoos.band/Output/Output.wav", _tone(31.0, 340.0))
    s1, s2, s3, s4 = (bs.full_sha256(p) for p in (m1, m2, m3, m4))
    rows = rows + [
        {"path": str(m1), "name": m1.name, "content": "full_mix", "song_group": "wadada", "project": "wadada", "percussive_ratio": 0.7, "sha256": s1, "duration_s": 46.0},
        {"path": str(m2), "name": m2.name, "content": "voice", "song_group": "laxanka", "source_group": "ahmed_collection", "sha256": s2},
        {"path": str(m3), "name": m3.name, "content": "full_mix", "song_group": "import07", "project": "import", "sha256": s3,
         "third_party_suspect": True, "third_party_reason": "import"},
        {"path": str(m4), "name": m4.name, "content": "full_mix", "song_group": "hoos", "project": "hoos", "sha256": s4},
    ]
    sep = root / "data/separated"
    index = [
        _stem_row(sep, s1),                                              # both stems
        _stem_row(sep, s2, oud=False, write=("vocals",)),                # vocals only (oud_present False)
        _stem_row(sep, s3),                                              # third-party mix: not in ahmed_mix
        _stem_row(sep, s4, write=("vocals",)),                           # oud_present but other.wav missing
        _stem_row(sep, "7" * 64, corpus="harvard", rights=bs.RIGHTS_HARVARD),  # Harvard tier: not for sep_*
        _stem_row(sep, "8" * 64, corpus="ahmed", paths=False),           # not in the inventory
        {"source_sha256": "not-a-sha", "corpus": "ahmed", "oud_present": True},
    ]
    (sep / "index.jsonl").write_text("".join(json.dumps(r) + "\n" for r in index))
    return root, rows, index


def test_select_separated_inherits_the_mix(fake_separated: tuple[Path, list[dict], list[dict]]) -> None:
    root, rows, index = fake_separated
    sep = root / "data/separated"
    mix = bs.select_ahmed(rows, "ahmed_mix", root=root)
    assert sorted(f.song_group for f in mix.files) == ["hoos", "laxanka", "wadada"]
    loaded = bs.load_separated_index(sep)
    # the stems.json files are the truth (each with its "_dir"); the index only adds rows the scan lacks
    assert len(loaded) == len(index) == 7
    assert [r["source_sha256"] for r in loaded[:6]] == [r["source_sha256"] for r in sorted(index[:6], key=lambda r: (r["corpus"], r["source_sha256"][:12]))]
    assert all("_dir" in r for r in loaded[:6]) and loaded[6] == index[6] and "_dir" not in loaded[6]
    oud = bs.select_separated(loaded, "sep_oud", mix, root=root, sep_root=sep)
    assert [f.song_group for f in oud.files] == ["wadada"]
    f = oud.files[0]
    assert f.content == "sep_oud" and f.rights == bs.RIGHTS_AHMED and f.performer == "Ahmed Ilkacase"
    assert f.sha256 == mix.files[[m.song_group for m in mix.files].index("wadada")].sha256  # the SOURCE mix's sha
    assert f.path == sep / "ahmed" / f.sha12 / "other.wav" and f.name == "Output.wav" and f.project == "wadada"
    assert f.percussive_ratio is None and f.instruments is None and f.duration_s == 46.0
    assert f.extra["stem"] == "other" and f.extra["mix_path"] == "data/ahmed_raw/GarageBand/wadada.band/Output/Output.wav"
    assert f.extra["stem_rms_dbfs"] == -18.0 and f.extra["stem_voiced_fraction"] == 0.6 and f.extra["source_group"] == "ahmed_sessions"
    assert dict(oud.skipped) == {"other_absent": 1, "source_not_in_mix_set": 2, "missing_stem": 1,
                                 "rights_harvard_research_only": 1, "no_source_sha256": 1}
    assert oud.universe == mix.universe
    voc = bs.select_separated(loaded, "sep_vocal", mix, root=root, sep_root=sep)
    assert sorted(f.song_group for f in voc.files) == ["hoos", "laxanka", "wadada"]
    assert all(f.content == "sep_vocal" and f.extra["stem"] == "vocals" for f in voc.files)
    lax = next(f for f in voc.files if f.song_group == "laxanka")
    assert bs.detect_genre(lax.genre_text) == "qaraami" and lax.project == "ahmed_collection"
    assert bs.build_caption(lax, 100.0, "A").startswith("qaraami, Somali traditional song, led by vocals (unaccompanied), ")
    # no index.jsonl: the stems.json files are scanned and the default paths are used
    (sep / "index.jsonl").unlink()
    scanned = bs.load_separated_index(sep)
    assert len(scanned) == 6 and all("_dir" in r for r in scanned)
    oud2 = bs.select_separated(scanned, "sep_oud", mix, root=root, sep_root=sep)
    assert [f.song_group for f in oud2.files] == ["wadada"] and oud2.files[0].path == f.path
    # nothing separated yet: 0 files, a clear note, no error
    assert bs.load_separated_index(root / "data/nowhere") == []
    empty = bs.select_separated([], "sep_oud", mix, root=root, sep_root=root / "data/nowhere")
    assert empty.files == [] and empty.universe == mix.universe
    assert "run the Demucs separation step first (0 files selected)" in bs.separated_missing_note(root / "data/nowhere", root)
    # stem paths: explicit paths, bare keys, stems.json dir and the default layout
    row = {"source_sha256": "a" * 64, "corpus": "ahmed"}
    assert bs.stem_wav_path(row, "other", root, sep) == sep / "ahmed" / ("a" * 12) / "other.wav"
    assert bs.stem_wav_path(dict(row, other_wav="data/x/o.wav"), "other", root, sep) == root / "data/x/o.wav"
    assert bs.stem_wav_path(dict(row, _dir=str(sep / "ahmed/zzz")), "vocals", root, sep) == sep / "ahmed/zzz/vocals.wav"
    assert bs.stem_wav_path(dict(row, paths={"vocals_wav": "/abs/v.wav"}), "vocals", root, sep) == Path("/abs/v.wav")
    assert bs.separated_rights({"corpus": "harvard_full"}) == bs.RIGHTS_HARVARD
    assert bs.separated_rights({"corpus": "ahmed"}) == bs.separated_rights({"corpus": "ahmed_collection"}) == bs.RIGHTS_AHMED
    assert bs.separated_rights({"rights": "internet_cc", "corpus": "harvard"}) == "internet_cc"
    # a rights-less row resolves to the consented tier only for separate_stems' own Ahmed corpora: an extra
    # inventory's corpus is its tier, anything else is unknown (and skipped), never Ahmed
    assert bs.separated_rights({"corpus": "internet_cc"}) == "internet_cc"
    assert bs.separated_rights({"corpus": "contrib_hodan_research_only"}) == "contrib_hodan_research_only"
    assert bs.separated_rights({"corpus": "ahmed_x"}) == bs.separated_rights({"corpus": "whatever"}) == bs.separated_rights({}) == "unknown"
    unknown_row = dict(_stem_row(sep, "c" * 64, corpus="whatever"), rights=None)
    assert bs.select_separated([unknown_row], "sep_oud", mix, root=root, sep_root=sep).skipped == Counter({"rights_unknown": 1})
    # a row of the index (no "_dir") whose stems live where its own stem_dir says, under a file name from stems.<stem>.file
    probe = root / "data/sep_probe"
    _write_wav(probe / "ahmed" / ("d" * 12) / "other_32k.wav", _tone(31.0))
    moved = {"source_sha256": "d" * 64, "corpus": "ahmed", "stem_dir": "data/sep_probe/ahmed/" + "d" * 12,
             "stems": {"other": {"file": "other_32k.wav"}}, "oud_present": True}
    assert bs.stem_wav_path(moved, "other", root, sep) == probe / "ahmed" / ("d" * 12) / "other_32k.wav"
    assert bs.stem_wav_path(moved, "vocals", root, sep) == probe / "ahmed" / ("d" * 12) / "vocals.wav"
    assert bs.stem_wav_path(dict(moved, _dir=str(sep / "ahmed/zzz")), "other", root, sep) == sep / "ahmed/zzz/other_32k.wav"
    assert bs.stem_wav_path({"source_sha256": "d" * 64, "corpus": "ahmed", "stems": {"other": {"file": "o.wav"}}}, "other", root, sep) == sep / "ahmed" / ("d" * 12) / "o.wav"


def test_load_separated_index_prefers_the_stems_json_files(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    sep = tmp_path / "data/separated"
    a = _stem_row(sep, "1" * 64, write=("other",))
    _stem_row(sep, "2" * 64, write=("other",))  # written after the index was last rebuilt (a killed run)
    (sep / "index.jsonl").write_text(json.dumps(a) + "\n" + json.dumps({"source_sha256": "9" * 64, "corpus": "ahmed"}) + "\n")
    rows = bs.load_separated_index(sep)
    assert [r["source_sha256"][:1] for r in rows] == ["1", "2", "9"]  # scanned rows first, index-only rows after
    assert rows[0]["_dir"] == str(sep / "ahmed" / ("1" * 12)) and rows[1]["_dir"] == str(sep / "ahmed" / ("2" * 12))
    assert "_dir" not in rows[2]
    assert "is stale: 1 stems.json" in capsys.readouterr().err
    # a complete index gives no warning; no stems.json at all falls back to the index alone
    (sep / "index.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows[:2]))
    assert len(bs.load_separated_index(sep)) == 2 and capsys.readouterr().err == ""
    lone = tmp_path / "data/lone"
    lone.mkdir(parents=True)
    (lone / "index.jsonl").write_text(json.dumps({"source_sha256": "5" * 64}) + "\n")
    assert bs.load_separated_index(lone) == [{"source_sha256": "5" * 64}]


def test_sep_sets_build_at_10s_share_the_mix_split_and_merge(fake_separated: tuple[Path, list[dict], list[dict]], capsys: pytest.CaptureFixture[str]) -> None:
    root, rows, _ = fake_separated
    sep = root / "data/separated"
    out_root = root / "data/sets_10s"
    mix = bs.select_ahmed(rows, "ahmed_mix", root=root)
    sep_rows = bs.load_separated_index(sep)
    oud_sel = bs.select_separated(sep_rows, "sep_oud", mix, root=root, sep_root=sep)
    voc_sel = bs.select_separated(sep_rows, "sep_vocal", mix, root=root, sep_root=sep)
    # the stems can be built before the mix set exists: nothing to check against yet
    oud = bs.build_set("sep_oud", oud_sel, out_root, seconds=10.0, root=root)
    assert oud["clips_total"] == 8 and oud["related_sets_checked"] == [] and oud["stems_checked_against_mix"] == 0
    assert oud["clip_stem"] == "sep_oud_10s_<sha256>_seg000" and oud["rights"] == bs.RIGHTS_AHMED
    out = capsys.readouterr().out
    assert "LEAKAGE CHECK PASSED" in out and "STEM/MIX SPLIT CHECK PASSED (0 stem clips" in out
    caps = _read_rows(out_root / "sep_oud/captions.jsonl")
    mix_sha = oud_sel.files[0].sha256
    for r in caps:
        assert r["song_sha256"] == mix_sha and r["song_group"] == "wadada" and r["content"] == "sep_oud"
        assert r["stem"] == "other" and r["mix_path"] == "data/ahmed_raw/GarageBand/wadada.band/Output/Output.wav"
        assert r["source_path"] == f"data/separated/ahmed/{mix_sha[:12]}/other.wav" and r["source_name"] == "Output.wav"
        assert r["clip_path"].startswith(f"data/sets_10s/sep_oud/clips/{r['split']}/sep_oud_10s_{mix_sha[:12]}_seg")
        assert r["seconds"] == 10.0 and r["tokens_dir"] == "data/sets_10s/sep_oud/tokens"
        assert r["caption"] == ("Somali song, led by the oud (kaban), moderate at 100 BPM, pentatonic melody rooted on A, "
                                "studio recording, clean, performed by Ahmed Ilkacase")
        assert "hand drums" not in r["caption"]  # the mix had percussive_ratio 0.7; the stem has no drums
    card = (out_root / "sep_oud/SET_CARD.md").read_text()
    assert "# Set card: sep_oud (10 s clips)" in card and "Stem invariant" in card and "`ahmed_mix/captions.jsonl`" in card
    assert "Demucs htdemucs_ft `other` stems of the `ahmed_mix` sources" in card
    # now the mix set: same out-root, same universe -> identical splits, the check sees the stems
    mixb = bs.build_set("ahmed_mix", mix, out_root, seconds=10.0, root=root)
    assert mixb["related_sets_checked"] == ["sep_oud"] and mixb["stem_split_mismatches"] == 0
    assert mixb["stems_checked_against_mix"] == 8
    mix_caps = _read_rows(out_root / "ahmed_mix/captions.jsonl")
    mix_split = {r["song_sha256"]: r["split"] for r in mix_caps}
    assert all(mix_split[r["song_sha256"]] == r["split"] for r in caps)
    vocb = bs.build_set("sep_vocal", voc_sel, out_root, seconds=10.0, root=root)
    assert vocb["related_sets_checked"] == ["ahmed_mix"] and vocb["stems_checked_against_mix"] == vocb["clips_total"] > 0
    voc_caps = _read_rows(out_root / "sep_vocal/captions.jsonl")
    assert all(mix_split[r["song_sha256"]] == r["split"] for r in voc_caps)
    assert all(r["caption"].split(", led by ")[1].startswith("vocals (unaccompanied), ") for r in voc_caps)
    capsys.readouterr()
    # the merge accepts one song in a mix set and its stem sets (different content), checks the invariant
    merged = bs.merge_sets(["ahmed_mix", "sep_oud", "sep_vocal"], out_root, out_root / "mix_and_stems.jsonl", root=root)
    assert merged["rows"] == len(mix_caps) + len(caps) + len(voc_caps) and merged["songs_in_several_sets"] == 0
    assert merged["stem_split_mismatches"] == 0 and merged["seconds"] == [10.0]
    out = capsys.readouterr().out
    assert "LEAKAGE CHECK PASSED" in out and f"STEM/MIX SPLIT CHECK PASSED ({len(caps) + len(voc_caps)} stem clips" in out
    assert (out_root / "mix_and_stems.jsonl").exists()
    # the same content twice (the mix set under another name) is still a duplicate
    (out_root / "ahmed_mix_copy").mkdir()
    (out_root / "ahmed_mix_copy/captions.jsonl").write_text("".join(json.dumps(dict(r, source="ahmed_mix_copy")) + "\n" for r in mix_caps))
    with pytest.raises(SystemExit, match="DUPLICATE SONGS ACROSS SETS"):
        bs.merge_sets(["ahmed_mix", "ahmed_mix_copy", "sep_oud"], out_root, out_root / "dup.jsonl", root=root)


def test_stem_split_invariant_end_to_end(fake_separated: tuple[Path, list[dict], list[dict]], capsys: pytest.CaptureFixture[str]) -> None:
    root, rows, _ = fake_separated
    sep = root / "data/separated"
    out_root = root / "data/sets"
    mix = bs.select_ahmed(rows, "ahmed_mix", root=root)
    oud_sel = bs.select_separated(bs.load_separated_index(sep), "sep_oud", mix, root=root, sep_root=sep)
    bs.build_set("ahmed_mix", mix, out_root, seconds=30.0, root=root)
    mix_caps = _read_rows(out_root / "ahmed_mix/captions.jsonl")
    sha = oud_sel.files[0].sha256
    real_split = next(r["split"] for r in mix_caps if r["song_sha256"] == sha)
    other_split = "test" if real_split != "test" else "val"
    # a stale mix captions file (the song moved): building the stems is refused after writing them
    stale = [dict(r, split=other_split, clip_path=r["clip_path"].replace(f"/{r['split']}/", f"/{other_split}/")) if r["song_sha256"] == sha else r
             for r in mix_caps]
    (out_root / "ahmed_mix/captions.jsonl").write_text("".join(json.dumps(r) + "\n" for r in stale))
    with pytest.raises(SystemExit, match="STEM/MIX SPLIT MISMATCH: 1 stems"):
        bs.build_set("sep_oud", oud_sel, out_root, seconds=30.0, root=root)
    out = capsys.readouterr().out
    assert "LEAKAGE CHECK PASSED" in out and '"stem_split_mismatches": 1' in out
    assert (out_root / "sep_oud/captions.jsonl").exists()  # the rows are on disk for inspection
    assert "1 mismatches" in (out_root / "sep_oud/SET_CARD.md").read_text()
    # rebuilding the mix set (its real splits) only warns that the stems on disk disagree...
    bs.build_set("ahmed_mix", mix, out_root, seconds=30.0, root=root)
    assert "STEM/MIX SPLIT MISMATCH" not in capsys.readouterr().out
    stem_caps = _read_rows(out_root / "sep_oud/captions.jsonl")
    tampered = [dict(r, split=other_split, clip_path=r["clip_path"].replace(f"/{r['split']}/", f"/{other_split}/")) for r in stem_caps]
    (out_root / "sep_oud/captions.jsonl").write_text("".join(json.dumps(r) + "\n" for r in tampered))
    summary = bs.build_set("ahmed_mix", mix, out_root, seconds=30.0, root=root)
    assert summary["stem_split_mismatches"] == 1 and summary["stem_split_examples"][0]["content"] == "sep_oud"
    captured = capsys.readouterr()
    assert "WARNING: 1 stems in sep_oud now sit in another split" in captured.err and "LEAKAGE CHECK PASSED" in captured.out
    # ...and the merge refuses the union until the stems are rebuilt
    with pytest.raises(SystemExit, match="LEAKAGE DETECTED|STEM/MIX SPLIT MISMATCH"):
        bs.merge_sets(["ahmed_mix", "sep_oud"], out_root, out_root / "bad.jsonl", root=root)
    assert not (out_root / "bad.jsonl").exists()
    # rebuilding the stems (resume renames the clips into the mix's split) restores the invariant
    fixed = bs.build_set("sep_oud", oud_sel, out_root, seconds=30.0, root=root)
    assert fixed["stem_split_mismatches"] == 0 and fixed["resumed_files"] == 1
    assert all((root / r["clip_path"]).exists() and r["split"] == real_split for r in _read_rows(out_root / "sep_oud/captions.jsonl"))
    assert bs.merge_sets(["ahmed_mix", "sep_oud"], out_root, out_root / "good.jsonl", root=root)["stem_split_mismatches"] == 0


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
    assert summary["songs_in_several_sets"] == 0 and summary["seconds"] == [None]
    # the same song in two sets (two captions for one audio) is an error, nothing is written
    _set("b", "train", "1" * 64, "song1")
    with pytest.raises(SystemExit, match="DUPLICATE SONGS ACROSS SETS"):
        bs.merge_sets(["a", "b"], out_root, tmp_path / "dup.jsonl", root=tmp_path)
    assert not (tmp_path / "dup.jsonl").exists()
    with pytest.raises(SystemExit, match="no captions"):
        bs.merge_sets(["a", "missing"], out_root, tmp_path / "x.jsonl", root=tmp_path)


def test_merge_across_out_roots_refuses_mixed_seconds(fake_corpus: tuple[Path, list[dict]], capsys: pytest.CaptureFixture[str]) -> None:
    root, rows = fake_corpus
    r30, r10 = root / "data/sets", root / "data/sets_10s"
    oud = bs.select_ahmed(rows, "ahmed_oud", root=root)
    voc = bs.select_ahmed(rows, "ahmed_vocal", root=root)
    bs.build_set("ahmed_oud", oud, r30, seconds=30.0, root=root)
    bs.build_set("ahmed_vocal", voc, r10, seconds=10.0, root=root)
    # a name is looked up in every out-root; different durations are refused unless allowed
    with pytest.raises(SystemExit, match="MIXED CLIP DURATIONS"):
        bs.merge_sets(["ahmed_oud", "ahmed_vocal"], [r30, r10], root / "data/m.jsonl", root=root)
    assert not (root / "data/m.jsonl").exists()
    ok = bs.merge_sets(["ahmed_oud", "ahmed_vocal"], [r30, r10], root / "data/m.jsonl", root=root, allow_mixed_seconds=True)
    assert ok["seconds"] == [10.0, 30.0] and ok["rows"] == 3 + 5 and (root / "data/m.jsonl").exists()
    assert {r["tokens_dir"] for r in _read_rows(root / "data/m.jsonl")} == {"data/sets/ahmed_oud/tokens", "data/sets_10s/ahmed_vocal/tokens"}
    # same duration from two roots merges without the flag
    bs.build_set("ahmed_oud", oud, r10, seconds=10.0, root=root)
    with pytest.raises(SystemExit, match="several out-roots"):  # ahmed_oud now exists under both roots
        bs.merge_sets(["ahmed_oud", "ahmed_vocal"], [r30, r10], root / "data/m2.jsonl", root=root)
    ten = bs.merge_sets([str(r10 / "ahmed_oud"), "ahmed_vocal"], [r30, r10], root / "data/m2.jsonl", root=root)
    assert ten["seconds"] == [10.0] and set(ten["per_set"]) == {"ahmed_oud", "ahmed_vocal"} and ten["rows"] == 13 + 5
    # a set given as a repo-relative path or as its captions file
    by_file = bs.merge_sets(["data/sets_10s/ahmed_oud/captions.jsonl", "data/sets_10s/ahmed_vocal"], [r30], root / "data/m3.jsonl", root=root)
    assert by_file["rows"] == 18
    with pytest.raises(SystemExit, match="does not exist"):
        bs.merge_sets(["data/sets_10s/nothing"], [r30], root / "data/m4.jsonl", root=root)
    capsys.readouterr()


# ---------------------------------------------------------------------------
# CLI: the out-root guard and end-to-end runs through main()
# ---------------------------------------------------------------------------


def _write_classified(root: Path, rows: list[dict]) -> Path:
    classified = root / "data/inventory/ahmed_classified.jsonl"
    classified.parent.mkdir(parents=True, exist_ok=True)
    classified.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return classified


def test_main_refuses_out_root_outside_data_unless_allowed(fake_corpus: tuple[Path, list[dict]], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    root, rows = fake_corpus
    monkeypatch.setattr(bs, "REPO", root)
    classified = _write_classified(root, rows)
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
    # an unknown set name and two out-roots for --set are argparse errors
    with pytest.raises(SystemExit) as exc:
        bs.main(["--set", "harvard_oud", "--dry-run"])
    assert exc.value.code == 2 and "unknown set" in capsys.readouterr().err
    with pytest.raises(SystemExit) as exc:
        bs.main(["--set", "ahmed_oud", "--out-root", "data/sets", "--out-root", "data/sets_10s", "--dry-run"])
    assert exc.value.code == 2 and "one --out-root" in capsys.readouterr().err


def test_main_ten_second_build_and_sep_dry_run_without_separation(fake_corpus: tuple[Path, list[dict]], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    root, rows = fake_corpus
    monkeypatch.setattr(bs, "REPO", root)
    _write_classified(root, rows + [
        {"path": str(root / "data/ahmed_raw/GarageBand/amare cod.band/Media/No Effects#02.wav"), "name": "mix.wav", "content": "full_mix",
         "song_group": "amare", "sha256": bs.full_sha256(root / "data/ahmed_raw/GarageBand/amare cod.band/Media/No Effects#02.wav")},
    ])
    bs.main(["--set", "ahmed_oud", "--seconds", "10", "--out-root", "data/sets_10s", "--no-scorer"])
    out = capsys.readouterr().out
    assert "LEAKAGE CHECK PASSED" in out
    caps = _read_rows(root / "data/sets_10s/ahmed_oud/captions.jsonl")
    assert len(caps) == 13 and all("/ahmed_oud_10s_" in r["clip_path"] and r["seconds"] == 10.0 for r in caps)
    assert "(10 s clips)" in (root / "data/sets_10s/ahmed_oud/SET_CARD.md").read_text()
    # sep_oud --dry-run before any separation exists: a summary with 0 files and a clear note, exit 0
    assert not (root / "data/separated").exists()
    bs.main(["--set", "sep_oud", "--dry-run"])
    summary = json.loads(capsys.readouterr().out)
    assert summary["set"] == "sep_oud" and summary["files"] == 0 and summary["dry_run"]
    assert "no separation output" in summary["note"] and "data/separated/index.jsonl" in summary["note"]
    assert "run the Demucs separation step first (0 files selected)" in summary["note"]
    assert summary["files_per_split"] == {"train": 0, "val": 0, "test": 0} and summary["preview"] == []
    assert summary["split_universe"] == 3  # the mix set's universe: every non-excluded inventory row's group (wadada, riftoon, amare)
    assert not (root / "data/sets/sep_oud").exists()
    # without --dry-run the same situation is an error with the same message
    with pytest.raises(SystemExit, match="no separation output"):
        bs.main(["--set", "sep_vocal"])
    # the 10 s dry run of the sep set names the infixed stem
    bs.main(["--set", "sep_oud", "--dry-run", "--seconds", "10", "--out-root", "data/sets_10s"])
    assert json.loads(capsys.readouterr().out)["clip_stem"] == "sep_oud_10s_<sha256>_seg000"
    # --merge with several out-roots through the CLI
    bs.main(["--set", "ahmed_vocal", "--out-root", "data/sets", "--no-scorer"])
    capsys.readouterr()
    with pytest.raises(SystemExit, match="MIXED CLIP DURATIONS"):
        bs.main(["--merge", "both", "--out-root", "data/sets_10s", "--out-root", "data/sets", "--sets", "ahmed_oud", "ahmed_vocal"])
    bs.main(["--merge", "both", "--out-root", "data/sets_10s", "--out-root", "data/sets", "--sets", "ahmed_oud", "ahmed_vocal",
             "--allow-mixed-seconds"])
    assert "LEAKAGE CHECK PASSED" in capsys.readouterr().out
    assert len(_read_rows(root / "data/sets_10s/both_captions.jsonl")) == 14


def test_main_generic_set_from_rights_inventory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    root = tmp_path
    monkeypatch.setattr(bs, "REPO", root)
    _patch_decode(monkeypatch)
    rows = _generic_rows(root)
    inv = root / "data/inventory/internet_classified.jsonl"
    inv.parent.mkdir(parents=True, exist_ok=True)
    inv.write_text("".join(json.dumps(r) + "\n" for r in rows))
    with pytest.raises(SystemExit, match="mix rights tiers"):
        bs.main(["--set", "internet_oud", "--classified", str(inv), "--dry-run"])
    inv.write_text("".join(json.dumps(r) + "\n" for r in rows if r.get("rights") != "contrib_hodan_consented"))
    bs.main(["--set", "internet_oud", "--classified", str(inv)])
    assert "LEAKAGE CHECK PASSED" in capsys.readouterr().out
    caps = _read_rows(root / "data/sets/internet_oud/captions.jsonl")
    assert len(caps) == 2 and all(r["rights"] == "internet_cc" and r["source"] == "internet_oud" for r in caps)
    by_name = {r["source_name"]: r for r in caps}
    assert by_name["Qaraami kaban 1978.wav"]["caption"].endswith("archival recording, performed by Cabdi Holland")
    assert by_name["Heello 2015.wav"]["caption"].endswith("pentatonic melody rooted on A, studio recording")
    assert all(r["clip_path"].startswith(f"data/sets/internet_oud/clips/{r['split']}/internet_oud_") for r in caps)
    card = (root / "data/sets/internet_oud/SET_CARD.md").read_text()
    assert "`internet_cc`" in card and "attribution recorded" in card
    # the contributor tier alone builds its own set with its own card line
    inv.write_text("".join(json.dumps(r) + "\n" for r in rows if r.get("rights") == "contrib_hodan_consented"))
    bs.main(["--set", "hodan_oud", "--classified", str(inv)])
    capsys.readouterr()
    hodan = _read_rows(root / "data/sets/hodan_oud/captions.jsonl")
    assert [r["rights"] for r in hodan] == ["contrib_hodan_consented"] and hodan[0]["caption"].endswith("studio recording, clean")
    assert "contributor 'hodan'" in (root / "data/sets/hodan_oud/SET_CARD.md").read_text()
    # the two tiers merge (different songs), each row keeping its own tier
    bs.main(["--merge", "web", "--sets", "internet_oud", "hodan_oud"])
    capsys.readouterr()
    assert Counter(r["rights"] for r in _read_rows(root / "data/sets/web_captions.jsonl")) == {"internet_cc": 2, "contrib_hodan_consented": 1}


def test_harvard_instruments_claim_only_what_the_title_supports() -> None:
    from scripts.build_sets import harvard_instruments, instrument_phrase

    assert harvard_instruments("Side A. Track 1: Wisiisi (Longing) Sahro Axmed and others") == ["vocals", "ensemble"]
    assert harvard_instruments("Side B. Track 2: Kaban solo") == ["vocals", "the oud (kaban)"]
    assert instrument_phrase("full_mix", None, harvard_instruments("x")) == "vocals and ensemble"


# ---------------------------------------------------------------------------
# Review fixes: interrupted runs, the song tonic consensus, chroma pointers, no-clip sources, tiers
# ---------------------------------------------------------------------------


def _third_oud_source(root: Path, rows: list[dict]) -> list[dict]:
    c = _write_wav(root / "data/raw_incoming/oud_ilkacase/hoos qaraami saddex.wav", _tone(31.0, 550.0))
    return rows + [{"path": str(c), "name": c.name, "content": "oud", "song_group": "saddex", "source_group": "ahmed_collection",
                    "sha256": bs.full_sha256(c)}]


def test_interrupted_full_run_keeps_the_unreached_sources_resumable(fake_corpus: tuple[Path, list[dict]], monkeypatch: pytest.MonkeyPatch) -> None:
    root, rows = fake_corpus
    out_root = root / "data/sets"
    sel = bs.select_ahmed(_third_oud_source(root, rows), "ahmed_oud", root=root)
    assert len(sel.files) == 3
    bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    built = _read_rows(out_root / "ahmed_oud/captions.jsonl")
    # the second source (in build order) lost a clip, so it must be re-cut; the cut is interrupted (battery, Ctrl-C)
    second = sel.files[1]
    (root / next(r["clip_path"] for r in built if r["song_sha256"] == second.sha256)).unlink()
    real_cut = bs._cut_source

    def interrupted(src, *a, **kw):
        if src.sha256 == second.sha256:
            raise KeyboardInterrupt
        return real_cut(src, *a, **kw)

    monkeypatch.setattr(bs, "_cut_source", interrupted)
    with pytest.raises(KeyboardInterrupt):
        bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    # the captions on disk hold the resumed first source AND the untouched rows of the sources not reached
    after = _read_rows(out_root / "ahmed_oud/captions.jsonl")
    assert {r["song_sha256"] for r in after} == {f.sha256 for f in sel.files}
    assert sorted(after, key=lambda r: r["clip_path"]) == sorted(built, key=lambda r: r["clip_path"])
    # the rerun decodes only the interrupted source; the other two resume
    monkeypatch.setattr(bs, "_cut_source", real_cut)
    decoded: list[str] = []
    real_decode = bs.decode_mono32
    monkeypatch.setattr(bs, "decode_mono32", lambda p: decoded.append(Path(p).name) or real_decode(p))
    summary = bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    assert summary["resumed_files"] == 2 and decoded == [second.name]
    assert summary["clips_total"] == len(built) and summary["orphan_clips"] == 0
    assert all((root / r["clip_path"]).exists() for r in _read_rows(out_root / "ahmed_oud/captions.jsonl"))


def _desc(tonic: str, offset: float | None, source: str = "scorer", bpm: float = 100.0) -> bs.ClipDescription:
    return bs.ClipDescription(bpm=bpm, tonic=tonic, tonic_source=source, tuning_offset_cents=offset)


def test_song_consensus_resolves_the_quarter_tone_wrap_and_majorities() -> None:
    assert bs.tonic_abs_cents("C", 0.0) == 0.0 and bs.tonic_abs_cents("A", -50.0) == 850.0 and bs.tonic_abs_cents("C", -48.0) == 1152.0
    # a recording ~50 cents off A440: the scorer reads C# +46 on one clip and D -48 on the next (4 cents apart
    # on the pitch circle); the song gets one tonic and one direction
    alternating = [_desc("C#", 46.0), _desc("D", -48.0), _desc("C#", 44.0), _desc("D", -46.0), _desc("C#", 47.0)]
    assert bs.song_consensus(alternating) == ("C#", 48.6)
    assert bs.song_consensus(list(reversed(alternating))) == ("C#", 48.6)
    # the wrap across the octave seam (B +48 / C -48) is one cluster too
    assert bs.song_consensus([_desc("B", 48.0), _desc("C", -48.0)]) == ("C", -50.0)
    # a fifth-related ambiguity resolves to the majority, not the mean
    assert bs.song_consensus([_desc("D", -2.0), _desc("A", 3.0), _desc("D", 1.0), _desc("D", 4.0)]) == ("D", 1.0)
    # ties: the lowest pitch class wins, deterministically
    assert bs.song_consensus([_desc("A", 0.0), _desc("D", 0.0)]) == ("D", 0.0)
    # only scored clips vote; a song without any gives no consensus
    assert bs.song_consensus([_desc("A", None, "histogram"), _desc("G", None, "histogram")]) is None
    assert bs.song_consensus([]) is None
    assert bs.song_consensus([_desc("A", None, "histogram"), _desc("G", -20.0)]) == ("G", -20.0)
    # the tag direction follows the consensus offset
    assert bs.tuning_tag(48.6) == "tuned 49 cents sharp of A440" and bs.tuning_tag(-50.0) == "tuned 50 cents flat of A440"


def test_song_consensus_end_to_end_one_tonic_per_song(fake_corpus: tuple[Path, list[dict]], monkeypatch: pytest.MonkeyPatch) -> None:
    root, rows = fake_corpus
    out_root = root / "data/sets"
    sel = bs.select_ahmed(rows, "ahmed_oud", root=root)
    calls = {"n": 0}

    def alternating(clip, device=None):
        calls["n"] += 1
        if calls["n"] % 2:
            return SimpleNamespace(tonic_name="C#", tuning_offset_cents=46.0)
        return SimpleNamespace(tonic_name="D", tuning_offset_cents=-48.0)

    monkeypatch.setattr(bs, "score_clip", alternating)
    summary = bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    caps = _read_rows(out_root / "ahmed_oud/captions.jsonl")
    two = [r for r in caps if r["song_group"] == "wadada"]  # the 46 s source: two clips, two opposite readings
    assert len(two) == 2 and {r["clip_tonic"] for r in two} == {"C#", "D"} and {r["clip_tuning_offset_cents"] for r in two} == {46.0, -48.0}
    assert all(r["tonic"] == "C#" and r["tuning_offset_cents"] == 49.0 and r["tonic_source"] == "scorer" for r in two)
    assert all("pentatonic melody rooted on C#, tuned 49 cents sharp of A440, studio recording" in r["caption"] for r in two)
    assert len({r["caption"].split(", ")[4:6][0] for r in two}) == 1  # one tonic claim per song
    one = [r for r in caps if r["song_group"] == "riftoon"]
    assert len(one) == 1 and one[0]["tonic"] == one[0]["clip_tonic"] == "C#" and one[0]["tuning_offset_cents"] == 46.0
    assert summary["tonic_consensus_changed_clips"] == 1 and summary["tonics"] == {"C#": 3}
    assert summary["tuning_tagged_clips"] == 3 and summary["tonic_sources"] == {"scorer": 3}
    card = (out_root / "ahmed_oud/SET_CARD.md").read_text()
    assert "clips whose own reading differed: 1" in card and '"C#": 3' in card
    # resume keeps the consensus fields verbatim
    _forbid_decode(monkeypatch)
    assert bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)["resumed_files"] == 2
    assert _read_rows(out_root / "ahmed_oud/captions.jsonl") == caps
    # a clip the scorer cannot score takes the song's answer (tonic_source "song"), including the tuning
    _patch_decode(monkeypatch)
    calls["n"] = 0

    def one_unscored(clip, device=None):
        calls["n"] += 1
        return None if calls["n"] == 2 else SimpleNamespace(tonic_name="D", tuning_offset_cents=-20.0)

    monkeypatch.setattr(bs, "score_clip", one_unscored)
    mixed = bs.build_set("ahmed_oud", sel, root / "data/sets_b", seconds=30.0, root=root)
    assert mixed["tonic_sources"] == {"scorer": 2, "song": 1} and mixed["tuning_tagged_clips"] == 3
    rows_b = _read_rows(root / "data/sets_b/ahmed_oud/captions.jsonl")
    song = next(r for r in rows_b if r["tonic_source"] == "song")
    assert song["tonic"] == "D" and song["clip_tonic"] == "A" and song["clip_tuning_offset_cents"] is None
    assert song["tuning_offset_cents"] == -20.0 and "rooted on D, tuned 20 cents flat of A440" in song["caption"]


def test_chroma_dir_survives_resume_recaption_and_recut(fake_corpus: tuple[Path, list[dict]], monkeypatch: pytest.MonkeyPatch) -> None:
    root, rows = fake_corpus
    out_root = root / "data/sets"
    sel = bs.select_ahmed(rows, "ahmed_oud", root=root)
    bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    caps = _read_rows(out_root / "ahmed_oud/captions.jsonl")
    # scale_chroma --write-chroma-dir: a .npy per clip stem and chroma_dir on every row
    chroma = out_root / "ahmed_oud/chroma"
    chroma.mkdir()
    for r in caps:
        np.save(chroma / f"{Path(r['clip_path']).stem}.npy", np.zeros((235, 12), dtype=np.float16))
        r["chroma_dir"] = "data/sets/ahmed_oud/chroma"
    (out_root / "ahmed_oud/captions.jsonl").write_text("".join(json.dumps(r) + "\n" for r in caps))
    _forbid_decode(monkeypatch)
    resumed = bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    assert resumed["resumed_files"] == 2 and resumed["rows_with_chroma_dir"] == 3
    assert all(r["chroma_dir"] == "data/sets/ahmed_oud/chroma" for r in _read_rows(out_root / "ahmed_oud/captions.jsonl"))
    # a split move keeps the pointer (the stem does not name the split)
    moved_split = "test" if caps[0]["split"] != "test" else "val"
    monkeypatch.setattr(bs, "assign_splits", lambda files, universe=(): {f.sha256: moved_split for f in files})
    assert bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)["rows_with_chroma_dir"] == 3
    monkeypatch.undo()
    _forbid_decode(monkeypatch)
    # a caption-version re-caption keeps it too, except for a stem whose .npy is gone
    stale = [dict(r, caption_version=1) for r in _read_rows(out_root / "ahmed_oud/captions.jsonl")]
    (out_root / "ahmed_oud/captions.jsonl").write_text("".join(json.dumps(r) + "\n" for r in stale))
    gone = Path(stale[0]["clip_path"]).stem
    (chroma / f"{gone}.npy").unlink()
    recap = bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    assert recap["recaptioned_files"] == 2 and recap["rows_with_chroma_dir"] == 2
    by_stem = {Path(r["clip_path"]).stem: r for r in _read_rows(out_root / "ahmed_oud/captions.jsonl")}
    assert "chroma_dir" not in by_stem[gone] and all("chroma_dir" in r for s, r in by_stem.items() if s != gone)
    # a re-cut of the same window (a clip went missing) re-attaches the pointer by stem
    _patch_decode(monkeypatch)
    victim = next(r for r in by_stem.values() if "chroma_dir" in r)
    (root / victim["clip_path"]).unlink()
    recut = bs.build_set("ahmed_oud", sel, out_root, seconds=30.0, root=root)
    assert recut["resumed_files"] + recut["recaptioned_files"] == 1 and recut["rows_with_chroma_dir"] == 2
    assert _read_rows(out_root / "ahmed_oud/captions.jsonl") and (root / victim["clip_path"]).exists()
    # another window has other stems: no pointer is invented
    assert bs.build_set("ahmed_oud", sel, root / "data/sets_10s", seconds=10.0, root=root)["rows_with_chroma_dir"] == 0
    assert bs.kept_chroma_dir(None, "x", root) is None and bs.kept_chroma_dir({"chroma_dir": "nowhere"}, "x", root) is None


def test_sources_that_give_no_clips_are_counted(fake_corpus: tuple[Path, list[dict]], capsys: pytest.CaptureFixture[str]) -> None:
    root, rows = fake_corpus
    coll = root / "data/raw_incoming/oud_ilkacase"
    short = _write_wav(coll / "five seconds.wav", _tone(5.0))
    rows = rows + [{"path": str(short), "name": short.name, "content": "oud", "song_group": "five", "source_group": "ahmed_collection",
                    "sha256": bs.full_sha256(short)}]
    sel = bs.select_ahmed(rows, "ahmed_oud", root=root)
    assert len(sel.files) == 3
    summary = bs.build_set("ahmed_oud", sel, root / "data/sets_10s", seconds=10.0, root=root)
    assert summary["failed"] == {"no_clips_source_shorter_than_window": 1} and summary["files"] == 3
    assert summary["clips_total"] == 13 and "five" not in {r["song_group"] for r in _read_rows(root / "data/sets_10s/ahmed_oud/captions.jsonl")}
    err = capsys.readouterr().err
    assert "no clips from five seconds.wav: 5.0 s decoded, 10 s window (source_shorter_than_window)" in err
    assert '"no_clips_source_shorter_than_window": 1' in (root / "data/sets_10s/ahmed_oud/SET_CARD.md").read_text()


def test_include_third_party_names_no_performer_and_flags_the_rows(fake_separated: tuple[Path, list[dict], list[dict]], monkeypatch: pytest.MonkeyPatch) -> None:
    root, rows, _ = fake_separated
    default = bs.select_ahmed(rows, "ahmed_mix", root=root)
    assert default.skipped["third_party_import"] == 1 and all(f.rights == bs.RIGHTS_AHMED for f in default.files)
    assert not any(f.extra.get("third_party_suspect") for f in default.files)
    sel = bs.select_ahmed(rows, "ahmed_mix", root=root, include_third_party=True)
    assert "third_party_import" not in sel.skipped and len(sel.files) == len(default.files) + 1
    suspect = next(f for f in sel.files if f.song_group == "import07")
    # the tier stays Ahmed's (separate_stems / corpus_report carry the flag separately and rely on that),
    # but the caption never claims his performance and the rows say why
    assert suspect.rights == bs.RIGHTS_AHMED and suspect.performer is None
    assert suspect.extra["third_party_suspect"] is True and suspect.extra["third_party_reason"] == "import"
    cap = bs.build_caption(suspect, 100.0, "A")
    assert "performed by" not in cap and cap.endswith("studio recording, clean")
    assert bs.performer_of(suspect) is None and all(bs.performer_of(f) == "Ahmed Ilkacase" for f in sel.files if f is not suspect)
    assert bs.set_rights("ahmed_mix", sel.files) == bs.RIGHTS_AHMED
    assert "research-only as a whole" in bs.rights_line("mixed: a, b")
    summary = bs.build_set("ahmed_mix", sel, root / "data/sets", seconds=30.0, root=root)
    caps = _read_rows(root / "data/sets/ahmed_mix/captions.jsonl")
    flagged = [r for r in caps if r.get("third_party_suspect")]
    assert summary["third_party_rows"] == len(flagged) == 1 and flagged[0]["third_party_reason"] == "import"
    assert "performed by" not in flagged[0]["caption"] and flagged[0]["song_group"] == "import07"
    assert all("third_party_suspect" not in r and "performed by Ahmed Ilkacase" in r["caption"] for r in caps if r["song_group"] != "import07")
    assert "Third-party-suspect rows admitted with --include-third-party: 1" in (root / "data/sets/ahmed_mix/SET_CARD.md").read_text()
    # the flag survives a resume
    _forbid_decode(monkeypatch)
    assert bs.build_set("ahmed_mix", sel, root / "data/sets", seconds=30.0, root=root)["third_party_rows"] == 1


def test_rights_line_by_contributor_suffix() -> None:
    assert "consented rows" in bs.rights_line("contrib_hodan_consented") and "'hodan'" in bs.rights_line("contrib_hodan_consented")
    assert "research-only rows" in bs.rights_line("contrib_hodan_research_only") and "never served" in bs.rights_line("contrib_hodan_research_only")
    assert "consented" not in bs.rights_line("contrib_hodan_research_only").split(":")[1]
    assert "not contrib_<name>_consented" in bs.rights_line("contrib_hodan_maybe")
    assert bs.rights_line("internet_cc") == bs.RIGHTS_LINES["internet_cc"]
    assert bs.rights_line("something") == "unknown tier: treat as research-only until docs/DATA_PROVENANCE.md names it."


def test_main_refuses_a_window_that_cannot_be_cut(fake_corpus: tuple[Path, list[dict]], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    root, rows = fake_corpus
    monkeypatch.setattr(bs, "REPO", root)
    classified = _write_classified(root, rows)
    for bad in ("0", "-5", "nan", "inf"):
        with pytest.raises(SystemExit) as exc:
            bs.main(["--set", "ahmed_oud", "--classified", str(classified), "--seconds", bad, "--dry-run"])
        assert exc.value.code == 2 and "--seconds" in capsys.readouterr().err
    assert not (root / "data/sets").exists()



def test_scored_segments_budget() -> None:
    from scripts.build_sets import scored_segments

    assert scored_segments(5, 0) == {0, 1, 2, 3, 4}
    assert scored_segments(3, 5) == {0, 1, 2}
    assert scored_segments(10, 3) == {0, 4, 9}  # evenly spaced, ends included
    assert scored_segments(10, 1) == {0}
    assert scored_segments(0, 3) == set()
