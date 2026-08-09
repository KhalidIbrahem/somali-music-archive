'use client';

/**
 * DawApp (Stage 5 Tier 1) — the studio's root: owns the plain-data project,
 * the engine instance, selection, autosave (IndexedDB, 1.5 s debounce) and
 * background server sync (8 s debounce). Desktop: transport / arrange /
 * editor panel. Mobile (≤ lg): the same surfaces stacked, timeline scrolls
 * horizontally, editors are touch-first. The engine is created once and only
 * ever touched from handlers/effects — never during render.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DawEngine, type EngineSnapshot } from '@/lib/daw/engine';
import {
  cloneProject,
  newProject,
  newTrack,
  projectEndBeat,
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
import { Transport } from './Transport';
import { ArrangeView } from './ArrangeView';
import { PianoRoll } from './PianoRoll';
import { StepSequencer } from './StepSequencer';
import { Mixer } from './Mixer';

export interface Selection {
  trackId: string;
  regionId: string;
}

type BottomTab = 'editor' | 'mixer';

export function DawApp(): React.JSX.Element {
  const search = useSearchParams();
  // One engine per mounted studio; the lazy initializer keeps construction
  // out of re-renders without touching a ref during render.
  const [engine] = useState(() => new DawEngine());

  const [project, setProject] = useState<DawProject | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tab, setTab] = useState<BottomTab>('editor');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'offline'>('saved');
  const [transport, setTransport] = useState<EngineSnapshot>({ state: 'stopped', beat: 0 });
  const [exporting, setExporting] = useState(false);
  const [openList, setOpenList] = useState<ProjectListing[] | null>(null);

  const localTimer = useRef(0);
  const serverTimer = useRef(0);

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
      setProject(loaded);
      engine.setProject(loaded);
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
  const update = useCallback(
    (mutate: (draft: DawProject) => void): void => {
      setProject((current) => {
        if (current === null) return current;
        const draft = cloneProject(current);
        mutate(draft);
        draft.updatedAt = new Date().toISOString();
        engine.setProject(draft);

        setSaveState('saving');
        window.clearTimeout(localTimer.current);
        localTimer.current = window.setTimeout(() => {
          void saveLocal(draft).then(() => setSaveState('saved'));
        }, 1500);
        window.clearTimeout(serverTimer.current);
        serverTimer.current = window.setTimeout(() => {
          void pushToServer(draft.id)
            .then(() => setSaveState('saved'))
            .catch(() => setSaveState('offline'));
        }, 8000);
        return draft;
      });
    },
    [engine],
  );

  // ── keyboard: space = play/stop (skip when typing) ─────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (transport.state === 'stopped') engine.play(transport.beat);
        else engine.stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, transport]);

  const selectedRegion = useMemo((): { track: DawTrack; region: DawRegion } | null => {
    if (!project || !selection) return null;
    const track = project.tracks.find((t) => t.id === selection.trackId);
    const region = track?.regions.find((r) => r.id === selection.regionId);
    return track && region ? { track, region } : null;
  }, [project, selection]);

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
        setSelection(null);
        setProject(loaded);
        engine.setProject(loaded);
        setOpenList(null);
      });
    },
    [engine],
  );

  const createNew = useCallback((): void => {
    engine.stop();
    const fresh = newProject('Untitled');
    setSelection(null);
    setProject(fresh);
    engine.setProject(fresh);
    setOpenList(null);
    void saveLocal(fresh);
  }, [engine]);

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
        onUpdate={update}
        onExport={exportWav}
        onOpen={openDialog}
      />

      <div className="min-h-0 flex-1">
        <ArrangeView
          project={project}
          engine={engine}
          transport={transport}
          selection={selection}
          onSelect={setSelection}
          onUpdate={update}
          onAddTrack={(instrument: InstrumentId) =>
            update((draft) => {
              draft.tracks.push(
                newTrack(
                  `${instrument[0]?.toUpperCase()}${instrument.slice(1)} ${
                    draft.tracks.filter((t) => t.instrument === instrument).length + 1
                  }`,
                  instrument,
                ),
              );
            })
          }
        />
      </div>

      {/* ── bottom panel: editor / mixer ─────────────────────────────────── */}
      <div className="h-64 shrink-0 border-t border-hairline bg-chrome-1 sm:h-72">
        <div className="flex items-center gap-1 border-b border-hairline px-3 py-1.5">
          {(['editor', 'mixer'] as const).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              className={`numeric rounded-[4px] px-3 py-1 text-[11px] tracking-[0.14em] uppercase transition-colors ${
                tab === name ? 'bg-chrome-2 text-accent-state' : 'text-low hover:text-hi'
              }`}
            >
              {name}
            </button>
          ))}
          {tab === 'editor' && selectedRegion ? (
            <span className="numeric ml-3 truncate text-[11px] text-low">
              {selectedRegion.track.name} · region {selectedRegion.region.id.slice(-4)}
            </span>
          ) : null}
        </div>
        <div className="h-[calc(100%-2.3rem)]">
          {tab === 'mixer' ? (
            <Mixer project={project} engine={engine} onUpdate={update} />
          ) : selectedRegion === null ? (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <p className="text-sm text-low">
                Select a region in the timeline — or double-tap an empty lane to create one — to
                edit its notes here.
              </p>
            </div>
          ) : selectedRegion.track.instrument === 'durbaan' ? (
            <StepSequencer
              project={project}
              track={selectedRegion.track}
              region={selectedRegion.region}
              engine={engine}
              onUpdate={update}
            />
          ) : (
            <PianoRoll
              project={project}
              track={selectedRegion.track}
              region={selectedRegion.region}
              engine={engine}
              onUpdate={update}
            />
          )}
        </div>
      </div>

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

export { projectEndBeat };
