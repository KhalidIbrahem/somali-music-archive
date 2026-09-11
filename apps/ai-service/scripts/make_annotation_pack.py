"""Build an annotation pack for one recording of the transcription pool.

    python -m scripts.make_annotation_pack <slug> [--pool-dir ../../data/transcription_pool]
        [--out-dir ../../data/annotation]

Produces data/annotation/<slug>/ with everything an annotator needs and
nothing else: the machine transcription, a copy of it to correct in MuseScore,
the audio it was made from (and the separated stems when there are any), the
PDF, the pipeline JSON for scoring, a pre-filled meta.json holding the
reference scale to confirm or correct, source.json with the provenance, and a
one-page ANNOTATION_GUIDE.md. Format: docs/eval/TRANSCRIPTION_BENCHMARK.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]

GUIDE = """# Annotation guide: {slug}

You are correcting a machine transcription of a Somali qaraami recording by
ear. The result becomes part of the first annotated qaraami transcription
benchmark. Work on `{slug}_corrected.musicxml`; leave `{slug}_machine.musicxml`
untouched, it is the record of what the machine produced.

## Files

- `{slug}_source.wav`: the recording the transcription was made from{excerpt_note}.
- `stems/vocals.wav`, `stems/other.wav`: the separated voice and oud, when the
  recording was separated. Listen to these when the mix is unclear.
- `{slug}_machine.pdf`: the machine transcription as a page, for reference.
- `{slug}_corrected.musicxml`: the file you edit.
- `meta.json`: the reference scale. The values are the machine's estimate;
  confirm or correct them.

## How to work

1. Open `{slug}_corrected.musicxml` in MuseScore 4 (File > Open). Press space
   to play; put `{slug}_source.wav` in another player to compare.
2. Fix wrong pitches to the nearest note on the staff. When the sung or played
   pitch sits clearly between two notes, keep the nearer one and write the
   offset as a lyric on that note: `+40c` or `-40c` (Ctrl+L / Cmd+L adds a
   lyric). The machine already did this for the notes it left red.
3. Add missed notes; delete notes that are not there. Correct onsets and
   lengths on the eighth-note grid. If the metre is not 4/4, change the time
   signature; the machine always writes 4/4.
4. Mark a note you cannot decide about (buried, ornament or note, octave
   unclear) by colouring it blue: select the note, then Format > ... > Color,
   or the Inspector/Properties panel, and choose pure blue (#0000FF). Blue notes
   are left out of scoring. Every other note in your file counts as verified.
5. Leave the red notes red if you agree with them; recolour them black if you
   changed them. Red has no effect on scoring.
6. Do not change the key signature, the tempo mark or the part names, and do
   not add a second voice to the oud staff unless the collaborators agreed
   to notate the accompaniment.
7. Save with File > Export > MusicXML (uncompressed .musicxml), overwriting
   `{slug}_corrected.musicxml`. Save often.
8. Open `meta.json` in a text editor. Set `tonic_name` and `scale_cents`
   (each degree in cents above the tonic) to what you hear if the machine's
   estimate is wrong, and set `"confirmed": true`. Add a note on the metre if
   it is not 4/4.

When two annotators disagree, sit together and save the agreed version as
`{slug}_adjudicated.musicxml` in the same folder.

Do not put the audio or your corrected files anywhere public; the rights to
the recordings stay with the performers.
"""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_pack(slug: str, pool_dir: Path, out_dir: Path) -> Path:
    src = pool_dir / slug
    row_path = src / "pool_row.json"
    if not row_path.exists():
        raise FileNotFoundError(f"{row_path} not found: is '{slug}' a pool slug?")
    row = json.loads(row_path.read_text())
    if row.get("error"):
        raise RuntimeError(f"pool item {slug} failed: {row['error']}")
    stem = row["artifact_stem"]
    xml = src / f"{stem}.musicxml"
    if not xml.exists():
        raise FileNotFoundError(f"{xml} missing")
    pack = out_dir / slug
    pack.mkdir(parents=True, exist_ok=True)
    shutil.copy2(xml, pack / f"{slug}_machine.musicxml")
    shutil.copy2(xml, pack / f"{slug}_corrected.musicxml")
    pdf = src / f"{stem}.pdf"
    if pdf.exists():
        shutil.copy2(pdf, pack / f"{slug}_machine.pdf")
    pipeline_json = src / f"{stem}.json"
    shutil.copy2(pipeline_json, pack / f"{slug}_pipeline.json")
    result = json.loads(pipeline_json.read_text())
    wav = src / result["input_wav"]
    if wav.exists():
        shutil.copy2(wav, pack / f"{slug}_source.wav")
    stems_dir = None
    if result.get("separation", {}).get("used"):
        stems_dir = pack / "stems"
        stems_dir.mkdir(exist_ok=True)
        for key in ("vocals", "other"):
            p = Path(result["separation"][key])
            if p.exists():
                shutil.copy2(p, stems_dir / f"{key}.wav")
    scale = result["scale"]
    meta = {
        "slug": slug,
        "tonic_name": scale["tonic_name"],
        "tonic_label_machine": scale.get("tonic_label"),
        "tonic_ambiguous_machine": scale.get("tonic_ambiguous"),
        "mode": scale["mode"],
        "scale_cents": scale.get("scale_cents") or scale.get("scale_cents_template"),
        "scale_cents_template": scale.get("scale_cents_template"),
        "metre": "4/4 assumed by the machine; change if wrong",
        "confirmed": False,
        "annotator": "",
        "notes": "",
    }
    (pack / "meta.json").write_text(json.dumps(meta, indent=1))
    source_path = Path(result.get("source_path") or row.get("path") or "")
    source_info = {
        "slug": slug, "source_name": row["name"], "source": row["source"],
        "source_path": str(source_path) if source_path else None,
        "source_sha256": sha256_file(source_path) if source_path and source_path.exists() else None,
        "duration_s": row["duration_s"], "excerpt_sec": result.get("excerpt_sec"),
        "instrumental": result.get("instrumental"),
        "separated": bool(result.get("separation", {}).get("used")),
        "pipeline_runtime_s": row.get("runtime_s"),
        "machine_summary": {k: row.get(k) for k in ("tonic_label", "scale_cents", "pcs", "n_notes", "n_marked", "bpm")},
    }
    (pack / "source.json").write_text(json.dumps(source_info, indent=1))
    excerpt = result.get("excerpt_sec")
    (pack / "ANNOTATION_GUIDE.md").write_text(GUIDE.format(
        slug=slug, excerpt_note=(f" (the first {excerpt:.0f} seconds of the source)" if excerpt else "")))
    return pack


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="build an annotation pack from a pool item")
    ap.add_argument("slug", nargs="+")
    ap.add_argument("--pool-dir", default=str(REPO / "data" / "transcription_pool"))
    ap.add_argument("--out-dir", default=str(REPO / "data" / "annotation"))
    a = ap.parse_args(argv)
    for slug in a.slug:
        pack = build_pack(slug, Path(a.pool_dir), Path(a.out_dir))
        print(f"{slug}: {pack} ({len(list(pack.rglob('*')))} files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
