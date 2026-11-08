# Studio v3 — design decisions and the six-week roadmap

Written 2026-11-07 (overnight session, branch `studio-v3`). The question was:
how does QaraamiGenAI become a real studio — "like Logic Pro: the arrange
pane and all that" — where a Somali musician can create, play, learn, listen
and record in the browser; and how does the project put a clean reference
dataset for Somali music AI on Hugging Face. The evidence is in
`docs/research/` (six sourced research notes and the synthesis report
`reports/Somali music studio software research.md`); this file records what
was decided, what was built tonight, and what comes next, in deadline order
(MIT application: 2026-12-23).

## 1. What shipped tonight (branch `studio-v3`, commit `63cf4d1` + docs)

| Area | Shipped | Where |
| --- | --- | --- |
| Shell | Logic's window grammar: control bar with pane toggles (Y / I) and an LCD that now shows the key; a toolbar with the five modes; **Library** rail (Sounds · Loops · Grooves · Scales); tracks area; **Inspector** rail (region · track with insert FX · project); bottom editors (Editor · Play · Record · Learn · Mixer · Pitch · Generate); a GarageBand-style start screen; phone layout with full-screen overlays | `components/daw/{Transport,Toolbar,LibraryRail,Inspector,StartOverlay,DawApp}.tsx` |
| Play | On-screen kaban keyboard (multi-touch, velocity by position, scale-lock tint, scale-only bars) and durbaan pads, on the same note path as musical typing and MIDI | `PlaySurface.tsx`, `lib/daw/playSurface.ts` |
| Learn | Qaamuus reverse dictionary (72 terms, sources, confidence, Hear it); the qaraami scale lesson; the durbaan rhythm lesson with a tap trainer and device calibration; Beerdilaacshe phrase by phrase with play-along scoring; a Radio Hargeysa history lesson | `LearnPanel.tsx`, `LearnRhythm.tsx`, `LearnMelody.tsx`, `lib/learn/*` |
| Listen | Listen mode = the loop browser of every published QaraamiGen generation docked as the Library's Loops tab, with the Pitch analyser below | `LibraryRail.tsx` (existing `LoopBrowser`) |
| Record | Guided flow: microphone check with a live meter (new engine input-check API), target track, count-in and click, record, takes with Pitch / Rename / Delete | `RecordPanel.tsx`, `lib/daw/recordFlow.ts`, `lib/daw/engine.ts` |
| Dataset | `build_hf_dataset.py` assembles a rights-clean Hugging Face dataset (model output already public, the synthetic transcription benchmark with ground truth, the engraved Beerdilaacshe score, listening-study records, the glossary, releasable model cards) into `dist/hf_dataset/`, with a deny-list, `--check`, tests and a `--push` the owner runs | `apps/ai-service/scripts/build_hf_dataset.py`, `docs/data/HF_DATASET.md` |
| Verification | 241 web tests + 9 rights tests, tsc, Prettier, production build with the rights gate; Chrome at 1440 px; headless Chrome at 390 and 414 px (no sideways scroll, 0 console errors) | `apps/web/scripts/studio-mobile-check.mjs` |

Nothing was pushed, deployed or published; `master` and the live site are untouched.

## 2. Decisions, with the research behind them

**Window anatomy — copy Logic's grammar, not its pixels.** Apple publishes no
widths, radii or colours, but the grammar is stable across Logic Pro 13 and
Logic for iPad: control bar (pane toggles + transport + LCD) → toolbar → a
left slot (Browser/Inspector) → tracks area → one bottom editor chosen by the
selection, every area on a single-letter toggle. We built exactly that, with
the project's own tokens (`--studio-library-rail` 280 px, `--studio-inspector-rail`
320 px, 4 px radii, hairlines). The LCD gained a key cell because Logic's LCD
edits tempo, key and signature in place. *(Logic/GarageBand note §§1–4, 7.)*

**Phones get Logic-for-iPad's condensation, not a smaller desktop.** The iPad
app keeps one exclusive left slot, one centre, a resizable bottom stack, and
44 pt targets; we made the rails full-screen overlays below 768 px, modes close
what they do not need, and the bottom tabs scroll. The remaining gap is the
control bar wrapping to four rows — the next layout job. *(§7.)*

**Scales are first-class and Apple's are not.** Apple's scale vocabulary is a
fixed 12-TET list and the only microtonal hook is a per-semitone cent table;
GarageBand's song key is major/minor only. Qaraami needs the five pentatonic
rotations with a root, measured tuning in cents and "off-scale marked, not
snapped" — which the Pitch tab, the scale lock, the Scales tab and the
scale-only keyboard now give. This is a real differentiator to state in the
application. *(§8; Pitch tab in STUDIO.md.)*

**Learning: feedback with knowledge of results, slowed looping, honest
thresholds.** The only strong controlled evidence (Blanco, Tassani & Ramirez
2021, n = 47) says real-time pitch feedback helps *when it says right/wrong*
and transfers; contour alone did not. Vendors publish no tolerances; the only
published timing windows are rhythm games' (±50 → ±120 ms). We therefore score
pitch by pitch class (octave-tolerant: oud and voice sit in different octaves),
timing within an eighth note, and taps within 120 ms with a green ≤ 50 ms
band — and we show the early/late bias rather than just a score. Slow-down
floors in the market are 50 % (flowkey) to 25 % (Soundslice); ours offers
50/75/100 with loop. *(Music-learning note §§1, 3–5.)*

**Measure the device, don't trust it.** Browser round-trip latency is tens of
milliseconds and differs by browser (MacBook Pro 2021: Chrome 52 ms, Firefox
39, Safari 100; Windows up to 105 ms); `outputLatency` under-reports and only
became Baseline in 2025. The tap trainer's Calibrate subtracts the measured
mean offset; the engineering recommendation is a one-click loopback (MLS)
calibration stored per device. *(Browser-DAW note §4; learning note §5.)*

**Engine: keep native nodes now, move the scheduler to a Worker next, WASM
only for ported code.** Every documented browser DAW converges on one
AudioWorklet engine with a transactional project model; but the one controlled
benchmark found plain-JS worklets competitive with WASM. Our Karplus–Strong oud
and modal durbaan fit a JS worklet; what we must change first is the
look-ahead timer (a Web Worker survives tab throttling) and audio storage
(OPFS streaming instead of decoded buffers, ≈23 MB per stereo minute).
*(Browser-DAW note §§1–3, 9–10.)*

**Record like a DAW: raw input, compensation, monitoring off by default.**
`echoCancellation/noiseSuppression/autoGainControl` off and `latencyHint:
'interactive'` are what the engine already does; commercial web DAWs misalign
takes by −8 … −194 ms when they estimate instead of measuring. The Record
panel's meter and monitor toggle are the GarageBand-style on-ramp. *(§4.)*

**Qaamuus: a reverse dictionary built on sources, with an honesty flag.** The
glossary carries `attested / reported / uncertain` per entry and shows it; the
musicology note's review (corrections, sources, additions) is the next content
step. The Somali-language theory vocabulary that is documented is small
(laxan, luuq, cod, miisaan, higgaad, garaac, dhawaaq); mode names are a
convenience and the lesson says so. *(Musicology note; glossary.json.)*

**Dataset: public = model output, synthetic, symbolic, annotations — and say
what is absent.** Harvard Loeb recordings are research-only until the letter;
the performer's corpus is consented for training, not redistribution. The
card therefore leads with what is deliberately missing and why, licenses per
subset (MusicGen-derived output CC BY-NC 4.0; ACE-Step output, glossary,
synthetic set, records CC BY 4.0; engraving credited to the composer with the
copyright status flagged), uses README `configs` + audiofolder `metadata.jsonl`
so the Hub viewer works without a script, and ships the generator and the
evaluation conventions (mir_eval 50 ms / 50 cents) so it can be a benchmark.
*(HF note; `docs/data/HF_DATASET.md`.)*

## 3. Roadmap to 2026-12-23 (six weeks)

Ranked by application impact. Weeks are calendar weeks starting Monday 2026-11-10.

1. **Week 1 — ship and publish.** Khalid: review `studio-v3` at
   `http://127.0.0.1:3100/studio` (or `npm run build && npm start` in the
   worktree), merge to `master`, push, verify live at 390 px. Apply the glossary
   review (corrections + ~40 sourced additions) and re-run `build_hf_dataset.py`;
   `hf auth login`; push the dataset **private**, review the card on the Hub,
   flip to public; mint the DOI; add the citation to the README.
2. **Week 2 — the listening study and the trainers' honesty.** Connect Upstash
   for `/study`, send it to 10–20 musicians (CLAUDE.md Left 0). Add loopback
   latency calibration and the phone control bar. Pitch analysis in a worker.
3. **Week 3 — Somali ground truth.** A musician corrects the five annotation
   packs so Qormada is scored on Somali recordings (the dataset's biggest
   missing subset is *annotated Somali audio*; the consented corpus can carry
   annotations + model output even where audio cannot).
4. **Week 4 — kaban fretboard and ear training.** Fretboard play surface with
   courses in fourths; call-and-response exercises (reference-free scoring
   against the pentatonic grid, which the research recommends for the oud).
5. **Week 5 — paper and statement.** The paper's §2 citation check, the
   `TODO —` blocks, the research statement's three-track framing with the
   studio and dataset as artefacts; model cards for every served adapter.
6. **Week 6 — buffer.** Application package only.

## 4. Decisions only Khalid can make

- Publish the dataset (namespace, name, private → public). The written consent
  record comes first, and the study clips wait for the study to close
  (`docs/data/HF_DATASET.md` §4). Settled 2026-11-08: the Beerdilaacshe engraving
  is left out of the dataset unless the build is given `--include-symbolic`.
- Done 2026-11-08: `studio-v3` merged to `master`, on Khalid's instruction.
- Which glossary corrections from the musicology note to accept where the
  sources disagree (dhaanto's metre: 4/4 with claps vs a 6/8 feel; several
  dates).
- Whether the studio's Learn mode may cite the Listen page's Radio Hargeysa
  biographies verbatim (it paraphrases them now).
