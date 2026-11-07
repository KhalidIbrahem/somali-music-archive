'use client';

/**
 * Toolbar (Studio v3) — the second row under the control bar, Logic's
 * toolbar: the five studio modes (Create · Play · Learn · Listen · Record),
 * Import and Export, and the pane toggles. Scrolls sideways on a phone
 * instead of wrapping, so the tracks area keeps its height.
 */

import { ImportMenu } from './ImportMenu';
import { MODE_CARDS, type StudioMode } from './StartOverlay';
import type { DawProject } from '@/lib/daw/types';

export function Toolbar({
  mode,
  project,
  playheadBeat,
  libraryOpen,
  inspectorOpen,
  onMode,
  onUpdate,
  onExport,
  onToggleLibrary,
  onToggleInspector,
  onStart,
}: {
  mode: StudioMode;
  project: DawProject;
  playheadBeat: number;
  libraryOpen: boolean;
  inspectorOpen: boolean;
  onMode: (mode: StudioMode) => void;
  onUpdate: (mutate: (draft: DawProject) => void) => void;
  onExport: () => void;
  onToggleLibrary: () => void;
  onToggleInspector: () => void;
  onStart: () => void;
}): React.JSX.Element {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-hairline bg-chrome-1 px-2 [scrollbar-width:none]">
      <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Studio mode">
        {MODE_CARDS.map((card) => (
          <button
            key={card.id}
            type="button"
            aria-pressed={mode === card.id}
            title={`${card.title} · ${card.somali} — ${card.text}`}
            onClick={() => onMode(card.id)}
            className={`numeric h-7 rounded-[3px] px-2.5 text-[10px] tracking-[0.14em] uppercase transition-colors ${
              mode === card.id
                ? 'bg-accent-state/15 text-accent-state'
                : 'text-low hover:bg-chrome-2 hover:text-hi'
            }`}
          >
            {card.title}
          </button>
        ))}
      </div>
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-hairline" />
      <ImportMenu project={project} playheadBeat={playheadBeat} onUpdate={onUpdate} />
      <button
        type="button"
        onClick={onExport}
        className="numeric h-7 shrink-0 rounded-[3px] border border-hairline px-2.5 text-[10px] tracking-[0.14em] text-low uppercase transition-colors hover:border-accent-state hover:text-hi"
      >
        Export…
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <PaneToggle label="Library" active={libraryOpen} onClick={onToggleLibrary} side="left" />
        <PaneToggle
          label="Inspector"
          active={inspectorOpen}
          onClick={onToggleInspector}
          side="right"
        />
        <button
          type="button"
          onClick={onStart}
          title="Start screen"
          className="numeric h-7 rounded-[3px] px-2 text-[10px] tracking-[0.14em] text-low uppercase hover:bg-chrome-2 hover:text-hi"
        >
          Start
        </button>
      </div>
    </div>
  );
}

function PaneToggle({
  label,
  active,
  onClick,
  side,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  side: 'left' | 'right';
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${active ? 'Hide' : 'Show'} the ${label.toLowerCase()}`}
      title={`${label} pane`}
      onClick={onClick}
      className={`flex h-7 items-center gap-1.5 rounded-[3px] px-2 transition-colors ${
        active ? 'bg-chrome-2 text-accent-state' : 'text-low hover:bg-chrome-2 hover:text-hi'
      }`}
    >
      <svg
        width="14"
        height="12"
        viewBox="0 0 14 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        aria-hidden
      >
        <rect x="0.6" y="0.6" width="12.8" height="10.8" rx="1.5" />
        {side === 'left' ? (
          <rect
            x="0.6"
            y="0.6"
            width="4.4"
            height="10.8"
            rx="1.5"
            fill={active ? 'currentColor' : 'none'}
          />
        ) : (
          <rect
            x="9"
            y="0.6"
            width="4.4"
            height="10.8"
            rx="1.5"
            fill={active ? 'currentColor' : 'none'}
          />
        )}
      </svg>
      <span className="numeric hidden text-[10px] tracking-[0.14em] uppercase sm:inline">
        {label}
      </span>
    </button>
  );
}
