# QaraamiGenAI Studio — engineering handoff

The Studio is the browser DAW at `/studio` (Next.js, `apps/web`). The project
file format is in [DAW-PROJECT-FORMAT.md](DAW-PROJECT-FORMAT.md); this file
records the architecture, what works, and what is next. Updated 2026-11-08
(branch `studio-v3`, worktree `~/Projects/sma-studio-v3`; merged into `master`).
The research behind v3 is in `docs/research/` (six sourced notes and the
synthesis report) and the design decisions in [STUDIO_V3_PLAN.md](STUDIO_V3_PLAN.md).

## Architecture (v3)

| Layer | Path | Role |
| --- | --- | --- |
| Route | `app/studio/page.tsx` | Mounts `DawApp` in `Suspense` (reads `?project=`). `/daw` redirects here; `/studio/score` is the separate transcription score view (`components/studio/`). |
| Root | `components/daw/DawApp.tsx` | Owns the plain-data project, undo history, engine, selection, shortcuts, MIDI input, recording, autosave, and (v3) the **mode**, the two rails, the start screen, the play surface's octave, and the note/tap event bus the lessons subscribe to. Single edit path: `commitProject` / `update`. |
| Shell | `Transport.tsx` (control bar: pane toggles Y / I, transport, LCD with bar·beat / time / BPM / **key** / signature, scale lock) · `Toolbar.tsx` (the five modes, Import, Export…, pane toggles, Start) · `StartOverlay.tsx` (GarageBand-style chooser; `localStorage` `sma.studio.start=off` hides it) · `lib/daw/useBreakpoint.ts` (rails dock from 768 px, both open from 1280 px; below 768 px every rail is a full-screen overlay) | Logic's window anatomy: control bar + toolbar, Library left, tracks area centre, Inspector right, editors below. |
| Library | `LibraryRail.tsx` | Sounds (the four instruments + audio track, audition / add / use on selected), Loops (`LoopBrowser` embedded), Grooves (presets with a 16-step preview, one-bar audition, add at playhead), Scales (five pentatonic modes on any root: play, lock). |
| Inspector | `Inspector.tsx` | Region (MIDI: name, position, length, loop, notes, transpose; audio: name, clip gain, fades, span), Track (name, colour, instrument, volume, pan, M/S/●, insert FX: 3-band EQ, compressor, reverb send; "Open in Mixer"), Project (tempo, time, key, length, master). Same `editOps`/`fx` as the Mixer, so they never disagree. |
| Engine | `lib/daw/engine.ts` | The only AudioContext owner: scheduling, synthesised instruments, audio regions, recording (AudioWorklet capture), mixdown. v3 adds `startInputCheck` / `stopInputCheck` / `isInputChecking` / `getInputLevel` (microphone meter without recording; the recording path meters too). |
| Bottom panel | tabs **Editor · Play · Record · Learn · Mixer · Pitch · Generate** in `DawApp` | Editor = piano roll / step sequencer / audio inspector; the three new tabs below. |
| Play | `PlaySurface.tsx`, `lib/daw/playSurface.ts` | Keyboard (1.5–3 octaves by width, multi-touch with pointer capture, glissando, velocity by vertical position, scale-lock tint, **Scale-only layout** of in-scale bars with degree numbers, octave −/+) for oud/bass/keys; three pads (dum/tak/slap, velocity by position) for durbaan. Calls only `onNoteOn/onNoteOff`; DawApp routes them through the same `noteOn/noteOff` as musical typing and MIDI (scale lock, audition, recording into an armed instrument track). |
| Record | `RecordPanel.tsx`, `lib/daw/recordFlow.ts` | Five cards: Input (canvas meter from `engine.getInputLevel()`, Check microphone / Close, Monitor), Target (audio tracks as radios, `armOnly`, New audio track, arm the selected instrument track), Count-in & click, Record (64 px button, elapsed bars·beats), Takes (idb-sourced regions: Pitch → selects the region and opens the Pitch tab, Rename, Delete — undoable). |
| Learn | `LearnPanel.tsx` (+ `LearnRhythm.tsx`, `LearnMelody.tsx`), `lib/learn/*` | **Qaamuus** — the reverse dictionary over `lib/learn/glossary.json` (`glossaryTypes.ts` schema; `glossarySearch.ts`: accent-insensitive, typo-tolerant, field-weighted search by meaning in English or Somali; whole-name matches win; category browse; related terms; sources; "Hear it" plays a groove, a scale or a published model-output clip). **Scale** lesson (`lessons.ts` text, modes on any root, lock). **Rhythm** lesson (`tapTrainer.ts`: expected onsets from the groove presets, greedy nearest matching within 120 ms, score, early/late bias, device calibration; taps from the Tap button, the space bar, the durbaan pads and musical typing). **Melody** lesson (`phrases.ts` splits the engraved Beerdilaacshe notes into two-bar phrases; listen at 50/75/100 % with loop; play along after a count-in; `practiceScore.ts` matches played notes to the reference — pitch class, timing within an eighth, completeness, extras — with `estimateOffset` auto-alignment; per-note green/amber/red). **History** lesson linked to glossary entries. `lib/learn/audition.ts` schedules lesson sounds through `engine.audition()`. |
| Persistence | `lib/daw/projectStore.ts`, `audioStore.ts` | IndexedDB first (1.5 s debounce), then `/api/v1/studio/projects` sync (8 s) when the build has an API server and the visitor is signed in. |

### The note/tap bus

Lessons never own input. `DawApp.noteOn/noteOff` (musical typing, Web MIDI,
the play surface) publish `{ type, midi, velocity, timeMs }` to subscribers
(`subscribeNotes`); with the Learn tab open and a rhythm lesson listening, the
space bar publishes a tap (`subscribeTaps`) instead of toggling the transport.
`timeMs` is `performance.now()`, so the lessons measure timing against their own
`setTimeout` schedules; the trainer's Calibrate option subtracts the measured
mean offset (browser output + input latency is tens of milliseconds per the
research notes).

### Modes

`applyMode()` only arranges panes — every pane stays reachable afterwards:
Create → Editor tab, Library on Sounds (docked only); Play → Play tab;
Learn → Learn tab; Listen → Library on Loops + Pitch tab; Record → Record tab.
On a phone the mode closes the overlays it does not need.

## Verified (2026-11-07, local, production build at 127.0.0.1:3100)

- `npm test` in `apps/web`: **241 vitest tests** (85 new: glossary search 12,
  practice score 18, phrases 12, tap trainer 16, play surface 14, record flow 13)
  plus the 9 audio-rights node tests, all pass. `tsc --noEmit` clean. Prettier
  clean. `npm run build` clean, rights gate included.
- Chrome 1440 × 900: start screen → Learn (Qaamuus: "the lute" → **kaban** with
  sources and Hear it; melody lesson: 18 phrases + All; Play surface: C4–C7 with
  the A-minor-pentatonic tint, scale-only bars; Record panel; Listen mode opens
  Loops + Pitch; Grooves tab). No console errors.
- 2026-11-08, production build, headless Chrome 1440 × 900 with a fake microphone:
  50 of 50 checks. Transport and the play surface start real audio nodes, the
  Beerdilaacshe lesson plays, Qaamuus finds terms in all 194 entries, the mic meter
  runs, every bottom tab and the export dialog open, 11 public routes answer, 0
  console errors, 0 failed requests, 0 `/api/v1` calls.
- Headless Chrome 390 × 844 and 414 × 844 (`apps/web/scripts/studio-mobile-check.mjs`):
  start, Create, Play, Learn, Listen, Record — `scrollWidth == innerWidth` on
  every step, 0 console errors; the rails are full-screen overlays with a close.

## Known limitations

- The control bar wraps to four rows on a phone; a condensed phone transport
  (one row + a sheet) is the next layout step.
- Lesson playback uses `setTimeout` auditions (fine at lesson speeds), not the
  transport's sample-accurate scheduler; the melody lesson plays the engraved
  notes independently of the project (mute the Oud track if both sound).
- Rhythm scoring trusts `performance.now()` against audio scheduled on the
  main thread: expect 20–60 ms of systematic lateness per device — that is what
  Calibrate removes. A loopback (MLS) calibration is the research's recommendation.
- The play surface sends raw MIDI; DawApp's `lockToScale` snaps it (so with the
  lock on, the full keyboard lights the snapped key via `heldNotes`).
- Glossary v3: 194 entries; 146 attested, 46 reported, 2 unverified. Every term
  in the musicology review's list of additions is in, checked against the
  sources' own text (2026-11-08). The 122 new entries have no Somali definition
  yet (32 older entries do); a Somali speaker should write those. The people and
  institutions the review lists after its 64 lines are not added.
- ESLint does not run in the worktree (`eslint-config-next` parser resolution,
  pre-existing); CI does not lint the web app.

## Next engineering step

1. Somali definitions for the new glossary terms; the review's people and
   institutions; better sources for the entries still marked `reported`.
2. Phone transport: one-row control bar with a "more" sheet; bottom panel as a
   draggable sheet.
3. Pitch analysis in a Web Worker; transport-synced slowed playback (the
   PracticePlayer and the lessons share one time-stretch path).
4. Loopback latency calibration for the trainers (research note §5).
5. A kaban fretboard play surface (courses tuned in fourths, scale positions).
