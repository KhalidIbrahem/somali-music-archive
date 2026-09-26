"""Unit tests for scripts/intake.py: CONTRIBUTOR.md parsing (BOM, aliases,
uses-vs-tier), slugging and slug collisions, the inventory pass over a fake
data/incoming tree (a valid contributor, one with a malformed record, one
without a record), rights stamping, the lifted apple_loop rule (.caf),
cross-corpus sha256 dedupe, idempotency ("no new contributors"), --dry-run and
--limit as a non-final "partial" pass.

No corpus, GPU, network or ffmpeg: audio is synthesised with numpy+soundfile
and ahmed_extract's ffprobe/ffmpeg seams are monkeypatched to soundfile.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from scripts import ahmed_extract as ax
from scripts import intake

SR = 16000

VALID_RECORD = """# Contributor record

name: Faadumo Qaasim
date: 2026-09-20
gave: 3 home recordings of qaraami songs, oud and voice
uses: analyse, train, evaluate, publish_adapters, publish_outputs
tier: consented_publishable
signed_by: Faadumo Qaasim (paper original held by Khalid Ibrahim)
"""

INVALID_RECORD = """name: Someone Else
date: 20-09-2026
signed_by: Someone Else
"""


def _tone(seconds: float, freq: float, sr: int = SR) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    return (0.4 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _write(path: Path, audio: np.ndarray, sr: int = SR) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, audio, sr, subtype="PCM_16")
    return path


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


@pytest.fixture(autouse=True)
def fake_ffmpeg(monkeypatch: pytest.MonkeyPatch) -> None:
    """ahmed_extract.measure goes through soundfile instead of ffprobe/ffmpeg."""

    def meta(path: Path) -> dict:
        try:
            info = sf.info(str(path))
        except RuntimeError:
            return {}
        return {"duration_s": round(info.duration, 3), "sample_rate": info.samplerate, "channels": info.channels,
                "codec": "pcm_s16le"}

    def decode(path: Path) -> np.ndarray:
        try:
            audio, _ = sf.read(str(path), dtype="float32")
        except RuntimeError:
            return np.zeros(0, dtype=np.float32)
        return audio if audio.ndim == 1 else audio.mean(axis=1)

    monkeypatch.setattr(ax, "ffprobe_meta", meta)
    monkeypatch.setattr(ax, "decode_mono16", decode)


@pytest.fixture
def tree(tmp_path: Path) -> dict:
    """data/incoming with three folders plus the corpus files the dedupe reads."""
    root = tmp_path / "incoming"
    valid = root / "Faadumo Qaasim"
    (valid / "CONTRIBUTOR.md").parent.mkdir(parents=True)
    (valid / "CONTRIBUTOR.md").write_text(VALID_RECORD, encoding="utf-8")
    a = _write(valid / "song_a.wav", _tone(4.0, 220.0))
    b = _write(valid / "session 2" / "song_b.wav", _tone(5.0, 330.0))
    a_copy = _write(valid / "song_a copy.wav", _tone(4.0, 220.0))          # in-folder duplicate of a
    c = _write(valid / "song_c.wav", _tone(4.0, 440.0))                     # already in Ahmed's inventory
    (valid / "notes.txt").write_text("not audio")
    (valid / "._song_a.wav").write_bytes(b"\0")
    bad = root / "bad_record"
    bad.mkdir()
    (bad / "CONTRIBUTOR.md").write_text(INVALID_RECORD, encoding="utf-8")
    _write(bad / "x.wav", _tone(3.5, 200.0))
    norec = root / "no_record"
    norec.mkdir()
    _write(norec / "y.wav", _tone(3.5, 250.0))
    inv_dir = tmp_path / "inventory"
    inv_dir.mkdir()
    ahmed = inv_dir / "ahmed_files.jsonl"
    ahmed.write_text(json.dumps({"path": "data/ahmed_raw/x/song_c.aif", "sha256": _sha(c)}) + "\n")
    harvard = tmp_path / "harvard_manifest.jsonl"
    harvard.write_text(json.dumps({"cid": "mus1", "sha256": "0" * 64}) + "\n")
    internet = tmp_path / "internet_manifest.jsonl"
    internet.write_text(json.dumps({"source": "ia", "item_id": "it", "files": [{"name": "f.mp3", "sha256": "1" * 64}]}) + "\n")
    return {"root": root, "valid": valid, "inv_dir": inv_dir, "ahmed": ahmed, "harvard": harvard, "internet": internet,
            "files": {"a": a, "b": b, "a_copy": a_copy, "c": c}}


def _run(tree: dict, **kw: object) -> dict:
    return intake.run(tree["root"], tree["inv_dir"], tree["ahmed"], tree["harvard"], tree["internet"], **kw)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# record parsing
# ---------------------------------------------------------------------------


def test_parse_record_valid() -> None:
    rec = intake.parse_record(VALID_RECORD, "faadumo_qaasim", "data/incoming/Faadumo Qaasim", "x/CONTRIBUTOR.md")
    assert rec.errors == []
    assert (rec.name, rec.date, rec.tier, rec.signed_by[:14]) == ("Faadumo Qaasim", "2026-09-20", "consented_publishable", "Faadumo Qaasim")
    assert rec.uses == ["analyse", "train", "evaluate", "publish_adapters", "publish_outputs"]
    assert rec.rights == "contrib_faadumo_qaasim_consented"
    assert rec.source_group == "contrib_faadumo_qaasim"


def test_parse_record_accepts_markdown_bullets_bold_keys_and_aliases() -> None:
    text = "- **Credited as**: Cali Dhuux\n* **Date**: 2026-01-05\n- Tier: research_only\n- Signed: Cali Dhuux\n"
    rec = intake.parse_record(text, "cali", "f", "r")
    assert rec.errors == []
    assert rec.name == "Cali Dhuux" and rec.tier == "research_only" and rec.signed_by == "Cali Dhuux"
    assert rec.rights == "contrib_cali_research_only"


def test_parse_record_tolerates_bom_and_crlf() -> None:
    text = "\ufeffname: Xaliimo\r\ndate: 2026-01-01\r\ntier: research_only\r\nsigned_by: X\r\n"
    rec = intake.parse_record(text, "x", "f", "r")
    assert rec.errors == [] and rec.name == "Xaliimo" and rec.rights == "contrib_x_research_only"


def test_parse_record_canonical_key_beats_alias() -> None:
    text = "Contributor: Khalid (collector)\nname: Cabdi Sinimo\ndate: 2026-01-01\ntier: research_only\nsigned_by: Cabdi\n"
    rec = intake.parse_record(text, "x", "f", "r")
    assert rec.errors == [] and rec.name == "Cabdi Sinimo"
    # the alias still works when the canonical key is absent, and the first canonical occurrence wins
    rec2 = intake.parse_record("Contributor: Cabdi\ndate: 2026-01-01\ntier: research_only\nsigned_by: Cabdi\nname: later\n", "x", "f", "r")
    assert rec2.name == "later"
    rec3 = intake.parse_record("Contributor: Cabdi\ndate: 2026-01-01\ntier: research_only\nsigned_by: Cabdi\n", "x", "f", "r")
    assert rec3.name == "Cabdi"


def test_parse_record_tier_must_be_covered_by_uses() -> None:
    head = "name: A\ndate: 2026-01-01\nsigned_by: A\n"
    rec = intake.parse_record(head + "tier: consented_publishable\nuses: analyse\n", "a", "f", "r")
    assert len(rec.errors) == 1 and "tier consented_publishable needs uses" in rec.errors[0]
    assert "'train'" in rec.errors[0] and "'publish_adapters'" in rec.errors[0] and "'publish_outputs'" in rec.errors[0]
    rec = intake.parse_record(head + "tier: consented_publishable\nuses: train, publish_adapters\n", "a", "f", "r")
    assert rec.errors and "missing ['publish_outputs']" in rec.errors[0]
    rec = intake.parse_record(head + "tier: research_only\nuses: analyse, evaluate\n", "a", "f", "r")
    assert rec.errors and "tier research_only needs uses ['train']" in rec.errors[0]
    assert intake.parse_record(head + "tier: research_only\nuses: train\n", "a", "f", "r").errors == []
    assert intake.parse_record(head + "tier: consented_publishable\nuses: train, publish_adapters, publish_outputs\n", "a", "f", "r").errors == []
    # no uses line: the tier stands on its own (the signed document is the authority)
    assert intake.parse_record(head + "tier: consented_publishable\n", "a", "f", "r").errors == []


def test_parse_record_reports_every_defect() -> None:
    rec = intake.parse_record(INVALID_RECORD, "bad", "f", "r")
    assert any("missing 'tier:'" in e for e in rec.errors)
    assert any("date must be YYYY-MM-DD" in e for e in rec.errors)
    assert rec.rights == ""
    rec2 = intake.parse_record("name: A\ndate: 2026-02-30\ntier: full_rights\nsigned_by: A\nuses: train, resell\n", "b", "f", "r")
    assert any("tier must be one of" in e for e in rec2.errors)
    assert any("date must be" in e for e in rec2.errors)
    assert any("unknown uses ['resell']" in e for e in rec2.errors)
    rec3 = intake.parse_record("", "e", "f", "r")
    assert len(rec3.errors) == 4


def test_slugify() -> None:
    assert intake.slugify("Faadumo Qaasim") == "faadumo_qaasim"
    assert intake.slugify("  Ahmed-Ilkacase (family) ") == "ahmed_ilkacase_family"
    assert intake.slugify("***") == "contributor"
    assert len(intake.slugify("x" * 80)) == 40


# ---------------------------------------------------------------------------
# the intake pass
# ---------------------------------------------------------------------------


def test_run_inventories_valid_folder_and_skips_invalid_ones(tree: dict, capsys: pytest.CaptureFixture[str]) -> None:
    summary = _run(tree)
    assert (summary["changed"], summary["skipped"], summary["unchanged"]) == (1, 2, 0)
    by_slug = {c["slug"]: c for c in summary["contributors"]}
    assert by_slug["faadumo_qaasim"]["status"] == "ok"
    assert by_slug["bad_record"]["status"] == "skipped" and "missing 'tier:'" in by_slug["bad_record"]["reason"]
    assert by_slug["no_record"]["status"] == "skipped" and "no CONTRIBUTOR.md" in by_slug["no_record"]["reason"]
    out = tree["inv_dir"] / "contrib_faadumo_qaasim_files.jsonl"
    rows = _rows(out)
    assert len(rows) == 4                                        # notes.txt and ._song_a.wav are not audio
    assert {r["source_group"] for r in rows} == {"contrib_faadumo_qaasim"}
    assert {r["rights"] for r in rows} == {"contrib_faadumo_qaasim_consented"}
    assert {r["role_guess"] for r in rows} == {"song"}
    assert all(r["contributor"] == "Faadumo Qaasim" and r["consent_date"] == "2026-09-20"
               and r["consent_tier"] == "consented_publishable" and r["uses_granted"][:2] == ["analyse", "train"]
               and r["consent_record"].endswith("CONTRIBUTOR.md") for r in rows)
    by_name = {r["name"]: r for r in rows}
    assert by_name["song_a.wav"]["excluded"] is False and by_name["song_a.wav"]["duration_s"] == 4.0
    assert by_name["song_a copy.wav"]["excluded"] and by_name["song_a copy.wav"]["exclude_reason"] == "duplicate"
    assert by_name["song_a copy.wav"]["dup_of"] == by_name["song_a.wav"]["sha256"]
    assert by_name["song_c.wav"]["excluded"] and by_name["song_c.wav"]["exclude_reason"] == "duplicate_of_corpus"
    assert by_name["song_c.wav"]["dup_of_corpus"] == "ahmed:data/ahmed_raw/x/song_c.aif"
    assert by_name["song_b.wav"]["project"] == "session 2" and by_name["song_b.wav"]["excluded"] is False
    # the ahmed_files schema is intact for downstream consumers
    for key in ("path", "sha256", "duration_s", "sample_rate", "channels", "codec", "silence_fraction", "is_silent",
                "position", "also_in", "dup_of", "dup_of_path", "excluded", "exclude_reason", "mtime_iso", "bytes", "ext"):
        assert key in rows[0]
    assert by_slug["faadumo_qaasim"]["kept"] == 2 and by_slug["faadumo_qaasim"]["hours_kept"] == round(9.0 / 3600, 3)
    log = _rows(tree["inv_dir"] / "intake_log.jsonl")
    # folders are visited in sorted() order: "Faadumo Qaasim" (capital F) before the lower-case names
    assert [(r["slug"], r["status"]) for r in log] == [("faadumo_qaasim", "ok"), ("bad_record", "skipped"), ("no_record", "skipped")]
    assert log[0]["rights"] == "contrib_faadumo_qaasim_consented" and log[0]["record"]["name"] == "Faadumo Qaasim"
    printed = capsys.readouterr().out
    assert "skip" in printed and "wrote" in printed and "no new contributors" not in printed


def test_run_is_idempotent_and_reacts_to_changes(tree: dict, capsys: pytest.CaptureFixture[str]) -> None:
    _run(tree)
    capsys.readouterr()
    again = _run(tree)
    assert (again["changed"], again["skipped"], again["unchanged"]) == (0, 0, 3)
    assert "no new contributors" in capsys.readouterr().out
    assert len(_rows(tree["inv_dir"] / "intake_log.jsonl")) == 3          # nothing appended
    # a new file in the valid folder changes its fingerprint -> re-inventoried, measurements of old files reused
    _write(tree["valid"] / "song_d.wav", _tone(6.0, 550.0))
    third = _run(tree)
    assert (third["changed"], third["unchanged"]) == (1, 2)
    rows = _rows(tree["inv_dir"] / "contrib_faadumo_qaasim_files.jsonl")
    assert len(rows) == 5 and sum(1 for r in rows if not r["excluded"]) == 3
    assert len(_rows(tree["inv_dir"] / "intake_log.jsonl")) == 4
    # fixing the bad record makes that folder land too
    (tree["root"] / "bad_record" / "CONTRIBUTOR.md").write_text(
        "name: Someone Else\ndate: 2026-09-21\ntier: research_only\nsigned_by: Someone Else\n", encoding="utf-8")
    fourth = _run(tree)
    assert fourth["changed"] == 1
    rows = _rows(tree["inv_dir"] / "contrib_bad_record_files.jsonl")
    assert rows[0]["rights"] == "contrib_bad_record_research_only" and rows[0]["source_group"] == "contrib_bad_record"


def test_dry_run_writes_nothing(tree: dict) -> None:
    summary = _run(tree, dry_run=True)
    assert summary["changed"] == 1 and summary["dry_run"] is True
    assert not (tree["inv_dir"] / "contrib_faadumo_qaasim_files.jsonl").exists()
    assert not (tree["inv_dir"] / "intake_log.jsonl").exists()
    # and a real run afterwards still sees everything as new
    assert _run(tree)["changed"] == 1


def test_limit_measures_a_subset_and_never_poisons_the_resume(tree: dict, capsys: pytest.CaptureFixture[str]) -> None:
    summary = _run(tree, limit=2)
    me = next(c for c in summary["contributors"] if c["slug"] == "faadumo_qaasim")
    assert me["files"] == 2 and me["limit"] == 2 and me["status"] == "partial"
    assert len(_rows(tree["inv_dir"] / "contrib_faadumo_qaasim_files.jsonl")) == 2
    assert "partial: first 2 of 4 files, not final" in capsys.readouterr().out
    log = _rows(tree["inv_dir"] / "intake_log.jsonl")
    assert [r["status"] for r in log if r["slug"] == "faadumo_qaasim"] == ["partial"]
    # the same smoke again is unchanged; a full run is not, and inventories the whole folder
    again = _run(tree, limit=2)
    assert next(c for c in again["contributors"] if c["slug"] == "faadumo_qaasim")["status"] == "unchanged"
    full = _run(tree)
    me = next(c for c in full["contributors"] if c["slug"] == "faadumo_qaasim")
    assert full["changed"] == 1 and me["status"] == "ok" and me["files"] == 4
    assert len(_rows(tree["inv_dir"] / "contrib_faadumo_qaasim_files.jsonl")) == 4
    # ...after which both a full run and a smoke run leave it alone
    assert _run(tree)["unchanged"] == 3
    assert next(c for c in _run(tree, limit=2)["contributors"] if c["slug"] == "faadumo_qaasim")["status"] == "unchanged"


def test_slug_collision_skips_the_second_folder_and_stays_idempotent(tree: dict, capsys: pytest.CaptureFixture[str]) -> None:
    twin = tree["root"] / "faadumo-qaasim"                       # slugifies to faadumo_qaasim as well
    twin.mkdir()
    (twin / "CONTRIBUTOR.md").write_text(VALID_RECORD, encoding="utf-8")
    _write(twin / "other_song.wav", _tone(4.0, 660.0))
    first = _run(tree)
    by_folder = {c["folder"]: c for c in first["contributors"]}
    twin_entry = by_folder[ax.rel(twin)]
    assert twin_entry["status"] == "skipped" and "slug 'faadumo_qaasim' already used by" in twin_entry["reason"]
    assert by_folder[ax.rel(tree["valid"])]["status"] == "ok"
    rows = _rows(tree["inv_dir"] / "contrib_faadumo_qaasim_files.jsonl")
    assert len(rows) == 4 and all(r["path"].startswith(ax.rel(tree["valid"])) for r in rows)
    capsys.readouterr()
    second = _run(tree)
    assert (second["changed"], second["skipped"], second["unchanged"]) == (0, 0, 4)
    assert "no new contributors" in capsys.readouterr().out
    assert len(_rows(tree["inv_dir"] / "intake_log.jsonl")) == 4
    # the owner stays the inventoried folder even when a colliding folder sorts first ("(" < "F"; same slug)
    early = tree["root"] / "(Faadumo Qaasim)"
    early.mkdir()
    (early / "CONTRIBUTOR.md").write_text(VALID_RECORD, encoding="utf-8")
    _write(early / "z.wav", _tone(4.0, 770.0))
    third = _run(tree)
    by_folder = {c["folder"]: c for c in third["contributors"]}
    assert by_folder[ax.rel(early)]["status"] == "skipped" and by_folder[ax.rel(tree["valid"])]["status"] == "unchanged"
    assert len(_rows(tree["inv_dir"] / "contrib_faadumo_qaasim_files.jsonl")) == 4


def test_caf_files_are_not_apple_loops_for_contributors(tree: dict) -> None:
    caf = tree["valid"] / "Voice Memo.caf"
    sf.write(caf, _tone(4.0, 880.0), SR, format="CAF", subtype="PCM_16")
    caf_dup = tree["valid"] / "Voice Memo copy.caf"
    caf_dup.write_bytes(caf.read_bytes())
    _run(tree)
    by_name = {r["name"]: r for r in _rows(tree["inv_dir"] / "contrib_faadumo_qaasim_files.jsonl")}
    assert by_name["Voice Memo.caf"]["excluded"] is False and by_name["Voice Memo.caf"]["exclude_reason"] is None
    assert by_name["Voice Memo copy.caf"]["excluded"] and by_name["Voice Memo copy.caf"]["exclude_reason"] == "duplicate"
    assert "apple_loop" not in {r["exclude_reason"] for r in by_name.values()}


def test_empty_or_missing_root(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    summary = intake.run(tmp_path / "nowhere", tmp_path / "inv", tmp_path / "a.jsonl", tmp_path / "h.jsonl", tmp_path / "i.jsonl")
    assert summary["contributors"] == [] and summary["changed"] == 0
    out = capsys.readouterr().out
    assert "no contributor folders" in out and "no new contributors" in out


def test_known_sha256s_reads_every_corpus_and_other_contributors(tree: dict) -> None:
    (tree["inv_dir"] / "contrib_other_files.jsonl").write_text(
        json.dumps({"path": "data/incoming/other/z.wav", "source_group": "contrib_other", "sha256": "2" * 64}) + "\n")
    known = intake.load_known_sha256s(tree["ahmed"], tree["harvard"], tree["internet"], tree["inv_dir"], skip_slug="faadumo_qaasim")
    assert known["0" * 64] == "harvard:mus1"
    assert known["1" * 64] == "internet:ia/it/f.mp3"
    assert known["2" * 64] == "contrib_other:data/incoming/other/z.wav"
    assert known[_sha(tree["files"]["c"])].startswith("ahmed:")
    assert intake.load_known_sha256s(tree["ahmed"], tree["harvard"], tree["internet"], tree["inv_dir"], skip_slug="other").get("2" * 64) is None
