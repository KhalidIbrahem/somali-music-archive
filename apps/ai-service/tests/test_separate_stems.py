"""Unit tests for scripts/separate_stems.py -- Demucs stem separation over the full mixes.

No corpus, GPU, network or real Demucs: get_model / apply_model are fakes that
derive four stems from the input, the ffmpeg decode is a soundfile read, CREPE
(extract_f0) is a fake driven by the window's energy, and the inventories are
tiny fixtures under tmp_path. The one test that touches ffmpeg is skipped
when the binary is absent.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
import time
from pathlib import Path

import demucs
import numpy as np
import pytest
import soundfile as sf
import torch

from scripts import separate_stems as ss

SR_IN = 44100
SOURCES = ["drums", "bass", "other", "vocals"]
DEFAULT_GAINS = {"drums": 0.5, "bass": 0.25, "other": 0.8, "vocals": 0.1}


# ---------------------------------------------------------------------------
# Fakes and fixtures
# ---------------------------------------------------------------------------


class FakeModel:
    """Stands in for demucs.pretrained.get_model('htdemucs_ft')."""

    sources = SOURCES
    samplerate = SR_IN

    def eval(self) -> FakeModel:
        return self

    def to(self, device: str) -> FakeModel:
        return self


def make_fake_apply(gains: dict[str, float] | None = None, calls: list[dict] | None = None):
    gains = gains or DEFAULT_GAINS

    def fake_apply(model, mix, device=None, shifts=1, split=True, overlap=0.25, progress=False):
        assert mix.ndim == 3 and mix.shape[0] == 1 and mix.shape[1] == 2, mix.shape
        if calls is not None:
            calls.append({"device": device, "shifts": shifts, "split": split, "overlap": overlap, "n": int(mix.shape[-1])})
        return torch.stack([mix[0] * gains[name] for name in model.sources], dim=0)[None]

    return fake_apply


def fake_extract_f0(audio: np.ndarray, device: str, sr: int = 32000):
    """A 220 Hz voiced frame for every 20 ms of audible signal, unvoiced otherwise."""
    frames = max(1, len(audio) // (sr // 50))
    if float(np.sqrt(np.mean(np.square(audio, dtype=np.float64)))) > 1e-4:
        return np.full(frames, 220.0, dtype=np.float32), np.full(frames, 0.9, dtype=np.float32)
    return np.zeros(frames, dtype=np.float32), np.zeros(frames, dtype=np.float32)


def fake_decode(path: Path, sr: int = SR_IN) -> np.ndarray:
    audio, rate = sf.read(path, dtype="float32", always_2d=True)
    assert rate == sr
    x = audio.T
    return np.stack([x[0], x[0]]) if x.shape[0] == 1 else np.ascontiguousarray(x[:2])


def _tone(seconds: float, freq: float = 220.0, amp: float = 0.3, channels: int = 2) -> np.ndarray:
    t = np.arange(int(seconds * SR_IN)) / SR_IN
    mono = (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    return np.stack([mono] * channels, axis=1) if channels > 1 else mono


def _write(path: Path, audio: np.ndarray) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, audio, SR_IN, subtype="PCM_16")
    return path


def _touch(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(str(path).encode("utf-8") * 4)
    return path


def _sha(path: Path) -> str:
    return ss.row_sha256({}, path)


def _jsonl(path: Path, rows: list[dict]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return path


def _catalog_csv(path: Path, rows: list[tuple[str, str, str, str]]) -> Path:
    lines = [
        'Collection Title,"Somali Songs, 1955-1991"',
        "Database Number,Component Title,Component Date,Container Info,Component Type,Digital Content Link,Level 2",
    ]
    for cid, title, container, typ in rows:
        lines.append(f'{cid},"{title}",1955-1991,"{container}",{typ},https://x/{cid},')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n")
    return path


@pytest.fixture
def corpus(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict:
    """Five separable full mixes across four corpora plus the rows every rule must skip."""
    root = tmp_path
    gb = root / "data/ahmed_raw/GarageBand"
    coll = root / "data/raw_incoming/oud_ilkacase"
    hr = root / "data/harvard_raw"
    mix = _write(gb / "wadada.band/Output/Output.wav", _tone(40.0))
    coll_mix = _write(coll / "Laxanka Qaraamiga ah_mixed.wav", _tone(35.0, 330.0))
    oud = _write(coll / "Qaraami kaban.wav", _tone(31.0))
    third = _write(gb / "imports.band/Media/07 Track 7.wav", _tone(31.0))
    excluded = _touch(gb / "wadada.band/Media/No Effects#02.wav")
    classified = [
        {"path": str(mix), "name": mix.name, "content": "full_mix", "song_group": "wadada", "source_group": "garageband",
         "project": "wadada", "sha256": _sha(mix), "duration_s": 40.0},
        {"path": str(coll_mix), "name": coll_mix.name, "content": None, "song_group": "laxanka", "source_group": "ahmed_collection",
         "project": "ahmed_collection", "sha256": _sha(coll_mix), "duration_s": 35.0},
        {"path": str(oud), "name": oud.name, "content": "oud", "song_group": "kaban", "source_group": "ahmed_collection",
         "sha256": _sha(oud), "duration_s": 31.0},
        {"path": str(third), "name": third.name, "content": "full_mix", "song_group": "imports", "source_group": "garageband",
         "sha256": _sha(third), "duration_s": 31.0, "third_party_suspect": True, "third_party_reason": "import"},
        {"path": str(excluded), "name": excluded.name, "content": "full_mix", "song_group": "wadada", "source_group": "garageband",
         "sha256": "0" * 64, "excluded": True, "exclude_reason": "duplicate"},
    ]
    side = _touch(hr / "legacy/track_0001_Sahro_Axmed.wav")
    legacy_track = _write(hr / "legacy/track_0002_Side_A_Track_1_Wisiisi.wav", _tone(33.0, 262.0))
    fetched_track = _write(hr / "AWM_SC_12201_A1_Ayaamaha__mus00044c00092.wav", _tone(36.0, 294.0))
    manifest = [
        {"cid": "c0001", "status": "legacy", "type": "Item", "title": "Sahro Axmed and others", "cassette": "12200",
         "file": "data/harvard_raw/legacy/track_0001_Sahro_Axmed.wav", "sha256": _sha(side), "duration_s": 1784.0},
        {"cid": "c0081", "status": "legacy", "type": "Track", "title": "Side A. Track 1: Wisiisi", "parent": "Sahro Axmed and others",
         "cassette": "12200", "file": "data/harvard_raw/legacy/track_0002_Side_A_Track_1_Wisiisi.wav", "sha256": _sha(legacy_track), "duration_s": 33.0},
        {"cid": "mus00044c00092", "status": "fetched", "type": "Track", "title": "Side A. Track 1: Ayaamaha", "cassette": "12201",
         "file": "data/harvard_raw/AWM_SC_12201_A1_Ayaamaha__mus00044c00092.wav", "sha256": _sha(fetched_track), "duration_s": 36.0},
        {"cid": "c0999", "status": "skipped", "type": "Item", "title": "Skipped", "cassette": "12400", "reason": "cassette-level object"},
    ]
    catalog = _catalog_csv(root / "data/harvard_catalog/mus00044.csv", [
        ("c0001", "Sahro Axmed and others", "Box 1, Audiocassette AWM SC 12200", "Item"),
        ("c0081", "Side A. Track 1: Wisiisi", "", "Track"),
        ("mus00044c00092", "Side A. Track 1: Ayaamaha", "", "Track"),
    ])
    cc = _write(root / "data/raw_incoming/internet/cc_song.wav", _tone(32.0, 196.0))
    no_rights = _write(root / "data/raw_incoming/internet/no_rights.wav", _tone(31.0))
    extra = [
        {"path": str(cc), "name": cc.name, "role_guess": "song", "content": None, "rights": "internet_cc",
         "project": "archive.org/x", "sha256": _sha(cc), "duration_s": 32.0},
        {"path": str(no_rights), "name": no_rights.name, "role_guess": "song", "sha256": _sha(no_rights)},
        {"path": str(cc), "name": "solo.wav", "role_guess": "song", "content": "oud", "rights": "internet_cc", "sha256": "1" * 64},
    ]
    paths = {
        "classified": _jsonl(root / "data/inventory/ahmed_classified.jsonl", classified),
        "manifest": _jsonl(root / "data/harvard_raw/manifest.jsonl", manifest),
        "catalog": catalog,
        "extra": _jsonl(root / "data/inventory/internet_cc.jsonl", extra),
    }
    monkeypatch.setattr(ss, "get_model", lambda name: FakeModel() if name == "htdemucs_ft" else pytest.fail(name))
    monkeypatch.setattr(ss, "apply_model", make_fake_apply())
    monkeypatch.setattr(ss, "decode_stereo", fake_decode)
    monkeypatch.setattr(ss, "extract_f0", fake_extract_f0)
    return {
        "root": root, "paths": paths, "classified": classified, "manifest": manifest, "extra": extra,
        "files": {"mix": mix, "coll_mix": coll_mix, "third": third, "side": side, "legacy_track": legacy_track,
                  "fetched_track": fetched_track, "cc": cc},
    }


def _args(c: dict, out: Path, *more: str) -> list[str]:
    p = c["paths"]
    return [
        "--root", str(c["root"]), "--classified", str(p["classified"]), "--harvard-manifest", str(p["manifest"]),
        "--harvard-catalog", str(p["catalog"]), "--extra-inventory", str(p["extra"]), "--out", str(out), "--device", "cpu",
        *more,
    ]


def _summary(capsys: pytest.CaptureFixture[str]) -> dict:
    lines = [line for line in capsys.readouterr().out.splitlines() if line.startswith("{")]
    assert lines, "no JSON summary printed"
    return json.loads(lines[-1])


def _read_index(out: Path) -> list[dict]:
    return [json.loads(line) for line in (out / "index.jsonl").read_text().splitlines() if line.strip()]


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------


def test_select_jobs_corpora_and_harvard_selection_reuse(corpus: dict) -> None:
    c = corpus
    catalog = ss.load_catalog(c["paths"]["catalog"])
    jobs, skipped = ss.select_jobs(c["classified"], c["manifest"], catalog, [c["extra"]], root=c["root"])
    by_path = {j.path: j for j in jobs}
    f = c["files"]
    assert set(by_path) == {f["mix"], f["coll_mix"], f["legacy_track"], f["fetched_track"], f["cc"]}
    assert by_path[f["mix"]].corpus == "ahmed" and by_path[f["mix"]].rights == "ahmed_ilkacase_consented"
    assert by_path[f["coll_mix"]].corpus == "ahmed_collection" and by_path[f["coll_mix"]].rights == "ahmed_ilkacase_consented"
    assert by_path[f["legacy_track"]].corpus == "harvard" and by_path[f["legacy_track"]].rights == "harvard_research_only"
    assert by_path[f["fetched_track"]].project == "AWM SC 12201" and by_path[f["fetched_track"]].song_group == "mus00044c00092"
    assert by_path[f["cc"]].corpus == "internet_cc" and by_path[f["cc"]].rights == "internet_cc"
    # the superseded whole side is not in the list: exactly harvard_full's selection
    assert f["side"] not in by_path and skipped["harvard:superseded_by_legacy_tracks"] == 1
    assert skipped["harvard:status_skipped"] == 1
    assert skipped["ahmed:third_party_import"] == 1 and skipped["ahmed:excluded"] == 1
    assert skipped["ahmed:collection_as_oud_from_oud"] == 0 and skipped["ahmed:content_oud"] == 0
    assert skipped["ahmed:collection_reserved_for_ahmed_oud"] == 1  # the non-mixed collection file belongs to ahmed_oud
    assert skipped["extra:no_rights"] == 1 and skipped["extra:content_oud"] == 1
    assert [j.corpus for j in jobs] == sorted(j.corpus for j in jobs)  # (corpus, sha) order
    assert all(j.sha12 == j.sha256[:12] and len(j.sha12) == 12 for j in jobs)


def test_include_third_party_admits_the_suspect(corpus: dict, capsys: pytest.CaptureFixture[str]) -> None:
    c = corpus
    jobs, _ = ss.select_jobs(c["classified"], [], {}, root=c["root"], include_third_party=True)
    by_path = {j.path: j for j in jobs}
    assert c["files"]["third"] in by_path
    assert all(j.corpus in ("ahmed", "ahmed_collection") for j in jobs)
    # the flag travels with the job so the record is self-describing about the unverified authorship
    assert by_path[c["files"]["third"]].third_party_suspect is True
    assert by_path[c["files"]["third"]].third_party_reason == "import"
    assert by_path[c["files"]["mix"]].third_party_suspect is False and by_path[c["files"]["mix"]].third_party_reason is None

    out = c["root"] / "data/separated"
    ss.main(_args(c, out, "--include-third-party"))
    summary = _summary(capsys)
    assert summary["files"] == 6 and summary["include_third_party"] is True
    rec = json.loads((out / "ahmed" / _sha(c["files"]["third"])[:12] / "stems.json").read_text())
    assert rec["third_party_suspect"] is True and rec["third_party_reason"] == "import"
    assert rec["rights"] == "ahmed_ilkacase_consented"  # unchanged: corpus_report decides what to do with the flag
    clean = json.loads((out / "ahmed" / _sha(c["files"]["mix"])[:12] / "stems.json").read_text())
    assert clean["third_party_suspect"] is False and clean["third_party_reason"] is None
    assert sum(1 for r in _read_index(out) if r["third_party_suspect"]) == 1


def test_select_extra_rules(tmp_path: Path) -> None:
    data = tmp_path / "data" / "raw_incoming"
    a = _touch(data / "a.wav")
    b = _touch(data / "b.wav")
    outside = _touch(tmp_path / "elsewhere" / "c.wav")
    rows = [
        {"path": str(a), "rights": "internet_cc", "content": "full_mix", "role_guess": "stem"},  # content wins
        {"path": str(b), "rights": "contrib_ali_consented", "role_guess": "mixdown"},  # role, no content label
        {"path": str(b), "rights": "contrib_ali_consented", "role_guess": "mixdown"},  # duplicate sha
        {"path": str(a), "rights": "internet_cc", "content": "voice", "role_guess": "song"},  # contradicting label
        {"path": str(a), "rights": "", "role_guess": "song"},
        {"path": str(data / "missing.wav"), "rights": "internet_cc", "role_guess": "song"},
        {"path": str(a), "rights": "internet_cc", "role_guess": "song", "excluded": True},
        {"rights": "internet_cc", "role_guess": "song"},
        # the select_generic gates
        {"path": str(a), "rights": "internet_research_only", "role_guess": "song"},  # by policy never used
        {"path": str(a), "rights": "internet_cc", "role_guess": "song", "third_party_suspect": True, "third_party_reason": "import"},
        {"path": str(a), "rights": "internet_cc", "role_guess": "song", "third_party_suspect": True},
        {"path": str(outside), "rights": "internet_cc", "role_guess": "song"},  # audio must lie under data/
        {"path": str(a), "rights": "contrib_ali", "role_guess": "song"},  # not a tier intake.py stamps
        {"path": str(a), "rights": "internet/cc", "role_guess": "song"},  # would nest below <out>/<corpus>/<sha12>
        {"path": str(a), "rights": "harvard_research_only", "role_guess": "song"},  # not an extra-inventory tier
    ]
    jobs, skipped = ss.select_extra(rows, root=tmp_path)
    assert {(j.path, j.corpus) for j in jobs} == {(a, "internet_cc"), (b, "contrib_ali_consented")}
    assert all(j.third_party_suspect is False for j in jobs)
    assert skipped == {
        "duplicate_sha256": 1, "content_voice": 1, "no_rights": 1, "missing_file": 1, "excluded": 1, "no_path": 1,
        "rights_internet_research_only_by_policy": 1, "third_party_import": 1, "third_party_suspect": 1,
        "outside_roots": 1, "bad_rights": 3,
    }
    # --include-third-party admits the suspects, flagged; the research_only contributor tier is a valid tier
    research = _touch(data / "r.wav")
    rows.append({"path": str(research), "rights": "contrib_bob_research_only", "role_guess": "song"})
    jobs, skipped = ss.select_extra(rows, root=tmp_path, include_third_party=True)
    assert {(j.path, j.corpus) for j in jobs} == {(a, "internet_cc"), (b, "contrib_ali_consented"), (research, "contrib_bob_research_only")}
    assert "third_party_import" not in skipped and "third_party_suspect" not in skipped
    assert skipped["duplicate_sha256"] == 3  # the two suspects share a's sha with the first row


def test_select_jobs_drops_known_short_files_and_passes_include_third_party_to_extras(corpus: dict) -> None:
    c = corpus
    short = _write(c["root"] / "data/ahmed_raw/GarageBand/blip.band/Output/Output.wav", _tone(0.5))
    classified = c["classified"] + [
        {"path": str(short), "name": "Output.wav", "content": "full_mix", "source_group": "garageband", "sha256": _sha(short), "duration_s": 0.5},
        {"path": str(short), "name": "zero.wav", "content": "full_mix", "source_group": "garageband", "sha256": "2" * 64, "duration_s": 0.0},
    ]
    sus = _write(c["root"] / "data/raw_incoming/internet/sus.wav", _tone(31.0, 440.0))
    extra = c["extra"] + [{"path": str(sus), "role_guess": "song", "rights": "internet_cc", "sha256": _sha(sus),
                           "third_party_suspect": True, "third_party_reason": "cover"}]
    jobs, skipped = ss.select_jobs(classified, [], {}, [extra], root=c["root"])
    assert short not in {j.path for j in jobs} and skipped["too_short"] == 2
    assert sus not in {j.path for j in jobs} and skipped["extra:third_party_cover"] == 1
    jobs, skipped = ss.select_jobs(classified, [], {}, [extra], root=c["root"], include_third_party=True)
    by_path = {j.path: j for j in jobs}
    assert by_path[sus].third_party_suspect is True and by_path[sus].third_party_reason == "cover"
    assert by_path[c["files"]["third"]].third_party_suspect is True


def test_shard_of_is_a_stable_function_of_the_sha() -> None:
    shas = [f"{i:08x}" + "0" * 56 for i in range(1000)]
    for n in (1, 2, 3, 7):
        buckets = [ss.shard_of(s, n) for s in shas]
        assert set(buckets) <= set(range(n)) and (n == 1 or len(set(buckets)) == n)
        assert buckets == [ss.shard_of(s, n) for s in reversed(shas)][::-1]  # independent of any list order
    assert ss.shard_of("ffffffff" + "0" * 56, 2) == 1 and ss.shard_of("fffffffe" + "0" * 56, 2) == 0


def test_parse_shard() -> None:
    assert ss.parse_shard("0/1") == (0, 1) and ss.parse_shard("2/3") == (2, 3)
    for bad in ("3/3", "-1/2", "a/b", "1", "0/0"):
        with pytest.raises(SystemExit):
            ss.parse_shard(bad)


# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------


def test_scorer_windows_even_spacing() -> None:
    sr = 32000
    assert ss.scorer_windows(10 * sr, sr) == [0]
    assert ss.scorer_windows(30 * sr, sr) == [0]
    assert ss.scorer_windows(40 * sr, sr) == [5 * sr]  # one window, centred
    assert ss.scorer_windows(90 * sr, sr) == [0, 30 * sr, 60 * sr]
    starts = ss.scorer_windows(200 * sr, sr)
    assert starts == [0, 85 * sr, 170 * sr] and all(s + 30 * sr <= 200 * sr for s in starts)


def test_to_mono32_length_and_downmix() -> None:
    stereo = np.stack([np.full(SR_IN, 0.5, np.float32), np.full(SR_IN, -0.5, np.float32)])
    mono = ss.to_mono32(stereo, SR_IN)
    assert mono.shape == (32000,) and mono.dtype == np.float32 and np.abs(mono).max() < 1e-6
    tone = _tone(2.0).T
    out = ss.to_mono32(tone, SR_IN)
    assert out.shape == (64000,) and out.max() <= 1.0 and abs(out[1000:-1000].max() - 0.3) < 0.01


def test_separate_undoes_the_normalisation_and_survives_silence() -> None:
    model = FakeModel()
    identity = make_fake_apply({"drums": 1.0, "bass": 0.0, "other": 1.0, "vocals": 0.0})
    mix = _tone(1.0).T + 0.05  # a DC offset makes the mean/std round trip visible
    stems = ss_separate_with(identity, model, mix)
    assert set(stems) == set(SOURCES)
    assert np.allclose(stems["other"], mix, atol=1e-5) and np.allclose(stems["bass"], 0.05, atol=1e-5)
    silent = ss_separate_with(identity, model, np.zeros((2, 4410), np.float32))
    assert all(np.isfinite(s).all() for s in silent.values())


def ss_separate_with(fake_apply, model, mix: np.ndarray) -> dict[str, np.ndarray]:
    original = ss.apply_model
    ss.apply_model = fake_apply
    try:
        return ss.separate(model, mix, "cpu")
    finally:
        ss.apply_model = original


@pytest.mark.skipif(shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="ffmpeg not installed")
def test_decode_stereo_duplicates_mono_without_pan_loss(tmp_path: Path) -> None:
    mono = _tone(1.0, channels=1)
    p = _write(tmp_path / "mono.wav", mono)
    x = ss.decode_stereo(p, SR_IN)
    assert x.shape == (2, SR_IN) and x.dtype == np.float32
    assert np.allclose(x[0], x[1]) and abs(np.abs(x[0]).max() - 0.3) < 0.01  # not the -3 dB of ffmpeg -ac 2
    st = _write(tmp_path / "stereo.wav", np.stack([mono, -mono], axis=1))
    y = ss.decode_stereo(st, SR_IN)
    assert y.shape == (2, SR_IN) and np.allclose(y[0], -y[1], atol=1e-3)
    assert y.flags.writeable  # torch.from_numpy on a read-only frombuffer view warns


@pytest.mark.skipif(shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="ffmpeg not installed")
def test_decode_errors_carry_the_tool_stderr_not_just_the_command_line(tmp_path: Path) -> None:
    deep = tmp_path.joinpath(*(["a_long_directory_name_segment"] * 8), "GarageBand", "corrupt.band", "Output")
    corrupt = deep / "Output.wav"
    corrupt.parent.mkdir(parents=True)
    corrupt.write_bytes(bytes(range(256)) * 20)
    with pytest.raises(RuntimeError) as ei:
        ss.decode_stereo(corrupt, SR_IN)
    msg = str(ei.value)
    assert msg.startswith("ffprobe failed on 'Output.wav': ") and "Invalid data" in msg
    assert "-show_entries" not in msg and str(deep) not in msg and len(msg) < 300  # the path prefix never eats the reason
    assert isinstance(ei.value.__cause__, ss.subprocess.CalledProcessError)


def test_run_tool_reports_a_missing_binary(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="not installed"):
        ss._run_tool(["definitely-not-an-installed-tool-xyz", "x"], tmp_path / "a.wav")


# ---------------------------------------------------------------------------
# End to end: main() on the fixture corpus
# ---------------------------------------------------------------------------


def test_main_end_to_end(corpus: dict, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    c = corpus
    calls: list[dict] = []
    monkeypatch.setattr(ss, "apply_model", make_fake_apply(calls=calls))
    out = c["root"] / "data/separated"
    assert ss.main(_args(c, out)) is None  # a clean run returns (exit status 0), no SystemExit
    text = capsys.readouterr().out
    summary = json.loads([line for line in text.splitlines() if line.startswith("{")][-1])
    assert summary["files"] == 5 and summary["skipped_existing"] == 0 and summary["failed"] == 0
    assert summary["oud_present"] == 5 and summary["vocals_present"] == 5 and summary["index_rows"] == 5
    assert summary["hours_separated"] == pytest.approx((40 + 35 + 33 + 36 + 32) / 3600, abs=1e-3)
    assert summary["device"] == "cpu" and summary["expected_realtime_factor"] == 7.6
    assert summary["skipped"] == {} and summary["interrupted"] is False and summary["index_error"] is None
    assert summary["include_third_party"] is False and summary["min_seconds"] == 1.0
    assert len(calls) == 5 and all(k["shifts"] == 0 and k["split"] is True and k["overlap"] == 0.25 and k["device"] == "cpu" for k in calls)
    progress = [line for line in text.splitlines() if line.startswith("[")]
    assert len(progress) == 5 and [line.split("]")[0] for line in progress] == [f"[{i}/5" for i in range(1, 6)]
    assert all("x)" in line and "oud=yes" in line and "vocals=yes" in line for line in progress)
    assert progress[0].split()[1:3] == ["ahmed", _sha(c["files"]["mix"])[:12]]  # (corpus, sha) order

    sha12 = _sha(c["files"]["mix"])[:12]
    d = out / "ahmed" / sha12
    assert sorted(p.name for p in d.iterdir()) == ["other.wav", "stems.json", "vocals.wav"]  # no drums/bass, no .part
    for name in ("other.wav", "vocals.wav"):
        info = sf.info(d / name)
        assert (info.samplerate, info.channels, info.subtype) == (32000, 1, "PCM_16")
        assert abs(info.frames - 40 * 32000) <= 1
    rec = json.loads((d / "stems.json").read_text())
    for key in ("source_path", "source_sha256", "corpus", "rights", "duration_s", "model", "demucs_version", "stems",
                "oud_present", "vocals_present", "seconds_elapsed", "written_at"):
        assert key in rec, key
    assert rec["source_path"] == "data/ahmed_raw/GarageBand/wadada.band/Output/Output.wav"  # repo-relative
    assert rec["source_sha256"] == _sha(c["files"]["mix"]) and rec["corpus"] == "ahmed"
    assert rec["rights"] == "ahmed_ilkacase_consented" and rec["duration_s"] == pytest.approx(40.0, abs=0.01)
    assert rec["mix_rms_dbfs"] == pytest.approx(20 * np.log10(0.3 / np.sqrt(2)), abs=0.3)
    assert rec["model"] == "htdemucs_ft" and rec["demucs_version"] == demucs.__version__
    assert set(rec["stems"]) == {"drums", "bass", "other", "vocals"}
    assert set(rec["stems"]["other"]) >= {"rms_dbfs", "voiced_fraction", "pcs", "tuning_offset_cents", "tonic"}
    assert set(rec["stems"]["vocals"]) >= {"rms_dbfs", "voiced_fraction"}
    assert set(rec["stems"]["drums"]) == {"rms_dbfs"} and set(rec["stems"]["bass"]) == {"rms_dbfs"}
    tone_rms = 20 * np.log10(0.3 / np.sqrt(2))
    assert rec["stems"]["drums"]["rms_dbfs"] == pytest.approx(tone_rms + 20 * np.log10(0.5), abs=0.3)
    assert rec["stems"]["other"]["rms_dbfs"] == pytest.approx(tone_rms + 20 * np.log10(0.8), abs=0.3)
    assert rec["stems"]["vocals"]["rms_dbfs"] == pytest.approx(tone_rms + 20 * np.log10(0.1), abs=0.3)
    assert rec["stems"]["other"]["voiced_fraction"] == 1.0 and rec["stems"]["other"]["pcs"] == 1.0
    assert rec["stems"]["other"]["tonic"] == "A" and rec["stems"]["other"]["tuning_offset_cents"] == pytest.approx(0.0, abs=1.0)
    assert rec["stems"]["vocals"]["voiced_fraction"] == 1.0
    assert rec["oud_present"] is True and rec["vocals_present"] is True
    assert rec["scorer"]["window_starts_s"] == [5.0] and rec["realtime_factor"] > 0 and rec["written_at"].endswith("+00:00")
    from scripts import pcs
    assert rec["scorer"]["hop_ms"] == 1000 * pcs.HOP / pcs.CREPE_SR  # derived from the scorer, never hand-typed
    assert rec["third_party_suspect"] is False and rec["third_party_reason"] is None

    dirs = {p.relative_to(out).as_posix() for p in out.glob("*/*") if p.is_dir()}
    f = c["files"]
    assert dirs == {
        f"ahmed/{_sha(f['mix'])[:12]}", f"ahmed_collection/{_sha(f['coll_mix'])[:12]}",
        f"harvard/{_sha(f['legacy_track'])[:12]}", f"harvard/{_sha(f['fetched_track'])[:12]}",
        f"internet_cc/{_sha(f['cc'])[:12]}",
    }
    assert not (out / "harvard" / _sha(f["side"])[:12]).exists()  # superseded whole side never separated
    index = _read_index(out)
    assert len(index) == 5 and [r["corpus"] for r in index] == sorted(r["corpus"] for r in index)
    assert {r["source_sha256"] for r in index} == {_sha(p) for p in (f["mix"], f["coll_mix"], f["legacy_track"], f["fetched_track"], f["cc"])}
    assert all(r["stem_dir"].startswith("data/separated/") for r in index)
    assert not list(out.rglob(".lock")) and not list(out.glob("index.jsonl.*.tmp"))  # no lock or temp left behind


def test_progress_lines_carry_the_realtime_factor(corpus: dict, capsys: pytest.CaptureFixture[str]) -> None:
    c = corpus
    ss.main(_args(c, c["root"] / "data/separated", "--limit", "2"))
    text = capsys.readouterr().out
    progress = [line for line in text.splitlines() if line.startswith("[")]
    assert len(progress) == 2 and progress[0].startswith("[1/2] ") and "x)" in progress[0] and "oud=yes" in progress[0]


def test_min_stem_dbfs_flag_controls_presence(corpus: dict, capsys: pytest.CaptureFixture[str]) -> None:
    c = corpus
    out = c["root"] / "data/separated"
    ss.main(_args(c, out, "--limit", "1", "--min-stem-dbfs", "-20"))
    summary = _summary(capsys)
    assert summary["files"] == 1 and summary["oud_present"] == 1 and summary["vocals_present"] == 0
    rec = _read_index(out)[0]
    assert rec["min_stem_dbfs"] == -20.0 and rec["stems"]["vocals"]["rms_dbfs"] < -20 < rec["stems"]["other"]["rms_dbfs"]


def test_silent_other_stem_means_no_oud(corpus: dict, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    c = corpus
    monkeypatch.setattr(ss, "apply_model", make_fake_apply({"drums": 0.5, "bass": 0.25, "other": 0.0, "vocals": 0.1}))
    out = c["root"] / "data/separated"
    ss.main(_args(c, out, "--limit", "1"))
    summary = _summary(capsys)
    assert summary["files"] == 1 and summary["oud_present"] == 0 and summary["vocals_present"] == 1
    rec = _read_index(out)[0]
    other = rec["stems"]["other"]
    assert other["rms_dbfs"] < -35 and other["voiced_fraction"] == 0.0
    assert other["pcs"] is None and other["tonic"] is None and other["tuning_offset_cents"] is None
    assert rec["oud_present"] is False and rec["vocals_present"] is True
    info = sf.info(out / rec["corpus"] / rec["source_sha256"][:12] / "other.wav")
    assert info.samplerate == 32000 and info.channels == 1


def test_oud_present_needs_both_level_and_voicing() -> None:
    assert ss.oud_present({"rms_dbfs": -18.0, "voiced_fraction": 0.4}, -35.0)
    assert not ss.oud_present({"rms_dbfs": -18.0, "voiced_fraction": 0.1}, -35.0)
    assert not ss.oud_present({"rms_dbfs": -40.0, "voiced_fraction": 0.9}, -35.0)
    assert not ss.oud_present({"rms_dbfs": -18.0, "voiced_fraction": None}, -35.0)
    assert ss.vocals_present({"rms_dbfs": -35.0}, -35.0) and not ss.vocals_present({"rms_dbfs": -35.1}, -35.0)


def test_resume_second_run_does_nothing(corpus: dict, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    c = corpus
    out = c["root"] / "data/separated"
    ss.main(_args(c, out))
    first = {p: p.stat().st_mtime_ns for p in out.rglob("*.wav")}
    assert len(first) == 10

    def forbid(*a, **k):
        raise AssertionError("apply_model called on resume")

    monkeypatch.setattr(ss, "apply_model", forbid)
    monkeypatch.setattr(ss, "decode_stereo", forbid)
    monkeypatch.setattr(ss, "get_model", forbid)
    capsys.readouterr()
    ss.main(_args(c, out))
    summary = _summary(capsys)
    assert summary["files"] == 0 and summary["skipped_existing"] == 5 and summary["index_rows"] == 5
    assert summary["hours_separated"] == 0 and summary["realtime_factor"] is None
    assert {p: p.stat().st_mtime_ns for p in out.rglob("*.wav")} == first
    assert len(_read_index(out)) == 5


def test_partial_wav_left_by_a_crash_is_deleted_and_the_file_redone(corpus: dict, capsys: pytest.CaptureFixture[str]) -> None:
    c = corpus
    out = c["root"] / "data/separated"
    sha12 = _sha(c["files"]["mix"])[:12]
    d = out / "ahmed" / sha12
    d.mkdir(parents=True)
    part = d / "other.part.wav"
    part.write_bytes(b"garbage")
    (d / "stems.json.tmp").write_text("{")
    ss.main(_args(c, out))
    summary = _summary(capsys)
    assert summary["files"] == 5  # the crashed one was not counted as done
    assert not part.exists() and not (d / "stems.json.tmp").exists()
    assert (d / "stems.json").exists() and sf.info(d / "other.wav").frames == 40 * 32000


def test_shards_are_disjoint_and_cover_the_selection(corpus: dict, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    c = corpus
    out = c["root"] / "data/separated"
    seen: list[list[Path]] = [[], []]

    def recording_decode(idx: int):
        def decode(path: Path, sr: int = SR_IN) -> np.ndarray:
            seen[idx].append(path)
            return fake_decode(path, sr)
        return decode

    f = c["files"]
    selected = {f["mix"], f["coll_mix"], f["legacy_track"], f["fetched_track"], f["cc"]}
    expected = [{p for p in selected if ss.shard_of(_sha(p), 2) == i} for i in range(2)]
    assert expected[0] and expected[1], "fixture shas should land in both shards"

    monkeypatch.setattr(ss, "decode_stereo", recording_decode(0))
    ss.main(_args(c, out, "--shard", "0/2"))
    s0 = _summary(capsys)
    monkeypatch.setattr(ss, "decode_stereo", recording_decode(1))
    ss.main(_args(c, out, "--shard", "1/2"))
    s1 = _summary(capsys)
    assert s0["files"] == len(expected[0]) and s1["files"] == len(expected[1]) and s0["shard"] == "0/2" and s1["shard"] == "1/2"
    assert set(seen[0]) == expected[0] and set(seen[1]) == expected[1]  # membership is a function of the sha, not the position
    assert set(seen[0]).isdisjoint(seen[1]) and set(seen[0]) | set(seen[1]) == selected
    assert s0["index_rows"] == len(expected[0]) and s1["index_rows"] == 5 and len(_read_index(out)) == 5
    with pytest.raises(SystemExit):
        ss.main(_args(c, out, "--shard", "2/2"))


def test_shards_stay_disjoint_when_the_manifest_grows_between_starts(corpus: dict, monkeypatch: pytest.MonkeyPatch,
                                                                    capsys: pytest.CaptureFixture[str]) -> None:
    """Shard 1/2 started on the old manifest, shard 0/2 on a manifest the fetch has grown by one
    row in the meantime: no file may be separated by both (position-based slicing would shift
    the parity of every later harvard file)."""
    c = corpus
    out = c["root"] / "data/separated"
    hr = c["root"] / "data/harvard_raw"
    new_track = _write(hr / "AWM_SC_12201_A2_Dhaanto__mus00044c00093.wav", _tone(34.0, 349.0))
    grown = c["manifest"] + [
        {"cid": "mus00044c00093", "status": "fetched", "type": "Track", "title": "Side A. Track 2: Dhaanto", "cassette": "12201",
         "file": "data/harvard_raw/AWM_SC_12201_A2_Dhaanto__mus00044c00093.wav", "sha256": _sha(new_track), "duration_s": 34.0},
    ]
    grown_manifest = _jsonl(c["root"] / "data/harvard_raw/manifest_grown.jsonl", grown)
    seen: dict[str, set[Path]] = {"old": set(), "new": set()}

    def recording_decode(key: str):
        def decode(path: Path, sr: int = SR_IN) -> np.ndarray:
            seen[key].add(path)
            return fake_decode(path, sr)
        return decode

    for n in (2, 3):
        shutil.rmtree(out, ignore_errors=True)
        for key in seen:
            seen[key].clear()
        monkeypatch.setattr(ss, "decode_stereo", recording_decode("old"))
        for i in range(1, n):
            ss.main(_args(c, out, "--shard", f"{i}/{n}"))
        monkeypatch.setattr(ss, "decode_stereo", recording_decode("new"))
        args = _args(c, out, "--shard", f"0/{n}")
        args[args.index("--harvard-manifest") + 1] = str(grown_manifest)
        ss.main(args)
        capsys.readouterr()
        assert seen["old"].isdisjoint(seen["new"]), (n, seen)
        f = c["files"]
        old_five = {f["mix"], f["coll_mix"], f["legacy_track"], f["fetched_track"], f["cc"]}
        # every old file exactly once; the new row only where its own sha sends it (shard 0 ran the grown manifest)
        expected = old_five | ({new_track} if ss.shard_of(_sha(new_track), n) == 0 else set())
        assert seen["old"] | seen["new"] == expected, (n, seen)
        assert seen["new"] == {p for p in expected if ss.shard_of(_sha(p), n) == 0}


def test_a_file_finished_by_another_shard_is_skipped_before_it_starts(corpus: dict, monkeypatch: pytest.MonkeyPatch,
                                                                     capsys: pytest.CaptureFixture[str]) -> None:
    """The todo list is made once; a job re-checks stems.json right before it starts."""
    c = corpus
    out = c["root"] / "data/separated"
    jobs, _ = ss.select_jobs(c["classified"], c["manifest"], ss.load_catalog(c["paths"]["catalog"]), [c["extra"]], root=c["root"])
    first, last = jobs[0], jobs[-1]
    decoded: list[Path] = []

    def decode(path: Path, sr: int = SR_IN) -> np.ndarray:
        decoded.append(path)
        if path == first.path:  # "another shard" finishes the last job while this one runs the first
            d = last.out_dir(out)
            d.mkdir(parents=True, exist_ok=True)
            (d / "stems.json").write_text(json.dumps({"corpus": last.corpus, "source_sha256": last.sha256, "duration_s": 1.0,
                                                      "oud_present": False, "vocals_present": False}) + "\n")
        return fake_decode(path, sr)

    monkeypatch.setattr(ss, "decode_stereo", decode)
    ss.main(_args(c, out))
    text = capsys.readouterr().out
    summary = json.loads([line for line in text.splitlines() if line.startswith("{")][-1])
    assert last.path not in decoded and len(decoded) == 4
    assert summary["files"] == 4 and summary["skipped"] == {"done_by_another_shard": 1} and summary["index_rows"] == 5
    assert f"[5/5] {last.corpus} {last.sha12} SKIPPED: done_by_another_shard" in text


def test_lock_held_by_a_live_process_skips_and_a_stale_lock_is_taken_over(corpus: dict, capsys: pytest.CaptureFixture[str]) -> None:
    c = corpus
    out = c["root"] / "data/separated"
    f = c["files"]
    live_dir = out / "ahmed" / _sha(f["mix"])[:12]
    live_dir.mkdir(parents=True)
    (live_dir / ".lock").write_text(str(os.getpid()))  # this very process is alive
    stale_dir = out / "internet_cc" / _sha(f["cc"])[:12]
    stale_dir.mkdir(parents=True)
    (stale_dir / ".lock").write_text("2147483000")  # no such pid
    (stale_dir / "other.part.wav").write_bytes(b"crash leftovers")
    old_dir = out / "harvard" / _sha(f["fetched_track"])[:12]
    old_dir.mkdir(parents=True)
    old_lock = old_dir / ".lock"
    old_lock.write_text("")  # never got its pid: stale once older than LOCK_EMPTY_STALE_S
    old = time.time() - ss.LOCK_EMPTY_STALE_S - 5
    os.utime(old_lock, (old, old))

    ss.main(_args(c, out))
    text = capsys.readouterr().out
    summary = json.loads([line for line in text.splitlines() if line.startswith("{")][-1])
    assert summary["files"] == 4 and summary["skipped"] == {"locked": 1} and summary["failed"] == 0
    assert "SKIPPED: locked" in text
    assert (live_dir / ".lock").read_text() == str(os.getpid()) and not (live_dir / "stems.json").exists()
    for d in (stale_dir, old_dir):
        assert (d / "stems.json").exists() and not (d / ".lock").exists() and not (d / "other.part.wav").exists()
    assert not (live_dir / "other.wav").exists()
    assert ss.lock_is_stale(live_dir / ".lock") is False
    fresh_empty = live_dir / "fresh.lock"
    fresh_empty.write_text("")
    assert ss.lock_is_stale(fresh_empty) is False and ss.lock_is_stale(live_dir / "nope.lock") is False


def test_claim_removes_the_lock_and_an_empty_dir_but_keeps_written_output(tmp_path: Path) -> None:
    d = tmp_path / "corpus" / "abc"
    with ss.claim(d) as lock:
        assert lock.exists() and lock.read_text() == str(os.getpid())
        with pytest.raises(ss.SkipJob) as ei, ss.claim(d):
            pass
        assert ei.value.reason == "locked"
        assert lock.read_text() == str(os.getpid())  # the loser never unlinks the holder's lock
    assert not d.exists()  # nothing was written: the directory goes too
    with pytest.raises(KeyboardInterrupt), ss.claim(d):
        raise KeyboardInterrupt  # Ctrl-C inside the claim leaves no empty directory either
    assert not d.exists()
    with ss.claim(d):
        (d / "other.wav").write_bytes(b"x")
    assert d.exists() and not (d / ".lock").exists() and (d / "other.wav").exists()
    with pytest.raises(RuntimeError), ss.claim(tmp_path / "corpus" / "fail"):
        raise RuntimeError("boom")
    assert not (tmp_path / "corpus" / "fail").exists()


def test_index_is_rebuilt_from_the_stems_json_scan(corpus: dict, capsys: pytest.CaptureFixture[str]) -> None:
    c = corpus
    out = c["root"] / "data/separated"
    ss.main(_args(c, out))
    index_path = out / "index.jsonl"
    rows = _read_index(out)
    assert len(rows) == 5
    # a stale / clobbered index and a stems.json that vanished: the next run's rebuild reflects the disk
    index_path.write_text('{"bogus": true}\n' + index_path.read_text() + '{"bogus": true}\n')
    victim = out / "internet_cc" / _sha(c["files"]["cc"])[:12]
    shutil.rmtree(victim)
    assert ss.rebuild_index(out) == 4
    rebuilt = _read_index(out)
    assert len(rebuilt) == 4 and not any("bogus" in r for r in rebuilt)
    assert [(r["corpus"], r["source_sha256"]) for r in rebuilt] == sorted((r["corpus"], r["source_sha256"]) for r in rebuilt)
    capsys.readouterr()
    ss.main(_args(c, out))  # re-separates only the vanished one, index back to 5
    summary = _summary(capsys)
    assert summary["files"] == 1 and summary["skipped_existing"] == 4 and summary["index_rows"] == 5
    assert len(_read_index(out)) == 5 and (victim / "stems.json").exists()


def test_failed_file_is_reported_and_the_run_continues(corpus: dict, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    c = corpus
    bad = c["files"]["coll_mix"]

    def decode(path: Path, sr: int = SR_IN) -> np.ndarray:
        if path == bad:
            raise RuntimeError("ffmpeg: Invalid data found when processing input")
        return fake_decode(path, sr)

    monkeypatch.setattr(ss, "decode_stereo", decode)
    out = c["root"] / "data/separated"
    with pytest.raises(SystemExit) as ei:
        ss.main(_args(c, out))
    assert ei.value.code == 1  # a driver loop can tell a run with failed files from a clean one
    text = capsys.readouterr().out
    summary = json.loads([line for line in text.splitlines() if line.startswith("{")][-1])
    assert summary["files"] == 4 and summary["failed"] == 1 and summary["index_rows"] == 4
    assert summary["failures"][0]["sha12"] == _sha(bad)[:12] and "Invalid data" in summary["failures"][0]["error"]
    assert summary["failures"][0]["error"].startswith("RuntimeError: ")
    assert "FAILED: RuntimeError" in text
    assert not (out / "ahmed_collection" / _sha(bad)[:12]).exists()  # a failed file leaves no empty directory behind
    assert len(_read_index(out)) == 4


def test_too_short_source_is_skipped_not_failed_and_leaves_nothing(corpus: dict, monkeypatch: pytest.MonkeyPatch,
                                                                  capsys: pytest.CaptureFixture[str]) -> None:
    """An inventory row with an unknown duration that decodes to 50 ms (or 0 frames) is skipped
    after the decode, never sent to Demucs, counted under skipped, and the run exits 0."""
    c = corpus
    blip = _write(c["root"] / "data/ahmed_raw/GarageBand/blip.band/Output/Output.wav", _tone(0.05))
    zero = _write(c["root"] / "data/ahmed_raw/GarageBand/zero.band/Output/Output.wav", np.zeros((0, 2), np.float32))
    rows = c["classified"] + [
        {"path": str(blip), "name": "Output.wav", "content": "full_mix", "source_group": "garageband", "sha256": _sha(blip), "duration_s": None},
        {"path": str(zero), "name": "Output.wav", "content": "full_mix", "source_group": "garageband", "sha256": _sha(zero)},
    ]
    _jsonl(c["paths"]["classified"], rows)
    calls: list[dict] = []
    monkeypatch.setattr(ss, "apply_model", make_fake_apply(calls=calls))
    out = c["root"] / "data/separated"
    assert ss.main(_args(c, out)) is None
    text = capsys.readouterr().out
    summary = json.loads([line for line in text.splitlines() if line.startswith("{")][-1])
    assert summary["files"] == 5 and summary["failed"] == 0 and summary["skipped"] == {"too_short": 2}
    assert len(calls) == 5 and all(k["n"] >= SR_IN for k in calls)  # Demucs never saw the short ones
    assert "SKIPPED: too_short (0.050 s < 1.0 s)" in text and "SKIPPED: too_short (0.000 s < 1.0 s)" in text
    for p in (blip, zero):
        assert not (out / "ahmed" / _sha(p)[:12]).exists()
    assert summary["index_rows"] == 5 and len(_read_index(out)) == 5


def test_ctrl_c_rebuilds_the_index_prints_the_summary_and_exits_130(corpus: dict, monkeypatch: pytest.MonkeyPatch,
                                                                    capsys: pytest.CaptureFixture[str]) -> None:
    c = corpus
    out = c["root"] / "data/separated"
    n = {"decoded": 0}

    def decode(path: Path, sr: int = SR_IN) -> np.ndarray:
        n["decoded"] += 1
        if n["decoded"] == 3:
            raise KeyboardInterrupt
        return fake_decode(path, sr)

    monkeypatch.setattr(ss, "decode_stereo", decode)
    with pytest.raises(SystemExit) as ei:
        ss.main(_args(c, out))
    assert ei.value.code == 130
    text = capsys.readouterr().out
    summary = json.loads([line for line in text.splitlines() if line.startswith("{")][-1])
    assert summary["files"] == 2 and summary["interrupted"] is True and summary["index_rows"] == 2
    assert len(_read_index(out)) == 2 and not list(out.rglob(".lock"))
    assert len([d for d in out.glob("*/*") if d.is_dir()]) == 2  # the interrupted job left no directory


def test_index_rebuild_failure_is_reported_in_the_summary(corpus: dict, monkeypatch: pytest.MonkeyPatch,
                                                          capsys: pytest.CaptureFixture[str]) -> None:
    c = corpus
    out = c["root"] / "data/separated"

    def broken(out_root: Path) -> int:
        raise PermissionError(13, "Permission denied", str(out_root / "index.jsonl"))

    monkeypatch.setattr(ss, "rebuild_index", broken)
    with pytest.raises(SystemExit) as ei:
        ss.main(_args(c, out))
    assert ei.value.code == 1
    captured = capsys.readouterr()
    summary = json.loads([line for line in captured.out.splitlines() if line.startswith("{")][-1])
    assert summary["files"] == 5 and summary["index_rows"] is None
    assert summary["index_error"].startswith("PermissionError: ") and "index: rebuild failed" in captured.err


def test_rebuild_index_is_safe_for_concurrent_callers(tmp_path: Path) -> None:
    """Two writers finishing together (shards) each use their own temporary; with one shared
    temp name the loser's os.replace raised FileNotFoundError."""
    out = tmp_path / "sep"
    for i in range(6):
        d = out / "ahmed" / f"{i:012d}"
        d.mkdir(parents=True)
        (d / "stems.json").write_text(json.dumps({"corpus": "ahmed", "source_sha256": f"{i:064d}"}) + "\n")
    errors: list[BaseException] = []
    barrier = threading.Barrier(2)

    def worker() -> None:
        barrier.wait()
        for _ in range(150):
            try:
                assert ss.rebuild_index(out) == 6
            except BaseException as e:  # noqa: BLE001 - collected for the assertion below
                errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    rows = [json.loads(line) for line in (out / "index.jsonl").read_text().splitlines()]
    assert len(rows) == 6 and not list(out.glob("index.jsonl.*.tmp"))


def test_dry_run_lists_hours_and_writes_nothing(corpus: dict, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    c = corpus

    def forbid(*a, **k):
        raise AssertionError("model loaded in dry run")

    monkeypatch.setattr(ss, "get_model", forbid)
    out = c["root"] / "data/separated"
    ss.main(_args(c, out, "--dry-run"))
    text = capsys.readouterr().out
    summary = json.loads([line for line in text.splitlines() if line.startswith("{")][-1])
    assert summary["dry_run"] is True and summary["selected"] == 5 and summary["pending"] == 5 and summary["done"] == 0
    assert summary["hours_selected"] == pytest.approx(176 / 3600, abs=1e-3)
    assert summary["by_corpus"]["harvard"] == {"files": 2, "hours": pytest.approx(69 / 3600, abs=1e-3)}
    assert summary["by_corpus"]["internet_cc"]["files"] == 1 and summary["skipped"]["harvard:superseded_by_legacy_tracks"] == 1
    assert summary["estimated_minutes_at_expected_realtime"] == pytest.approx(176 / 60 / 7.6, abs=0.1)
    assert "data/harvard_raw/AWM_SC_12201_A1_Ayaamaha__mus00044c00092.wav" in text
    assert not out.exists()


def test_probe_reports_per_file_throughput(corpus: dict, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    c = corpus
    out = c["root"] / "data/separated"
    inner = make_fake_apply()

    def slow_apply(*a, **k):
        time.sleep(0.01)  # a measurable separation time, so the throughput numbers are non-zero
        return inner(*a, **k)

    monkeypatch.setattr(ss, "apply_model", slow_apply)
    ss.main(_args(c, out, "--probe", "2"))
    summary = _summary(capsys)
    assert summary["files"] == 2 and len(summary["probe"]) == 2
    probe = summary["probe"][0]
    assert set(probe) >= {"corpus", "sha12", "duration_s", "seconds_separation", "realtime_factor", "rms_dbfs", "oud_present"}
    assert set(probe["rms_dbfs"]) == {"drums", "bass", "other", "vocals"}
    assert probe["seconds_separation"] >= 0.01 and probe["realtime_factor"] > 0 and summary["realtime_factor"] > 0
    assert summary["seconds_separation"] >= 0.02 and summary["realtime_factor_end_to_end"] > 0


def test_main_exits_when_nothing_is_selected(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit, match="no full mixes selected"):
        ss.main(["--root", str(tmp_path), "--out", str(tmp_path / "sep"), "--device", "cpu"])
