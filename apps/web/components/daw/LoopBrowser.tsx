'use client';

/**
 * LoopBrowser (Studio v2) — the studio's "Apple Loops": every releasable
 * QaraamiGen generation from the public gallery, searchable and filterable,
 * with one-at-a-time preview. A clip becomes an audio track either by
 * dragging it onto the arrangement or with "Add"; it lands at the playhead,
 * its length in beats taken from its duration at the project tempo.
 *
 * Every clip here is model output (lib/daw/loops.ts refuses any other URL).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_LOOP_FILTER,
  LOOP_DRAG_MIME,
  addLoopTrack,
  filterLoops,
  loadGalleryClips,
  loopModels,
  type LoopClip,
  type LoopFilter,
  type LoopKindFilter,
  type LoopSort,
} from '@/lib/daw/loops';
import type { DawProject } from '@/lib/daw/types';

const PAGE = 60;

const KIND_OPTIONS: { value: LoopKindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'vocals', label: 'Songs with vocals' },
  { value: 'oud', label: 'Solo oud' },
];

const SORT_OPTIONS: { value: LoopSort; label: string }[] = [
  { value: 'gallery', label: 'Gallery order' },
  { value: 'pcs', label: 'Pitch-class score' },
  { value: 'voiced', label: 'Voiced ratio' },
  { value: 'title', label: 'Title' },
  { value: 'duration', label: 'Length' },
];

function formatDuration(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Drop handlers for the arrangement area: a loop dragged from the browser
 * becomes a new audio track at `beat` (the playhead).
 */
export function loopDropHandlers(
  onUpdate: (mutate: (draft: DawProject) => void) => void,
  beat: number,
): Pick<React.HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDrop'> {
  return {
    onDragOver: (e) => {
      if (e.dataTransfer.types.includes(LOOP_DRAG_MIME)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    onDrop: (e) => {
      const id = e.dataTransfer.getData(LOOP_DRAG_MIME);
      if (!id) return;
      e.preventDefault();
      void loadGalleryClips().then((list) => {
        const clip = list.find((c) => c.id === id);
        if (clip) onUpdate((draft) => void addLoopTrack(draft, clip, Math.max(0, beat)));
      });
    },
  };
}

export function LoopBrowser({
  project,
  playheadBeat,
  onUpdate,
  onClose,
}: {
  project: DawProject;
  playheadBeat: number;
  onUpdate: (mutate: (draft: DawProject) => void) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [clips, setClips] = useState<LoopClip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LoopFilter>(DEFAULT_LOOP_FILTER);
  const [limit, setLimit] = useState(PAGE);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGalleryClips()
      .then((list) => {
        if (cancelled) return;
        setClips(list);
      })
      .catch(() => {
        if (!cancelled) setError('The loop list could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // One preview element for the panel's lifetime; stopped on unmount.
  useEffect(
    () => () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      audioRef.current = null;
    },
    [],
  );

  const stopPreview = useCallback((): void => {
    audioRef.current?.pause();
    setPlayingId(null);
  }, []);

  const togglePreview = useCallback(
    (clip: LoopClip): void => {
      if (playingId === clip.id) {
        stopPreview();
        return;
      }
      let audio = audioRef.current;
      if (audio === null) {
        audio = new Audio();
        audio.preload = 'none';
        audio.addEventListener('ended', () => setPlayingId(null));
        audioRef.current = audio;
      }
      audio.pause();
      audio.src = clip.url;
      audio.currentTime = 0;
      setPlayingId(clip.id);
      audio.play().catch(() => {
        setPlayingId(null);
        setStatus(`Could not play “${clip.title}”.`);
      });
    },
    [playingId, stopPreview],
  );

  const addClip = useCallback(
    (clip: LoopClip): void => {
      onUpdate((draft) => {
        addLoopTrack(draft, clip, Math.max(0, playheadBeat));
      });
      setStatus(`Added “${clip.title}” as a new audio track.`);
    },
    [onUpdate, playheadBeat],
  );

  const models = useMemo(() => (clips ? loopModels(clips) : []), [clips]);
  const visible = useMemo(() => (clips ? filterLoops(clips, filter) : []), [clips, filter]);

  const setField = <K extends keyof LoopFilter>(key: K, value: LoopFilter[K]): void => {
    setFilter((current) => ({ ...current, [key]: value }));
    setLimit(PAGE);
  };

  const selectClass =
    'min-w-0 rounded-[4px] border border-hairline bg-chrome-2 px-2 py-1.5 text-xs text-hi focus:border-accent-state focus:outline-none';

  return (
    <aside
      aria-label="Loop browser"
      className="flex h-full w-full flex-col border-l border-hairline bg-chrome-1 sm:w-80"
    >
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <h2 className="font-display text-lg text-hi">Loops</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close loop browser"
          className="rounded-[4px] px-2 py-1 text-sm text-low hover:text-hi"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-2 border-b border-hairline px-3 py-2">
        <input
          type="search"
          value={filter.query}
          onChange={(e) => setField('query', e.target.value)}
          placeholder="Search title or prompt"
          aria-label="Search loops by title or prompt"
          className="rounded-[4px] border border-hairline bg-chrome-2 px-2 py-1.5 text-sm text-hi placeholder:text-low focus:border-accent-state focus:outline-none"
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Loop type">
          {KIND_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter.kind === option.value}
              onClick={() => setField('kind', option.value)}
              className={`rounded-[4px] border px-2 py-1 text-[11px] transition-colors ${
                filter.kind === option.value
                  ? 'border-accent-state text-accent-state'
                  : 'border-hairline text-low hover:text-hi'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={filter.model}
            onChange={(e) => setField('model', e.target.value)}
            aria-label="Filter by model"
            className={selectClass}
          >
            <option value="all">All models</option>
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <select
            value={filter.sort}
            onChange={(e) => setField('sort', e.target.value as LoopSort)}
            aria-label="Sort loops"
            className={selectClass}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-low">
          <input
            type="checkbox"
            checked={filter.autoPickOnly}
            onChange={(e) => setField('autoPickOnly', e.target.checked)}
            className="accent-[#C89B5F]"
          />
          Automatic picks only
        </label>
        <p className="numeric text-[10px] tracking-[0.12em] text-low uppercase">
          {clips === null ? 'Loading…' : `${visible.length} of ${clips.length} AI generations`}
        </p>
      </div>

      <p className="sr-only" aria-live="polite">
        {status}
      </p>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2" aria-label="Loops">
        {error !== null ? <li className="px-2 py-4 text-sm text-danger">{error}</li> : null}
        {visible.slice(0, limit).map((clip) => {
          const playing = playingId === clip.id;
          return (
            <li
              key={clip.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(LOOP_DRAG_MIME, clip.id);
                e.dataTransfer.setData('text/plain', clip.title);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              className="mb-1.5 cursor-grab rounded-[4px] border border-hairline bg-chrome-2 p-2 active:cursor-grabbing"
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => togglePreview(clip)}
                  aria-label={`${playing ? 'Stop' : 'Preview'} ${clip.title}`}
                  aria-pressed={playing}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs transition-colors ${
                    playing
                      ? 'border-accent-state bg-accent-state text-page'
                      : 'border-hairline text-hi hover:border-accent-state'
                  }`}
                >
                  {playing ? '■' : '▶'}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-hi" title={clip.prompt}>
                    {clip.title}
                  </p>
                  <p className="numeric mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-low">
                    <span className="rounded-[3px] border border-accent-state/60 px-1 text-accent-state">
                      AI output
                    </span>
                    <span>{clip.model}</span>
                    <span>{formatDuration(clip.durationSec)}</span>
                    {clip.pcs !== null ? <span>PCS {clip.pcs.toFixed(2)}</span> : null}
                    {clip.voiced !== null ? <span>voiced {clip.voiced.toFixed(2)}</span> : null}
                    {clip.autoPick ? <span className="text-accent-state">auto-pick</span> : null}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => addClip(clip)}
                  aria-label={`Add ${clip.title} to a new track`}
                  className="shrink-0 rounded-[4px] border border-hairline px-2 py-1 text-[11px] text-low transition-colors hover:border-accent-state hover:text-accent-state"
                >
                  + Add
                </button>
              </div>
            </li>
          );
        })}
        {visible.length > limit ? (
          <li>
            <button
              type="button"
              onClick={() => setLimit((n) => n + PAGE)}
              className="w-full rounded-[4px] border border-hairline py-2 text-xs text-low hover:text-hi"
            >
              Show more ({visible.length - limit} left)
            </button>
          </li>
        ) : null}
        {clips !== null && visible.length === 0 ? (
          <li className="px-2 py-4 text-center text-sm text-low">No loops match.</li>
        ) : null}
      </ul>
      <p className="border-t border-hairline px-3 py-2 text-[10px] leading-snug text-low">
        Drag a loop onto the arrangement or press Add — it lands at the playhead ({project.bpm}{' '}
        BPM). Every loop is QaraamiGen model output.
      </p>
    </aside>
  );
}
