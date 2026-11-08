"""Synthetic token corpus: fixed clip shape, exact reproducibility, leakage-free splits, Parquet output."""
from __future__ import annotations

import json

import numpy as np
import pytest

from scripts import assemble_token_corpus as ac
from scripts import synth_somali_bench as synth
from scripts import synth_token_corpus as tc


def test_fit_clip_pads_tail_and_normalises_peak():
    y = tc.fit_clip(np.array([0.0, 2.0, -4.0]))
    assert y.shape == (tc.CLIP_SAMPLES,) and y.dtype == np.float32
    assert y[:3] == pytest.approx([0.0, 0.15, -0.3]) and not y[3:].any()


def test_fit_clip_rejects_overlong_audio():
    with pytest.raises(ValueError):
        tc.fit_clip(np.ones(tc.CLIP_SAMPLES + 1))


def test_clip_length_covers_the_longest_possible_melody():
    assert tc.CLIP_SECONDS > 14.0 + 2 * 60 / 70 + 1.0


def test_render_item_depends_only_on_seed_and_index():
    meta_a, clips_a = tc.render_item(3, seed=11)
    meta_b, clips_b = tc.render_item(3, seed=11)
    assert meta_a == meta_b and np.array_equal(clips_a, clips_b)
    assert clips_a.shape == (len(synth.CONDITIONS), tc.CLIP_SAMPLES)
    assert not np.array_equal(clips_a, tc.render_item(4, seed=11)[1])


def test_conditions_and_shape_agree_between_scripts():
    assert tuple(synth.CONDITIONS) == ac.CONDITIONS
    assert (ac.CODEBOOKS, ac.FRAMES, ac.CLIP_SECONDS, ac.SEED) == (tc.CODEBOOKS, tc.FRAMES, tc.CLIP_SECONDS, tc.BASE_SEED)


def test_split_is_stable_and_roughly_80_10_10():
    splits = [ac.split_for(i) for i in range(5000)]
    assert splits == [ac.split_for(i) for i in range(5000)]
    share = splits.count("train") / 5000
    assert 0.77 < share < 0.83 and {"train", "validation", "test"} == set(splits)


def _fake_shard(tmp_path, items):
    metas = [{"item": i, "register": "oud", "tonic": 2, "scale_pcs": [0, 2, 4, 7, 9], "bpm": 90.0, "offset_cents": 1.5, "length_sec": 10.0,
              "notes": [{"onset": 0.5 + i, "offset": 1.0 + i, "midi": 60, "cents": 2.5}]} for i in items]
    codes = np.full((len(metas) * 5, ac.CODEBOOKS, ac.FRAMES), 7, dtype=np.int16)
    np.save(tmp_path / "shard_00000.npy", codes)
    (tmp_path / "shard_00000.jsonl").write_text("".join(json.dumps(m) + "\n" for m in metas), encoding="utf-8")
    cond = {c: {"log_mel_corr": 0.9, "chroma_corr": 0.8, "reencode_match": 0.99} for c in ac.CONDITIONS}
    (tmp_path / "verify.json").write_text(json.dumps({"melodies": 2, "conditions": cond}), encoding="utf-8")


def test_assemble_writes_parquet_card_and_checksums(tmp_path):
    pq = pytest.importorskip("pyarrow.parquet")
    shards, out = tmp_path / "s", tmp_path / "out"
    shards.mkdir()
    _fake_shard(shards, range(40))
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    for n in ("synth_somali_bench.py", "synth_token_corpus.py", "verify_token_corpus.py", "assemble_token_corpus.py"):
        (scripts / n).write_text("# x\n", encoding="utf-8")
    stats = ac.assemble(shards, out, "ns/x", scripts)
    assert stats["melodies"] == 40 and stats["tokens"] == 40 * 5 * 4 * 850 and stats["notes"] == 40
    tables = [pq.read_table(p) for p in sorted((out / "data/encodec_32khz").glob("*.parquet"))]
    assert sum(t.num_rows for t in tables) == 200
    row = tables[0].slice(0, 1).to_pylist()[0]
    assert len(row["codes"]) == 4 and len(row["codes"][0]) == 850 and row["codes"][0][0] == 7
    notes = [r for p in (out / "data/notes").glob("*.parquet") for r in pq.read_table(p).to_pylist()]
    assert len(notes) == 40 and notes[0]["notes"][0]["midi"] == 60
    readme = (out / "README.md").read_text(encoding="utf-8")
    assert "This dataset is synthetic" in readme and "- config_name: notes" in readme and "ns/x" in readme
    assert "SHA256SUMS" not in (out / "SHA256SUMS").read_text(encoding="utf-8")


def test_assemble_refuses_out_of_range_codes(tmp_path):
    pytest.importorskip("pyarrow")
    _fake_shard(tmp_path, range(2))
    c = np.load(tmp_path / "shard_00000.npy")
    c[0, 0, 0] = 2048
    np.save(tmp_path / "shard_00000.npy", c)
    with pytest.raises(SystemExit):
        list(ac.load_shards(tmp_path))
