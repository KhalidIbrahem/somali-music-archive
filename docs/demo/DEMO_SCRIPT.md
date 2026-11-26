# Demo video script (about 2 min 50 s)

Project 1 of the portfolio (the technical one): a screen recording with
voice-over, built around Khalid's own oud recording of the Beerdilaacshe melody
(session planned for 2026-12-10). Six shots, about 330 words spoken; say them
your own way. No generated audio is played anywhere in this video.

Project 2 is the performance video from the same session; its sheet is
`docs/portfolio/RECORDING_SHEET_MUSICIANS.md`.

## What must exist before this can be recorded

| needed | state on 2026-11-25 |
| --- | --- |
| The takes from the session: silence, Beerdilaacshe on solo oud, a different piece on solo oud, the voice take | not recorded yet |
| A short clip of the performance video for shot 1 | not recorded yet |
| The separation and restoration page with those takes on it | page built (`/separation`, 2026-11-25) on synthesised test signals; `portfolio_dsp_build.py --source recording` swaps the takes in |
| Every clip on that page approved by Khalid's ear | waits on the takes |
| Numbers marked `[…]` below | measured on the takes, then written in |
| `portfolio-v1` merged and pushed, so the pages are live | not pushed |

## Before recording

1. Browser at 1280 × 720 or 1440 × 900, zoom 110 %, bookmarks bar hidden, one
   window, these tabs in order: `/portfolio`, `/transcribe`,
   `/scores/beerdilaacshe`, the separation page, `/results`.
2. System audio is recorded (QuickTime with BlackHole, or OBS). Play one clip
   and check the level. Notifications off.
3. Mac on power, lid open: a sleeping Mac freezes the audio clock.

## Shots

| # | time | on screen | do | say |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:25 | The performance video, full screen, then `www.qaraamigen.com/portfolio` | Let eight seconds of the oud play with no talking. Cut to the portfolio page. | "That is me, playing Beerdilaacshe on the oud. Somali qaraami is oud-led song, taught by ear, the way my teacher is teaching me. Almost none of it is written down, and its five-note scale is not tuned like a piano. I'm Khalid Ibrahim. I built QaraamiGen to study this music with computation." |
| 2 | 0:25–0:55 | `/transcribe` | Drop in the recording from shot 1. The score appears. Point at the scale and cents line, then at a red note. Click **Download MusicXML**. | "First, transcription. I give it the recording you just heard, and it becomes sheet music, in the browser, nothing uploaded. It measures which five notes I actually played and how far they sit from piano tuning. Notes off the scale are kept and marked red, because ornaments are music, not errors. On a public benchmark it reaches ninety-three percent of the agreement between two human annotators." |
| 3 | 0:55–1:20 | `/scores/beerdilaacshe` | Show the engraved melody, press play for three seconds, then put the transcription from shot 2 beside it. | "This is the same melody as it is engraved on the site, and this is what the software heard me play. Where they differ, some of it is the software and some of it is me; I can see which, note by note. Across ninety-one recordings the measurements show a tendency: the minor seventh is played about eight cents sharp." |
| 4 | 1:20–1:55 | The separation page, first block | Play **Original** (oud and voice together) for five seconds, **Extracted oud** for five, **Extracted voice** for four. Rest on the number table. | "Second, separation. I recorded the oud and the voice separately, so the true parts are known. The method is non-negative matrix factorisation, written in plain numpy: it learns what my oud sounds like from another piece in the same session, then splits the mixture. It recovers the oud at [X] decibels. A pretrained neural network reaches [Y], and I show both, because the simple method is the one I can explain line by line." |
| 5 | 1:55–2:20 | The separation page, second block | Play **Noisy** for four seconds, **Noise** for two, **Restored** for five. | "Third, restoration. Much of Somali music survives only on cassette. Here I add tape noise to my own clean recording at a known level, remove it with spectral subtraction, and measure what comes back: from ten decibels to [Z]." |
| 6 | 2:20–2:50 | `/results`, then end on `/portfolio` | Rest on the figure, scroll to the blind-test column. | "I also fine-tuned music generation models on oud recordings. They predict unseen Somali songs better than their base models, and along the way I found and reported a bug in the Hugging Face MusicGen code. But in blind listening the output is not good enough yet, and I say so next to the numbers. Making it good, with Somali musicians as the judges, is the work I want to do next. Thank you." |

## Notes

- Shot 4's words depend on the measurement. On two real oud takes and one voice
  take from the project's corpus the same code gave: oud 4.4 dB in the mixture,
  10.8 dB separated with a same-session dictionary, 16.9 dB for Demucs; with a
  dictionary from another session it was worse than the mixture (2.9 dB). If
  the result on Khalid's takes is not clearly above the mixture, the line
  changes to say so; it is not cut.
- Shot 3 only works if the two scores are in the same key and tempo on screen.
  Check it once before recording; if the comparison is hard to read, show the
  two scores one after the other instead.
- Beerdilaacshe: one source (Geeska, 2025) credits the melody to Qarshe and
  nothing else on record dates it. Say "the Beerdilaacshe melody" and name no
  composer in the video. Whether a public performance of it needs anyone's
  permission is Khalid's question to settle with his teacher before the video
  is uploaded.
- If someone else sings the voice take, their consent form is signed before the
  clip is used (`docs/portfolio/CONSENT_FORM.md`).
- Do not show: the member archive, any source recording that is not Khalid's
  own, the listening study's clips, any generated clip, a terminal with the
  service token.
- Numbers spoken are the ones on the pages: 93 %, 91 recordings, about 8 cents,
  and the three filled in from the takes. If a page changes, change the line.
- After recording: upload unlisted, then give me the URL for the `/portfolio`
  video slot and the README.

## Dates

| by | what | who |
| --- | --- | --- |
| 2026-12-10 | Recording session: the takes and the performance video | Khalid |
| 2026-12-12 | Separation and restoration page built on the takes; numbers filled in | Claude |
| 2026-12-13 | Every clip listened to and approved or cut | Khalid |
| 2026-12-14 | Merge and push so the pages are live | Khalid's go |
| 2026-12-16 | This video recorded | Khalid |
| 2026-12-18 | Application submitted, five days before the deadline in the notes (2026-12-23; confirm in the portal) | Khalid |
