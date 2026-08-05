'use client';

/**
 * Transport (64px, fixed): playback controls, timecode, tempo/grid readouts,
 * zoom. Static in B1-02 — the WebAudio clock and the shared cursor arrive in
 * B1-05. Every numeric readout is `numeric` (mono, tabular) so nothing
 * reflows while time advances (§1). Playback state is flag blue; selection
 * and edit states are amber (§1 token roles).
 */

function TransportButton({
  label,
  emphasis = false,
  children,
}: {
  label: string;
  emphasis?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-[4px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-live ${
        emphasis
          ? 'border-hairline bg-chrome-2 text-accent-live hover:text-hi'
          : 'border-transparent text-mid hover:text-hi'
      }`}
    >
      {children}
    </button>
  );
}

export function TransportBar(): React.JSX.Element {
  return (
    <footer className="flex h-(--studio-transport) shrink-0 items-center gap-4 border-t border-hairline bg-chrome-1 px-4 print:hidden">
      <div className="flex items-center gap-2">
        <TransportButton label="Skip to start">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
            <rect x="1" y="1" width="2" height="10" />
            <path d="M11 1 4 6l7 5V1Z" />
          </svg>
        </TransportButton>
        <TransportButton label="Play" emphasis>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
            <path d="M2.5 1.2v9.6L11 6 2.5 1.2Z" />
          </svg>
        </TransportButton>
        <TransportButton label="Skip to end">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
            <rect x="9" y="1" width="2" height="10" />
            <path d="M1 1l7 5-7 5V1Z" />
          </svg>
        </TransportButton>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="numeric text-sm text-hi">00:00:00.000</span>
        <span className="numeric text-xs text-low">/ 00:05:48</span>
      </div>

      <div className="hidden items-center gap-4 md:flex">
        <span aria-hidden className="h-4 w-px bg-hairline" />
        <span className="numeric text-xs text-mid">106 BPM</span>
        <span className="text-xs text-low">beat grid</span>
        <span className="numeric text-xs text-mid">+41.6¢</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <TransportButton label="Zoom out">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden
          >
            <line x1="2" y1="6" x2="10" y2="6" />
          </svg>
        </TransportButton>
        <span className="numeric w-12 text-center text-xs text-mid">100%</span>
        <TransportButton label="Zoom in">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden
          >
            <line x1="2" y1="6" x2="10" y2="6" />
            <line x1="6" y1="2" x2="6" y2="10" />
          </svg>
        </TransportButton>
      </div>
    </footer>
  );
}
