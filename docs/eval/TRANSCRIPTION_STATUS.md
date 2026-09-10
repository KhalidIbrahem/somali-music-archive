# Transcription pipeline: status

Kept current after every commit. Outputs live under `data/transcription_demo/`
(not tracked). Environment: `~/ai/musicgen-env`; render: `/Applications/MuseScore 4.app`.

## Done

- Inventory of the existing Track B code and what runs on this machine (reported 2026-09-10).
- `scripts/pentatonic.py`: `refine_scale_cents` and `scale_cents_template`, the data-driven scale in cents relative to the tonic (commits b8083dd, and the interval fix that follows it).
- `scripts/quantize.py`: `deviation_cents`, `degree` and `rel_cents` on every note; `detect_scale(refine=True)`; snapping and PCS against the refined degrees (commit 154ae3f).
- Tools installed: Demucs 4.1.0, music21 10.5.0, Verovio, pytest in `musicgen-env`; MuseScore Studio 4.7.5 in `/Applications`.

## Running

- Nothing at the moment.

## Failed

- Nothing so far.

## Reproduce

```
cd apps/ai-service
~/ai/musicgen-env/bin/python -m pytest -q tests/test_pentatonic.py tests/test_quantize.py
```

## Next

- `scripts/transcribe.py <audio> --out <dir>`: CREPE front-end, optional Demucs, skyline for the oud, beat grid, MusicXML (two staves), MIDI, JSON, PDF, report.
- Three demo recordings, then the benchmark scaffold.
