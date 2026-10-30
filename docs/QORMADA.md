# Qormada in the browser — audio to sheet music

`/transcribe` now turns any recording into sheet music on the visitor's own
device: choose a file or record with the microphone, and get an engraved
score with the scale and tuning measured from the recording, playable as
MIDI, downloadable as MusicXML and MIDI, printable to PDF. Nothing is
uploaded. It runs on the public site (no AI service needed) and in local mode
below the server pipeline. Added 2026-10-29 on branch `qormada-v1`.

## Pipeline

| step | file | what it does |
| --- | --- | --- |
| decode | `components/transcribe/BrowserTranscriber.tsx` | `OfflineAudioContext.decodeAudioData`; 60 MB, 10 min per transcription |
| melody pitch | `lib/qormada/melody.ts` | downmix to ~11 kHz, 4th-order 150 Hz high-pass, YIN with a 100 Hz floor (keeps the tracker off the bass), tuning offset, pentatonic fit, note segmentation (`lib/daw/pitch.ts`), lone octave slips moved back to their neighbours |
| plucks | `lib/qormada/onsets.ts` | a held pitch is split where the level rises 6 dB over the recent minimum (repeated oud plucks) |
| tempo | `lib/qormada/tempo.ts` | onset-strength envelope of the whole recording (3-band log-energy rise), autocorrelation at the beat lag + half weight at half/double lag, preference around 100 BPM; beat phase by comb search. Falls back to melody onsets. The musician can type the tempo |
| rhythm | `lib/qormada/quantize.ts` | sixteenth grid from the beat phase, one note per step, gaps under a beat joined (legato, optional), rests, barline ties; values never cross a beat inside it, two-beat values and dotted quarters start on beats 1 or 3, rests use plain values |
| notation | `lib/qormada/musicxml.ts` | MusicXML 4.0: nearest major key holding the pentatonic set (scale notes need no accidentals), diatonic spelling, accidentals once per bar, treble or bass clef by range, tempo mark, caption with scale and tuning, cents under notes ≥ 15 c off, off-scale notes in red |
| engrave | `lib/verovio.ts` | Verovio WASM → SVG pages + MIDI (shared with the MusicXML viewer) |
| options | `lib/qormada/sheet.ts` | tempo, 4/4 · 3/4 · 2/4, transpose ±12, cents on/off, keep off-scale notes, legato; re-runs without re-analysing |

## Verification (2026-10-29)

- `npm test` in `apps/web`: 140 vitest tests (15 new in
  `lib/qormada/__tests__/qormada.test.ts`) and the 9 audio-rights tests pass.
  The end-to-end test synthesises a plucked A minor pentatonic melody at
  100 BPM, transcribes it, and checks that Verovio engraves the MusicXML and
  renders MIDI (tonic A, tempo within 3 BPM).
- `tsc --noEmit` clean; Prettier clean; `npm run build` passes with the rights
  gate (488 shipped audio files).
- Headless Chrome, dev server (local mode) and production build (public mode,
  no AI service): gallery clip loaded as a file → Transcribe → score engraved
  in about 1 s for a 10 s clip and for a 60 s song; transpose renames the key
  (E → F♯ at +2); MusicXML and MIDI download links present; 390 px wide
  without sideways scroll; no `/api/v1` requests.
- Microphone: Chrome's fake capture device recorded 5 s, stopped, decoded and
  loaded; its beeps hold no melody and the page said so.
- Not checked in a browser: the print dialog behind "Print / save as PDF"
  (headless Chrome has none).

## Measured on 8 gallery clips (model output, prompts state the BPM)

Bass-locking before and after the melody mode (median MIDI note of the
transcription; notes 10+ semitones from it):

| clip | prompt BPM | median, old → new | far notes, old → new | tempo, melody onsets → whole-recording envelope |
| --- | --- | --- | --- | --- |
| oud_000 | 121 | 62 → 62 | 4 → 1 | 119 → 120 |
| oud_002 | 110 | 60 → 60 | 2 → 0 | 94.5 → 109 |
| oud_003 | 144 | 62 → 57 | 4 → 3 | 108 → 73 (half) |
| v4_epoch01_003 | 110 | 61 → 61 | 50 → 6 | 82.5 → 110 |
| v4_epoch05_015 | 110 | 45 → 59 | 9 → 5 | 87.5 → 109 |
| v4pool_001_15 | 110 | 42 → 61 | 31 → 1 | 112 → 111.5 |
| v4pool_004_19 | 110 | 45 → 59 | 32 → 4 | 163.5 → 81.5 |
| v4pool_007_23 | 110 | 42 → 58 | 9 → 2 | 96 → 109.5 |

Tempo within 2 BPM of the prompt: 2 of 8 before, 6 of 8 after (7 counting the
half-tempo reading). The prompt is what the model was asked for, not a
measured ground truth; n = 8, directional.

## Limitations

- One melodic line. Chords and a second voice are not written.
- Full mixes give a rough melody: in the v4 songs only about a fifth of the
  frames carry a clear melody pitch, so the score has gaps. Solo oud or voice
  transcribes densely.
- YIN, not the research pipeline's CREPE and source separation.
- One global tempo; rubato lowers the tempo confidence (the page shows the
  estimate and takes a typed tempo). Bars start on the first beat found, not
  a detected downbeat.
- Ornaments and grace notes are not notated as such; short ones are absorbed
  or become sixteenths.

## Next

Downbeat detection (bar lines on the strong beat), an "Open in Studio" button
(the measured melody as an oud track, as the Pitch tab already does), and a
worker thread for long recordings on phones.
