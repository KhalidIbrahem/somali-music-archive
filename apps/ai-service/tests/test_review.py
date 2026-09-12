"""The listening review: phrase cutting on the beat grid, the two renderings
of a phrase, and the review file round trip through the HTTP routes."""
from __future__ import annotations

import io
import json

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import services.review_service as rs
from main import app

client = TestClient(app)
SR = 44100


def make_pipeline(n_beats: int = 60, shift: int = 4, bpm: float = 120.0, beat_times: bool = True,
                  bars_with_notes: int | None = None) -> dict:
    """A constant grid (one beat every 60/bpm s) with a one-bar pickup, and a
    crotchet on every beat of every bar up to `bars_with_notes`."""
    beat = 60.0 / bpm
    bt = [round(1.0 + k * beat, 3) for k in range(n_beats)]      # beat 0 at 1.0 s
    n_bars = bars_with_notes if bars_with_notes is not None else (n_beats + shift) // 4
    notes = []
    for b in range(n_bars):
        for q in range(4):
            ql = b * 4 + q
            t0 = 1.0 + (ql - shift) * beat
            notes.append({"staff": "Oud (kaban)", "start": round(t0, 3), "end": round(t0 + beat * 0.8, 3),
                          "midi": 57 + (ql % 5) * 2, "amp": 0.5, "offset_ql": float(ql), "duration_ql": 1.0,
                          "engraved": True})
    notes.append({"staff": "Oud (kaban)", "start": 2.0, "end": 2.2, "midi": 60, "amp": 0.5,
                  "offset_ql": 4.0, "duration_ql": 1.0, "engraved": False})   # dropped by the grid
    tempo = {"bpm": bpm, "grid": "beat-tracked", "n_beats": n_beats, "subdivision_per_beat": 2,
             "beats_per_bar": 4, "pickup_shift_beats": shift}
    if beat_times:
        tempo["beat_times"] = bt
    duration = 1.0 + (n_beats - 1) * beat + 0.4
    return {"duration_sec": round(duration, 1), "tempo": tempo, "notes": notes}


@pytest.fixture
def pack(tmp_path, monkeypatch):
    slug = "oud_test_pack"
    d = tmp_path / slug
    d.mkdir()
    pipeline = make_pipeline()
    (d / f"{slug}_pipeline.json").write_text(json.dumps(pipeline))
    (d / "meta.json").write_text(json.dumps({"slug": slug, "tonic_name": "A"}))
    (d / "source.json").write_text(json.dumps({"source_name": "A test oud take", "source": "oud", "duration_s": pipeline["duration_sec"]}))
    n = int(pipeline["duration_sec"] * SR) + SR
    t = np.arange(n) / SR
    sf.write(d / f"{slug}_source.wav", (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), SR, subtype="PCM_16")
    monkeypatch.setattr(rs, "ANNOTATION_ROOT", tmp_path)
    monkeypatch.setattr(rs, "POOL_ROOT", tmp_path / "pool")
    monkeypatch.setattr(rs, "DEMO_ROOT", tmp_path / "demo")
    return slug, d, pipeline


@pytest.fixture
def pool_item(tmp_path, monkeypatch):
    """A transcribe.py output folder in the pool layout, with no pack."""
    slug = "oud_0123abcd_a_pool_take"
    d = tmp_path / "pool" / slug
    d.mkdir(parents=True)
    pipeline = make_pipeline(beat_times=False)
    pipeline["file"] = "/somewhere/A pool take.m4a"
    (d / "A pool take.json").write_text(json.dumps(pipeline))
    (d / "pool_row.json").write_text(json.dumps({"slug": slug, "source": "oud", "name": "A pool take.m4a",
                                                 "duration_s": pipeline["duration_sec"], "error": None}))
    n = int(pipeline["duration_sec"] * SR) + SR
    t = np.arange(n) / SR
    sf.write(d / "A pool take.input.wav", (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), SR, subtype="PCM_16")
    dup = tmp_path / "pool" / "oud_0123abcd_a_pool_take_2"   # same content hash: folded away
    dup.mkdir()
    for f in d.iterdir():
        (dup / f.name).write_bytes(f.read_bytes())
    monkeypatch.setattr(rs, "ANNOTATION_ROOT", tmp_path / "annotation")
    monkeypatch.setattr(rs, "POOL_ROOT", tmp_path / "pool")
    monkeypatch.setattr(rs, "DEMO_ROOT", tmp_path / "demo")
    return slug, d, pipeline


def test_phrases_follow_the_bar_lines_with_the_pickup_at_zero():
    p = make_pipeline()                       # 60 beats + 4 pickup = 16 bars
    ph = rs.split_phrases(p)
    assert [(x.bar_from, x.bar_to) for x in ph] == [(1, 4), (5, 8), (9, 12), (13, 16)]
    assert ph[0].start == 0.0                  # the pickup bar begins before the first tracked beat
    assert ph[1].start == pytest.approx(1.0 + 12 * 0.5, abs=1e-3)   # bar 5 = beat position 16 - 4
    assert ph[2].start == pytest.approx(1.0 + 28 * 0.5, abs=1e-3)
    assert ph[-1].end == p["duration_sec"]     # the tail after the last bar line is short: absorbed


def test_a_short_remainder_joins_the_previous_phrase():
    p = make_pipeline(bars_with_notes=13)     # 13 bars: 4+4+4+1 -> the last bar joins the third phrase
    assert [(x.bar_from, x.bar_to) for x in rs.split_phrases(p)] == [(1, 4), (5, 8), (9, 13)]
    p = make_pipeline(bars_with_notes=14)     # 4+4+4+2 -> two bars stand on their own
    assert [(x.bar_from, x.bar_to) for x in rs.split_phrases(p)][-1] == (13, 14)


def test_a_pack_without_stored_beat_times_gets_a_fitted_grid():
    p = make_pipeline(beat_times=False)
    g = rs.Grid(p)
    assert g.kind == "fitted"
    assert g.seconds(16.0)[0] == pytest.approx(1.0 + 12 * 0.5, abs=0.02)
    assert [(x.bar_from, x.bar_to) for x in rs.split_phrases(p)] == [(1, 4), (5, 8), (9, 12), (13, 16)]


def test_machine_rendering_covers_the_window_and_stays_in_range():
    p = make_pipeline()
    ph = rs.split_phrases(p)[1]
    x, sr = sf.read(io.BytesIO(rs.machine_audio(p, ph)), dtype="float32")
    assert sr == SR and len(x) == round((ph.end - ph.start) * SR)
    assert 0.5 < float(np.max(np.abs(x))) <= 0.71
    # a crotchet starts on every beat: loud at the first beat's attack, decayed just before the second beat's
    beat = 0.5
    attack = float(np.max(np.abs(x[int(0.005 * SR):int(0.1 * SR)])))
    tail = float(np.max(np.abs(x[int((beat - 0.02) * SR):int((beat - 0.005) * SR)])))
    assert attack > 0.3 and tail < 0.5 * attack


def test_pluck_is_deterministic_and_decays():
    a, b = rs.pluck(220.0, 1.0, SR, seed=3), rs.pluck(220.0, 1.0, SR, seed=3)
    assert np.array_equal(a, b) and len(a) == SR
    assert float(np.max(np.abs(a[:SR // 10]))) > 5 * float(np.max(np.abs(a[-SR // 10:])))


def test_routes_serve_the_pack_and_keep_the_review(pack):
    slug, d, pipeline = pack
    assert "A test oud take" in client.get("/demo/review").text
    page = client.get(f"/demo/review/{slug}")
    assert page.status_code == 200 and "Record my version" in page.text and "<script src=" not in page.text
    assert client.get("/demo/review/no_such_pack").status_code == 404

    info = client.get(f"/demo/review/{slug}/phrases").json()
    assert info["title"] == "A test oud take" and len(info["phrases"]) == 4 and info["grid"] == "beat-tracked"

    orig = client.get(f"/demo/review/{slug}/phrase/1/original.wav")
    assert orig.status_code == 200 and orig.headers["content-type"].startswith("audio/wav")
    x, sr = sf.read(io.BytesIO(orig.content), dtype="float32")
    ph = info["phrases"][1]
    assert len(x) == round((ph["end"] - ph["start"]) * SR)
    assert client.get(f"/demo/review/{slug}/phrase/1/machine.wav").status_code == 200
    assert client.get(f"/demo/review/{slug}/phrase/9/machine.wav").status_code == 404
    assert (d / ".review_cache").is_dir()

    # verdicts and notes save at once and come back on reload
    assert client.get(f"/demo/review/{slug}/Bad Name/state").status_code == 400
    r = client.post(f"/demo/review/{slug}/hodan/phrase/1", json={"verdict": "wrong_notes"})
    assert r.status_code == 200 and r.json()["saved"]["verdict"] == "wrong_notes"
    client.post(f"/demo/review/{slug}/hodan/phrase/1", json={"note": "second beat should be the fifth"})
    client.post(f"/demo/review/{slug}/hodan/phrase/2", json={"verdict": "correct"})
    assert client.post(f"/demo/review/{slug}/hodan/phrase/2", json={"verdict": "meh"}).status_code == 422
    saved = json.loads((d / "review_hodan.json").read_text())
    assert saved["phrases"]["1"]["verdict"] == "wrong_notes" and saved["phrases"]["1"]["bar_from"] == 5
    assert saved["phrases"]["1"]["note"] == "second beat should be the fifth"
    state = client.get(f"/demo/review/{slug}/hodan/state").json()
    assert state["phrases"]["2"]["verdict"] == "correct"

    # a recording lands next to the pack and is served back
    rec = client.post(f"/demo/review/{slug}/hodan/phrase/1/recording",
                      files={"file": ("version", b"\x00\x00\x00\x18ftypmp42", "audio/mp4")})
    assert rec.status_code == 200 and rec.json()["recording"].startswith("phrase_001_") and rec.json()["recording"].endswith(".m4a")
    name = rec.json()["recording"]
    assert (d / "review_hodan_recordings" / name).read_bytes().startswith(b"\x00\x00\x00\x18ftyp")
    assert client.get(f"/demo/review/{slug}/hodan/recording/{name}").status_code == 200
    assert client.get(f"/demo/review/{slug}/hodan/recording/../meta.json").status_code in (404, 422)

    # the export lists only what was marked wrong, with bars and times
    md = client.get(f"/demo/review/{slug}/hodan/export.md").text
    assert "2 phrases judged, 1 marked wrong" in md
    assert "| 2 | 5–8 | 0:07.0–0:15.0 | wrong notes | second beat should be the fifth | " + name + " |" in md
    assert "correct" not in md.split("|---")[-1] or "| correct |" not in md


def test_index_lists_reviewers(pack):
    slug, d, _ = pack
    client.post(f"/demo/review/{slug}/hodan/phrase/0", json={"verdict": "correct"})
    packs = rs.list_packs()
    assert packs[0]["slug"] == slug and packs[0]["reviews"] == ["hodan"]
    assert "reviewed by hodan" in client.get("/demo/review").text


def test_pool_folders_are_offered_and_reviewed_under_annotation(pool_item):
    slug, d, pipeline = pool_item
    items = rs.list_items()
    assert [i["slug"] for i in items] == [slug]
    assert items[0]["kind"] == "pool" and items[0]["legato"] is False and items[0]["title"] == "A pool take"
    page = client.get("/demo/review")
    assert "A pool take" in page.text and "before the legato fix" in page.text
    info = client.get(f"/demo/review/{slug}/phrases").json()
    assert info["kind"] == "pool" and info["legato"] is False and info["grid"] == "fitted" and info["phrases"]
    wav = client.get(f"/demo/review/{slug}/phrase/0/original.wav")
    assert wav.status_code == 200 and wav.headers["content-type"] == "audio/wav"
    r = client.post(f"/demo/review/{slug}/hodan/phrase/0", json={"verdict": "wrong_notes", "note": "second note"})
    assert r.status_code == 200
    saved = rs.ANNOTATION_ROOT / slug / "review_hodan.json"
    assert saved.is_file() and json.loads(saved.read_text())["phrases"]["0"]["verdict"] == "wrong_notes"
    md = client.get(f"/demo/review/{slug}/hodan/export.md").text
    assert "A pool take.musicxml" in md and "wrong notes" in md
    assert rs.list_items()[0]["reviews"] == ["hodan"]
    assert client.get("/demo/review/demo_nothing_here").status_code == 404


def test_the_legato_copy_of_a_duplicated_recording_is_the_one_offered(pool_item):
    slug, d, pipeline = pool_item
    dup = d.parent / (slug + "_2")
    p2 = dict(pipeline); p2["stems"] = {"Oud (kaban)": {"legato": True}}
    (dup / "A pool take.json").write_text(json.dumps(p2))
    items = rs.list_items()
    assert [i["slug"] for i in items] == [slug + "_2"] and items[0]["legato"] is True
