# Transcription pipeline: status

Kept current after every commit. Outputs live under `data/transcription_demo/`
(ignored by git). Environment: `~/ai/musicgen-env`; render: `/Applications/MuseScore 4.app`.
Decisions and their reasons: `TRANSCRIPTION_DECISIONS.md`.

## Done

- Inventory of the existing Track B code and what runs on this machine.
- `scripts/pentatonic.py`: data-driven scale in cents relative to the tonic (`refine_scale_cents`, weighted median per degree, unsung degrees keep their template interval), runner-up (tonic, mode) readings with scores.
- `scripts/quantize.py`: `deviation_cents`, `degree`, `rel_cents` on every note; `detect_scale(refine=True)`; snapping and PCS against the refined degrees.
- `scripts/beat_grid.py`: `snap_notes_monophonic` (pickups shifted by whole bars, overlaps resolved).
- `scripts/vocal_f0.py`: raw 10 ms pitch frames on request; CREPE device selectable.
- `scripts/transcribe.py`: the CLI. Demucs (htdemucs, MPS, `--shifts 0`) or `--instrumental`; CREPE on each stem; skyline for the oud; recording-level scale; quantization to the estimated scale with signed deviations; beat-tracked eighth grid (tempo halved above 140 BPM); MusicXML with one or two staves, key by mode, red off-scale notes with their deviation; MIDI; JSON with raw pitch tracks, scale and every note's fields; PDF via MuseScore 4 (Verovio SVG fallback); report.
- Tools: Demucs 4.1.0, music21 10.5.0, Verovio, pytest in `musicgen-env`; MuseScore Studio 4.7.5 in `/Applications`.
- Three demo recordings transcribed end to end (table below). Nothing from the Harvard collection was used.
- Benchmark scaffold: `docs/eval/TRANSCRIPTION_BENCHMARK.md`, `scripts/transcription_metrics.py`, synthetic test.

## Running

- Nothing at the moment.

## Failed, and what was done

- `scripts/transcribe.py` (old) failed at `import basic_pitch`; the Basic Pitch front-end was replaced by CREPE, as decided.
- First rendered score was empty: pickup notes clamped to offset 0 overlapped, music21 split them into voices numbered from 0, MuseScore dropped them. Fixed by the monophonic grid snap.
- MIDI export failed on two-staff scores: one `Key` object inserted into two parts. Fixed with one object per part.
- Spurious naturals on every note: music21 marks a MIDI-built note with an explicit natural. Fixed by clearing it.
- The band clip's tonic flipped between D and F across runs: Demucs' random time shift. Fixed with `--shifts 0`; the degree refinement moved from histogram peak to weighted median for the same reason.
- Two-staff scores were padded with empty bars to twice the music, and the voice staff sat a bar late: the second part was appended after the first in time, and each staff computed its own pickup shift. Fixed: parts inserted at offset 0; one pickup shift shared by all staves.
- Residual run-to-run drift from CREPE on MPS (one marginal note, 0.2 cents): accepted, documented, `--pitch-device cpu` available.

## Demo results (2026-09-10)

| recording | length | staves | tonic | scale (cents above tonic) | PCS | notes (marked) | tempo | time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| oud: 02 aha aha qaraami mul | 242 s | oud | A (+1.0 c tape, +1.9 c refined) | 0 / 301 / 498 / 693 / 1002 | 0.932 | 461 (23) | 83 BPM, halved from 167 | 42 s |
| oud: 04 Qaraami kaban wadada cod | 372 s | oud | A (−3.2 c, −6.8 c) | 0 / 311 / 504 / 706 / 1015 | 0.947 | 892 (52) | 117 BPM | 63 s |
| band_qaraami e0e0a1425885 seg000 | 30 s | voice + oud | D (+10.5 c, +0.4 c); runner-up F | 0 / 301 / 495 / 698 / 995 | voice 0.977, oud 0.985 | 84 (2) | 112 BPM | 15 s (separation 2 s) |

Both oud songs sit in the minor-pentatonic mode; the second places its third
and sixth degrees 11 to 15 cents sharp of 12-TET, which the score caption and
the JSON carry. No song took anywhere near 15 minutes, so no excerpt versions
were needed.

Outputs: `data/transcription_demo/<name>/` with `<stem>.musicxml`, `<stem>.pdf`,
`<stem>.mid`, `<stem>.json`, `report.txt`, `preview-N.png`, and `stems/` for
the separated clip.

## Reproduce

```
cd apps/ai-service
P=~/ai/musicgen-env/bin/python
$P -m pytest -q tests/test_pentatonic.py tests/test_quantize.py tests/test_beat_grid.py tests/test_f0_notes.py tests/test_melody.py tests/test_transcribe_cli.py tests/test_transcription_metrics.py
$P -m scripts.transcribe "../../data/raw_incoming/oud_ilkacase/02 aha aha qaraami mul.m4a" --out ../../data/transcription_demo/oud_02_aha_aha --instrumental
$P -m scripts.transcribe "../../data/raw_incoming/oud_ilkacase/04 Qaraami kaban wadada cod.m4a" --out ../../data/transcription_demo/oud_04_kaban_wadada --instrumental
$P -m scripts.transcribe ../../data/scale_clips/test/band_qaraami_e0e0a1425885_seg000.wav --out ../../data/transcription_demo/band_e0e0a1425885_seg000
$P -m scripts.transcription_metrics --ref <corrected.musicxml> --est <pipeline.json> --ref-scale <meta.json>
```

## Open

- Annotation of the benchmark set has not started; the format and metrics are ready.
- `services/notation_service.py` still calls the old CLI shape; not updated in this phase.
- The score assumes 4/4; the corrected file is the authority on metre.
