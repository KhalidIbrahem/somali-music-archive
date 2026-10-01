# QaraamiGenAI Studio — project format (v1, Studio v2 additions)

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
  markers?: DawMarker[];            // Studio v2 — absent = none
  tracks: DawTrack[];
  updatedAt: string;                // ISO — last local edit; sync tie-breaker
}

interface DawTrack {
  id: string;
  name: string;
  kind?: 'midi' | 'audio';          // Studio v2 — absent = 'midi' (read with trackKind())
  audioRegions?: DawAudioRegion[];  // Studio v2 — audio tracks; absent = none
  fx?: TrackFx;                     // Studio v2 — absent = DEFAULT_FX (read with trackFx())
  instrument: 'oud' | 'durbaan' | 'bass' | 'keys';   // ignored for audio tracks
  gain: number;                     // 0–1.5 (1 = unity)
  pan: number;                      // -1 … 1
  muted: boolean;
  solo: boolean;
  armed: boolean;                   // record-arm (audio tracks record from the microphone)
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

// ── Studio v2 (all optional on the track/project — v1 documents stay valid) ──

interface DawAudioRegion {
  id: string;
  kind: 'audio';
  name: string;
  startBeat: number;                // absolute timeline position
  lengthBeats: number;              // visible length of ONE pass (may trim the file)
  loopCount: number;                // ≥1; each pass replays [offsetSec, offsetSec + lengthBeats)
  source: string;                   // 'idb:<id>' (this browser's audio store) or a same-origin URL
  offsetSec: number;                // where in the file playback starts
  gain: number;                     // linear clip gain, 0–2
  fadeInSec: number;                // at the region's first pass
  fadeOutSec: number;               // at the region's last pass
}

interface TrackFx {
  eq: { low: number; mid: number; high: number };   // dB, −12…+12
  comp: { enabled: boolean; thresholdDb: number; ratio: number };  // −60…0 dB, 1…20
  reverbSend: number;               // 0–1, post-fader send to the shared reverb
}
// DEFAULT_FX = { eq: 0/0/0, comp: { enabled: false, thresholdDb: -18, ratio: 3 }, reverbSend: 0.1 }

interface DawMarker { id: string; beat: number; name: string }
```

Readers that predate Studio v2 ignore `kind`, `audioRegions`, `fx` and
`markers` (the additive rule); an audio track then looks like an empty MIDI
track. Out-of-range FX values are clamped by the engine (`resolveFx`), never
rejected.

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

### Engine API added in Studio v2 (lib/daw/engine.ts)

- `loadAudio(source): Promise<{ durationSec }>` — fetch + decode + cache by
  `source`; `getPeaks(source, buckets): Float32Array | null` — absolute peak
  (0…1, max over channels) per bucket, cached; `subscribeAudio(fn)` fires when
  a source finishes decoding; `getAudioBuffer(source)`.
- `getLevels(): { master: { peakDb, rmsDb }, tracks: Record<id, { peakDb, rmsDb }> }`
  — post-fader/post-pan per track, post-limiter for master, dBFS floored at −96.
- `startRecording(trackId)` / `stopRecording(): Promise<RecordedTake>` —
  `{ trackId, source: 'idb:<id>', name, durationSec, startBeat }`;
  `onRecordingComplete(fn)`, `isRecording()`, `setInputMonitoring(on)` (off by
  default). `stop()` during a take finishes it.
- `renderMix(project, { tracks? }): Promise<AudioBuffer>` — offline render
  through the full graph; `renderMixdown(project)` = `renderMix(project)`.

## Audio regions (Studio v2)

Scheduling math lives in `lib/daw/audioSchedule.ts` (pure, unit-tested):
each loop pass is a segment at `(startBeat + pass·lengthBeats)·60/bpm`
seconds playing the file from `offsetSec` for `lengthBeats·60/bpm` seconds
(less if the file ends first — the rest of the pass is silent). The region's
fades shape its outer edges; pass joins, seeks into the middle of a region and
loop-range wraps get a 4 ms de-click ramp. Playing from inside a region (or
looping back into one) starts the file at the matching offset. Audio sources
are tracked: editing an audio region, adding a track or a late decode during
playback fades the live clips and restarts them from just ahead of now.

Sources: `idb:<id>` blobs live in IndexedDB database `qaraami-studio-audio`
(store `audio`; `lib/daw/audioStore.ts`: `putAudio`, `getAudio`,
`deleteAudio`, `listAudio`). They exist only in the browser that recorded or
imported them — a project opened elsewhere plays those regions silent. Any
other `source` is fetched as a **same-origin** URL (other origins are refused).

## Mix graph (Studio v2)

Per track: input → EQ (low shelf 200 Hz, peaking 1 kHz Q 0.9, high shelf
5 kHz) → compressor on a parallel path, switched by a dry/wet crossfade →
fader (`gain`) → mute/solo gate → pan → meter → master bus, plus a post-pan
send (`fx.reverbSend`) to one shared reverb (ConvolverNode, generated stereo
impulse, ~2.2 s to −60 dB). Master: `masterGain` → limiter
(DynamicsCompressor −1 dB, 20:1, 1 ms attack, 100 ms release) → destination.
Every live change ramps with `setTargetAtTime` (20 ms); nothing is rebuilt on
a parameter edit.

## Recording (Studio v2)

`startRecording` opens the microphone (echo cancellation, noise suppression
and AGC off), captures it sample-accurately in an AudioWorklet (mono), and
starts the transport from the playhead with the project's count-in. On stop,
the capture is trimmed so the take lines up with the timeline: frames before
`epoch + outputLatency + baseLatency` are dropped (epoch = the context time of
the start beat). The take is encoded as 16-bit WAV, stored with `putAudio`,
and `useRecordingTakes` (mounted in DawApp) adds it as an audio region on the
armed track at the take's start beat. A take is linear even when the loop is
on. Input monitoring is off by default.

## Instruments (Tier 1)

- **oud** — the shared Karplus-Strong voice from `lib/audio/qaraamiEngine`
  (the Beerdilaacshe engine, reused not duplicated): plucks are rendered once
  per (midi, duration-bucket) into cached AudioBuffers.
- **durbaan** — dum/tak/slap strokes from the same module, cached buffers.
- **bass / keys** — original subtractive voices (oscillator + filter + ADSR),
  polyphonic for keys.

## Export

WAV mixdown re-runs the same scheduling code against an OfflineAudioContext at
44.1 kHz and encodes PCM16 — what you hear is what renders. Studio v2:
`renderMix(project, { tracks? })` builds the same FX graph (inserts, reverb,
master gain and limiter) offline, renders from beat 0 (sample 0 = beat 0, loop
range ignored) and adds a 2.7 s tail. Without `tracks` mute/solo apply; with
`tracks` exactly those tracks render and their mute/solo flags are ignored —
call it once per track for stems.

## Persistence & sync

IndexedDB is the source of truth while editing (autosaved, offline-safe);
the server copy (`/api/v1/studio/projects`, Mongo) syncs in the background and
feeds My Studio on the dashboard. Newest `updatedAt` wins on conflict — last
writer takes the project (single-author platform; real merge is a later tier).
