"""Unit tests for scripts/ahmed_extract.py: pure helpers (take numbers, role
guess, Apple-loop rule, silence fraction, layout resolution, set-level
finalisation) plus one ffmpeg-backed end-to-end pass over synthetic WAVs
written to tmp_path. No corpus, GPU or network."""

from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from scripts import ahmed_extract as ax


def test_take_number_patterns() -> None:
    assert ax.take_number("No Effects#07.aif") == 7
    assert ax.take_number("365 caana_2#02.aif") == 2
    assert ax.take_number("Qaraami kaban 200 wadada 2.m4a") == 2
    assert ax.take_number("xajiin hoos_1.m4a") == 1
    assert ax.take_number("runbaa hoos 100.aif") is None  # three digits: a BPM token, not a take
    assert ax.take_number("AUDIO-2020-03-13-23-12-42.aif") is None
    assert ax.take_number("Output.aif") is None


def test_role_guess_rules() -> None:
    assert ax.role_guess("Output", "Output.aif") == "mixdown"
    assert ax.role_guess("Bounces", "xajin cod 4.aif") == "mixdown"
    assert ax.role_guess("Media", "duni wada cod last.m4a") == "mixdown"
    assert ax.role_guess("Audio Files", "Output 1-2.aif") == "mixdown"
    assert ax.role_guess("Media", "AUDIO-2026-02-06-21-55-37_mixed.aif") == "mixdown"
    assert ax.role_guess("loose", "02 aha aha qaraami mul.m4a") == "mixdown"
    assert ax.role_guess("Media", "No Effects#03.aif") == "take"
    assert ax.role_guess("Audio Files", "koshin Drum tempo change_2#03.aif") == "take"
    assert ax.role_guess("Audio Files", "04 Drum.m4a") == "import"
    assert ax.role_guess("Media", "08 waa cudur Tubeec.m4a") == "import"
    assert ax.role_guess("Media", "jiijo drum.aif") == "stem"
    assert ax.role_guess("Media", "Balkaalay best.m4a") == "stem"  # "best" is not "last"
    assert ax.role_guess("Media", "Sanad guuro kor T21.m4a") == "stem"
    assert ax.role_guess("loose", "05 Qaraami kaban wadada.m4a") == "song"


def test_apple_loop_rule_is_conservative() -> None:
    assert ax.is_apple_loop("80s Dance Bass Synth 07.caf")
    assert ax.is_apple_loop("Cartoon Cymbal Hit.caf")
    assert ax.is_apple_loop("Shaker 01.caf")
    assert ax.is_apple_loop("Club Dance Beat 007_1.aif")  # loop vocabulary + index, even as .aif
    assert not ax.is_apple_loop("RnB Backing Vocals#02.aif")  # a take on a preset-named track
    assert not ax.is_apple_loop("Female Basic.aif")
    assert not ax.is_apple_loop("jiijo drum.aif")
    assert not ax.is_apple_loop("Koshin Kaban drum.m4a")
    assert not ax.is_apple_loop("Drum slow xidig.mp3")


def test_silence_fraction_on_synthetic_audio() -> None:
    sr = 16000
    t = np.arange(sr * 2) / sr
    tone = (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    silence = np.zeros(sr * 2, dtype=np.float32)
    assert ax.silence_fraction(tone, sr) == 0.0
    assert ax.silence_fraction(silence, sr) == 1.0
    assert abs(ax.silence_fraction(np.concatenate([tone, silence]), sr) - 0.5) < 0.02
    assert ax.silence_fraction(np.zeros(10, dtype=np.float32), sr) == 1.0  # shorter than one frame
    quiet = (1e-4 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)  # about -83 dBFS
    assert ax.silence_fraction(quiet, sr) == 1.0


def test_resolve_ref_layouts(tmp_path: Path) -> None:
    gb = tmp_path / "GarageBand"
    band = gb / "song lgt.band"
    (band / "Media" / "Recording").mkdir(parents=True)
    (band / "Output").mkdir()
    f1, f2, f3 = band / "Media" / "No Effects#01.aif", band / "Media" / "Recording" / "x.aif", band / "Output" / "Output.aif"
    for f in (f1, f2, f3):
        f.touch()
    r1 = ax.resolve_ref(gb, "garageband", f1)
    assert r1 is not None and (r1.project, r1.project_kind, r1.location) == ("song lgt", "band", "Media")
    assert ax.resolve_ref(gb, "garageband", f2).location == "Media"  # type: ignore[union-attr]
    assert ax.resolve_ref(gb, "garageband", f3).location == "Output"  # type: ignore[union-attr]

    lg = tmp_path / "Logic"
    proj = lg / "kun"
    for d in ("Audio Files", "Bounces", "kun.logic", "Project File Backups"):
        (proj / d).mkdir(parents=True)
    a, b = proj / "Audio Files" / "kun_1#01.aif", proj / "Bounces" / "Output 1-2.aif"
    c, d = proj / "kun.logic" / "x.aif", proj / "Project File Backups" / "y.aif"
    for f in (a, b, c, d):
        f.touch()
    ra = ax.resolve_ref(lg, "logic", a)
    assert ra is not None and (ra.project, ra.project_kind, ra.location) == ("kun", "logic", "Audio Files")
    assert ax.resolve_ref(lg, "logic", b).location == "Bounces"  # type: ignore[union-attr]
    assert ax.resolve_ref(lg, "logic", c) is None and ax.resolve_ref(lg, "logic", d) is None

    coll = tmp_path / "oud"
    coll.mkdir()
    s = coll / "wadada 2.m4a"
    s.touch()
    rs = ax.resolve_ref(coll, "ahmed_collection", s)
    assert rs is not None and (rs.project, rs.project_kind, rs.location) == ("wadada 2", "loose", "loose")
    assert ax.source_group_for_root(gb) == "garageband"
    assert ax.source_group_for_root(lg) == "logic"
    assert ax.source_group_for_root(coll) == "ahmed_collection"
    assert [r.path.name for r in ax.walk(lg, "logic")] == ["kun_1#01.aif", "Output 1-2.aif"]


def _row(name: str, project: str, sha: str, dur: float = 10.0, sfrac: float | None = 0.1,
         location: str = "Media", probe_error: str | None = None) -> dict:
    return {"path": f"x/{project}/{name}", "source_group": "garageband", "project": project, "project_kind": "band",
            "location": location, "name": name, "ext": Path(name).suffix.lower(), "take_number": ax.take_number(name),
            "position": None, "mtime_iso": "2020-01-01T00:00:00+00:00", "bytes": 1, "sha256": sha, "duration_s": dur,
            "sample_rate": 44100, "channels": 2, "codec": "pcm_s16be", "silence_fraction": sfrac, "probe_error": probe_error}


def test_finalize_marks_duplicates_positions_and_exclusions() -> None:
    rows = [
        _row("b.aif", "p", "S1"), _row("a.aif", "p", "S1"),
        _row("Cartoon Cymbal Hit.caf", "p", "S2"),
        _row("quiet.aif", "p", "S3", sfrac=0.99),
        _row("short.aif", "p", "S4", dur=2.0),
        _row("bad.aif", "p", "S5", dur=0.0, sfrac=None, probe_error="ffprobe: no audio stream or zero duration"),
        _row("cache.ovw", "p", "S6", dur=0.0, sfrac=None),
        _row("Output.aif", "q", "S7", location="Output"),
    ]
    by = {r["name"]: r for r in ax.finalize(rows)}
    assert by["a.aif"]["position"] == 1 and by["b.aif"]["position"] == 2 and by["Output.aif"]["position"] == 1
    assert by["a.aif"]["excluded"] is False and by["a.aif"]["dup_of"] is None and by["a.aif"]["role_guess"] == "stem"
    assert by["b.aif"]["exclude_reason"] == "duplicate" and by["b.aif"]["dup_of"] == "S1" and by["b.aif"]["dup_of_path"] == "x/p/a.aif"
    assert by["Cartoon Cymbal Hit.caf"]["exclude_reason"] == "apple_loop"
    assert by["quiet.aif"]["exclude_reason"] == "silent" and by["quiet.aif"]["is_silent"] is True
    assert by["short.aif"]["exclude_reason"] == "silent"
    assert by["bad.aif"]["exclude_reason"] == "unreadable"
    assert by["cache.ovw"]["exclude_reason"] == "overview_cache" and by["cache.ovw"]["is_silent"] is False
    assert by["Output.aif"]["role_guess"] == "mixdown" and by["Output.aif"]["excluded"] is False
    summary = ax.summarize(list(by.values()))
    assert summary["all"]["files"] == 8 and summary["all"]["unique_by_sha"] == 7
    assert summary["all"]["excluded"] == {"apple_loop": 1, "duplicate": 1, "overview_cache": 1, "silent": 2, "unreadable": 1}
    assert summary["garageband"]["hours_kept"] == round(20 / 3600, 2)


@pytest.mark.skipif(shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="ffmpeg not installed")
def test_measure_and_resume_on_synthetic_wavs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "GarageBand"
    band = root / "demo.band"
    (band / "Media").mkdir(parents=True)
    (band / "Output").mkdir()
    sr = 16000
    t = np.arange(sr * 4) / sr
    tone = (0.5 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    sf.write(band / "Media" / "No Effects#01.wav", tone, sr)
    sf.write(band / "Media" / "No Effects#02.wav", tone, sr)  # identical bytes -> duplicate
    sf.write(band / "Output" / "Output.wav", np.zeros(sr * 4, dtype=np.float32), sr)  # silent mixdown
    monkeypatch.setattr(ax, "REPO", tmp_path)

    refs = ax.collect([root])
    assert [r.path.name for r in refs] == ["No Effects#01.wav", "No Effects#02.wav", "Output.wav"]
    rows = ax.finalize([ax.measure(r, None) for r in refs])
    by = {r["name"]: r for r in rows}
    first = by["No Effects#01.wav"]
    assert first["path"] == "GarageBand/demo.band/Media/No Effects#01.wav"
    assert first["duration_s"] == pytest.approx(4.0, abs=0.05)
    assert first["sample_rate"] == 16000 and first["channels"] == 1 and first["codec"] == "pcm_s16le"
    assert first["silence_fraction"] == 0.0 and first["excluded"] is False and first["take_number"] == 1
    assert len(first["sha256"]) == 64
    dup = by["No Effects#02.wav"]
    assert dup["exclude_reason"] == "duplicate" and dup["dup_of"] == first["sha256"] and dup["dup_of_path"] == first["path"]
    out = by["Output.wav"]
    assert out["exclude_reason"] == "silent" and out["silence_fraction"] == 1.0 and out["role_guess"] == "mixdown"

    # resume: a cached row with the same bytes + mtime is reused without hashing or probing
    inv = tmp_path / "inv.jsonl"
    ax.write_jsonl(inv, rows)
    cache = ax.load_existing(inv)
    assert set(cache) == {r["path"] for r in rows}
    calls: list[Path] = []
    monkeypatch.setattr(ax, "sha256_file", lambda p: calls.append(p) or "never")
    again = ax.measure(refs[0], cache[first["path"]])
    assert calls == [] and again["sha256"] == first["sha256"] and again["silence_fraction"] == 0.0
    fresh = ax.measure(refs[0], {**cache[first["path"]], "bytes": 0})  # stale cache -> recomputed
    assert calls and fresh["sha256"] == "never"

    summary = ax.summarize(rows)
    assert summary["all"]["files"] == 3 and summary["all"]["unique_by_sha"] == 2
    assert summary["all"]["excluded"] == {"duplicate": 1, "silent": 1}
    assert summary["all"]["hours_unique"] == round(8 / 3600, 2)
