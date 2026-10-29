# QaraamiGenAI Studio — engineering handoff

The Studio is the browser DAW at `/studio` (Next.js, `apps/web`). The project
file format is in [DAW-PROJECT-FORMAT.md](DAW-PROJECT-FORMAT.md); this file
records the architecture, what works, and what is next. Updated 2026-10-29
(branch `studio-v2`, commits `d4eb149`, `fb8362b`; not merged, not deployed).

## Architecture

| Layer | Path | Role |
| --- | --- | --- |
| Route | `app/studio/page.tsx` | Mounts `DawApp` in `Suspense` (reads `?project=`). `/daw` redirects here; `/studio/score` is the separate transcription score view (`components/studio/`). |
| Root | `components/daw/DawApp.tsx` | Owns the plain-data project, undo history, engine, selection, shortcuts, MIDI input, recording, autosave. Single edit path: `commitProject` / `update`. |
| Engine | `lib/daw/engine.ts` | The only AudioContext owner: scheduling, synthesised instruments (oud = Karplus–Strong, durbaan, bass, keys), audio regions, recording (AudioWorklet capture), mixdown. |
| Edits | `lib/daw/editOps.ts`, `history.ts` | Pure edit operations and undo/redo. |
| Persistence | `lib/daw/projectStore.ts`, `audioStore.ts` | IndexedDB first (1.5 s debounce), then `/api/v1/studio/projects` sync (8 s); user audio as `idb:` blobs. |
| Bottom panel | `Editor` · `Mixer` · `Pitch` · `Generate` tabs in `DawApp` | Piano roll / step sequencer / audio clip inspector; mixer with FX; the two new tabs below. |
| Loops | `components/daw/LoopBrowser.tsx`, `lib/daw/loops.ts` | The 472 published QaraamiGen generations (`/demos/gallery/`), drag or Add onto a new audio track. `isAllowedAudioSource` refuses archive audio and remote URLs. |

## What this session changed

1. **`/studio` serves the DAW again.** SEO commit `2483a2d` had swapped the
   route to the score shell, so the whole DAW was unreachable on the live site
   (checked: `qaraamigen.com/studio` served the score viewer on 2026-10-29).
   The SEO metadata stays; the description now calls the oud voice synthesised.
2. **Pitch tab** (`components/daw/PitchLens.tsx`, `lib/daw/pitch.ts`) for the
   selected audio region, all in the browser, nothing uploaded:
   - YIN f0 every 10 ms on an ~11 kHz mono downmix (70–1000 Hz, −45 dBFS gate);
   - tuning offset from A440 (clarity-weighted circular mean of the cents residue);
   - best of the 12 anhemitonic pentatonic sets, tonic = most-sounded degree
     (ambiguous when the runner-up has ≥ 95 % of its mass), mode = that rotation;
   - each degree at the weighted median of pitches within 60 c of its template
     (under 2 % of the mass: "too sparse"), the research transcription method;
   - share of voiced frames within a quarter tone of the measured degrees;
   - note events (stable runs ≥ 80 ms, a 60 c jump starts a new note) with
     measured cents deviation and confidence; off-scale notes **marked, not snapped**;
   - contour plot (12-TET lines faint, measured degrees dashed), click to seek;
   - actions: **Melody → Oud track** (aligned to the region, via
     `transcriptionToTrack`), **Use as scale lock**, and **Practice** playback
     at 50 / 75 / 100 % with pitch preserved, loopable (`PracticePlayer.tsx`).
3. **Generate tab** (`components/daw/GeneratePanel.tsx`,
   `lib/daw/studioGeneration.ts`): prompt → AI service `/demo/generate` → WAV
   fetched, stored as `idb:`, placed on a new audio track at the playhead.
   Only `oud` and `base` are offered (allowlist; also dropped if the service
   marks them research-only). With `NEXT_PUBLIC_AI_SERVICE_MODE` off (the
   public site) the tab says live generation is not connected and points to Loops.
4. **Save status** says where the project is (`saved on this device` /
   `saved to account`) instead of a red "offline copy" for every visitor
   without the account server.
5. **Page titles**: pages whose title already names QaraamiGenAI use
   `title.absolute`; the layout template no longer doubles the brand.

## Verified (2026-10-29, local)

- `npm test` in `apps/web`: 121 vitest tests (12 new: pitch 7, generation 5)
  plus the audio-rights node tests, all pass. `tsc --noEmit` clean. Prettier
  clean on changed files. `npm run build` passes, rights gate included.
- Headless Chrome (DevTools protocol), 1440 × 900 and 390 × 844, no horizontal
  scroll: Loops → add a v4 clip → Pitch → Analyse (60 s clip: E suspended
  pentatonic, +4 c, 88 % within ¼ tone, 61 notes, 8 off-scale) → melody track
  added → scale lock set → practice playback at 50 %.
- Live generation with the local stack: 15 s `oud` clip in 34 s, service PCS
  0.95, new audio track; `harvard_raw` and `large` not offered.
- Production build served with `next start`: Generate shows the not-connected
  state, Pitch its empty state.
- Account sync gate (`lib/daw/syncPolicy.ts`, 4 tests, web total 125): a
  production build without `NEXT_PUBLIC_API_URL`, with a stored token, an edit
  and 11 s past the sync timer, made 0 requests to `/api/v1/` (label "saved on
  this device"); the same flow in a build with the URL set made 4
  `/studio/projects` requests.

## Known limitations

- Pitch numbers are browser estimates (YIN), not the paper's CREPE scorer;
  dense mixes with vocals give octave errors and a wide contour. The tonic
  heuristic can disagree with a clip's caption (the test clip "rooted on A"
  fitted E; same pitch-class set). Monophonic oud or voice measures best.
- Analysis spans at most 10 minutes per region; it runs on the main thread in
  chunks (cancellable), not in a worker.
- Practice playback is separate from the transport (no sync with other tracks).
- MIDI cannot hold the measured cents; the melody track rounds to semitones,
  the deviations stay in the Pitch tab.
- Deleting a synced project while signed out removes only the local copy; the
  server copy reappears in the open dialog after signing in.
- ESLint does not run: `eslint-config-next` at the repo root cannot resolve
  `next/dist/compiled/babel/eslint-parser` (Next is only in `apps/web/node_modules`).
  CI does not lint the web app.
- AI service CORS allows `http://localhost:3000` and the old Vercel domain, not
  `qaraamigen.com`; local generation must be opened at `localhost:3000`.

## Next engineering step

Done: account sync only runs when the build has an API server (or is a dev
build) and the visitor is signed in (`canSync()` in `projectStore.ts`). Next: a
Learn panel built only from documented material (the
Beerdilaacshe score and transcription already in `public/`), a worker for the
pitch analysis, and transport-synced slowed playback.
