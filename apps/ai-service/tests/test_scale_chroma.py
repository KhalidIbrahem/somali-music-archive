"""Unit tests for scripts/scale_chroma.py with a monkeypatched melody processor.

No model, GPU or network: the processor is a fake that checks it receives
exactly `seconds` of 32 kHz audio and returns fixed-shape features.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from scripts import scale_chroma as sc

SR = 32000


class FakeProcessor:
    """Stands in for AutoProcessor('facebook/musicgen-melody')."""

    def __init__(self, frames: int = 235, drift_after: int | None = None) -> None:
        self.frames = frames
        self.drift_after = drift_after
        self.calls = 0
        self.lengths: list[int] = []

    def __call__(self, audio: np.ndarray, sampling_rate: int, return_tensors: str) -> dict:
        assert sampling_rate == SR and return_tensors == "pt"
        self.calls += 1
        self.lengths.append(len(audio))
        frames = self.frames + (1 if self.drift_after is not None and self.calls > self.drift_after else 0)
        return {"input_features": np.random.default_rng(self.calls).random((1, frames, 12), dtype=np.float32)}


def _clips(tmp_path: Path, seconds: list[float]) -> list[dict]:
    rows = []
    for i, s in enumerate(seconds):
        p = tmp_path / "clips" / f"set_{i:012d}_seg{i:03d}.wav"
        p.parent.mkdir(parents=True, exist_ok=True)
        t = np.arange(int(s * SR)) / SR
        sf.write(p, (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), SR, subtype="PCM_16")
        rows.append({"clip_path": str(p), "caption": "c", "split": "train"})
    return rows


def test_run_writes_float16_constant_shape_and_resumes(tmp_path: Path) -> None:
    rows = _clips(tmp_path, [30.0, 20.0, 31.0])
    proc = FakeProcessor()
    logs: list[str] = []
    summary = sc.run(rows, tmp_path / "chroma", proc, seconds=30.0, root=tmp_path, log=logs.append)
    assert summary["computed"] == 3 and summary["shape"] == [235, 12] and summary["skipped_existing"] == 0
    assert proc.lengths == [30 * SR] * 3  # padded / trimmed before the processor
    assert any("chroma shape (235, 12)" in line for line in logs)
    for r in rows:
        arr = np.load(sc.chroma_path(tmp_path / "chroma", r["clip_path"]))
        assert arr.shape == (235, 12) and arr.dtype == np.float16
    again = sc.run(rows, tmp_path / "chroma", proc, seconds=30.0, root=tmp_path, log=logs.append)
    assert again["computed"] == 0 and again["skipped_existing"] == 3 and proc.calls == 3
    smoke = sc.run(_clips(tmp_path / "more", [30.0, 30.0]), tmp_path / "chroma2", proc, smoke=1, root=tmp_path, log=logs.append)
    assert smoke["clips"] == 1 and smoke["computed"] == 1


def test_shape_drift_raises(tmp_path: Path) -> None:
    rows = _clips(tmp_path, [30.0, 30.0])
    with pytest.raises(RuntimeError, match="chroma shape changed"):
        sc.run(rows, tmp_path / "chroma", FakeProcessor(drift_after=1), root=tmp_path, log=lambda s: None)


def test_load_clip_rejects_wrong_rate_and_handles_stereo(tmp_path: Path) -> None:
    stereo = tmp_path / "stereo.wav"
    sf.write(stereo, np.zeros((SR, 2), dtype=np.float32), SR)
    assert sc.load_clip(stereo, 2 * SR).shape == (2 * SR,)
    wrong = tmp_path / "wrong.wav"
    sf.write(wrong, np.zeros(1000, dtype=np.float32), 44100)
    with pytest.raises(ValueError, match="32000 Hz"):
        sc.load_clip(wrong, SR)


def test_main_writes_chroma_dir_into_captions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    rows = _clips(tmp_path, [30.0, 30.0])
    captions = tmp_path / "captions.jsonl"
    captions.write_text("".join(json.dumps(r) + "\n" for r in rows))
    proc = FakeProcessor()
    monkeypatch.setattr(sc, "load_processor", lambda model=sc.MODEL: proc)
    assert sc.main(["--captions", str(captions), "--chroma-dir", str(tmp_path / "chroma"), "--write-chroma-dir"]) == 0
    out = capsys.readouterr().out
    summary = json.loads(out.strip().splitlines()[-1])
    assert summary["shape"] == [235, 12] and summary["rows_with_chroma_dir"] == 2 and summary["failed"] == 0
    rewritten = [json.loads(line) for line in captions.read_text().splitlines()]
    assert all(r["chroma_dir"] == str((tmp_path / "chroma").resolve()) for r in rewritten)
    assert proc.calls == 2


def test_unreadable_clips_are_skipped_counted_and_exit_1(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    rows = _clips(tmp_path, [30.0, 30.0, 30.0])
    empty = tmp_path / "clips" / "bad clip #1.wav"
    empty.write_bytes(b"")  # a 0-byte WAV: soundfile raises LibsndfileError
    wrong = tmp_path / "clips" / "wrong_rate.wav"
    sf.write(wrong, np.zeros(1000, dtype=np.float32), 44100)  # load_clip raises ValueError
    missing = tmp_path / "clips" / "missing.wav"
    bad_rows = [{"clip_path": str(p), "caption": "c", "split": "train"} for p in (empty, wrong, missing)]
    rows = rows[:1] + bad_rows[:1] + rows[1:2] + bad_rows[1:] + rows[2:]
    captions = tmp_path / "captions.jsonl"
    captions.write_text("".join(json.dumps(r) + "\n" for r in rows))
    proc = FakeProcessor()
    monkeypatch.setattr(sc, "load_processor", lambda model=sc.MODEL: proc)
    logs: list[str] = []
    summary = sc.run(rows, tmp_path / "chroma", proc, root=tmp_path, log=logs.append)
    assert summary["computed"] == 3 and summary["failed"] == 3 and summary["shape"] == [235, 12]
    assert summary["failed_clips"] == [str(empty), str(wrong), str(missing)]
    assert sum(1 for line in logs if line.startswith("FAILED ")) == 3 and proc.calls == 3
    # main still prints the summary, stamps the rows that have chroma and exits 1
    assert sc.main(["--captions", str(captions), "--chroma-dir", str(tmp_path / "chroma"), "--write-chroma-dir"]) == 1
    out, err = capsys.readouterr()
    printed = json.loads(out.strip().splitlines()[-1])
    assert printed["failed"] == 3 and printed["computed"] == 0 and printed["skipped_existing"] == 3
    assert printed["rows_with_chroma_dir"] == 3 and "3 clips failed" in err
    rewritten = [json.loads(line) for line in captions.read_text().splitlines()]
    assert [("chroma_dir" in r) for r in rewritten] == [True, False, True, False, False, True]


def test_shape_drift_still_aborts_after_a_failed_clip(tmp_path: Path) -> None:
    rows = _clips(tmp_path, [30.0, 30.0])
    (tmp_path / "clips" / "empty.wav").write_bytes(b"")
    rows.insert(1, {"clip_path": str(tmp_path / "clips" / "empty.wav"), "caption": "c", "split": "train"})
    with pytest.raises(RuntimeError, match="chroma shape changed"):
        sc.run(rows, tmp_path / "chroma", FakeProcessor(drift_after=1), root=tmp_path, log=lambda s: None)
