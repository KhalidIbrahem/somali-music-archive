"""Unit tests for scripts/ahmed_classify.py (song grouping, name hints, seed
rules, mixdown choice, chunking, the classifier on synthetic clusters) and
scripts/ahmed_inventory_doc.py (table rendering from a tiny fake JSONL). MERT,
Silero and CREPE are never loaded: everything runs on numpy fixtures."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from scripts import ahmed_classify as ac
from scripts import ahmed_inventory_doc as doc


def test_song_group_normalisation() -> None:
    assert ac.song_group("gayiga last beat 200 kor") == "gayiga"
    assert ac.song_group("gayiga somaaliland") == "gayiga"
    assert ac.song_group("gayiga somaaliland chip kore") == "gayiga"
    assert ac.song_group("Ciida five") == ac.song_group("Ciida two") == "cida"  # doubled vowels collapse (spelling variants)
    assert ac.song_group("wadada ayro Qaraami 21 kor 2") == ac.song_group("05 Qaraami kaban wadada") == "wadada"
    assert ac.song_group("jiijo1") == ac.song_group("JIIJO KOR LAST") == ac.song_group("cod double jiijo") == "jijo"
    assert ac.song_group("waa cudur hoos last") == "cudur"
    assert ac.song_group("caashaqu dan guud 120 kor") == ac.song_group("caashaqu dan guud lgt ton") == "cashaqu"
    assert ac.song_group("My Song 2") == 'my song 2' and ac.song_group("My Song") == 'my song'
    assert ac.song_group("03 Qaraami awliyo heele 2") == ac.song_group("03 Qaraami awliyo heele") == 'qarami awliyo hele'
    assert ac.song_group("365") == 'canamal'
    assert ac.song_group("") == 'untitled'


def test_name_hints_and_generic_names() -> None:
    h = ac.name_hints("Koshin Kaban drum.m4a", "koshin")
    assert h["oud"] and h["drums"] and not h["voice"] and not h["generic_name"]
    assert ac.name_hints("xooga dalka codd.aif")["voice"]
    assert ac.name_hints("baricod dheer.m4a")["voice"]
    assert not ac.name_hints("decoder.m4a")["voice"]
    assert not ac.name_hints("cloud.m4a")["oud"]
    gen = ac.name_hints("No Effects#03.aif", "My rap")
    assert gen["rap"] and gen["generic_name"]
    assert not ac.name_hints("No Effects#03.aif", "gayiga last beat")["drums"]  # project "beat" is not inherited
    xml = ac.name_hints("Xooga Beat power xml.m4a")
    assert xml["synth"] and xml["drums"]
    assert ac.name_hints("QARAAMI ISKU SHUBAN 2022_mixed.mp3")["mixed"]
    assert ac.name_hints("tictok_1#01.aif", "tictok")["rap"]


def _row(name: str, project: str = "p", group: str = "garageband", role: str = "stem", **feat: float) -> dict:
    return {"name": name, "project": project, "source_group": group, "role_guess": role,
            "ext": Path(name).suffix.lower(), "features": feat}


def test_seed_rules() -> None:
    assert ac.seed_label(_row("Koshin Kaban.m4a", vocal_fraction=0.0)) == ("oud", False, ["oud"])
    assert ac.seed_label(_row("song.m4a", group="ahmed_collection", vocal_fraction=0.01)) == ("oud", False, ["oud"])
    assert ac.seed_label(_row("song_mixed.mp3", group="ahmed_collection", vocal_fraction=0.01)) == (None, False, [])
    assert ac.seed_label(_row("song.m4a", group="ahmed_collection", vocal_fraction=0.2)) == (None, False, [])
    assert ac.seed_label(_row("layla cod.m4a", vocal_fraction=0.4))[0] == "voice"
    assert ac.seed_label(_row("layla cod.m4a", vocal_fraction=0.05, voiced_fraction=0.8, percussive_ratio=0.1))[0] == "voice"
    assert ac.seed_label(_row("layla cod.m4a", vocal_fraction=0.05, voiced_fraction=0.3, percussive_ratio=0.1))[0] is None
    assert ac.seed_label(_row("No Effects#02.aif", role="take", vocal_fraction=0.54, percussive_ratio=0.09))[0] == "voice"
    assert ac.seed_label(_row("No Effects#02.aif", role="take", vocal_fraction=0.37, percussive_ratio=0.09))[0] is None
    assert ac.seed_label(_row("Output.aif", role="mixdown", vocal_fraction=0.7, percussive_ratio=0.1))[0] == "full_mix"
    assert ac.seed_label(_row("03 drum.m4a"))[0] == "drums"
    assert ac.seed_label(_row("No Effects#04.aif", percussive_ratio=0.7, voiced_fraction=0.05))[0] == "drums"
    assert ac.seed_label(_row("No Effects#04.aif", percussive_ratio=0.7, voiced_fraction=0.5))[0] is None
    assert ac.seed_label(_row("jiijo string.aif"))[0] == "synth"
    assert ac.seed_label(_row("Output.aif", role="mixdown"))[0] == "full_mix"
    assert ac.seed_label(_row("No Effects#01.aif", project="tictok", role="take")) == ("rap", False, ["rap"])
    assert ac.seed_label(_row("Output.aif", project="My rap", role="mixdown"))[0] == "rap"  # rap wins over full_mix
    label, conflict, cands = ac.seed_label(_row("Xooga Beat power xml.m4a"))
    assert label is None and conflict and cands == ["drums", "synth"]
    label, conflict, cands = ac.seed_label(_row("xajin cod 4.aif", role="mixdown", vocal_fraction=0.5))
    assert label is None and conflict and cands == ["voice", "full_mix"]


def test_choose_mixdown_and_project_summary() -> None:
    def r(path: str, role: str, dur: float, excluded: bool = False, content: str | None = "voice") -> dict:
        return {"path": path, "source_group": "garageband", "project": "gayiga last beat", "project_kind": "band",
                "role_guess": role, "duration_s": dur, "excluded": excluded, "content": content}

    rows = [r("a/Media/take.aif", "take", 100), r("a/Media/last.m4a", "mixdown", 200, content="full_mix"),
            r("a/Output/Output.aif", "mixdown", 300, content="full_mix"),
            r("a/Media/dup.aif", "mixdown", 999, excluded=True, content=None)]
    assert ac.choose_mixdown(rows)["path"] == "a/Output/Output.aif"  # type: ignore[index]
    assert ac.choose_mixdown(rows[:1]) is None
    p = ac.project_summary(rows)["garageband/gayiga last beat"]
    assert p["song_group"] == "gayiga" and p["mixdown"] == "a/Output/Output.aif"
    assert p["stems"] == ["a/Media/take.aif", "a/Media/last.m4a"]
    assert p["files"] == 4 and p["kept"] == 3 and p["content"] == {"full_mix": 2, "voice": 1}
    assert p["hours_unique"] == round(600 / 3600, 3)


def test_chunk_starts() -> None:
    assert ac.chunk_starts(20.0, 4) == [0.0]
    assert ac.chunk_starts(30.0, 4) == [0.0]
    assert ac.chunk_starts(50.0, 4) == [10.0]
    assert ac.chunk_starts(90.0, 4) == [0.0, 30.0, 60.0]
    assert ac.chunk_starts(300.0, 4) == [0.0, 90.0, 180.0, 270.0]
    assert ac.chunk_starts(300.0, 1) == [0.0]


def test_aggregate_scalars() -> None:
    agg = ac.aggregate_scalars([
        {"vocal_fraction": 0.2, "pcs": None, "detected_tonic": "A", "percussive_ratio": 0.4},
        {"vocal_fraction": 0.4, "pcs": 0.9, "detected_tonic": "A", "percussive_ratio": None},
    ])
    assert agg["vocal_fraction"] == 0.3 and agg["pcs"] == 0.9 and agg["percussive_ratio"] == 0.4
    assert agg["detected_tonic"] == "A" and agg["chunks_analyzed"] == 2 and agg["voiced_fraction"] is None


def test_train_and_predict_on_synthetic_clusters() -> None:
    rng = np.random.default_rng(0)
    labels = ["oud", "voice", "drums"]
    embs, feats, seeds = [], [], []
    for i in range(30):
        label = labels[i % 3]
        e = rng.normal(0, 0.05, 768)
        e[labels.index(label)] += 1.0
        embs.append(e.astype(np.float32))
        feats.append({"vocal_fraction": 0.3 if label == "voice" else 0.0, "percussive_ratio": 0.8 if label == "drums" else 0.2,
                      "onset_strength_mean": 1.0, "voiced_fraction": 0.5, "pcs": None if i % 5 == 0 else 0.9,
                      "spectral_flatness_mean": 0.01})
        seeds.append(label if i < 24 else None)
    X = ac.feature_matrix(embs, feats)
    assert X.shape == (30, 768 + len(ac.SCALAR_KEYS) + 1)
    content, prob, report = ac.train_and_predict(X, seeds)
    assert report["seed_counts"] == {"drums": 8, "oud": 8, "voice": 8} and report["n_seeds"] == 24
    assert report["cv"]["n_splits"] == 5 and report["cv"]["accuracy"] == 1.0
    assert report["cv"]["confusion"]["labels"] == ["drums", "oud", "voice"]
    assert content[24:] == ["oud", "voice", "drums", "oud", "voice", "drums"]
    assert all(p >= ac.PROB_MIN for p in prob)


def test_train_and_predict_with_one_class_passes_seeds_through() -> None:
    content, prob, report = ac.train_and_predict(np.zeros((3, 5)), ["oud", None, "oud"])
    assert content == ["oud", "other", "oud"] and prob == [1.0, 0.0, 1.0] and report["cv"] is None


# ── ahmed_inventory_doc rendering ─────────────────────────────────────────────


def _inv(path: str, group: str, project: str, kind: str, dur: float, role: str = "stem", excluded: bool = False,
         reason: str | None = None, dup_of_path: str | None = None, content: str | None = None,
         prob: float | None = None, unclassified: bool = False, seed: str | None = None,
         conflict: bool = False, cands: list[str] | None = None) -> dict:
    return {"path": path, "source_group": group, "project": project, "project_kind": kind, "name": Path(path).name,
            "location": "Media", "duration_s": dur, "role_guess": role, "excluded": excluded, "exclude_reason": reason,
            "dup_of_path": dup_of_path, "content": content, "content_prob": prob, "unclassified": unclassified,
            "seed_label": seed, "seed_conflict": conflict, "seed_candidates": cands or []}


def _fixture_rows() -> list[dict]:
    return [
        _inv("d/GarageBand/gayiga last beat.band/Media/No Effects#01.aif", "garageband", "gayiga last beat", "band", 3600,
             role="take", content="voice", prob=0.9, seed="voice", cands=["voice"]),
        _inv("d/GarageBand/gayiga last beat.band/Output/Output.aif", "garageband", "gayiga last beat", "band", 1800,
             role="mixdown", content="full_mix", prob=0.95, seed="full_mix", cands=["full_mix"]),
        _inv("d/GarageBand/gayiga last beat.band/Media/Shaker 01.caf", "garageband", "gayiga last beat", "band", 5,
             excluded=True, reason="apple_loop"),
        _inv("d/Logic/kun/Audio Files/kun_1#01.aif", "logic", "kun", "logic", 900, role="take", content="oud", prob=0.5,
             unclassified=True),
        _inv("d/Logic/xooga dalka/Audio Files/Xooga Beat power xml.m4a", "logic", "xooga dalka", "logic", 360,
             content="synth", prob=0.8, unclassified=True, conflict=True, cands=["drums", "synth"]),
        _inv("d/oud/wadada 2.m4a", "ahmed_collection", "wadada 2", "loose", 720, role="song", content="oud", prob=0.99,
             seed="oud", cands=["oud"]),
        _inv("d/oud/wadada 3.m4a", "ahmed_collection", "wadada 3", "loose", 720, role="song", excluded=True,
             reason="duplicate", dup_of_path="d/oud/wadada 2.m4a"),
    ]


def _report() -> dict:
    return {"model": "LogisticRegression(C=1, class_weight=balanced)", "features": "MERT + scalars", "n_seeds": 3,
            "n_rows": 5, "seed_counts": {"full_mix": 1, "oud": 1, "voice": 1},
            "cv": {"n_splits": 2, "accuracy": 0.75, "balanced_accuracy": 0.7,
                   "per_class": {"oud": {"f1-score": 0.8, "support": 1}, "accuracy": 0.75}},
            "chunks": 4, "rows_processed": 5, "rows_usable": 5, "unclassified": 2, "seed_conflicts": 1,
            "device": "cpu", "elapsed_s": 1.0}


def test_doc_render_from_tiny_jsonl(tmp_path: Path) -> None:
    cls = tmp_path / "ahmed_classified.jsonl"
    cls.write_text("".join(json.dumps(r) + "\n" for r in _fixture_rows()))
    rows, available, _groups = doc.load_rows(cls, tmp_path / "missing.jsonl")
    assert available and rows[0]["song_group"] == "gayiga"
    text = doc.render(rows, _report(), True, "2026-09-25", {"rows": "x.jsonl", "report": "r.json"})
    assert "# Ahmed Ilkacase corpus inventory (Stage 1, 2026-09-25)" in text
    assert "| unique songs (song groups) | 4 |" in text  # gayiga, kun, xooga, wadada
    assert "| unique hours (non-excluded, unique by sha256) | 2.05 | 5 files |" in text
    assert "| isolated oud | 0.20 | 1 files |" in text  # kun is unclassified, not oud
    assert "| isolated vocals | 1.00 | 1 files |" in text
    assert "| full mix | 0.50 | 1 files |" in text
    assert "| drums | 0.00 | 0 files |" in text
    assert "| synth / beats / rap (non-qaraami, to exclude) | 0.00 | 0 files |" in text  # xooga is unclassified
    assert "| unclassified | 0.35 | 2 files |" in text
    assert "7 files inventoried, 5 kept, 2 excluded." in text
    assert "| garageband | 3 | 1.50 | 2 | 1.50 | 1 | 1 | 1 |" in text
    assert "| gayiga last beat | gayiga | band | 3 | 1.50 | Output.aif | 1 | 0 | full_mix 1, voice 1 |" in text
    assert "| wadada 2 | wadada | loose | 1 | 0.20 |  | 1 | 0 | oud 1 |" in text
    assert "apple_loop: 1, duplicate: 1" in text
    assert "| d/oud/wadada 3.m4a | duplicate | 0.20 | d/oud/wadada 2.m4a |" in text
    assert "| d/Logic/kun/Audio Files/kun_1#01.aif | oud | 0.50 |  | content_prob < 0.6 |" in text
    assert "seed conflict: drums/synth" in text
    assert "accuracy 0.750, balanced accuracy 0.700; per class: oud F1 0.80 (n=1)." in text
    assert "OUD_VAD_MAX = 0.06" in text and "`rap`: name (or the project" in text


def test_doc_falls_back_to_raw_inventory(tmp_path: Path) -> None:
    raw = tmp_path / "ahmed_files.jsonl"
    stripped = []
    for r in _fixture_rows():
        r = {k: v for k, v in r.items() if k not in ("content", "content_prob", "unclassified", "seed_label", "seed_conflict", "seed_candidates")}
        stripped.append(r)
    raw.write_text("".join(json.dumps(r) + "\n" for r in stripped))
    rows, available, _groups = doc.load_rows(tmp_path / "nope.jsonl", raw)
    assert not available
    text = doc.render(rows, None, False, "2026-09-25", {"rows": "f.jsonl", "report": "r.json"})
    assert "| unclassified | 2.05 | 5 files |" in text and "| isolated oud | 0.00 | 0 files |" in text
    assert "Classification: **not run**" in text
    assert "| d/oud/wadada 2.m4a |  |  |  | no classification |" in text


def test_load_reference_seeds_reads_cached_embeddings(tmp_path) -> None:
    import numpy as np

    emb = tmp_path / "emb"
    emb.mkdir()
    np.save(emb / "a.npy", np.ones(ac.EMB_DIM, dtype=np.float32))
    np.save(emb / "bad.npy", np.ones(7, dtype=np.float32))
    rows = [
        {"seed_label": "oud", "embedding_path": "emb/a.npy", "features": {"pcs": 0.9}},
        {"seed_label": "voice", "embedding_path": "emb/bad.npy", "features": {}},       # wrong shape
        {"seed_label": None, "embedding_path": "emb/a.npy", "features": {}},            # no seed
        {"seed_label": "drums", "embedding_path": "emb/a.npy", "features": {}, "seed_conflict": True},
        {"seed_label": "drums", "embedding_path": "emb/missing.npy", "features": {}},
    ]
    cls = tmp_path / "c.jsonl"
    cls.write_text("".join(json.dumps(r) + "\n" for r in rows))
    embs, feats, labels = ac.load_reference_seeds(cls, root=tmp_path)
    assert labels == ["oud"] and len(embs) == 1 and feats == [{"pcs": 0.9}]
