# Qaraami transcription benchmark (scaffold, 2026-09-10)

The first annotated transcription benchmark for Somali qaraami: 20 to 30
recordings, each with an automatic transcription and a version corrected by
ear, so that a transcription system can be scored on this music rather than
on Western pop or classical sets. Status: scaffold. The pipeline, the file
format and the metrics exist and are tested; no recording has been annotated
yet.

## Scope and rights

- Version 1 draws on two sources only: the oud (kaban) collection in
  `data/raw_incoming/oud_ilkacase` (instrumental, one staff) and the
  `band_qaraami` recordings with vocals (two staves). Nothing from the Harvard
  Aryette collection enters this set.
- Audio is never part of the benchmark files; each item records the source
  path and its SHA-256 so it can be found again on this machine.
- The corrected scores are derivatives of recordings whose rights stay with
  the performers. They stay under `data/transcription_benchmark/` (not tracked
  in git) until the performers agree to their release. The metrics, the
  format and the scripts are public now.

## Selection

- 20 to 30 distinct songs (distinct by full-file hash): about 15 from the oud
  collection and about 10 band recordings with a clear sung line.
- Spread across tonics, modes and tempi; both solo oud and ensemble; both
  clean and worn recordings.
- Long songs are annotated as a 60-second excerpt from a musically complete
  passage (`--excerpt-sec 60`, start chosen by the annotator and recorded in
  `meta.json`), so one item takes under an hour to correct.

## Annotation format

One directory per item, `data/annotation/<slug>/`, built by
`scripts/make_annotation_pack.py <slug>` from the transcription pool
(`data/transcription_pool/`, see `INDEX.md` there):

| file | content |
| --- | --- |
| `<slug>_machine.musicxml`, `<slug>_machine.pdf`, `<slug>_pipeline.json` | the automatic transcription exactly as produced (`scripts/transcribe.py`); the JSON is what the metrics script scores |
| `<slug>_corrected.musicxml` | the annotator's correction, edited in MuseScore starting from a copy of the machine file; a second annotator saves `<slug>_corrected_<initials>.musicxml` |
| `<slug>_adjudicated.musicxml` | where two annotators disagree, the version they settled on together |
| `<slug>_source.wav`, `stems/` | the audio the transcription was made from (an excerpt for long songs) and the separated stems when there are any |
| `meta.json` | the reference scale: `tonic_name`, `scale_cents` (each degree in cents above the tonic), `mode`, the metre, `confirmed` |
| `source.json` | source path and SHA-256, excerpt, instrumentation, the machine summary |
| `ANNOTATION_GUIDE.md` | the one-page instructions for that item |

The per-note **verified flag** lives inside the MusicXML as a note colour, so
it survives editing in MuseScore and needs no side file:

- every note in a corrected file is verified, except
- a note coloured blue (`#0000FF`) is **unverified**: the annotator could not
  decide (buried in noise, ornament versus note, octave unclear). Unverified
  notes are excluded from scoring, together with any estimated note that lands
  on them.
- The pipeline's red colour (kept off-scale, deviation shown as a lyric) may
  stay on a corrected note as information; it has no effect on scoring.

What the annotator corrects: wrong pitches (to the nearest 12-TET note, with
a `+Nc` / `−Nc` lyric when the sung pitch sits clearly off it), missed notes,
false notes, onsets and durations on the eighth-note grid, and bar lines when
the metre is not 4/4. Pitch in the reference is read as the notated note plus
any microtone the MusicXML carries; the lyric is for the reader.

Two annotators correct every item independently (Khalid and the
collaborator). Their agreement, scored with the same metrics, is reported as
the ceiling any system can be expected to reach.

## Metrics

Computed by `apps/ai-service/scripts/transcription_metrics.py` in beat space
(quarter lengths), which is the space the annotator edits in.

**Note level.** Reference and estimated notes are matched one-to-one (Hungarian
assignment) when both conditions hold:

- onset within the tolerance: 0.25 quarter lengths by default (an eighth
  note); a stricter 0.125 is also reported;
- pitch within 50 cents.

precision = matched / estimated, recall = matched / verified reference,
F1 = their harmonic mean. The same is reported with the pitch condition
dropped (onset-only), which separates rhythm errors from pitch errors. All
of it per staff (Voice, Oud) and overall.

**Scale estimation.** Against `meta.json`:

- tonic correct (pitch class);
- degree set correct: same number of degrees and every estimated degree
  within 50 cents of a reference degree;
- mean and maximum absolute error in cents of the estimated degrees against
  their nearest reference degrees.

## Commands

```
cd apps/ai-service
# 1. automatic transcription (an excerpt for a long song)
~/ai/musicgen-env/bin/python -m scripts.transcribe "<audio>" --out ../../data/transcription_benchmark/<song_id> [--instrumental] [--excerpt-sec 60]
# 2. correct pipeline.musicxml in MuseScore 4, save as corrected_<initials>.musicxml; write meta.json
# 3. score
~/ai/musicgen-env/bin/python -m scripts.transcription_metrics --ref ../../data/transcription_benchmark/<song_id>/corrected_ki.musicxml \
    --est ../../data/transcription_benchmark/<song_id>/pipeline.json --ref-scale ../../data/transcription_benchmark/<song_id>/meta.json
```

The metrics script is tested on a synthetic item
(`tests/test_transcription_metrics.py`): a ten-note reference with two
unverified notes against an estimate with one missed note, one wrong pitch,
one spurious note and one onset inside the tolerance, giving precision,
recall and F1 of 0.75 for onset and pitch, and seven onset-only matches.

## Reporting

| item | staff | notes (ref) | P | R | F1 | F1 onset-only | tonic | degree set | mean cents error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Aggregate rows: mean over items, and the inter-annotator ceiling.

## Open questions for the annotators

- Whether to notate the oud as the skyline line only (as the pipeline does) or
  to add a second oud voice where the accompaniment is audible.
- Metre for items that are not 4/4 (some heello are in 6/8); the pipeline
  writes 4/4 and the corrected file is the authority.
