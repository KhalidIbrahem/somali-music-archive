'use client';

/**
 * DawApp (Studio v2) — the studio's root: owns the plain-data project, the
 * undo history, the engine instance, selection (regions, notes, track),
 * view state (zoom, track height, snap), keyboard shortcuts, musical typing,
 * Web MIDI input, recording, autosave (IndexedDB, 1.5 s debounce) and
 * background server sync (8 s debounce).
 *
 * The single edit path is `commitProject(next, coalesceKey?)`: every edit —
 * a mutate-a-draft `update`, or a pure operation from lib/daw/editOps — lands
 * there, is pushed to the history (drags coalesce into one step), handed to
 * the engine and scheduled for saving. The engine is created once and only
 * ever touched from handlers/effects — never during render.
 */

import { registerAudioStore } from '@/lib/daw/loops';
import { putAudio } from '@/lib/daw/audioStore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DawEngine, type EngineSnapshot, type RecordedTake } from '@/lib/daw/engine';
import {
  cloneProject,
  newAudioRegion,
  newAudioTrack,
  newProject,
  newTrack,
  projectEndBeat,
  trackKind,
  type DawAudioRegion,
  type DawProject,
  type DawRegion,
  type DawTrack,
  type InstrumentId,
} from '@/lib/daw/types';
import { buildDemoProject, DEMO_PROJECT_NAME } from '@/lib/daw/demoProject';
import {
  combinedList,
  openProject,
  pushToServer,
  removeProject,
  saveLocal,
  type ProjectListing,
} from '@/lib/daw/projectStore';
import { audioBufferToWav, downloadBlob } from '@/lib/daw/wav';
import { useRecordingTakes } from '@/lib/daw/useRecordingTakes';
import {
  canRedo,
  canUndo,
  commit,
  initHistory,
  redo as historyRedo,
  replacePresent,
  undo as historyUndo,
  type HistoryState,
} from '@/lib/daw/history';
import {
  addMarker,
  adjacentMarkerBeat,
  buildRecordedRegion,
  copyNotes,
  copyRegions,
  cutRegions,
  deleteNotes,
  deleteRegions,
  duplicateRegions,
  findRegion,
  insertAudioRegion,
  isAudioRegion,
  joinRegions,
  moveNotes,
  pasteNotes,
  pasteRegions,
  pruneSelection,
  quantizeNotes,
  quantizeRegions,
  selectAllRegions,
  snapBeats,
  splitRegionsAt,
  type EditResult,
  type NoteClipboard,
  type RecordedNote,
  type RegionClipboard,
  type RegionRef,
  type SnapValue,
} from '@/lib/daw/editOps';
import { matchShortcut, SHORTCUT_GROUPS, SHORTCUTS, type ShortcutId } from '@/lib/daw/shortcuts';
import {
  DEFAULT_TYPING,
  lockToScale,
  parseMidiMessage,
  typingControl,
  typingNote,
  type TypingState,
} from '@/lib/daw/musicalTyping';
import { midiName } from '@/lib/daw/scales';
import { engineExtras, settle } from '@/lib/daw/engineAdapter';
import { Transport } from './Transport';
import { ArrangeView } from './ArrangeView';
import { PianoRoll } from './PianoRoll';
import { StepSequencer } from './StepSequencer';
import { Mixer } from './Mixer';
// studio-io: content & import/export
import { LoopBrowser, loopDropHandlers } from './LoopBrowser';
import { ImportMenu } from './ImportMenu';
import { ExportDialog } from './ExportDialog';

/** A selected region (kept under its v1 name for existing importers). */
export type Selection = RegionRef;

export type UpdateFn = (mutate: (draft: DawProject) => void, coalesceKey?: string) => void;
export type CommitFn = (next: DawProject, coalesceKey?: string) => void;

export interface ViewState {
  pxPerBeat: number;
  trackHeight: number;
  snap: SnapValue;
}

export interface RecordingInfo {
  trackIds: string[];
  startBeat: number;
}

type BottomTab = 'editor' | 'mixer';
type FocusArea = 'arrange' | 'editor';

export const ZOOM_MIN = 6;
export const ZOOM_MAX = 240;
export const TRACK_H_MIN = 36;
export const TRACK_H_MAX = 140;

interface TakeState {
  startBeat: number;
  midiTrackId: string | null;
  audioTrackId: string | null;
  notes: RecordedNote[];
  held: Map<number, { startBeat: number; velocity: number }>;
}

function isRecordedTake(value: unknown): value is RecordedTake {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<Record<keyof RecordedTake, unknown>>;
  return (
    typeof v.source === 'string' &&
    typeof v.name === 'string' &&
    typeof v.durationSec === 'number' &&
    typeof v.startBeat === 'number'
  );
}

export function DawApp(): React.JSX.Element {
  const search = useSearchParams();
  // One engine per mounted studio; the lazy initializer keeps construction
  // out of re-renders without touching a ref during render.
  const [engine] = useState(() => new DawEngine());

  const [project, setProject] = useState<DawProject | null>(null);
  const [selection, setSelection] = useState<RegionRef[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [focusArea, setFocusArea] = useState<FocusArea>('arrange');
  const [view, setView] = useState<ViewState>({ pxPerBeat: 28, trackHeight: 64, snap: 'beat' });
  const [quantizeStrength, setQuantizeStrength] = useState(1);
  const [tab, setTab] = useState<BottomTab>('editor');
  const [bottomH, setBottomH] = useState(300);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'offline'>('saved');
  const [transport, setTransport] = useState<EngineSnapshot>({ state: 'stopped', beat: 0 });
  const [exporting, setExporting] = useState(false);
  const [openList, setOpenList] = useState<ProjectListing[] | null>(null);
  // studio-io: loop browser panel + export dialog
  const [loopsOpen, setLoopsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [undoState, setUndoState] = useState({ undo: false, redo: false });
  const [showHelp, setShowHelp] = useState(false);
  const [typingOn, setTypingOn] = useState(false);
  const [typing, setTyping] = useState<TypingState>(DEFAULT_TYPING);
  const [heldNotes, setHeldNotes] = useState<number[]>([]);
  const [midiStatus, setMidiStatus] = useState<'off' | 'unavailable' | 'denied' | number>('off');
  const [recording, setRecording] = useState<RecordingInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const projectRef = useRef<DawProject | null>(null);
  const historyRef = useRef<HistoryState<DawProject> | null>(null);
  const regionClipRef = useRef<RegionClipboard | null>(null);
  const noteClipRef = useRef<NoteClipboard | null>(null);
  const takeRef = useRef<TakeState | null>(null);
  const typingKeysRef = useRef(new Map<string, number>());
  const localTimer = useRef(0);
  const serverTimer = useRef(0);
  const noticeTimer = useRef(0);

  const flash = useCallback((message: string): void => {
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2600);
  }, []);

  // ── persistence ────────────────────────────────────────────────────────────
  const scheduleSave = useCallback((next: DawProject): void => {
    setSaveState('saving');
    window.clearTimeout(localTimer.current);
    localTimer.current = window.setTimeout(() => {
      void saveLocal(next).then(() => setSaveState('saved'));
    }, 1500);
    window.clearTimeout(serverTimer.current);
    serverTimer.current = window.setTimeout(() => {
      void pushToServer(next.id)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('offline'));
    }, 8000);
  }, []);

  /** Replace the open document (open/new/boot) — resets history + selection. */
  const loadProject = useCallback(
    (loaded: DawProject): void => {
      projectRef.current = loaded;
      historyRef.current = initHistory(loaded);
      setUndoState({ undo: false, redo: false });
      setProject(loaded);
      setSelection([]);
      setSelectedNoteIds([]);
      setSelectedTrackId(loaded.tracks[0]?.id ?? null);
      engine.setProject(loaded);
    },
    [engine],
  );

  // ── boot: ?project=id, else the Beerdilaacshe demo ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    const requested = search.get('project');
    void (async () => {
      let loaded: DawProject | null = null;
      if (requested !== null) loaded = await openProject(requested).catch(() => null);
      if (loaded === null) {
        const existing = await combinedList().catch(() => []);
        const demo = existing.find((p) => p.name === DEMO_PROJECT_NAME);
        if (requested === null && demo) loaded = await openProject(demo.id).catch(() => null);
      }
      if (loaded === null) loaded = await buildDemoProject().catch(() => newProject('Untitled'));
      if (cancelled || loaded === null) return;
      loadProject(loaded);
      void saveLocal(loaded);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => engine.subscribe(setTransport), [engine]);
  useEffect(() => () => engine.dispose(), [engine]);

  // ── the single edit path ───────────────────────────────────────────────────
  const commitProject = useCallback<CommitFn>(
    (next, coalesceKey) => {
      next.updatedAt = new Date().toISOString();
      projectRef.current = next;
      const history = historyRef.current ?? initHistory(next);
      historyRef.current = commit(history, next, { coalesceKey });
      setUndoState({ undo: canUndo(historyRef.current), redo: false });
      setProject(next);
      engine.setProject(next);
      scheduleSave(next);
    },
    [engine, scheduleSave],
  );

  const update = useCallback<UpdateFn>(
    (mutate, coalesceKey) => {
      const current = projectRef.current;
      if (current === null) return;
      const draft = cloneProject(current);
      mutate(draft);
      commitProject(draft, coalesceKey);
    },
    [commitProject],
  );

  const applyEdit = useCallback(
    (op: (p: DawProject) => EditResult, coalesceKey?: string): void => {
      const current = projectRef.current;
      if (current === null) return;
      const result = op(current);
      commitProject(result.project, coalesceKey);
      setSelection(result.selection);
    },
    [commitProject],
  );

  const restore = useCallback(
    (step: (h: HistoryState<DawProject>) => HistoryState<DawProject>): void => {
      const history = historyRef.current;
      if (history === null) return;
      const moved = step(history);
      if (moved === history) return;
      // Re-stamp so newest-wins sync keeps the undone state.
      const stamped: DawProject = { ...moved.present, updatedAt: new Date().toISOString() };
      historyRef.current = replacePresent(moved, stamped);
      projectRef.current = stamped;
      setUndoState({ undo: canUndo(moved), redo: canRedo(moved) });
      setProject(stamped);
      engine.setProject(stamped);
      setSelection((sel) => pruneSelection(stamped, sel));
      scheduleSave(stamped);
    },
    [engine, scheduleSave],
  );
  const undo = useCallback(() => restore(historyUndo), [restore]);
  const redo = useCallback(() => restore(historyRedo), [restore]);

  // ── derived selection ──────────────────────────────────────────────────────
  const liveSelection = useMemo(
    () => (project ? pruneSelection(project, selection) : []),
    [project, selection],
  );
  const primary = liveSelection[liveSelection.length - 1] ?? null;
  const primaryFound = project && primary ? findRegion(project, primary) : null;
  const primaryMidi: { track: DawTrack; region: DawRegion } | null =
    primaryFound && primaryFound.region.kind === 'midi'
      ? { track: primaryFound.track, region: primaryFound.region }
      : null;
  const primaryAudio: { track: DawTrack; region: DawAudioRegion } | null =
    primaryFound && primaryFound.region.kind === 'audio'
      ? { track: primaryFound.track, region: primaryFound.region }
      : null;

  const selectRegions = useCallback((refs: RegionRef[]): void => {
    setSelection(refs);
    const last = refs[refs.length - 1];
    if (last) setSelectedTrackId(last.trackId);
    setSelectedNoteIds([]);
  }, []);

  // ── transport helpers ──────────────────────────────────────────────────────
  const seek = useCallback((beat: number): void => engine.seek(Math.max(0, beat)), [engine]);

  // ── note input (musical typing + Web MIDI) and recording ───────────────────
  const inputInstrument = useCallback((): InstrumentId => {
    const p = projectRef.current;
    if (!p) return 'keys';
    const take = takeRef.current;
    const candidates: (DawTrack | undefined)[] = [
      take?.midiTrackId ? p.tracks.find((t) => t.id === take.midiTrackId) : undefined,
      p.tracks.find((t) => t.id === selectedTrackId),
      p.tracks.find((t) => t.armed && trackKind(t) === 'midi'),
      p.tracks.find((t) => trackKind(t) === 'midi'),
    ];
    const track = candidates.find((t) => t !== undefined && trackKind(t) === 'midi');
    return track?.instrument ?? 'keys';
  }, [selectedTrackId]);

  const noteOn = useCallback(
    (rawMidi: number, velocity: number): void => {
      const p = projectRef.current;
      if (!p) return;
      const midi = lockToScale(rawMidi, p.scaleLock);
      engine.audition(inputInstrument(), midi, velocity);
      setHeldNotes((held) => (held.includes(midi) ? held : [...held, midi]));
      const take = takeRef.current;
      if (take?.midiTrackId) {
        take.held.set(midi, { startBeat: engine.currentBeat(), velocity });
      }
    },
    [engine, inputInstrument],
  );

  const noteOff = useCallback(
    (rawMidi: number): void => {
      const p = projectRef.current;
      if (!p) return;
      const midi = lockToScale(rawMidi, p.scaleLock);
      setHeldNotes((held) => held.filter((m) => m !== midi));
      const take = takeRef.current;
      const started = take?.held.get(midi);
      if (take && started) {
        const now = engine.currentBeat();
        take.held.delete(midi);
        take.notes.push({
          midi,
          velocity: started.velocity,
          startBeat: started.startBeat,
          // Wrapped around the cycle → keep a short note rather than a negative one.
          endBeat: now > started.startBeat ? now : started.startBeat + 0.25,
        });
      }
    },
    [engine],
  );
  useRecordingTakes(engine, update);
  // Imported audio files persist in IndexedDB (lib/daw/audioStore.ts), not as session-only URLs.
  useEffect(() => {
    registerAudioStore({ put: putAudio });
    return () => registerAudioStore(null);
  }, []);

  const startRecording = useCallback((): void => {
    const p = projectRef.current;
    if (!p) return;
    let midiTrack = p.tracks.find((t) => t.armed && trackKind(t) === 'midi') ?? null;
    const audioTrack = p.tracks.find((t) => t.armed && trackKind(t) === 'audio') ?? null;
    if (!midiTrack && !audioTrack) {
      const selected = p.tracks.find((t) => t.id === selectedTrackId);
      if (selected && trackKind(selected) === 'midi') {
        midiTrack = selected;
        update((draft) => {
          const t = draft.tracks.find((x) => x.id === selected.id);
          if (t) t.armed = true;
        });
      } else {
        flash('Arm a track (●) to record into it');
        return;
      }
    }
    const extras = engineExtras(engine);
    if (audioTrack && !extras.startRecording) {
      flash('Audio recording is not available in this build yet');
      if (!midiTrack) return;
    }
    const startBeat = transport.beat;
    const take: TakeState = {
      startBeat,
      midiTrackId: midiTrack?.id ?? null,
      audioTrackId: audioTrack && extras.startRecording ? audioTrack.id : null,
      notes: [],
      held: new Map(),
    };
    takeRef.current = take;
    // Record always clicks and counts in (the project's count-in length).
    const current = projectRef.current ?? p;
    engine.setProject({ ...current, metronome: { ...current.metronome, enabled: true } });
    engine.play(startBeat);
    if (take.audioTrackId !== null) {
      void settle(extras.startRecording?.(take.audioTrackId)).catch(() =>
        flash('Microphone unavailable'),
      );
    }
    setRecording({
      trackIds: [take.midiTrackId, take.audioTrackId].filter(
        (id): id is string => typeof id === 'string',
      ),
      startBeat,
    });
  }, [engine, flash, selectedTrackId, transport.beat, update]);

  const stopRecording = useCallback((): void => {
    const take = takeRef.current;
    if (!take) return;
    const endBeat = engine.currentBeat();
    takeRef.current = null;
    engine.stop();
    setRecording(null);
    setHeldNotes([]);
    for (const [midi, started] of take.held) {
      take.notes.push({ midi, velocity: started.velocity, startBeat: started.startBeat, endBeat });
    }
    const p = projectRef.current;
    if (!p) return;
    engine.setProject(p);
    let next = p;
    const newSelection: RegionRef[] = [];
    if (take.midiTrackId !== null) {
      const region = buildRecordedRegion(take.notes, p.timeSignature.beatsPerBar);
      if (region) {
        next = cloneProject(next);
        next.tracks.find((t) => t.id === take.midiTrackId)?.regions.push(region);
        newSelection.push({ trackId: take.midiTrackId, regionId: region.id });
      } else {
        flash('Nothing recorded — play musical typing (⌘K) or a MIDI keyboard');
      }
    }
    const finish = (final: DawProject): void => {
      if (final !== p) {
        commitProject(final);
        setSelection(newSelection);
      }
    };
    const audioTrackId = take.audioTrackId;
    if (audioTrackId === null) {
      finish(next);
      return;
    }
    const extras = engineExtras(engine);
    void settle(extras.stopRecording?.())
      .then((result) => {
        // The engine resolves a RecordedTake; turn it into a region here so the
        // commit below includes it (useRecordingTakes skips takes already placed).
        const region = isAudioRegion(result)
          ? result
          : isRecordedTake(result)
            ? newAudioRegion(
                result.source,
                result.name,
                result.startBeat,
                result.durationSec / (60 / next.bpm),
              )
            : null;
        if (region !== null) {
          const inserted = insertAudioRegion(next, audioTrackId, region);
          newSelection.push(...inserted.selection);
          finish(inserted.project);
        } else {
          finish(next);
        }
      })
      .catch(() => finish(next));
  }, [commitProject, engine, flash]);

  const toggleRecording = useCallback((): void => {
    if (takeRef.current) stopRecording();
    else startRecording();
  }, [startRecording, stopRecording]);

  const togglePlay = useCallback((): void => {
    if (takeRef.current) {
      stopRecording();
      return;
    }
    if (transport.state === 'stopped') engine.play(transport.beat);
    else engine.stop();
  }, [engine, stopRecording, transport]);

  // Web MIDI — enabled from the transport (browsers ask permission).
  const midiHandlers = useRef({ noteOn, noteOff });
  useEffect(() => {
    midiHandlers.current = { noteOn, noteOff };
  });
  const enableMidi = useCallback((): void => {
    if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
      setMidiStatus('unavailable');
      flash('This browser has no Web MIDI — use musical typing (⌘K)');
      return;
    }
    navigator
      .requestMIDIAccess()
      .then((access) => {
        const bind = (): void => {
          let count = 0;
          access.inputs.forEach((input) => {
            count += 1;
            input.onmidimessage = (event: MIDIMessageEvent) => {
              const parsed = parseMidiMessage(event.data);
              if (parsed?.type === 'on') midiHandlers.current.noteOn(parsed.midi, parsed.velocity);
              if (parsed?.type === 'off') midiHandlers.current.noteOff(parsed.midi);
            };
          });
          setMidiStatus(count);
        };
        bind();
        access.onstatechange = bind;
      })
      .catch(() => {
        setMidiStatus('denied');
        flash('MIDI access was not granted');
      });
  }, [flash]);

  // ── edit commands (shared by shortcuts and toolbars) ───────────────────────
  const gridBeats = project ? (snapBeats(view.snap, project.timeSignature) ?? 0.25) : 1;
  const secPerBeat = project ? 60 / project.bpm : 0.5;
  const editorFocused = tab === 'editor' && focusArea === 'editor';
  const editingNotes = editorFocused && primaryMidi !== null && primary !== null;

  const commands = {
    split: (): void => {
      if (liveSelection.length === 0) return;
      applyEdit((p) => splitRegionsAt(p, liveSelection, transport.beat, secPerBeat));
    },
    duplicate: (): void => {
      if (liveSelection.length > 0) applyEdit((p) => duplicateRegions(p, liveSelection));
    },
    join: (): void => {
      if (liveSelection.length > 1) applyEdit((p) => joinRegions(p, liveSelection));
    },
    deleteRegions: (): void => {
      if (liveSelection.length > 0) applyEdit((p) => deleteRegions(p, liveSelection));
    },
    loop: (delta: number): void => {
      if (liveSelection.length === 0) return;
      update((draft) => {
        for (const ref of liveSelection) {
          const found = findRegion(draft, ref);
          if (found) found.region.loopCount = Math.max(1, found.region.loopCount + delta);
        }
      });
    },
    quantize: (): void => {
      if (!project) return;
      if (editingNotes && primary && selectedNoteIds.length > 0) {
        commitProject(
          quantizeNotes(project, primary, selectedNoteIds, gridBeats, quantizeStrength),
        );
      } else if (editingNotes && primary) {
        commitProject(quantizeNotes(project, primary, null, gridBeats, quantizeStrength));
      } else if (liveSelection.length > 0) {
        commitProject(quantizeRegions(project, liveSelection, gridBeats, quantizeStrength));
      } else {
        return;
      }
      flash(
        `Quantized to ${view.snap === 'off' ? '1/16' : view.snap} at ${Math.round(
          quantizeStrength * 100,
        )}%`,
      );
    },
    addMarker: (): void => {
      const p = projectRef.current;
      if (!p) return;
      commitProject(addMarker(p, transport.beat).project);
    },
    addMidiTrack: (instrument: InstrumentId): void => {
      const count =
        (project?.tracks.filter((t) => t.instrument === instrument && trackKind(t) === 'midi')
          .length ?? 0) + 1;
      const track = newTrack(
        `${instrument[0]?.toUpperCase()}${instrument.slice(1)} ${count}`,
        instrument,
      );
      update((draft) => {
        draft.tracks.push(track);
      });
      setSelectedTrackId(track.id);
    },
    addAudioTrack: (): void => {
      const count = (project?.tracks.filter((t) => trackKind(t) === 'audio').length ?? 0) + 1;
      const track = newAudioTrack(`Audio ${count}`);
      update((draft) => {
        draft.tracks.push(track);
      });
      setSelectedTrackId(track.id);
    },
    zoom: (factor: number): void =>
      setView((v) => ({
        ...v,
        pxPerBeat: Math.min(
          ZOOM_MAX,
          Math.max(ZOOM_MIN, Math.round(v.pxPerBeat * factor * 100) / 100),
        ),
      })),
  };

  /** Returns whether the shortcut did something (so unhandled keys keep defaults). */
  const runShortcut = (id: ShortcutId): boolean => {
    const p = projectRef.current;
    if (!p) return false;
    const beatsPerBar = p.timeSignature.beatsPerBar;
    switch (id) {
      case 'play':
        togglePlay();
        return true;
      case 'toStart':
        engine.returnToStart();
        return true;
      case 'record':
        toggleRecording();
        return true;
      case 'cycle':
        update((draft) => {
          draft.loop.enabled = !draft.loop.enabled;
          if (draft.loop.endBeat <= draft.loop.startBeat) {
            draft.loop.startBeat = 0;
            draft.loop.endBeat = beatsPerBar * 2;
          }
        });
        return true;
      case 'metronome':
        update((draft) => {
          draft.metronome.enabled = !draft.metronome.enabled;
        });
        return true;
      case 'barBack': {
        const bar = transport.beat / beatsPerBar;
        const onLine = Math.abs(bar - Math.round(bar)) < 1e-3;
        seek((onLine ? Math.round(bar) - 1 : Math.floor(bar)) * beatsPerBar);
        return true;
      }
      case 'barForward':
        seek((Math.floor(transport.beat / beatsPerBar + 1e-3) + 1) * beatsPerBar);
        return true;
      case 'prevMarker':
      case 'nextMarker': {
        const beat = adjacentMarkerBeat(p, transport.beat, id === 'nextMarker' ? 1 : -1);
        if (beat !== null) seek(beat);
        return true;
      }
      case 'addMarker':
        commands.addMarker();
        return true;
      case 'undo':
        undo();
        return true;
      case 'redo':
        redo();
        return true;
      case 'copy':
      case 'cut': {
        if (editingNotes && primaryMidi && primary && selectedNoteIds.length > 0) {
          noteClipRef.current = copyNotes(primaryMidi.region, selectedNoteIds);
          if (id === 'cut') {
            commitProject(deleteNotes(p, primary, selectedNoteIds));
            setSelectedNoteIds([]);
          }
          return true;
        }
        if (liveSelection.length === 0) return false;
        if (id === 'copy') {
          regionClipRef.current = copyRegions(p, liveSelection);
        } else {
          const result = cutRegions(p, liveSelection);
          regionClipRef.current = result.clipboard;
          commitProject(result.project);
          setSelection([]);
        }
        return true;
      }
      case 'paste': {
        if (editingNotes && primaryMidi && primary && noteClipRef.current) {
          const rel = transport.beat - primaryMidi.region.startBeat;
          const at = rel >= 0 && rel < primaryMidi.region.lengthBeats ? rel : 0;
          const result = pasteNotes(p, primary, noteClipRef.current, at);
          commitProject(result.project);
          setSelectedNoteIds(result.noteIds);
          return true;
        }
        const clip = regionClipRef.current;
        if (!clip) return false;
        applyEdit((proj) => pasteRegions(proj, clip, transport.beat, selectedTrackId));
        return true;
      }
      case 'duplicate':
        commands.duplicate();
        return true;
      case 'split':
        commands.split();
        return true;
      case 'join':
        commands.join();
        return true;
      case 'delete':
        if (editingNotes && primary && selectedNoteIds.length > 0) {
          commitProject(deleteNotes(p, primary, selectedNoteIds));
          setSelectedNoteIds([]);
          return true;
        }
        if (liveSelection.length > 0) {
          commands.deleteRegions();
          return true;
        }
        return false;
      case 'selectAll':
        if (editingNotes && primaryMidi) {
          setSelectedNoteIds(primaryMidi.region.notes.map((n) => n.id));
        } else {
          setSelection(selectAllRegions(p));
        }
        return true;
      case 'deselect':
        if (showHelp) setShowHelp(false);
        else if (selectedNoteIds.length > 0) setSelectedNoteIds([]);
        else setSelection([]);
        return true;
      case 'quantize':
        commands.quantize();
        return true;
      case 'transposeUp':
      case 'transposeDown':
      case 'octaveUp':
      case 'octaveDown': {
        if (!primary || !primaryMidi || selectedNoteIds.length === 0) return false;
        const step =
          id === 'transposeUp' ? 1 : id === 'transposeDown' ? -1 : id === 'octaveUp' ? 12 : -12;
        const lock = Math.abs(step) === 1 && p.scaleLock.enabled;
        commitProject(
          moveNotes(p, primary, selectedNoteIds, 0, step, (m) => {
            if (!lock) return m;
            // Scale lock: keep stepping in that direction to the next in-scale pitch.
            let x = m;
            while (lockToScale(x, p.scaleLock) !== x && x > 0 && x < 127) x += step;
            return x;
          }),
          `transpose:${primary.regionId}`,
        );
        const first = primaryMidi.region.notes.find((n) => n.id === selectedNoteIds[0]);
        if (first) {
          engine.audition(
            primaryMidi.track.instrument,
            Math.min(127, Math.max(0, first.midi + step)),
          );
        }
        return true;
      }
      case 'zoomIn':
        commands.zoom(1.25);
        return true;
      case 'zoomOut':
        commands.zoom(0.8);
        return true;
      case 'musicalTyping':
        setTypingOn((on) => !on);
        return true;
      case 'help':
        setShowHelp((s) => !s);
        return true;
    }
  };

  // ── keyboard (latest handler via ref; listeners bound once) ────────────────
  const keyHandlers = useRef<{
    down: (e: KeyboardEvent) => void;
    up: (e: KeyboardEvent) => void;
  }>({ down: () => undefined, up: () => undefined });
  useEffect(() => {
    keyHandlers.current = {
      down: (e) => {
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (
          target &&
          (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)
        ) {
          return;
        }
        const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
        if (typingOn && plain) {
          const control = typingControl(e.code, typing);
          if (control) {
            e.preventDefault();
            setTyping(control);
            return;
          }
          const midi = typingNote(e.code, typing);
          if (midi !== null) {
            e.preventDefault();
            if (!e.repeat && !typingKeysRef.current.has(e.code)) {
              typingKeysRef.current.set(e.code, midi);
              noteOn(midi, typing.velocity);
            }
            return;
          }
        }
        const id = matchShortcut(e, { musicalTyping: typingOn });
        if (id === null) return;
        if (runShortcut(id)) {
          e.preventDefault();
          // Keep Space/Return from also "clicking" a focused button on keyup.
          if (target && target.tagName === 'BUTTON' && (id === 'play' || id === 'toStart')) {
            target.blur();
          }
        }
      },
      up: (e) => {
        const midi = typingKeysRef.current.get(e.code);
        if (midi !== undefined) {
          typingKeysRef.current.delete(e.code);
          noteOff(midi);
        }
      },
    };
  });
  useEffect(() => {
    const down = (e: KeyboardEvent): void => keyHandlers.current.down(e);
    const up = (e: KeyboardEvent): void => keyHandlers.current.up(e);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Release typing notes when typing is switched off mid-press.
  useEffect(() => {
    if (typingOn) return;
    for (const midi of typingKeysRef.current.values()) noteOff(midi);
    typingKeysRef.current.clear();
  }, [typingOn, noteOff]);

  // ── project-level actions ─────────────────────────────────────────────────
  const exportWav = useCallback((): void => {
    if (!project || exporting) return;
    setExporting(true);
    void engine
      .renderMixdown(project)
      .then((buffer) => {
        downloadBlob(audioBufferToWav(buffer), `${project.name.replace(/[^\w-]+/g, '_')}.wav`);
      })
      .finally(() => setExporting(false));
  }, [engine, project, exporting]);

  const openDialog = useCallback((): void => {
    void combinedList().then(setOpenList);
  }, []);

  const openById = useCallback(
    (id: string): void => {
      void openProject(id).then((loaded) => {
        if (!loaded) return;
        engine.stop();
        loadProject(loaded);
        setOpenList(null);
      });
    },
    [engine, loadProject],
  );

  const createNew = useCallback((): void => {
    engine.stop();
    const fresh = newProject('Untitled');
    loadProject(fresh);
    setOpenList(null);
    void saveLocal(fresh);
  }, [engine, loadProject]);

  // ── bottom panel resize ────────────────────────────────────────────────────
  const onPanelResizeStart = (e: React.PointerEvent): void => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = bottomH;
    const move = (ev: PointerEvent): void => {
      const max = Math.max(160, window.innerHeight - 220);
      setBottomH(Math.min(max, Math.max(120, startH + (startY - ev.clientY))));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (project === null) {
    return (
      <div className="flex h-dvh items-center justify-center bg-page">
        <p className="numeric text-xs tracking-[0.2em] text-low uppercase">Opening the studio…</p>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-page text-hi">
      <Transport
        project={project}
        engine={engine}
        transport={transport}
        saveState={saveState}
        exporting={exporting}
        recording={recording !== null}
        canUndo={undoState.undo}
        canRedo={undoState.redo}
        typingOn={typingOn}
        midiStatus={midiStatus}
        onUpdate={update}
        onExport={exportWav}
        onOpen={openDialog}
        onTogglePlay={togglePlay}
        onRecord={toggleRecording}
        onUndo={undo}
        onRedo={redo}
        onToggleTyping={() => setTypingOn((on) => !on)}
        onEnableMidi={enableMidi}
        onShowShortcuts={() => setShowHelp(true)}
      />

      {/* studio-io: import / export / loops strip */}
      <div className="flex items-center gap-2 border-b border-hairline bg-chrome-1 px-3 py-1">
        <ImportMenu project={project} playheadBeat={transport.beat} onUpdate={update} />
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          className="numeric rounded-[4px] border border-hairline px-3 py-1.5 text-[11px] tracking-[0.14em] text-low uppercase transition-colors hover:border-accent-state hover:text-hi"
        >
          Export…
        </button>
        <button
          type="button"
          aria-pressed={loopsOpen}
          onClick={() => setLoopsOpen((v) => !v)}
          className={`numeric ml-auto rounded-[4px] border px-3 py-1.5 text-[11px] tracking-[0.14em] uppercase transition-colors ${
            loopsOpen
              ? 'border-accent-state text-accent-state'
              : 'border-hairline text-low hover:text-hi'
          }`}
        >
          Loops
        </button>
      </div>

      {/* studio-io: relative + loop drop target; the loop browser docks on the right */}
      <div
        className="relative min-h-0 flex-1"
        {...loopDropHandlers(update, transport.beat)}
        onPointerDownCapture={() => setFocusArea('arrange')}
      >
        <ArrangeView
          project={project}
          engine={engine}
          transport={transport}
          selection={liveSelection}
          selectedTrackId={selectedTrackId}
          view={view}
          recording={recording}
          quantizeStrength={quantizeStrength}
          onSelect={selectRegions}
          onSelectTrack={setSelectedTrackId}
          onOpenEditor={() => {
            setTab('editor');
            setFocusArea('editor');
          }}
          onCommit={commitProject}
          onUpdate={update}
          onViewChange={(patch) => setView((v) => ({ ...v, ...patch }))}
          onSeek={seek}
          onAddMidiTrack={commands.addMidiTrack}
          onAddAudioTrack={commands.addAudioTrack}
          onSplit={commands.split}
          onDuplicate={commands.duplicate}
          onJoin={commands.join}
          onDelete={commands.deleteRegions}
          onLoop={commands.loop}
          onQuantize={commands.quantize}
          onQuantizeStrength={setQuantizeStrength}
        />
        {loopsOpen ? (
          <div className="fixed inset-0 z-40 sm:absolute sm:inset-y-0 sm:right-0 sm:left-auto sm:z-30 sm:shadow-2xl">
            <LoopBrowser
              project={project}
              playheadBeat={transport.beat}
              onUpdate={update}
              onClose={() => setLoopsOpen(false)}
            />
          </div>
        ) : null}
      </div>

      {/* ── bottom panel: editor / mixer ─────────────────────────────────── */}
      <div
        className="relative shrink-0 border-t border-hairline bg-chrome-1"
        style={{ height: bottomH }}
        onPointerDownCapture={() => setFocusArea('editor')}
      >
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize editor"
          onPointerDown={onPanelResizeStart}
          className="absolute -top-1 right-0 left-0 z-30 h-2 cursor-ns-resize touch-none"
        />
        <div className="flex h-8 items-center gap-1 border-b border-hairline px-2">
          {(['editor', 'mixer'] as const).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              className={`numeric rounded-[3px] px-2.5 py-0.5 text-[10px] tracking-[0.14em] uppercase transition-colors ${
                tab === name ? 'bg-chrome-2 text-accent-state' : 'text-low hover:text-hi'
              }`}
            >
              {name}
            </button>
          ))}
          {tab === 'editor' && primaryFound ? (
            <span className="numeric ml-2 truncate text-[10px] text-low">
              {primaryFound.track.name} ·{' '}
              {primaryFound.region.kind === 'audio' ? primaryFound.region.name : 'MIDI region'} ·
              bar{' '}
              {Math.floor(primaryFound.region.startBeat / project.timeSignature.beatsPerBar) + 1}
            </span>
          ) : null}
          <span className="numeric ml-auto hidden text-[10px] text-low md:block">
            {editorFocused ? 'keys act on notes' : 'keys act on regions'} · ? shortcuts
          </span>
        </div>
        <div className="h-[calc(100%-2rem)]">
          {tab === 'mixer' ? (
            <Mixer project={project} engine={engine} onUpdate={(m) => update(m, 'mixer')} />
          ) : primaryAudio !== null && primary !== null ? (
            <AudioRegionInspector
              region={primaryAudio.region}
              secPerBeat={secPerBeat}
              onUpdate={(fn, key) =>
                update((draft) => {
                  const found = findRegion(draft, primary);
                  if (found?.region.kind === 'audio') fn(found.region);
                }, key)
              }
            />
          ) : primaryMidi === null || primary === null ? (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <p className="text-sm text-low">
                Select a region in the timeline — or double-click an empty MIDI lane to create one —
                to edit it here.
              </p>
            </div>
          ) : primaryMidi.track.instrument === 'durbaan' ? (
            <StepSequencer
              project={project}
              track={primaryMidi.track}
              region={primaryMidi.region}
              engine={engine}
              onUpdate={update}
            />
          ) : (
            <PianoRoll
              project={project}
              track={primaryMidi.track}
              region={primaryMidi.region}
              regionRef={primary}
              engine={engine}
              transport={transport}
              snap={view.snap}
              selectedNoteIds={selectedNoteIds}
              quantizeStrength={quantizeStrength}
              onSelectNotes={setSelectedNoteIds}
              onCommit={commitProject}
              onQuantize={commands.quantize}
              onQuantizeStrength={setQuantizeStrength}
              onSnapChange={(snap) => setView((v) => ({ ...v, snap }))}
            />
          )}
        </div>
      </div>

      {/* studio-io: export dialog */}
      {exportOpen ? (
        <ExportDialog
          project={project}
          engine={engine}
          onUpdate={update}
          onClose={() => setExportOpen(false)}
        />
      ) : null}

      {/* ── musical typing strip ─────────────────────────────────────────── */}
      {typingOn ? (
        <div className="numeric flex h-7 shrink-0 items-center gap-3 border-t border-hairline bg-chrome-2 px-3 text-[10px] text-low">
          <span className="tracking-[0.14em] text-accent-state uppercase">Musical typing</span>
          <span>A = {midiName(12 * (typing.octave + 1))} · Z/X octave</span>
          <span>velocity {Math.round(typing.velocity * 100)} · C/V</span>
          <span className="truncate text-hi">{heldNotes.map(midiName).join(' ')}</span>
          {project.scaleLock.enabled ? (
            <span className="ml-auto hidden sm:inline">scale lock snaps notes</span>
          ) : null}
        </div>
      ) : null}

      {notice !== null ? (
        <div
          role="status"
          className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[4px] border border-hairline bg-chrome-2 px-4 py-2 text-xs text-hi shadow-lg"
        >
          {notice}
        </div>
      ) : null}

      {showHelp ? <ShortcutsOverlay onClose={() => setShowHelp(false)} /> : null}

      {/* ── open-project dialog ──────────────────────────────────────────── */}
      {openList !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-label="Open project"
        >
          <div className="max-h-[70vh] w-full max-w-md overflow-auto rounded-[4px] border border-hairline bg-chrome-1 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl">Projects</h2>
              <button
                type="button"
                onClick={() => setOpenList(null)}
                className="text-sm text-low hover:text-hi"
              >
                Close
              </button>
            </div>
            <button
              type="button"
              onClick={createNew}
              className="mt-3 w-full rounded-[4px] bg-accent-state px-4 py-2 text-sm font-semibold text-page"
            >
              New project
            </button>
            <ul className="mt-3 flex flex-col gap-1.5">
              {openList.map((listing) => (
                <li key={listing.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openById(listing.id)}
                    className="flex min-w-0 flex-1 items-center justify-between rounded-[4px] border border-hairline bg-chrome-2 px-3 py-2 text-left transition-colors hover:border-accent-state"
                  >
                    <span className="min-w-0 truncate text-sm text-hi">{listing.name}</span>
                    <span className="numeric shrink-0 pl-3 text-[10px] text-low">
                      {listing.bpm} BPM · {listing.location}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${listing.name}`}
                    onClick={() => {
                      void removeProject(listing.id).then(openDialog);
                    }}
                    className="shrink-0 rounded-[4px] border border-hairline px-2 py-2 text-xs text-low hover:border-danger hover:text-danger"
                  >
                    ✕
                  </button>
                </li>
              ))}
              {openList.length === 0 ? (
                <li className="py-2 text-center text-sm text-low">No saved projects yet.</li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Audio region editor: name, clip gain, fades (offset/loop shown read-only). */
function AudioRegionInspector({
  region,
  secPerBeat,
  onUpdate,
}: {
  region: DawAudioRegion;
  secPerBeat: number;
  onUpdate: (fn: (r: DawAudioRegion) => void, coalesceKey?: string) => void;
}): React.JSX.Element {
  const field = 'numeric flex flex-col gap-1 text-[10px] tracking-[0.14em] text-low uppercase';
  return (
    <div className="flex h-full flex-wrap content-start items-start gap-x-6 gap-y-4 overflow-auto p-4">
      <label className={field}>
        Name
        <input
          key={region.id}
          defaultValue={region.name}
          maxLength={80}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== region.name) {
              onUpdate((r) => {
                r.name = name;
              });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className="w-56 rounded-[4px] border border-hairline bg-chrome-2 px-2 py-1 text-sm tracking-normal text-hi normal-case outline-none focus:border-accent-state"
        />
      </label>
      <label className={field}>
        Clip gain {(20 * Math.log10(Math.max(0.001, region.gain))).toFixed(1)} dB
        <input
          type="range"
          min={0}
          max={2}
          step={0.01}
          value={region.gain}
          onChange={(e) => {
            const gain = Number(e.target.value);
            onUpdate((r) => {
              r.gain = gain;
            }, `gain:${region.id}`);
          }}
          className="w-40 accent-(--accent-state)"
        />
      </label>
      <label className={field}>
        Fade in {region.fadeInSec.toFixed(2)} s
        <input
          type="range"
          min={0}
          max={4}
          step={0.01}
          value={region.fadeInSec}
          onChange={(e) => {
            const v = Number(e.target.value);
            onUpdate((r) => {
              r.fadeInSec = v;
            }, `fadein:${region.id}`);
          }}
          className="w-40 accent-(--accent-state)"
        />
      </label>
      <label className={field}>
        Fade out {region.fadeOutSec.toFixed(2)} s
        <input
          type="range"
          min={0}
          max={4}
          step={0.01}
          value={region.fadeOutSec}
          onChange={(e) => {
            const v = Number(e.target.value);
            onUpdate((r) => {
              r.fadeOutSec = v;
            }, `fadeout:${region.id}`);
          }}
          className="w-40 accent-(--accent-state)"
        />
      </label>
      <div className={field}>
        File
        <span className="max-w-72 truncate text-xs tracking-normal text-mid normal-case">
          {region.source}
        </span>
        <span className="text-[10px] tracking-normal text-low normal-case">
          starts {region.offsetSec.toFixed(2)} s in · {(region.lengthBeats * secPerBeat).toFixed(2)}{' '}
          s per pass · ×{region.loopCount}
        </span>
      </div>
    </div>
  );
}

function ShortcutsOverlay({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-label="Keyboard shortcuts"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-[6px] border border-hairline bg-chrome-1 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl text-hi">Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} className="text-sm text-low hover:text-hi">
            Close <span className="numeric text-[10px]">Esc</span>
          </button>
        </div>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group}>
              <h3 className="numeric mb-1.5 text-[10px] tracking-[0.16em] text-accent-state uppercase">
                {group}
              </h3>
              <ul className="flex flex-col gap-1">
                {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                  <li key={`${s.keys}-${s.description}`} className="flex items-baseline gap-3">
                    <kbd className="numeric min-w-16 shrink-0 rounded-[3px] border border-hairline bg-chrome-2 px-1.5 py-0.5 text-center text-[10px] text-hi">
                      {s.keys}
                    </kbd>
                    <span className="text-xs text-mid">{s.description}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-low">
          ⌘ is Ctrl on Windows and Linux. While musical typing is on, C, K and S play notes — use
          the transport buttons for cycle and metronome.
        </p>
      </div>
    </div>
  );
}

export { projectEndBeat };
