"""Unit tests for the Turing sets in scripts/ab_listen.py: discovery of
data/ab_turing_<tag>/pairNNN_{real,model}.wav next to the existing A/B sets, the
question read from README.txt, --list, the randomised blind session and the
result JSON (real / model / none counts, Wilson interval on "picked the model as
real"), and the unchanged A/B result shape. tmp DATA dir, stdlib wavs, no server."""

from __future__ import annotations

import json
import struct
from pathlib import Path

import pytest

from scripts import ab_listen as al


def wav(path: Path, seconds: float = 0.1, sr: int = 8000) -> Path:
    """A tiny silent PCM_16 wav, stdlib only (ab_listen never decodes audio)."""
    n = int(seconds * sr)
    data = b"\0\0" * n
    hdr = struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(data), b"WAVE", b"fmt ", 16, 1, 1, sr, sr * 2, 2, 16, b"data", len(data))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(hdr + data)
    return path


def make_turing(data: Path, tag: str = "fx", n: int = 3, readme: bool = True) -> Path:
    d = data / f"ab_turing_{tag}"
    for i in range(n):
        wav(d / f"pair{i:03d}_real.wav")
        wav(d / f"pair{i:03d}_model.wav")
    (d / "CAPTIONS.txt").write_text("".join(f"pair{i:03d}: caption {i}\n" for i in range(n)))
    if readme:
        (d / "README.txt").write_text("Turing check for run x.\nQuestion: which of the two is the real recording?\n"
                                      "pairNNN_real.wav is a held-out REAL clip: Ahmed Ilkacase's consented recordings.\n")
    return d


def make_ab(data: Path, tag: str = "foo", n: int = 2) -> Path:
    d = data / f"ab_{tag}"
    for i in range(n):
        wav(d / f"pair{i:03d}_base.wav")
        wav(d / f"pair{i:03d}_adapter.wav")
    (d / "CAPTIONS.txt").write_text("".join(f"pair{i:03d}: ab caption {i}\n" for i in range(n)))
    return d


@pytest.fixture
def data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    d = tmp_path / "data"
    d.mkdir()
    monkeypatch.setattr(al, "DATA", d)
    monkeypatch.setattr(al, "RUNS", tmp_path / "runs")
    monkeypatch.setattr(al, "LISTENING", tmp_path / "listening")
    al.SESSIONS.clear()
    return d


def test_turing_set_loader(data: Path) -> None:
    d = make_turing(data)
    s = al.turing_set(d)
    assert s is not None and s.name == "ab_turing_fx" and s.kind == "turing" and s.sides == ("real", "model")
    assert s.question == "which of the two is the real recording?" and s.success_side == "model"
    assert s.title.startswith("Turing check") and "consented" in s.note
    assert len(s.pairs) == 3 and s.testable
    assert s.pairs[0].base.file == "pair000_real.wav" and s.pairs[0].adapter.file == "pair000_model.wav"
    assert s.pairs[1].caption == "caption 1"
    assert al.turing_set(make_ab(data)) is None            # base/adapter files are not a Turing set
    empty = data / "ab_turing_empty"
    empty.mkdir()
    assert al.turing_set(empty) is None


def test_read_question_fallback(tmp_path: Path) -> None:
    assert al.read_question(tmp_path / "missing") == al.TURING_QUESTION
    p = tmp_path / "README.txt"
    p.write_text("no question here\n")
    assert al.read_question(p) == al.TURING_QUESTION
    p.write_text("x\n  Question:   is this real?  \n")
    assert al.read_question(p) == "is this real?"


def test_load_sets_discovers_turing_next_to_ab(data: Path) -> None:
    make_turing(data)
    make_ab(data)
    sets = al.load_sets()
    by_name = {s.name: s for s in sets}
    assert set(by_name) == {"ab_foo", "ab_turing_fx"}
    assert by_name["ab_foo"].kind == "ab" and by_name["ab_foo"].sides == ("base", "adapter")
    assert by_name["ab_turing_fx"].kind == "turing"
    assert al.scored_set(data / "ab_turing_fx") is None    # the generic loader does not misread real/model files
    # the side-by-side table is for A/B sets only; the Turing set renders its own section with real/model headers
    html = al.render(sets)
    assert "Turing check" in html and "<th>real</th>" in html and "<th>model</th>" in html
    assert al.render_side_by_side(sets).count("<th>") == 2 + 2  # #, caption, ab_foo base, ab_foo adapter


def test_list_flag_prints_sets_and_exits(data: Path, capsys: pytest.CaptureFixture[str]) -> None:
    make_turing(data)
    make_ab(data)
    with pytest.raises(SystemExit) as ex:
        al.main(["--list"])
    assert ex.value.code == 0
    out = capsys.readouterr().out
    assert "ab_turing_fx" in out and "turing" in out and "ab_foo" in out and "2 sets under" in out
    assert out.count("blind test available") == 2
    with pytest.raises(SystemExit) as ex2:
        al.main(["--list", "--port", "1"])                 # no server is started
    assert ex2.value.code == 0


def test_turing_session_and_result(data: Path) -> None:
    s = al.turing_set(make_turing(data))
    sid = al.new_session(s)
    order = al.SESSIONS[sid]["order"]
    assert set(order) == {0, 1, 2}
    page = al.render_test(s, sid)
    assert "real recording" in page and "which is the real recording?" in page and "qaraami to you" not in page
    # the listener calls the MODEL side real in pairs 0 and 1, the real side in pair 2
    choices = {"0": "A" if order[0] else "B", "1": "A" if order[1] else "B", "2": "B" if order[2] else "A"}
    result, path = al.save_result(s, sid, {"listener": "t", "choices": choices, "notes": {"0": "smooth"}})
    sm = result["summary"]
    assert result["kind"] == "turing" and result["sides"] == ["real", "model"]
    assert result["question"] == s.question == "which of the two is the real recording?"   # model_report reads this key
    assert sm["n"] == 3 and sm["model"] == 2 and sm["real"] == 1 and sm["none"] == 0
    assert sm["model_as_real_rate"] == pytest.approx(2 / 3, abs=1e-4)
    assert sm["wilson95"] == [round(x, 4) for x in al.wilson(2, 3)] and sm["wilson95_on"] == "picked the model as real"
    assert "adapter_rate" not in sm
    assert [p["preferred"] for p in result["pairs"]] == ["model", "model", "real"]
    assert all(p["A"] in ("real", "model") for p in result["pairs"]) and result["pairs"][0]["note"] == "smooth"
    assert path.parent == al.LISTENING and path.name.startswith("ab_turing_fx_t_") and json.loads(path.read_text())["kind"] == "turing"
    html = al.render_result(result, path)
    assert "taken for the real recording in 2 of 3 pairs" in html and "called real" in html


def test_ab_result_shape_unchanged(data: Path) -> None:
    s = al.scored_set(make_ab(data))
    sid = al.new_session(s)
    order = al.SESSIONS[sid]["order"]
    choices = {"0": "A" if order[0] else "B", "1": "none"}       # adapter in pair 0, neither in pair 1
    result, _ = al.save_result(s, sid, {"listener": "k", "choices": choices})
    sm = result["summary"]
    assert result["kind"] == "ab" and sm == {"n": 2, "adapter": 1, "base": 0, "none": 1, "adapter_rate": 0.5,
                                              "wilson95": [round(x, 4) for x in al.wilson(1, 2)]}
    assert [p["preferred"] for p in result["pairs"]] == ["adapter", "none"]
    assert result["question"] == al.AB_QUESTION
    assert "adapter preferred in 1 of 2 pairs" in al.render_result(result, al.LISTENING / "x.json")


def test_index_counts_real_recordings_apart_from_generated_clips(data: Path) -> None:
    make_turing(data, n=3)
    make_ab(data, n=2)
    sets = al.load_sets()
    assert al.clip_counts(sets) == (7, 3)                      # 3 model + 4 A/B clips generated, 3 real recordings
    html = al.render(sets)
    assert "7 generated clips" in html and "3 real consented recordings" in html and "all generated" not in html
    assert "consented contributors" in html                    # the footer no longer attributes every real clip to one person
    assert al.clip_counts([al.scored_set(data / "ab_foo")]) == (4, 0)
    assert "real consented recording" not in al.render([al.scored_set(data / "ab_foo")])


def test_scale_summary_survives_unscored_sides(data: Path, tmp_path: Path) -> None:
    """An ab_medium eval JSON whose adapter side has no scorable clip (pcs_mean null) renders with dashes
    instead of killing the index page."""
    d = make_ab(data, "medium", 2)
    ev = {"model": "facebook/musicgen-medium", "best_ckpt": "ckpt_step_0250",
          "per_song_ce": {"n_songs": 2, "base": {"mean": 4.0, "ci95": [3.9, 4.1]}, "adapter": {"mean": 3.9, "ci95": [3.8, 4.0]},
                          "improvement_base_minus_adapter": {"mean": 0.1, "ci95": [0.05, 0.15], "significant": True}},
          "ab": {"base": {"pcs_mean": 0.9, "voiced_fraction_mean": 0.6, "n_scored": 2},
                 "adapter": {"pcs_mean": None, "voiced_fraction_mean": None, "n_scored": 0},
                 "pairs": [{"pair": 0, "caption": "c", "base": {"scored": True, "pcs": 0.9, "voiced_fraction": 0.6}, "adapter": {"scored": False}}]}}
    runs = tmp_path / "runs" / "qaraami_medium_r32"
    runs.mkdir(parents=True)
    (runs / "eval_medium.json").write_text(json.dumps(ev))
    sets = al.load_sets()
    assert [s.name for s in sets] == ["ab_medium"] and sets[0].dir == d
    html = al.render(sets)
    assert "Scale runs, held-out numbers" in html and "0.900 → –" in html and "4.0000 → <b>3.9000</b>" in html
    assert "0.100 [0.050, 0.150], significant" in html


def test_blind_audio_routes_to_the_right_side(data: Path) -> None:
    s = al.turing_set(make_turing(data, n=1))
    sid = al.new_session(s)
    second_is_a = al.SESSIONS[sid]["order"][0]
    pair = s.pairs[0]
    clip_a = pair.adapter if second_is_a else pair.base
    assert clip_a.file == ("pair000_model.wav" if second_is_a else "pair000_real.wav")
