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

    # Non-transcribe subprocesses (demucs, vocal_f0) fail politely so the
    # service's graceful-degradation path runs instead of the real engines.
    if "scripts.transcribe" not in cmd:
        class F:
            returncode = 1
            stderr = "fake subprocess: only transcribe is stubbed"
        return F()

    # Positional args follow the module name; flags (--melody, --beat-audio …)
    # may trail them, so anchor on the module instead of the list tail.
    i = cmd.index("scripts.transcribe")
    audio, out_dir = cmd[i + 1], cmd[i + 2]
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


def test_duplicate_upload_reuses_the_job(monkeypatch):
    """Identical bytes + options → the SAME job (re-upload herd protection)."""
    monkeypatch.setattr(svc.subprocess, "run", fake_transcribe_ok)
    r1 = client.post("/notation", files={"file": ("a.wav", b"RIFFdup1", "audio/wav")})
    r2 = client.post("/notation", files={"file": ("b.wav", b"RIFFdup1", "audio/wav")})
    assert r1.json()["job_id"] == r2.json()["job_id"]
    # Different options are a different request — own job.
    r3 = client.post("/notation", data={"separate": "true"},
                     files={"file": ("c.wav", b"RIFFdup1", "audio/wav")})
    assert r3.json()["job_id"] != r1.json()["job_id"]


def test_job_records_stage_and_timings(monkeypatch):
    monkeypatch.setattr(svc.subprocess, "run", fake_transcribe_ok)
    r = client.post("/notation", files={"file": ("t.wav", b"RIFFtiming", "audio/wav")})
    s = client.get(f"/notation/jobs/{r.json()['job_id']}").json()
    assert s["status"] == "done"
    assert s["stage"] == "done"
    assert "transcribe" in s["timings"]


def test_run_job_is_idempotent(monkeypatch):
    """A second run_job for the same id (deduped double-submit) is a no-op."""
    calls = []

    def counting_fake(cmd, **kwargs):
        calls.append(cmd)
        return fake_transcribe_ok(cmd, **kwargs)

    monkeypatch.setattr(svc.subprocess, "run", counting_fake)
    r = client.post("/notation", files={"file": ("i.wav", b"RIFFidem", "audio/wav")})
    jid = r.json()["job_id"]  # TestClient ran the background task → done
    before = len(calls)
    svc.run_job(jid)  # the ghost second schedule
    assert len(calls) == before  # nothing re-ran
    assert client.get(f"/notation/jobs/{jid}").json()["status"] == "done"


def test_instrument_routing_and_validation(monkeypatch):
    calls = []

    def counting_fake(cmd, **kwargs):
        calls.append(cmd)
        return fake_transcribe_ok(cmd, **kwargs)

    monkeypatch.setattr(svc.subprocess, "run", counting_fake)
    # kaban (no separation): register prior + staff name flow into the pipeline
    r = client.post("/notation", data={"instrument": "kaban"},
                    files={"file": ("k.wav", b"RIFFkaban", "audio/wav")})
    assert r.status_code == 202
    cmd = calls[-1]
    assert "--part-name" in cmd and cmd[cmd.index("--part-name") + 1] == "Kaban"
    assert "--fmin" in cmd and cmd[cmd.index("--fmin") + 1] == "70.0"
    # same bytes, different instrument → its OWN job (dedupe keys on instrument)
    r2 = client.post("/notation", data={"instrument": "violin"},
                     files={"file": ("k.wav", b"RIFFkaban", "audio/wav")})
    assert r2.json()["job_id"] != r.json()["job_id"]
    # unknown instrument → 422
    bad = client.post("/notation", data={"instrument": "banjo"},
                      files={"file": ("k.wav", b"RIFFother", "audio/wav")})
    assert bad.status_code == 422


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
