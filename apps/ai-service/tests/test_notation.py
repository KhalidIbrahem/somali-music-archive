"""Notation job API tests. The somali311 subprocess is faked so these run fast
under any Python; the real pipeline is exercised by scripts/phase4_ablation.py."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

import services.notation_service as svc
from main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def jobs_tmpdir(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "JOBS_ROOT", tmp_path)
    yield tmp_path


def fake_transcribe_ok(cmd, **kwargs):
    """Stand-in for the somali311 subprocess: writes the artifacts + summary."""
    audio, out_dir = cmd[-2], cmd[-1]
    from pathlib import Path

    stem = Path(audio).stem
    out = Path(out_dir)
    for ext in (".musicxml", ".svg", ".mid"):
        (out / f"{stem}{ext}").write_text("fake")
    (out / f"{stem}.json").write_text(json.dumps(
        {"file": f"{stem}.wav", "n_notes": 42, "tonic": "C", "mode": 0,
         "degrees": [0, 2, 4, 7, 9], "tuning_offset_cents": 12.0, "bpm": 100,
         "snapped": 40, "marked_outliers": 2, "mean_confidence": 0.9,
         "outputs": [f"{stem}.musicxml", f"{stem}.svg", f"{stem}.mid"], "notes": []}))

    class P:
        returncode = 0
        stderr = ""

    return P()


def test_full_job_lifecycle(monkeypatch):
    monkeypatch.setattr(svc.subprocess, "run", fake_transcribe_ok)
    r = client.post("/notation", files={"file": ("song.wav", b"RIFF....", "audio/wav")})
    assert r.status_code == 202
    job_id = r.json()["job_id"]

    # TestClient runs BackgroundTasks before returning, so the job is done
    s = client.get(f"/notation/jobs/{job_id}").json()
    assert s["status"] == "done"
    assert s["result"]["tonic"] == "C"
    assert s["result"]["marked_outliers"] == 2

    for kind in ("musicxml", "svg", "midi"):
        a = client.get(f"/notation/jobs/{job_id}/artifacts/{kind}")
        assert a.status_code == 200, kind


def test_rejects_bad_format_and_empty():
    r = client.post("/notation", files={"file": ("x.pdf", b"%PDF", "application/pdf")})
    assert r.status_code == 422
    r = client.post("/notation", files={"file": ("x.wav", b"", "audio/wav")})
    assert r.status_code == 422


def test_unknown_job_404():
    assert client.get("/notation/jobs/deadbeef").status_code == 404
    assert client.get("/notation/jobs/deadbeef/artifacts/svg").status_code == 404


def test_failed_subprocess_marks_job_error(monkeypatch):
    class P:
        returncode = 1
        stderr = "boom"

    monkeypatch.setattr(svc.subprocess, "run", lambda *a, **k: P())
    r = client.post("/notation", files={"file": ("song.wav", b"RIFF", "audio/wav")})
    s = client.get(f"/notation/jobs/{r.json()['job_id']}").json()
    assert s["status"] == "error"
    assert "boom" in s["error"]


def test_generation_is_gated_403():
    r = client.post("/generate", json={"caption": "Qaraami, moderate at 100 BPM"})
    assert r.status_code == 403
    assert "license" in r.json()["detail"].lower()
