# QaraamiGenAI Studio — project format (v1)

The studio (the DAW) edits a **plain-data document**. The React UI never touches
audio; it edits this document and sends messages to the engine. The engine
(lib/daw/engine.ts) is the only code that owns an AudioContext. This file is the
contract both sides — and every future tier — build on.

Design rules:

- **All musical time is in BEATS** (floats), never seconds. Tempo changes never
  invalidate a project; the engine converts with `60 / bpm` at schedule time.
- **Additive evolution only.** Later tiers may add fields; they must never
  change the meaning of existing ones. Readers ignore unknown fields; writers
  preserve them (load → edit → save keeps fields v1 doesn't understand).
  `formatVersion` bumps only for breaking shape changes, with a migration.
- **Everything is JSON-serialisable** — no Dates (ISO strings), no Maps, no
  class instances. A project must survive `JSON.parse(JSON.stringify(p))`.

```ts
interface DawProject {
  formatVersion: 1;
  id: string;                       // uuid — stable across local + server copies
  name: string;
  bpm: number;                      // 60–140 (Tier 1 transport range)
  timeSignature: { beatsPerBar: number; beatUnit: number };   // default 4/4
  scaleLock: {
    enabled: boolean;
    root: number;                   // pitch class 0–11 (0 = C)
    mode: 'major-pentatonic' | 'minor-pentatonic' | 'suspended-pentatonic'
        | 'blues-minor-pentatonic' | 'ritusen';
  };
  loop: { enabled: boolean; startBeat: number; endBeat: number };
  metronome: { enabled: boolean; countInBars: 0 | 1 | 2 };
  masterGain: number;               // 0–1.5
  tracks: DawTrack[];
  updatedAt: string;                // ISO — last local edit; sync tie-breaker
}

interface DawTrack {
  id: string;
  name: string;
  instrument: 'oud' | 'durbaan' | 'bass' | 'keys';
  gain: number;                     // 0–1.5 (1 = unity)
  pan: number;                      // -1 … 1
  muted: boolean;
  solo: boolean;
  armed: boolean;                   // record-arm; recording itself lands Tier 2
  regions: DawRegion[];
  // Tier 2+: takes/comping; Tier 3+: inserts, sends, automation — new fields.
}

interface DawRegion {
  id: string;
  kind: 'midi';                     // Tier 2 adds 'audio'
  startBeat: number;                // absolute timeline position
  lengthBeats: number;              // content length BEFORE looping
  loopCount: number;                // ≥1; total span = lengthBeats * loopCount
  notes: DawNote[];                 // startBeat RELATIVE to region start
}

interface DawNote {
  id: string;
  startBeat: number;                // relative to region start, < region length
  lengthBeats: number;
  midi: number;                     // 0–127. Durbaan lanes: 36 dum · 38 tak · 42 slap
  velocity: number;                 // 0–1
}
```

Drum patterns are ordinary MIDI regions: the 16-step sequencer is a *view* that
reads/writes notes quantised to 16ths on the three durbaan lanes. One region
model everywhere; the piano roll and the step grid are just different editors.

## Engine boundary (messages, no audio in UI handlers)

UI → engine: `setProject(project)` (structural edits re-send the whole plain
document — it is small), `play(fromBeat?)`, `stop()`, `setLoop`, `setBpm`,
`setMetronome`, `setTrackMix(trackId, {gain,pan,muted,solo})`,
`auditionNote(instrument, midi)` (piano-roll click preview), `dispose()`.
Engine → UI (subscribe): `position` (beat, ~30 Hz for the playhead),
`state` ('stopped'|'counting'|'playing'), `meters` (per-track RMS).
The engine uses a 25 ms lookahead scheduler with a 150 ms horizon — UI jank
never drops notes. The ONLY audio call allowed in a UI handler is the
first-gesture `engine.unlock()` (browser autoplay policy).

## Instruments (Tier 1)

- **oud** — the shared Karplus-Strong voice from `lib/audio/qaraamiEngine`
  (the Beerdilaacshe engine, reused not duplicated): plucks are rendered once
  per (midi, duration-bucket) into cached AudioBuffers.
- **durbaan** — dum/tak/slap strokes from the same module, cached buffers.
- **bass / keys** — original subtractive voices (oscillator + filter + ADSR),
  polyphonic for keys.

## Export

WAV mixdown re-runs the same scheduling code against an OfflineAudioContext at
44.1 kHz and encodes PCM16 — what you hear is what renders. Stems land Tier 3.

## Persistence & sync

IndexedDB is the source of truth while editing (autosaved, offline-safe);
the server copy (`/api/v1/studio/projects`, Mongo) syncs in the background and
feeds My Studio on the dashboard. Newest `updatedAt` wins on conflict — last
writer takes the project (single-author platform; real merge is a later tier).
