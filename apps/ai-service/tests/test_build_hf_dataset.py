"""Tests for scripts/build_hf_dataset.py on tiny fake inputs (no project data touched)."""

import json
import re
import wave
from pathlib import Path

import pytest

from scripts.build_hf_dataset import (
    GENERATED_COLUMNS,
    GLOSSARY_COLUMNS,
    SYNTH_COLUMNS,
    Builder,
    DenyListError,
    RightsError,
    check,
    deny_reason,
    main,
    mp3_duration,
    sha256_of,
)

DATE = "2026-11-07"


def fake_mp3(frames: int = 100) -> bytes:
    """One MPEG-1 Layer III frame (128 kbps, 44.1 kHz, stereo) carrying an Info header with a frame count."""
    header = bytes([0xFF, 0xFB, 0x90, 0x00])
    side_info = bytes(32)
    xing = b"Info" + (1).to_bytes(4, "big") + frames.to_bytes(4, "big")
    frame = header + side_info + xing
    return frame + bytes(417 - len(frame))


def write_wav(path: Path, seconds: float = 0.1) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(44100)
        w.writeframes(bytes(int(44100 * seconds) * 2))


def card(rights: str, base: str) -> str:
    return (f"# Model card\n\n**Rights class:** `{rights}` — test.\n\n**Artifact:** none.\n\n"
            f"## Base model\n{base}\n\n## Training data — described, not distributed\nA test corpus.\n")


def make_repo(root: Path, *, glossary: bool = True, bad_clip: str | None = None) -> Path:
    """A miniature checkout with every input the builder reads. `bad_clip` adds a gallery clip
    whose rights are wrong: "research_only" (manifest says so) or "card" (manifest says releasable,
    the card says research_only)."""
    w = root / "apps/web"
    (w / "lib/study").mkdir(parents=True)
    (w / "lib/learn").mkdir(parents=True)
    (root / "apps/ai-service/study").mkdir(parents=True)
    (root / "apps/ai-service/scripts").mkdir(parents=True)
    (root / "docs/eval").mkdir(parents=True)
    for d in ("public/demos/gallery", "public/demos/generated", "public/study", "public/scores/beerdilaacshe"):
        (w / d).mkdir(parents=True)
    for name in ("g1", "g2"):
        (w / f"public/demos/gallery/{name}.mp3").write_bytes(fake_mp3())
    (w / "public/demos/generated/g1.mp3").write_bytes(fake_mp3())
    (w / "public/study/aaaa.mp3").write_bytes(fake_mp3())
    (w / "public/study/bbbb.mp3").write_bytes(fake_mp3())

    rights = {
        "apps/web/public/demos/gallery/g1.mp3": {"kind": "model_output", "adapter": "oud", "rights": "releasable", "source": "data/oud_ab_listening/pair000_finetuned.wav"},
        "apps/web/public/demos/gallery/g2.mp3": {"kind": "model_output", "adapter": "oud", "rights": "releasable", "source": "data/oud_ab_listening/pair001_finetuned.wav"},
        "apps/web/public/demos/generated/g1.mp3": {"kind": "model_output", "adapter": "oud", "rights": "releasable", "source": "data/oud_ab_listening/pair000_finetuned.wav"},
        "apps/web/public/study/aaaa.mp3": {"kind": "model_output", "adapter": "acestep_base", "rights": "releasable", "source": "data/ab_x/pair000_base.wav"},
        "apps/web/public/study/bbbb.mp3": {"kind": "model_output", "adapter": "oud", "rights": "releasable", "source": "data/oud_ab_listening/pair000_finetuned.wav"},
    }
    clips = [
        {"id": "g1", "file": "/demos/gallery/g1.mp3", "title": "t", "adapterId": "oud", "model": "MusicGen-small (300 M)", "adapter": "oud adapter",
         "checkpoint": "step 500", "prompt": "Somali qaraami led by the oud", "seed": 1, "durationSec": 10, "vocals": False, "pcs": 0.9, "voiced": 0.5, "bandSnrDb": 20.0},
        {"id": "g2", "file": "/demos/gallery/g2.mp3", "title": "t", "adapterId": "oud", "model": "MusicGen-small (300 M)", "adapter": "oud adapter",
         "checkpoint": "step 500", "prompt": "p2", "seed": 2, "durationSec": 10, "vocals": False, "autoPick": True},
    ]
    if bad_clip:
        (w / "public/demos/gallery/h1.mp3").write_bytes(fake_mp3())
        rights["apps/web/public/demos/gallery/h1.mp3"] = {
            "kind": "model_output", "adapter": "harvard_raw", "source": "data/harvard_ab_listening/pair000_adapter.wav",
            "rights": "research_only" if bad_clip == "research_only" else "releasable",
        }
        clips.append({"id": "h1", "file": "/demos/gallery/h1.mp3", "title": "t", "adapterId": "harvard_raw", "model": "MusicGen-small", "adapter": "harvard",
                      "checkpoint": "x", "prompt": "p", "seed": 3, "durationSec": 10, "vocals": False})
    (w / "public-audio-rights.json").write_text(json.dumps({"files": rights}), encoding="utf-8")
    (w / "lib/gallery-clips.json").write_text(json.dumps({"groups": [{"title": "G", "note": "n", "sections": [{"title": "", "clips": clips}]}]}), encoding="utf-8")
    (w / "lib/published-clips.json").write_text(json.dumps({
        "generate": [{"id": "g1", "file": "/demos/generated/g1.mp3", "model": "MusicGen-small (300 M)", "adapter": "oud adapter", "adapterId": "oud",
                      "checkpoint": "step 500", "corpus": "c", "prompt": "Somali qaraami led by the oud", "seed": 1, "durationSec": 10, "pcs": 0.9, "voiced": 0.5}],
        "listen": {"clips": [{"id": "g1", "bandSnrDb": 21.0}]},
    }), encoding="utf-8")
    (w / "lib/study/stimuli.json").write_text(json.dumps({"version": 1, "salt": "s", "loudnessLufs": -16,
                                                          "comparisons": [{"id": "oud", "pairs": [{"pair": 0, "clips": ["aaaa", "bbbb"]}]}]}), encoding="utf-8")
    (root / "apps/ai-service/study/key.json").write_text(json.dumps({
        "aaaa": {"set": "oud", "pair": 0, "condition": "base", "adapter": "acestep_base", "caption": "cap", "seed": 7, "seconds": 2.6, "source": "data/ab_x/pair000_base.wav"},
        "bbbb": {"set": "oud", "pair": 0, "condition": "adapter", "adapter": "oud", "caption": "cap", "seed": 7, "seconds": 2.6, "source": "data/oud_ab_listening/pair000_finetuned.wav"},
    }), encoding="utf-8")
    (root / "apps/ai-service/scripts/synth_somali_bench.py").write_text('"""stub generator"""\n', encoding="utf-8")
    if glossary:
        (w / "lib/learn/glossary.json").write_text(json.dumps({"version": 1, "updated": DATE, "license": "CC-BY-4.0", "entries": [
            {"id": "qaraami", "term": "qaraami", "variants": ["qaraamiga"], "english": "classic love-song style", "category": "genre",
             "definition": "d", "definitionSo": "ds", "related": ["kaban"], "tags": ["love song"], "sources": ["s"], "confidence": "reported",
             "listen": {"kind": "clip", "url": "/demos/generated/g1.mp3"}},
            {"id": "kaban", "term": "kaban", "variants": [], "english": "oud", "category": "instrument", "definition": "d", "related": ["qaraami"],
             "tags": ["oud"], "sources": ["s"], "confidence": "attested"},
        ]}, ensure_ascii=False), encoding="utf-8")
    sc = w / "public/scores/beerdilaacshe"
    for n in ("Beerdilaacshe.ly", "Beerdilaacshe.midi", "Beerdilaacshe.pdf", "Beerdilaacshe.png"):
        (sc / n).write_bytes(b"x" + n.encode())
    (sc / "notes.json").write_text(json.dumps({"bpm": 96, "timeSignature": "4/4", "durationSec": 87.5, "noteCount": 2,
                                               "notes": [{"midi": 67, "start": 0, "end": 0.5}, {"midi": 69, "start": 0.5, "end": 1}]}), encoding="utf-8")
    (root / "docs/eval/MODEL_CARD_oud.md").write_text(card("releasable", "`facebook/musicgen-small` (MusicGen), unchanged."), encoding="utf-8")
    (root / "docs/eval/MODEL_CARD_acestep_base.md").write_text(
        "# Model card\n\n**Rights class:** `releasable` — ACE-Step 1.5 `xl-sft` exactly as published.\n\n**Artifact:** none.\n", encoding="utf-8")
    (root / "docs/eval/MODEL_CARD_harvard_raw.md").write_text(card("research_only", "`facebook/musicgen-small`"), encoding="utf-8")
    (root / "docs/eval/TABLES.md").write_text("## T1\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n", encoding="utf-8")

    synth = root / "data/eval_qormada/synth"
    synth.mkdir(parents=True)
    truth = {}
    for i, cond in enumerate(("clean", "bass")):
        name = f"synth_00_oud_{cond}.wav"
        write_wav(synth / name)
        truth[name] = {"scale_pcs": [0, 2, 4, 7, 9], "tonic": 0, "bpm": 100.0, "offset_cents": 5.0,
                       "notes": [{"onset": 0.0, "offset": 0.05, "midi": 69, "cents": 5.0}], "length": 0.1,
                       "register": "oud", "condition": cond, "item": 0}
    (synth / "truth.json").write_text(json.dumps(truth), encoding="utf-8")
    lis = root / "data/listening"
    lis.mkdir(parents=True)
    (lis / "ab_test_khalid_20260101-000000.json").write_text(json.dumps({
        "set": "ab_test", "title": "t", "listener": "khalid", "date": "2026-01-01T00:00:00", "seed": 1, "protocol": "paired",
        "pairs": [{"pair": 0, "caption": "c", "A": "adapter", "chosen": "A", "preferred": "adapter", "note": "",
                   "a_file": "data/ab_test/pair000_adapter.wav", "b_file": "/abs/elsewhere/pair000_base.wav"},
                  {"pair": 1, "caption": "c", "A": "base", "chosen": "none", "preferred": "none", "note": ""}],
        "summary": {"n": 2, "adapter": 1, "base": 0, "none": 1, "adapter_rate": 0.5, "wilson95": [0.1, 0.9]},
    }), encoding="utf-8")
    return root


def build(root: Path, out: Path, copy_audio: bool = True, include_symbolic: bool = False) -> dict:
    return Builder(root, root, out, copy_audio, DATE, repo_id="ns/test", include_symbolic=include_symbolic).build()


def rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_refuses_research_only_adapter(tmp_path):
    root = make_repo(tmp_path / "repo", bad_clip="research_only")
    with pytest.raises(RightsError, match="research_only"):
        build(root, tmp_path / "out")
    assert not (tmp_path / "out" / "MANIFEST.json").exists()


def test_refuses_when_card_disagrees_with_manifest(tmp_path):
    root = make_repo(tmp_path / "repo", bad_clip="card")
    with pytest.raises(RightsError, match="MODEL_CARD_harvard_raw.md says research_only"):
        build(root, tmp_path / "out")


def test_deny_list_blocks_source_paths(tmp_path):
    root = make_repo(tmp_path / "repo")
    b = Builder(root, root, tmp_path / "out", True, DATE)
    for bad in ("data/harvard_raw/legacy/x.mp3", "data/ahmed_raw/Logic/x.aif", "data/raw_incoming/oud_ilkacase/x.wav",
                "data/sets/ahmed_oud/clips/x.wav", "data/v3/clean_oud/x.wav", "data/v4/sD_pool/clip000.wav",
                "data/annotation/pack1/x.wav", "apps/web/public/audio/qaraami-laxanka.mp3", "data/scale_clips/x.wav",
                "data/clips_restored/x.wav", "data/ahmed_raw/GarageBand/song.band/Media/x.aif"):
        with pytest.raises(DenyListError):
            b.assert_readable(root / bad)
    # outside the allowed roots even without a deny word
    with pytest.raises(DenyListError, match="outside the allowed roots"):
        b.assert_readable(root / "apps/web/lib/tracks.ts")
    # copying from a denied place is refused before anything is written
    with pytest.raises(DenyListError):
        b.copy_file(root / "apps/web/public/audio/x.mp3", "generated_audio/x.mp3", "generated_audio", "evidence")
    assert not (tmp_path / "out").exists()
    # a listening *record* named after a Harvard set is votes, not audio, and passes; Harvard audio never does
    assert deny_reason("data/listening/ab_restore_harvard_khalid_20260924.json") is None
    assert deny_reason("data/harvard_ab_listening/pair000_adapter.wav")
    assert deny_reason("data/listening/harvard_clip.wav")


def test_build_writes_documented_columns_and_licences(tmp_path):
    root = make_repo(tmp_path / "repo")
    out = tmp_path / "out"
    manifest = build(root, out)
    gen = rows(out / "generated_audio/metadata.jsonl")
    assert [list(r.keys()) for r in gen] == [GENERATED_COLUMNS] * len(gen)
    assert [r["file_name"] for r in gen] == ["gallery/g1.mp3", "gallery/g2.mp3", "generate/g1.mp3", "study/aaaa.mp3", "study/bbbb.mp3"]
    by_id = {(r["subset"], r["id"]): r for r in gen}
    assert by_id[("gallery", "g1")]["license"] == "cc-by-nc-4.0"  # MusicGen weights are CC-BY-NC
    assert by_id[("study", "aaaa")]["license"] == "cc-by-4.0"  # ACE-Step base
    assert by_id[("study", "aaaa")]["comparison"] == "oud" and by_id[("study", "aaaa")]["pair"] == 0
    assert by_id[("study", "aaaa")]["loudness_lufs"] == -16 and by_id[("study", "aaaa")]["prompt"] == "cap"
    assert by_id[("study", "aaaa")]["duration_sec"] == 2.61  # 100 frames × 1152 / 44100 from the Info header
    assert by_id[("study", "bbbb")]["pcs"] == 0.9  # borrowed from its gallery twin (same provenance)
    assert by_id[("generate", "g1")]["band_snr_db"] == 21.0 and by_id[("gallery", "g2")]["auto_pick"] is True
    assert all(r["rights_class"] == "releasable" and r["model_card"].startswith("results/MODEL_CARD_") for r in gen)
    for r in gen:
        assert (out / "generated_audio" / r["file_name"]).exists()

    synth = rows(out / "synth_bench/metadata.jsonl")
    assert [list(r.keys()) for r in synth] == [SYNTH_COLUMNS] * 2
    assert synth[0]["voice"] == "oud" and synth[0]["duration_sec"] == 0.1 and synth[0]["sample_rate"] == 44100
    truth = rows(out / "synth_bench/truth.jsonl")
    assert truth[0]["notes"][0]["pitch_hz"] == pytest.approx(440 * 2 ** (5 / 1200))
    assert (out / "synth_bench/synth_somali_bench.py").exists()

    glossary = rows(out / "glossary/glossary.jsonl")
    assert [list(r.keys()) for r in glossary] == [GLOSSARY_COLUMNS] * 2
    assert glossary[0]["id"] == "kaban" and glossary[0]["listen"] is None and glossary[1]["definitionSo"] == "ds"

    assert not (out / "symbolic").exists()  # the engraving ships only with --include-symbolic

    trials = rows(out / "listening/trials.jsonl")
    assert trials[0]["a_file"] == "pair000_adapter.wav" and trials[0]["b_file"] == "pair000_base.wav"
    assert "/" not in json.dumps([t["a_file"] for t in trials] + [t["b_file"] for t in trials])
    assert [t["choice"] for t in trials] == ["adapter", "neither"]
    summary = rows(out / "listening/summary.jsonl")
    assert summary[0]["wilson95_low"] == 0.1 and summary[0]["n_pairs"] == 2

    assert sorted(p.name for p in (out / "results").iterdir()) == ["MODEL_CARD_acestep_base.md", "MODEL_CARD_oud.md", "TABLES.md"]
    assert manifest["audio_copied"] is True and manifest["subsets"]["generated_audio"]["rows"] == 5
    assert any("harvard_raw" in w for w in manifest["skipped"])


def test_manifest_sha256_matches_files(tmp_path):
    root = make_repo(tmp_path / "repo")
    out = tmp_path / "out"
    manifest = json.loads((out / "MANIFEST.json").read_text(encoding="utf-8")) if False else build(root, out)
    listed = {f["path"] for f in manifest["files"]}
    on_disk = {p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file()} - {"MANIFEST.json"}
    assert listed == on_disk
    for f in manifest["files"]:
        assert sha256_of(out / f["path"]) == f["sha256"] and (out / f["path"]).stat().st_size == f["size"]
        assert f["evidence"] and f["source"] and deny_reason(f["source"]) is None
    assert not re.search(r"harvard|ahmed|raw_incoming|/public/audio/|data/sets|data/v3|data/v4|annotation",
                         json.dumps([f["source"] for f in manifest["files"]]))


def test_check_passes_then_detects_tampering(tmp_path, capsys):
    root = make_repo(tmp_path / "repo")
    out = tmp_path / "out"
    argv = ["--repo-root", str(root), "--data-root", str(root), "--out", str(out)]
    assert main([*argv, "--copy-audio", "--date", DATE]) == 0
    assert main([*argv, "--check"]) == 0
    assert "check passed" in capsys.readouterr().out
    (out / "generated_audio/gallery/g1.mp3").write_bytes(b"tampered")
    (out / "stray.txt").write_text("x", encoding="utf-8")
    assert main([*argv, "--check"]) == 1
    err = capsys.readouterr().err
    assert "sha256 differs" in err and "stray.txt" in err


def test_check_fails_when_card_turns_research_only(tmp_path):
    root = make_repo(tmp_path / "repo")
    out = tmp_path / "out"
    build(root, out)
    (root / "docs/eval/MODEL_CARD_oud.md").write_text(card("research_only", "MusicGen"), encoding="utf-8")
    errors = check(out, root, root)
    assert errors and any("research_only" in e for e in errors)


def test_missing_glossary_is_skipped_with_warning(tmp_path):
    root = make_repo(tmp_path / "repo", glossary=False)
    out = tmp_path / "out"
    manifest = build(root, out)
    assert not (out / "glossary").exists()
    assert any("glossary" in w for w in manifest["skipped"])
    readme = (out / "README.md").read_text(encoding="utf-8")
    assert "config_name: glossary" not in readme and "not present when this build ran" in readme


def test_metadata_only_build(tmp_path):
    root = make_repo(tmp_path / "repo")
    out = tmp_path / "out"
    manifest = build(root, out, copy_audio=False)
    assert manifest["audio_copied"] is False
    assert not list(out.rglob("*.mp3")) and not list(out.rglob("*.wav"))
    assert len(rows(out / "generated_audio/metadata.jsonl")) == 5
    readme = (out / "README.md").read_text(encoding="utf-8")
    assert "without `--copy-audio`" in readme and "drop_labels" not in readme and "*.mp3" not in readme.split("\n---\n")[0]
    assert check(out, root, root) == []


def test_readme_has_yaml_configs_and_counts(tmp_path):
    root = make_repo(tmp_path / "repo")
    out = tmp_path / "out"
    build(root, out)
    readme = (out / "README.md").read_text(encoding="utf-8")
    header = readme.split("\n---\n")[0]
    assert header.startswith("---\npretty_name:")
    for cfg in ("generated_audio", "synth_bench", "synth_bench_truth", "glossary", "listening_trials", "listening_summary"):
        assert f"- config_name: {cfg}" in header
    assert "- config_name: symbolic" not in header
    assert "No score of Beerdilaacshe in this version" in readme
    assert "engraved score" not in readme and "symbolic/" not in readme
    assert '- "generated_audio/metadata.jsonl"' in header and '- "generated_audio/*/*.mp3"' in header
    assert "- cc-by-4.0\n- cc-by-nc-4.0" in header and "- 1K<n<10K" not in header and "- n<1K" in header
    assert "| model-generated clips with prompt, seed, adapter, metrics | 5 | 5 MP3 |" in readme
    assert 'load_dataset("ns/test", "generated_audio", split="train")' in readme
    assert not any(line != line.rstrip() for line in readme.splitlines())


def test_symbolic_ships_only_when_asked(tmp_path):
    root = make_repo(tmp_path / "repo")
    out = tmp_path / "out"
    manifest = build(root, out, include_symbolic=True)
    sym = rows(out / "symbolic/metadata.jsonl")
    assert sym[0]["composer"] == "Abdillahi Qarshe" and sym[0]["engraver"] == "Khalid Ibrahim" and sym[0]["note_count"] == 2
    assert all((out / "symbolic" / f).exists() for f in sym[0]["files"])
    readme = (out / "README.md").read_text(encoding="utf-8")
    assert "- config_name: symbolic" in readme.split("\n---\n")[0]
    assert "### `symbolic` — Beerdilaacshe" in readme and "No score of Beerdilaacshe" not in readme
    assert manifest["subsets"]["symbolic"]["rows"] == 1


def test_mp3_duration_from_info_header_and_frame_walk(tmp_path):
    p = tmp_path / "a.mp3"
    p.write_bytes(fake_mp3(frames=441))
    assert mp3_duration(p) == pytest.approx(441 * 1152 / 44100)
    # no Xing/Info header: the frames are walked (three CBR frames, 1152 samples each) behind an ID3v2 tag
    frame = bytes([0xFF, 0xFB, 0x90, 0x00]) + bytes(413)
    id3 = b"ID3\x04\x00\x00" + bytes([0, 0, 0, 10]) + bytes(10)
    p.write_bytes(id3 + frame * 3)
    assert mp3_duration(p) == pytest.approx(3 * 1152 / 44100)
    p.write_bytes(b"not an mp3 at all")
    assert mp3_duration(p) is None
