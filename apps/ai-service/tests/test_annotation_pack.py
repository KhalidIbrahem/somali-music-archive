import json

from scripts.make_annotation_pack import build_pack


def _fake_pool_item(pool, slug, separated):
    d = pool / slug
    d.mkdir(parents=True)
    stem = "song"
    (d / f"{stem}.musicxml").write_text("<score-partwise/>")
    (d / f"{stem}.pdf").write_bytes(b"%PDF-1.4 fake")
    (d / f"{stem}.input.wav").write_bytes(b"RIFF")
    sep = {"used": False}
    if separated:
        st = d / "stems" / "htdemucs" / stem
        st.mkdir(parents=True)
        (st / "vocals.wav").write_bytes(b"RIFF")
        (st / "other.wav").write_bytes(b"RIFF")
        sep = {"used": True, "vocals": str(st / "vocals.wav"), "other": str(st / "other.wav")}
    (d / f"{stem}.json").write_text(json.dumps({
        "input_wav": f"{stem}.input.wav", "excerpt_sec": 90 if separated else None,
        "instrumental": not separated, "separation": sep,
        "scale": {"tonic_name": "D", "tonic_label": "D (F)", "tonic_ambiguous": True, "mode": 4,
                  "scale_cents": [0, 300.1, 496.5, 698.3, 996.6], "scale_cents_template": [0, 300, 500, 700, 1000]}}))
    (d / "pool_row.json").write_text(json.dumps({
        "slug": slug, "source": "band" if separated else "oud", "name": "song.wav", "artifact_stem": stem,
        "duration_s": 120.0, "runtime_s": 40.0, "error": None, "tonic_label": "D (F)",
        "scale_cents": [0, 300.1, 496.5, 698.3, 996.6], "pcs": 0.98, "n_notes": 84, "n_marked": 2, "bpm": 112}))


def test_pack_has_every_file_the_annotator_needs(tmp_path):
    pool, out = tmp_path / "pool", tmp_path / "annotation"
    _fake_pool_item(pool, "band_x_song", separated=True)
    pack = build_pack("band_x_song", pool, out)
    names = sorted(p.relative_to(pack).as_posix() for p in pack.rglob("*") if p.is_file())
    assert names == sorted([
        "ANNOTATION_GUIDE.md", "band_x_song_corrected.musicxml", "band_x_song_machine.musicxml",
        "band_x_song_machine.pdf", "band_x_song_pipeline.json", "band_x_song_source.wav",
        "meta.json", "source.json", "stems/other.wav", "stems/vocals.wav"])
    meta = json.loads((pack / "meta.json").read_text())
    assert meta["tonic_name"] == "D" and meta["confirmed"] is False and meta["scale_cents"][2] == 496.5
    guide = (pack / "ANNOTATION_GUIDE.md").read_text()
    assert "#0000FF" in guide and "band_x_song_corrected.musicxml" in guide and "first 90 seconds" in guide
    src = json.loads((pack / "source.json").read_text())
    assert src["separated"] is True and src["excerpt_sec"] == 90


def test_instrumental_pack_has_no_stems_and_refuses_failed_items(tmp_path):
    pool, out = tmp_path / "pool", tmp_path / "annotation"
    _fake_pool_item(pool, "oud_y_song", separated=False)
    pack = build_pack("oud_y_song", pool, out)
    assert not (pack / "stems").exists()
    row = json.loads((pool / "oud_y_song" / "pool_row.json").read_text())
    row["error"] = "timeout"
    (pool / "oud_y_song" / "pool_row.json").write_text(json.dumps(row))
    import pytest

    with pytest.raises(RuntimeError):
        build_pack("oud_y_song", pool, out)
