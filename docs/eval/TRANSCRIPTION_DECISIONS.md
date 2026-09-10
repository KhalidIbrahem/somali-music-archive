# Transcription pipeline: decisions log

One line of reasoning per decision taken without asking, newest at the bottom.
Decisions given by Khalid on 2026-09-10 are recorded first for completeness.

| # | date | decision | reasoning |
| --- | --- | --- | --- |
| 1 | 2026-09-10 | CREPE is the only pitch front-end, for the vocal and the oud stem alike; Basic Pitch stays out. | Khalid's call. CREPE already runs on this machine and is the more accurate tool for a sung line; the oud stem is reduced to one line by the skyline step. |
| 2 | 2026-09-10 | Reuse the Track B stages (`quantize.py`, `pentatonic.py`, `beat_grid.py`, `f0_notes.py`, `melody.py`) by extension, not rewrite. | Khalid's call. They are tested and already encode the pentatonic-aware behaviour the paper depends on. |
| 3 | 2026-09-10 | Demucs, music21 and Verovio installed into `~/ai/musicgen-env` with torch pinned at 2.14.0; torchaudio resolved to 2.11.0. | One environment keeps the pipeline reproducible; imports succeed, and MPS is checked at the first real run. |
| 4 | 2026-09-10 | MuseScore Studio 4.7.5 installed from the official dmg into `/Applications` (no Homebrew, no sudo); `mscore` renders MusicXML to PDF. | Khalid's call; Verovio SVG is the fallback if a render fails. |
| 5 | 2026-09-10 | Scale refinement is opt-in (`detect_scale(refine=True)`); the CLI turns it on, the earlier experiment scripts do not. | Changing the reference frame of the ablation and PCS experiments silently would alter published numbers. |
| 6 | 2026-09-10 | A scale degree carrying under 2 percent of the pitch mass keeps its 12-TET template interval and is flagged as not refined. | Estimating a degree the performer never sang from a handful of frames would invent data. |
| 7 | 2026-09-10 | Demo outputs go to `data/transcription_demo/`, which is ignored by git; the status document carries the reports. | Scores are derivatives of recordings whose rights stay with the performers; the repository holds code and measurements, not the material. |
| 8 | 2026-09-10 | `pytest` added to `musicgen-env` through `uv` (the env has no `pip`). | Needed to run the existing stage tests where the pipeline actually runs. |
