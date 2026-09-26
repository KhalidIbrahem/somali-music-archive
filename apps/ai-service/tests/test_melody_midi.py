"""Unit tests for scripts/melody_midi.py: no CREPE, GPU, corpus or network.

A 30 s clip of a slow pentatonic tone sequence is synthesised with numpy and
soundfile; extract_f0 is monkeypatched with a fake that reads the known schedule
back from the clip's own envelope (voiced where the tone sounds, a low-confidence
guess elsewhere, the way CREPE behaves in silence).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pretty_midi
import pytest
import soundfile as sf

from scripts import melody_midi as mm

SR = mm.SR
SECONDS = 30.0
# (start, end, midi): eight slow notes of a D major-pentatonic line, 3 s each, 0.6 s apart
SCHEDULE = [(0.5 + i * 3.6, 0.5 + i * 3.6 + 3.0, m) for i, m in enumerate([62, 64, 66, 69, 71, 74, 71, 69])]
AMPS = [0.3, 0.15] * 4  # alternate loud / soft so velocities are testable
PENTATONIC_PCS = {2, 4, 6, 9, 11}


def _hz(midi: int) -> float:
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def _write_clip(path: Path, schedule: list[tuple[float, float, int]], amps: list[float] | None = None,
                seconds: float = SECONDS, offset_cents: float = 0.0) -> None:
    n = int(seconds * SR)
    t = np.arange(n) / SR
    y = np.zeros(n, dtype=np.float32)
    for k, (start, end, midi) in enumerate(schedule):
        on = (t >= start) & (t < end)
        a = (amps or [0.3] * len(schedule))[k]
        f = _hz(midi) * 2.0 ** (offset_cents / 1200.0)
        y[on] += (a * np.sin(2 * np.pi * f * t[on])).astype(np.float32)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, y, SR, subtype="PCM_16")


class FakeCrepe:
    """Stands in for scripts.pcs.extract_f0: 20 ms frames, voiced where the clip's own
    envelope is up (pitch from the master schedule), a 100 Hz guess at 0.05 confidence
    elsewhere, like CREPE's output in silence."""

    def __init__(self, schedule: list[tuple[float, float, int]], offset_cents: float = 0.0,
                 offset_by_len: dict[int, float] | None = None) -> None:
        self.schedule = schedule
        self.offset_cents = offset_cents
        self.offset_by_len = offset_by_len or {}  # clip length in samples -> tuning offset (per-clip tunings)
        self.schedule_by_len: dict[int, list[tuple[float, float, int]]] = {}  # clip length -> its own schedule
        self.calls = 0
        self.devices: list[str] = []

    def __call__(self, audio: np.ndarray, device: str, sr: int = SR) -> tuple[np.ndarray, np.ndarray]:
        assert sr == SR
        self.calls += 1
        self.devices.append(device)
        offset = self.offset_by_len.get(len(audio), self.offset_cents)
        schedule = self.schedule_by_len.get(len(audio), self.schedule)
        n = 1 + len(audio) // mm.RMS_HOP
        env = mm.frame_rms(audio, n)
        f0 = np.full(n, 100.0)
        pd = np.full(n, 0.05)
        times = np.arange(n) * mm.HOP_SEC
        for k in range(n):
            if env[k] < 0.3:
                continue
            for start, end, midi in schedule:
                if start <= times[k] < end:
                    f0[k], pd[k] = _hz(midi) * 2.0 ** (offset / 1200.0), 0.9
                    break
        return f0, pd


def _rows(tmp_path: Path, specs: list[tuple[str, list[tuple[float, float, int]], str]],
          seconds: float = SECONDS, extra: dict | None = None) -> tuple[Path, list[dict]]:
    """Write clips + a captions file. specs: (stem, schedule, content)."""
    rows = []
    for stem, schedule, content in specs:
        clip = tmp_path / "clips" / "test" / f"{stem}.wav"
        _write_clip(clip, schedule, AMPS[:len(schedule)] if schedule else None, seconds=seconds)
        rows.append({"clip_path": str(clip), "caption": "c", "split": "test", "content": content,
                     "seconds": seconds, "chroma_dir": "old/audio/chroma", **(extra or {})})
    captions = tmp_path / "captions.jsonl"
    captions.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return captions, rows


def _summary(capsys: pytest.CaptureFixture[str]) -> dict:
    return json.loads(capsys.readouterr().out.strip().splitlines()[-1])


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeCrepe:
    f = FakeCrepe(SCHEDULE)
    monkeypatch.setattr(mm, "extract_f0", f)
    return f


@pytest.fixture
def fast_tempo(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(mm, "tempo_bpm", lambda audio: 90.0)


# ----------------------------------------------------------------------------- pure parts
def test_chroma_frames_match_the_melody_processor() -> None:
    assert mm.chroma_frames(30.0) == 235 == mm.CHROMA_FRAMES_30S == round(30 * 235 / 30)
    assert mm.chroma_frames(10.0) == 79  # 1 + 320000 // 4096, not round(10 * 235 / 30) == 78
    assert mm.chroma_frames(5.0) == 40


def test_frame_rms_is_one_per_frame_and_peak_normalised() -> None:
    y = np.zeros(SR * 2, dtype=np.float32)
    y[SR // 2: SR] = 0.5
    n = 1 + len(y) // mm.RMS_HOP
    env = mm.frame_rms(y, n)
    assert env.shape == (n,) and env.max() == pytest.approx(1.0)
    assert env[int(0.75 / mm.HOP_SEC)] == pytest.approx(1.0) and env[int(1.5 / mm.HOP_SEC)] == 0.0
    assert mm.frame_rms(np.zeros(SR), 51).max() == 0.0  # silence stays 0, no division blow-up


def test_midi_chroma_is_one_hot_on_sounding_frames_and_zero_in_silence() -> None:
    notes = [mm.MelodyNote(0.0, 1.0, 62, 0.0, 6200.0, 1.0, 0.9, 100),
             mm.MelodyNote(1.5, 2.0, 69, 0.0, 6900.0, 1.0, 0.9, 100)]
    c = mm.midi_chroma(notes, mm.chroma_frames(3.0))
    assert c.shape == (24, 12) and c.dtype == np.float16
    t = np.arange(24) * mm.CHROMA_HOP / SR
    for k, tk in enumerate(t):
        if tk < 1.0:
            assert c[k].sum() == 1 and c[k].argmax() == 2  # D
        elif 1.5 <= tk < 2.0:
            assert c[k].sum() == 1 and c[k].argmax() == 9  # A
        else:
            assert c[k].sum() == 0


def test_velocity_from_rms_has_a_floor() -> None:
    assert mm.velocity_of(1.0) == 127 and mm.velocity_of(0.5) == 64 and mm.velocity_of(0.0) == mm.VELOCITY_FLOOR


def test_parse_shard() -> None:
    assert mm.parse_shard("1/3") == (1, 3)
    with pytest.raises(SystemExit):
        mm.parse_shard("3/3")
    with pytest.raises(SystemExit):
        mm.parse_shard("x")


# ----------------------------------------------------------------------------- one clip end to end
def test_pentatonic_clip_gives_midi_json_and_chroma(tmp_path: Path, fake: FakeCrepe) -> None:
    captions, rows = _rows(tmp_path, [("set_a_seg000", SCHEDULE, "oud")])
    midi_dir, chroma_dir = tmp_path / "midi", tmp_path / "chroma_midi"
    assert mm.main(["--captions", str(captions), "--midi-dir", str(midi_dir), "--chroma-dir", str(chroma_dir),
                    "--device", "cpu"]) == 0
    assert fake.calls == 1 and fake.devices == ["cpu"]

    # MIDI: eight notes, the schedule's pitches in order, nylon guitar, tempo = JSON bpm
    pm = pretty_midi.PrettyMIDI(str(midi_dir / "set_a_seg000.mid"))
    assert len(pm.instruments) == 1 and pm.instruments[0].program == mm.GM_NYLON_GUITAR == 24
    notes = sorted(pm.instruments[0].notes, key=lambda n: n.start)
    assert [n.pitch for n in notes] == [m for _, _, m in SCHEDULE]
    for n, (start, end, _m) in zip(notes, SCHEDULE):
        assert abs(n.start - start) < 0.06 and abs(n.end - end) < 0.06
    loud = [n.velocity for n in notes[0::2]]
    soft = [n.velocity for n in notes[1::2]]
    assert min(loud) > max(soft) and max(loud) >= 120  # mean RMS spans the 80 ms attack/release windows

    # JSON
    rec = json.loads((midi_dir / "set_a_seg000.json").read_text())
    assert rec["n_notes"] == 8 and rec["version"] == mm.JSON_VERSION and rec["program"] == 24
    assert abs(rec["voiced_fraction"] - 24.0 / 30.0) < 0.05
    assert set(rec["scale"]) == {"tonic", "tonic_pc", "mode", "tuning_offset_cents", "tonic_score", "pcs"}
    assert rec["scale"]["tonic_pc"] in PENTATONIC_PCS and abs(rec["scale"]["tuning_offset_cents"]) < 10
    assert rec["scale"]["pcs"] > 0.95
    assert rec["bpm"] > 0
    tempi = pm.get_tempo_changes()[1]
    assert tempi[0] == pytest.approx(rec["bpm"], abs=0.5)
    assert [n["midi"] for n in rec["notes"]] == [m for _, _, m in SCHEDULE]
    for n in rec["notes"]:
        assert set(n) == {"start", "end", "midi", "cents_dev", "cents", "amp", "confidence", "velocity"}
        assert abs(n["cents_dev"]) <= 50 and n["confidence"] >= 0.6
        assert abs(n["cents"] - 100 * n["midi"]) < 5  # the synthetic tones are on the A440 grid
    assert rec["chroma_frames"] == 235 and rec["params"]["legato"] is True
    assert rec["quantisation"]["grid"] == "tuning_corrected" and abs(rec["quantisation"]["grid_offset_cents"]) < 5
    assert rec["quantisation"]["grid_offset_source"] == "song" and rec["quantisation"]["n_clips_pooled"] == 1
    assert rec["quantisation"]["song_key"] == "set_a"  # no song_sha256 in the row: the stem minus _segNNN
    assert rec["audio_seconds"] == 30.0 and rec["n_notes_beyond_seconds"] == 0
    # paths are repo-relative, absolute when (as here) the dirs sit outside the repo
    assert rec["midi_path"] == str((midi_dir / "set_a_seg000.mid").resolve())
    assert rec["chroma_path"] == str((chroma_dir / "set_a_seg000.npy").resolve())
    assert rec["params"]["min_conf"] == 0.6 and rec["params"]["tuning_correct"] is True

    # chroma: (235, 12), one-hot on sounding frames, zero rows in the gaps
    c = np.load(chroma_dir / "set_a_seg000.npy")
    assert c.shape == (235, 12) and c.dtype == np.float16
    sums = c.sum(axis=1)
    assert set(np.unique(sums).tolist()) <= {0.0, 1.0}
    t = np.arange(235) * mm.CHROMA_HOP / SR
    n_sounding = 0
    for start, end, midi in SCHEDULE:
        inside = (t >= start + 0.15) & (t < end - 0.15)
        n_sounding += int(inside.sum())
        assert (sums[inside] == 1).all() and (c[inside].argmax(axis=1) == midi % 12).all()
    gaps = np.ones(235, dtype=bool)
    for start, end, _m in SCHEDULE:
        gaps &= ~((t >= start - 0.15) & (t < end + 0.15))
    assert (sums[gaps] == 0).all() and n_sounding > 150
    assert not (midi_dir / mm.SKIPPED_NAME).exists()


def test_no_legato_still_finds_the_eight_notes(tmp_path: Path, fake: FakeCrepe, fast_tempo: None) -> None:
    clip = tmp_path / "c.wav"
    _write_clip(clip, SCHEDULE, AMPS)
    audio = mm.load_clip(clip)
    f0, pd = fake(audio, "cpu")
    melody, skip = mm.analyse(audio, f0, pd, min_conf=0.6, min_note_ms=100.0, legato=False, seconds=30.0)
    assert skip is None and melody is not None
    assert [n.midi for n in melody.notes] == [m for _, _, m in SCHEDULE]
    assert melody.bpm == 90.0 and melody.n_frames == 235


def test_tuning_offset_is_removed_before_the_semitone_grid(tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
                                                          fast_tempo: None) -> None:
    """A recording +40 c sharp of A440: every note lands on the schedule's semitone with a
    near-zero deviation on the corrected grid, and with a +40 c deviation on the A440 grid."""
    sharp = FakeCrepe(SCHEDULE, offset_cents=40.0)
    monkeypatch.setattr(mm, "extract_f0", sharp)
    clip = tmp_path / "sharp.wav"
    _write_clip(clip, SCHEDULE, AMPS, offset_cents=40.0)
    audio = mm.load_clip(clip)
    f0, pd = sharp(audio, "cpu")
    want = [m for _, _, m in SCHEDULE]
    corrected, skip = mm.analyse(audio, f0, pd, min_conf=0.6, min_note_ms=100.0, legato=True, seconds=30.0)
    assert skip is None and corrected is not None
    assert abs(corrected.scale.tuning_offset_cents - 40.0) < 3 and corrected.tuning_correct
    assert abs(corrected.grid_offset_cents - 40.0) < 3
    assert [n.midi for n in corrected.notes] == want
    assert all(abs(n.cents_dev) < 5 for n in corrected.notes)
    assert all(abs(n.cents - (100 * m + 40)) < 5 for n, m in zip(corrected.notes, want))  # measured pitch kept
    a440, skip = mm.analyse(audio, f0, pd, min_conf=0.6, min_note_ms=100.0, legato=True, seconds=30.0,
                            tuning_correct=False)
    assert skip is None and a440 is not None and a440.grid_offset_cents == 0.0 and not a440.tuning_correct
    assert [n.midi for n in a440.notes] == want  # +40 c still rounds down
    assert all(35 < n.cents_dev < 45 for n in a440.notes)
    assert mm.midi_chroma(corrected.notes, 235).tolist() == mm.midi_chroma(a440.notes, 235).tolist()


def test_short_clip_still_gets_the_full_frame_count(tmp_path: Path, fake: FakeCrepe, fast_tempo: None) -> None:
    clip = tmp_path / "short.wav"
    _write_clip(clip, SCHEDULE[:5], AMPS[:5], seconds=20.0)  # a song's last segment
    audio = mm.load_clip(clip)
    f0, pd = fake(audio, "cpu")
    melody, skip = mm.analyse(audio, f0, pd, min_conf=0.6, min_note_ms=100.0, legato=True, seconds=30.0)
    assert skip is None and melody is not None and len(melody.notes) == 5
    c = mm.midi_chroma(melody.notes, melody.n_frames)
    assert c.shape == (235, 12) and c[int(20.0 / (mm.CHROMA_HOP / SR)) + 1:].sum() == 0


# ----------------------------------------------------------------------------- skips, resume, shards
def test_silent_and_sparse_clips_are_skipped_with_reasons(tmp_path: Path, fake: FakeCrepe, fast_tempo: None) -> None:
    captions, _rows_ = _rows(tmp_path, [("good_seg000", SCHEDULE, "oud"), ("silent_seg000", [], "oud"),
                                        ("sparse_seg000", SCHEDULE[:2], "oud")])
    midi_dir = tmp_path / "midi"
    assert mm.main(["--captions", str(captions), "--midi-dir", str(midi_dir), "--chroma-dir", str(tmp_path / "ch"),
                    "--device", "cpu"]) == 0
    skipped = [json.loads(line) for line in (midi_dir / mm.SKIPPED_NAME).read_text().splitlines()]
    by_stem = {s["stem"]: s for s in skipped}
    assert set(by_stem) == {"silent_seg000", "sparse_seg000"}
    assert by_stem["silent_seg000"]["reason"] == "voiced_under_1s" and by_stem["silent_seg000"]["n_voiced_frames"] == 0
    assert by_stem["sparse_seg000"]["reason"] == "fewer_than_4_notes" and by_stem["sparse_seg000"]["n_notes"] == 2
    assert by_stem["sparse_seg000"]["voiced_seconds"] > 1.0
    assert not (midi_dir / "silent_seg000.mid").exists() and not (midi_dir / "sparse_seg000.mid").exists()
    assert (midi_dir / "good_seg000.mid").exists()


def test_resume_skips_done_and_skipped_clips(tmp_path: Path, fake: FakeCrepe, fast_tempo: None,
                                             capsys: pytest.CaptureFixture[str]) -> None:
    captions, _rows_ = _rows(tmp_path, [("a_seg000", SCHEDULE, "oud"), ("silent_seg000", [], "oud"),
                                        ("b_seg000", SCHEDULE, "oud")])
    args = ["--captions", str(captions), "--midi-dir", str(tmp_path / "midi"), "--chroma-dir", str(tmp_path / "ch"),
            "--device", "cpu"]
    assert mm.main(args) == 0
    first = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert (first["processed"], first["skipped"], first["resumed"]) == (2, 1, 0) and fake.calls == 3
    # a half-written clip (only the .mid exists) is recomputed; the others are not
    (tmp_path / "ch" / "b_seg000.npy").unlink()
    assert mm.main(args) == 0
    second = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert (second["processed"], second["skipped"], second["resumed"]) == (1, 0, 2) and fake.calls == 4
    assert mm.main(args) == 0
    third = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert (third["processed"], third["skipped"], third["resumed"]) == (0, 0, 3) and fake.calls == 4
    # the skipped list was not appended to again
    assert len((tmp_path / "midi" / mm.SKIPPED_NAME).read_text().splitlines()) == 1


def test_sharding_and_limit_partition_the_eligible_rows(tmp_path: Path, fake: FakeCrepe, fast_tempo: None,
                                                        capsys: pytest.CaptureFixture[str]) -> None:
    captions, _rows_ = _rows(tmp_path, [(f"s{i}_seg000", SCHEDULE, "oud") for i in range(4)] + [("v_seg000", SCHEDULE, "voice")])
    base = ["--captions", str(captions), "--midi-dir", str(tmp_path / "midi"), "--chroma-dir", str(tmp_path / "ch"),
            "--device", "cpu"]
    assert mm.main(base + ["--shard", "0/2"]) == 0
    s0 = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert [c["stem"] for c in s0["per_clip"]] == ["s0_seg000", "s2_seg000"] and s0["shard"] == "0/2"
    assert s0["songs"] == 2 and s0["grid_offsets"].keys() == {"s0", "s2"}
    assert mm.main(base + ["--shard", "1/2"]) == 0
    s1 = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert [c["stem"] for c in s1["per_clip"]] == ["s1_seg000", "s3_seg000"]
    midi_dir = tmp_path / "midi"
    assert sorted(p.name for p in midi_dir.glob("*.mid")) == [f"s{i}_seg000.mid" for i in range(4)]
    assert not (midi_dir / "v_seg000.mid").exists()  # content voice: not eligible without --all-content
    assert mm.main(base + ["--all-content", "--limit", "5"]) == 0
    s_all = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert s_all["clips"] == 5 and s_all["processed"] == 1 and s_all["resumed"] == 4
    assert mm.main(base + ["--limit", "2"]) == 0
    lim = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert lim["clips"] == 2 and lim["resumed"] == 2 and fake.calls == 5


# ----------------------------------------------------------------------------- stamping, render, defaults
def test_write_midi_captions_is_a_sibling_file_with_only_the_midi_rows(tmp_path: Path, fake: FakeCrepe,
                                                                       fast_tempo: None,
                                                                       capsys: pytest.CaptureFixture[str]) -> None:
    captions, rows = _rows(tmp_path, [("a_seg000", SCHEDULE, "oud"), ("silent_seg000", [], "oud"),
                                      ("b_seg000", SCHEDULE, "oud"), ("v_seg000", SCHEDULE, "voice")])
    before = captions.read_text()
    midi_dir, chroma_dir = tmp_path / "midi", tmp_path / "chroma_midi"
    assert mm.main(["--captions", str(captions), "--midi-dir", str(midi_dir), "--chroma-dir", str(chroma_dir),
                    "--device", "cpu", "--write-chroma-dir"]) == 0  # the old flag name is an alias
    out = tmp_path / "captions_midi.jsonl"
    assert _summary(capsys)["midi_captions"] == {str(out): 2}
    assert captions.read_text() == before  # the input file is never rewritten: its audio chroma_dir survives
    assert not (tmp_path / "captions_midi.jsonl.tmp").exists()
    sib = [json.loads(line) for line in out.read_text().splitlines()]
    assert [Path(r["clip_path"]).name for r in sib] == ["a_seg000.wav", "b_seg000.wav"]  # no skipped, no voice row
    # tmp_path is outside the repo, so the paths fall back to absolute (as scale_chroma does)
    assert all(r["chroma_dir"] == str(chroma_dir.resolve()) for r in sib)
    assert all(r["audio_chroma_dir"] == "old/audio/chroma" and r["midi_grid"] == "tuning_corrected" for r in sib)
    assert [Path(r["midi_path"]).name for r in sib] == ["a_seg000.mid", "b_seg000.mid"]
    assert all(r["caption"] == "c" and r["seconds"] == SECONDS for r in sib)  # every other field carried over
    # with the repo root given, the paths are relative to it; the A440 grid names its own sibling
    dirs_of = {r["clip_path"]: (midi_dir, chroma_dir) for r in rows}
    out2 = mm.midi_captions_path(captions, tuning_correct=False)
    assert out2 == tmp_path / "captions_midi_a440.jsonl"
    assert mm.write_midi_captions(out2, rows, dirs_of, tuning_correct=False, root=tmp_path) == 2
    again = [json.loads(line) for line in out2.read_text().splitlines()]
    assert again[0]["chroma_dir"] == "chroma_midi" and again[0]["midi_path"] == "midi/a_seg000.mid"
    assert again[0]["midi_grid"] == "a440"


def test_render_check_writes_a_listenable_wav(tmp_path: Path, fake: FakeCrepe, fast_tempo: None,
                                              capsys: pytest.CaptureFixture[str]) -> None:
    captions, _rows_ = _rows(tmp_path, [("a_seg000", SCHEDULE, "oud"), ("b_seg000", SCHEDULE, "oud")])
    render_dir = tmp_path / "render"
    assert mm.main(["--captions", str(captions), "--midi-dir", str(tmp_path / "midi"), "--chroma-dir", str(tmp_path / "ch"),
                    "--device", "cpu", "--render-check", "1", "--render-dir", str(render_dir)]) == 0
    summary = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert summary["rendered"] == 1
    wavs = sorted(render_dir.glob("*.wav"))
    assert [w.name for w in wavs] == ["a_seg000.wav"]
    y, sr = sf.read(wavs[0])
    assert sr == SR and len(y) == int(SECONDS * SR) and np.abs(y).max() > 0.5
    t = np.arange(len(y)) / SR
    first = (t >= SCHEDULE[0][0] + 0.05) & (t < SCHEDULE[0][0] + 0.3)
    gap = (t >= SCHEDULE[0][1] + 0.3) & (t < SCHEDULE[1][0] - 0.05)
    assert np.abs(y[first]).max() > 5 * np.abs(y[gap]).max()  # the pluck decays into the rest


def test_default_dirs_sit_beside_the_clips_dir(tmp_path: Path, fake: FakeCrepe, fast_tempo: None) -> None:
    set_dir = tmp_path / "data" / "sets" / "ahmed_oud"
    clip = set_dir / "clips" / "test" / "ahmed_oud_abc_seg000.wav"
    _write_clip(clip, SCHEDULE, AMPS)
    captions = set_dir / "captions.jsonl"
    captions.write_text(json.dumps({"clip_path": str(clip), "content": "oud"}) + "\n")
    assert mm.main(["--captions", str(captions), "--device", "cpu"]) == 0
    assert (set_dir / "midi" / "ahmed_oud_abc_seg000.mid").exists()
    assert (set_dir / "midi" / "ahmed_oud_abc_seg000.json").exists()
    assert (set_dir / "chroma_midi" / "ahmed_oud_abc_seg000.npy").exists()
    assert sorted(p.name for p in (set_dir / "clips" / "test").iterdir()) == ["ahmed_oud_abc_seg000.wav"]


def test_unreadable_clip_is_counted_and_exit_1(tmp_path: Path, fake: FakeCrepe, fast_tempo: None,
                                               capsys: pytest.CaptureFixture[str]) -> None:
    captions, rows = _rows(tmp_path, [("a_seg000", SCHEDULE, "oud")])
    bad = tmp_path / "clips" / "test" / "bad_seg000.wav"
    bad.write_bytes(b"")
    wrong = tmp_path / "clips" / "test" / "wrong_seg000.wav"
    sf.write(wrong, np.zeros(1000, dtype=np.float32), 44100)
    rows += [{"clip_path": str(bad), "content": "oud"}, {"clip_path": str(wrong), "content": "oud"},
             {"clip_path": str(tmp_path / "missing.wav"), "content": "oud"}]
    captions.write_text("".join(json.dumps(r) + "\n" for r in rows))
    assert mm.main(["--captions", str(captions), "--midi-dir", str(tmp_path / "midi"), "--chroma-dir", str(tmp_path / "ch"),
                    "--device", "cpu"]) == 1
    out, err = capsys.readouterr()
    summary = json.loads(out.strip().splitlines()[-1])
    assert summary["processed"] == 1 and summary["failed"] == 3 and "3 clips failed" in err
    assert summary["failed_clips"] == [str(bad), str(wrong), str(tmp_path / "missing.wav")]


# ----------------------------------------------------------------------------- review fixes
def test_clips_of_one_song_share_one_grid_across_the_sign_flip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
                                                              fast_tempo: None,
                                                              capsys: pytest.CaptureFixture[str]) -> None:
    """Two segments of the same recording, one measured +44 c and one +54 c off A440: the
    per-clip circular mean calls the second -46 c (the [-50, 50) cut), which transposed it
    by a semitone. Pooled over the song, both get one grid and identical MIDI."""
    a = tmp_path / "clips" / "test" / "song_seg000.wav"
    b = tmp_path / "clips" / "test" / "song_seg001.wav"
    _write_clip(a, SCHEDULE, AMPS, seconds=30.0, offset_cents=44.0)
    _write_clip(b, SCHEDULE, AMPS, seconds=29.9, offset_cents=54.0)
    fake = FakeCrepe(SCHEDULE, offset_by_len={int(30.0 * SR): 44.0, int(29.9 * SR): 54.0})
    monkeypatch.setattr(mm, "extract_f0", fake)
    want = [m for _, _, m in SCHEDULE]
    # the defect, per clip: b's own offset is -46 and every note lands one semitone up
    audio_b = mm.load_clip(b)
    f0, pd = fake(audio_b, "cpu")
    alone, _skip = mm.analyse(audio_b, f0, pd, min_conf=0.6, min_note_ms=100.0, legato=True, seconds=30.0)
    assert alone is not None and abs(alone.scale.tuning_offset_cents + 46.0) < 3 and alone.grid_source == "clip"
    assert [n.midi for n in alone.notes] == [m + 1 for m in want]
    # the run: both clips of the song on the pooled grid
    rows = [{"clip_path": str(p), "content": "oud", "seconds": 30.0, "song_sha256": "abc"} for p in (a, b)]
    captions = tmp_path / "captions.jsonl"
    captions.write_text("".join(json.dumps(r) + "\n" for r in rows))
    args = ["--captions", str(captions), "--device", "cpu"]
    assert mm.main(args) == 0
    summary = _summary(capsys)
    assert summary["songs"] == 1 and summary["grid_offsets"].keys() == {"abc"}
    ra = json.loads((tmp_path / "midi" / "song_seg000.json").read_text())
    rb = json.loads((tmp_path / "midi" / "song_seg001.json").read_text())
    assert ra["quantisation"]["grid_offset_cents"] == rb["quantisation"]["grid_offset_cents"]
    assert 44 < ra["quantisation"]["grid_offset_cents"] < 54
    assert ra["quantisation"]["grid_offset_source"] == rb["quantisation"]["grid_offset_source"] == "song"
    assert ra["quantisation"]["n_clips_pooled"] == 2 and ra["quantisation"]["song_key"] == "abc"
    assert [n["midi"] for n in ra["notes"]] == [n["midi"] for n in rb["notes"]] == want
    assert abs(ra["scale"]["tuning_offset_cents"] - 44) < 3 and abs(rb["scale"]["tuning_offset_cents"] + 46) < 3
    ca = np.load(tmp_path / "chroma_midi" / "song_seg000.npy")
    cb = np.load(tmp_path / "chroma_midi" / "song_seg001.npy")
    assert ca.shape == cb.shape == (235, 12) and (ca.argmax(axis=1) == cb.argmax(axis=1)).all()
    # resume with only b to redo: the offset recorded in a's JSON is reused, not re-pooled
    for p in ((tmp_path / "midi" / "song_seg001.mid"), (tmp_path / "midi" / "song_seg001.json"),
              (tmp_path / "chroma_midi" / "song_seg001.npy")):
        p.unlink()
    calls = fake.calls
    assert mm.main(args) == 0
    summary = _summary(capsys)
    assert (summary["processed"], summary["resumed"]) == (1, 1) and fake.calls == calls + 1
    rb2 = json.loads((tmp_path / "midi" / "song_seg001.json").read_text())
    assert rb2["quantisation"]["grid_offset_cents"] == ra["quantisation"]["grid_offset_cents"]
    assert rb2["quantisation"]["grid_offset_source"] == "song_reused" and rb2["quantisation"]["n_clips_pooled"] == 1
    assert [n["midi"] for n in rb2["notes"]] == want


def test_torn_skipped_line_does_not_swallow_the_next_record(tmp_path: Path, fake: FakeCrepe, fast_tempo: None,
                                                           capsys: pytest.CaptureFixture[str]) -> None:
    captions, _rows_ = _rows(tmp_path, [("silent_seg000", [], "oud")])
    midi_dir = tmp_path / "midi"
    midi_dir.mkdir()
    (midi_dir / mm.SKIPPED_NAME).write_text('{"clip_path": "x", "stem": "torn_seg000"')  # crashed mid-write
    args = ["--captions", str(captions), "--midi-dir", str(midi_dir), "--chroma-dir", str(tmp_path / "ch"),
            "--device", "cpu"]
    assert mm.main(args) == 0
    assert _summary(capsys)["skipped"] == 1
    lines = (midi_dir / mm.SKIPPED_NAME).read_text().splitlines()
    assert len(lines) == 2 and lines[0] == '{"clip_path": "x", "stem": "torn_seg000"'
    rec = json.loads(lines[1])
    assert rec["stem"] == "silent_seg000" and rec["reason"] == "voiced_under_1s"
    assert rec["params"] == {"min_conf": 0.6, "min_note_ms": 100.0, "legato": True, "tuning_correct": True}
    assert set(mm.read_skipped(midi_dir)) == {"silent_seg000"}  # the torn line is ignored, the new one kept
    assert mm.main(args) == 0
    assert _summary(capsys)["resumed"] == 1 and fake.calls == 1


def test_row_seconds_decide_the_chroma_frames_not_the_cli(tmp_path: Path, fake: FakeCrepe, fast_tempo: None,
                                                          capsys: pytest.CaptureFixture[str]) -> None:
    """A merged captions file with 30 s and 10 s rows: each row's own seconds frames its chroma."""
    long_clip = tmp_path / "clips" / "test" / "long_seg000.wav"
    short_clip = tmp_path / "clips" / "test" / "short_seg000.wav"
    short_schedule = [(0.3 + i * 2.2, 0.3 + i * 2.2 + 1.8, m) for i, m in enumerate([62, 64, 66, 69])]
    _write_clip(long_clip, SCHEDULE, AMPS, seconds=30.0)
    _write_clip(short_clip, short_schedule, AMPS[:4], seconds=10.0)
    fake.schedule_by_len[int(10.0 * SR)] = short_schedule
    rows = [{"clip_path": str(long_clip), "content": "oud", "seconds": 30.0},
            {"clip_path": str(short_clip), "content": "sep_oud", "seconds": 10.0}]
    captions = tmp_path / "captions.jsonl"
    captions.write_text("".join(json.dumps(r) + "\n" for r in rows))
    assert mm.main(["--captions", str(captions), "--device", "cpu"]) == 0
    summary = _summary(capsys)
    assert summary["seconds"] == [10.0, 30.0] and summary["chroma_frames"] == [79, 235]
    assert np.load(tmp_path / "chroma_midi" / "long_seg000.npy").shape == (235, 12)
    assert np.load(tmp_path / "chroma_midi" / "short_seg000.npy").shape == (79, 12)
    short = json.loads((tmp_path / "midi" / "short_seg000.json").read_text())
    assert short["seconds"] == 10.0 and short["chroma_frames"] == 79 and short["audio_seconds"] == 10.0
    assert short["n_notes"] == 4 and short["n_notes_beyond_seconds"] == 0
    by_stem = {c["stem"]: c for c in summary["per_clip"]}
    assert by_stem["short_seg000"]["chroma_frames"] == 79 and by_stem["long_seg000"]["chroma_frames"] == 235


def test_notes_past_the_row_seconds_are_cut_and_reported(tmp_path: Path, fake: FakeCrepe, fast_tempo: None,
                                                        capsys: pytest.CaptureFixture[str]) -> None:
    long_schedule = SCHEDULE + [(29.0, 32.0, 62), (33.0, 36.0, 64), (37.0, 39.0, 66)]
    clip = tmp_path / "clips" / "test" / "over_seg000.wav"
    _write_clip(clip, long_schedule, AMPS + [0.3, 0.3, 0.3], seconds=40.0)
    fake.schedule = long_schedule
    captions = tmp_path / "captions.jsonl"
    captions.write_text(json.dumps({"clip_path": str(clip), "content": "oud", "seconds": 30.0}) + "\n")
    assert mm.main(["--captions", str(captions), "--device", "cpu"]) == 0
    out = capsys.readouterr().out
    rec = json.loads((tmp_path / "midi" / "over_seg000.json").read_text())
    assert rec["seconds"] == 30.0 and rec["audio_seconds"] == 40.0 and rec["n_notes_beyond_seconds"] == 3
    assert rec["n_notes"] == 9 and rec["notes"][-1]["end"] == 30.0  # the straddling note is shortened, two dropped
    pm = pretty_midi.PrettyMIDI(str(tmp_path / "midi" / "over_seg000.mid"))
    assert max(n.end for n in pm.instruments[0].notes) <= 30.0 and len(pm.instruments[0].notes) == 9
    c = np.load(tmp_path / "chroma_midi" / "over_seg000.npy")
    assert c.shape == (235, 12) and c[-5:].sum() > 0  # the shortened note sounds up to the last frames
    assert "WARN over_seg000: audio is 40.00 s but the row says 30 s; 3 notes past 30 s cut" in out
    # a clip shorter than its row's seconds is not a warning
    assert mm.clip_notes([mm.MelodyNote(0.0, 1.0, 62, 0.0, 6200.0, 1.0, 0.9, 100)], 30.0) == (
        [mm.MelodyNote(0.0, 1.0, 62, 0.0, 6200.0, 1.0, 0.9, 100)], 0)


def test_malformed_captions_exit_with_a_message(tmp_path: Path) -> None:
    with pytest.raises(SystemExit, match="captions file not found"):
        mm.main(["--captions", str(tmp_path / "nope.jsonl"), "--device", "cpu"])
    bad = tmp_path / "bad.jsonl"
    bad.write_text('{"clip_path": "a.wav", "content": "oud"}\n{not json\n')
    with pytest.raises(SystemExit, match=r"bad\.jsonl:2: not JSON"):
        mm.load_rows(bad)
    nopath = tmp_path / "nopath.jsonl"
    nopath.write_text('{"caption": "c", "content": "oud"}\n')
    with pytest.raises(SystemExit, match=r"nopath\.jsonl:1: row has no clip_path"):
        mm.load_rows(nopath)
    blank = tmp_path / "blank.jsonl"
    blank.write_text("\n  \n")
    assert mm.load_rows(blank) == []


def test_sep_oud_rows_are_eligible_and_sep_vocal_rows_are_not(tmp_path: Path, fake: FakeCrepe, fast_tempo: None,
                                                              capsys: pytest.CaptureFixture[str]) -> None:
    captions, _rows_ = _rows(tmp_path, [("o_seg000", SCHEDULE, "oud"), ("s_seg000", SCHEDULE, "sep_oud"),
                                        ("v_seg000", SCHEDULE, "sep_vocal"), ("f_seg000", SCHEDULE, "full_mix")])
    base = ["--captions", str(captions), "--device", "cpu"]
    assert mm.main(base) == 0
    summary = _summary(capsys)
    assert [c["stem"] for c in summary["per_clip"]] == ["o_seg000", "s_seg000"] and summary["clips"] == 2
    assert not (tmp_path / "midi" / "v_seg000.mid").exists() and not (tmp_path / "midi" / "f_seg000.mid").exists()
    # --content narrows the list; a list matching nothing is a stderr warning, not a silent exit 0
    assert mm.main(base + ["--content", "sep_oud"]) == 0
    assert _summary(capsys)["clips"] == 1
    assert mm.main(base + ["--content", "drums"]) == 0
    out, err = capsys.readouterr()
    assert json.loads(out.strip().splitlines()[-1]) == {"clips": 0, "processed": 0, "skipped": 0, "resumed": 0,
                                                        "failed": 0, "rows_read": 4}
    assert "no eligible clips: 4 rows read" in err and "'sep_vocal'" in err and "['drums']" in err
    assert mm.parse_content(mm.DEFAULT_CONTENT) == mm.OUD_CONTENTS == frozenset({"oud", "sep_oud"})


def test_default_dirs_come_from_each_clips_set_dir_not_the_captions_file(tmp_path: Path, fake: FakeCrepe,
                                                                         fast_tempo: None) -> None:
    """A merged run-captions file outside any set dir: every clip writes into its own
    set's midi/ and chroma_midi/ (the git-ignored dirs), nothing lands beside the captions."""
    set_a = tmp_path / "data" / "sets" / "ahmed_oud"
    set_b = tmp_path / "data" / "sets_10s" / "sep_oud"
    clip_a = set_a / "clips" / "train" / "ahmed_oud_abc_seg000.wav"
    clip_b = set_b / "clips" / "test" / "sep_oud_def_seg000.wav"
    _write_clip(clip_a, SCHEDULE, AMPS)
    _write_clip(clip_b, SCHEDULE, AMPS)
    merged = tmp_path / "data" / "sets" / "all_captions.jsonl"
    merged.write_text(json.dumps({"clip_path": str(clip_a), "content": "oud"}) + "\n"
                      + json.dumps({"clip_path": str(clip_b), "content": "sep_oud"}) + "\n")
    assert mm.main(["--captions", str(merged), "--device", "cpu"]) == 0
    assert (set_a / "midi" / "ahmed_oud_abc_seg000.mid").exists() and (set_a / "chroma_midi" / "ahmed_oud_abc_seg000.npy").exists()
    assert (set_b / "midi" / "sep_oud_def_seg000.json").exists() and (set_b / "chroma_midi" / "sep_oud_def_seg000.npy").exists()
    assert sorted(p.name for p in merged.parent.iterdir()) == ["ahmed_oud", "all_captions.jsonl"]
    # the A440 grid gets its own default dirs, so both grids coexist
    assert mm.main(["--captions", str(merged), "--device", "cpu", "--no-tuning-correct"]) == 0
    assert (set_a / "midi_a440" / "ahmed_oud_abc_seg000.mid").exists()
    assert (set_b / "chroma_midi_a440" / "sep_oud_def_seg000.npy").exists()
    assert mm.default_dirs(Path("data/sets/x/clips/val/c.wav")) == (Path("data/sets/x/midi"), Path("data/sets/x/chroma_midi"))
    assert mm.default_dirs(Path("data/sets/x/clips/val/c.wav"), tuning_correct=False) == (
        Path("data/sets/x/midi_a440"), Path("data/sets/x/chroma_midi_a440"))
    assert mm.default_dirs(Path("somewhere/c.wav")) is None
    # a clip outside the <set>/clips/<split>/ layout needs explicit dirs
    loose = tmp_path / "loose.wav"
    _write_clip(loose, SCHEDULE, AMPS)
    cap2 = tmp_path / "loose.jsonl"
    cap2.write_text(json.dumps({"clip_path": str(loose), "content": "oud"}) + "\n")
    with pytest.raises(SystemExit, match="not under <set>/clips/<split>/"):
        mm.main(["--captions", str(cap2), "--device", "cpu"])
    assert mm.main(["--captions", str(cap2), "--device", "cpu", "--midi-dir", str(tmp_path / "m"),
                    "--chroma-dir", str(tmp_path / "c")]) == 0
    assert (tmp_path / "m" / "loose.mid").exists()


def test_resume_recomputes_when_the_parameters_change(tmp_path: Path, fake: FakeCrepe, fast_tempo: None,
                                                     capsys: pytest.CaptureFixture[str]) -> None:
    captions, _rows_ = _rows(tmp_path, [("a_seg000", SCHEDULE, "oud"), ("sparse_seg000", SCHEDULE[:2], "oud")])
    base = ["--captions", str(captions), "--device", "cpu"]
    assert mm.main(base) == 0
    first = _summary(capsys)
    assert (first["processed"], first["skipped"], first["stale_recomputed"]) == (1, 1, 0) and fake.calls == 2
    assert mm.main(base) == 0
    assert (_summary(capsys)["resumed"], fake.calls) == (2, 2)
    # a different confidence floor: the done clip and the skipped clip are both recomputed
    assert mm.main(base + ["--min-conf", "0.4"]) == 0
    third = _summary(capsys)
    assert (third["processed"], third["skipped"], third["resumed"], third["stale_recomputed"]) == (1, 1, 0, 2)
    assert fake.calls == 4
    rec = json.loads((tmp_path / "midi" / "a_seg000.json").read_text())
    assert rec["params"]["min_conf"] == 0.4
    skipped = [json.loads(line) for line in (tmp_path / "midi" / mm.SKIPPED_NAME).read_text().splitlines()]
    assert [s["params"]["min_conf"] for s in skipped] == [0.6, 0.4]
    assert mm.main(base + ["--min-conf", "0.4"]) == 0
    assert (_summary(capsys)["resumed"], fake.calls) == (2, 4)
    # --no-legato likewise; the A440 grid lives in its own default dirs so it never collides
    assert mm.main(base + ["--min-conf", "0.4", "--no-legato"]) == 0
    assert _summary(capsys)["stale_recomputed"] == 2 and fake.calls == 6
    assert mm.main(base + ["--no-tuning-correct"]) == 0
    a440 = _summary(capsys)
    assert a440["processed"] == 1 and a440["grid"] == "a440" and fake.calls == 8
    assert a440["midi_dirs"] == [str((tmp_path / "midi_a440").resolve())]
    assert (tmp_path / "midi_a440" / "a_seg000.mid").exists() and (tmp_path / "chroma_midi_a440" / "a_seg000.npy").exists()
    assert json.loads((tmp_path / "midi_a440" / "a_seg000.json").read_text())["quantisation"]["grid_offset_source"] == "a440"
    # the legacy skip record without params does not count as skipped
    assert mm.same_params({"min_conf": 0.6, "min_note_ms": 100.0, "legato": True, "tuning_correct": True},
                          mm.analysis_params(min_conf=0.6, min_note_ms=100, legato=True, tuning_correct=True))
    assert not mm.same_params(None, mm.analysis_params(min_conf=0.6, min_note_ms=100, legato=True, tuning_correct=True))


def test_verify_processor_moves_past_an_unloadable_first_clip(tmp_path: Path, fake: FakeCrepe, fast_tempo: None,
                                                              monkeypatch: pytest.MonkeyPatch,
                                                              capsys: pytest.CaptureFixture[str]) -> None:
    captions, rows = _rows(tmp_path, [("good_seg000", SCHEDULE, "oud")])
    bad = tmp_path / "clips" / "test" / "bad_seg000.wav"
    bad.write_bytes(b"")
    rows.insert(0, {"clip_path": str(bad), "content": "oud", "seconds": SECONDS})
    captions.write_text("".join(json.dumps(r) + "\n" for r in rows))
    seen: list[str] = []

    def fake_verify(job: mm.Job, seconds: float, root: Path = mm.REPO, log=print) -> int:
        mm.load_clip(mm.resolve_clip(job.row["clip_path"], root))  # raises for the 0-byte clip, as sc.load_clip does
        seen.append(job.stem)
        return mm.chroma_frames(seconds)

    monkeypatch.setattr(mm, "verify_processor", fake_verify)
    assert mm.main(["--captions", str(captions), "--device", "cpu", "--verify-processor"]) == 1  # bad still fails in run
    out, err = capsys.readouterr()
    assert seen == ["good_seg000"] and "verify-processor tries the next clip" in err
    assert json.loads(out.strip().splitlines()[-1])["failed_clips"] == [str(bad)]


def test_json_and_summary_paths_are_relative_to_the_root(tmp_path: Path, fake: FakeCrepe, fast_tempo: None) -> None:
    captions, rows = _rows(tmp_path, [("a_seg000", SCHEDULE, "oud")])
    jobs = mm.build_jobs([captions], {captions: rows}, midi_dir=None, chroma_dir=None, root=tmp_path)
    assert jobs[0].seconds == SECONDS and jobs[0].song == "a"
    summary = mm.run(jobs, device="cpu", root=tmp_path, log=lambda _s: None)
    assert summary["midi_dirs"] == ["midi"] and summary["chroma_dirs"] == ["chroma_midi"]
    rec = json.loads((tmp_path / "midi" / "a_seg000.json").read_text())
    assert rec["midi_path"] == "midi/a_seg000.mid" and rec["chroma_path"] == "chroma_midi/a_seg000.npy"
    assert rec["version"] == 2
