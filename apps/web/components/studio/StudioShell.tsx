'use client';

/**
 * StudioShell — the four-zone studio layout (§2).
 *
 *   top bar (56) / library rail (280) · score canvas + waveform (96) · inspector
 *   rail (320) / transport (64)
 *
 * The shell owns the viewport (h-dvh, overflow hidden): only the score canvas
 * scrolls, so the transport can never leave view. Rails collapse by animating
 * to zero width; their inner content keeps its fixed rail width so text does
 * not reflow mid-transition. All dimensions come from the --studio-* layout
 * tokens — the 8px grid lives in the token file, not here.
 */

import { useState } from 'react';
import { StudioProvider } from './StudioState';
import { TimelineProvider } from './TimelineEngine';
import { StudioTopBar } from './StudioTopBar';
import { LibraryRail } from './LibraryRail';
import { InspectorRail } from './InspectorRail';
import { ScoreCanvasZone } from './ScoreCanvasZone';
import { WaveformStrip } from './WaveformStrip';
import { TransportBar } from './TransportBar';

export function StudioShell(): React.JSX.Element {
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  return (
    <StudioProvider>
      <TimelineProvider>
        <div className="flex h-dvh flex-col overflow-hidden bg-page font-body text-hi">
          <StudioTopBar
            libraryOpen={libraryOpen}
            inspectorOpen={inspectorOpen}
            onToggleLibrary={() => setLibraryOpen((v) => !v)}
            onToggleInspector={() => setInspectorOpen((v) => !v)}
          />

          <div className="flex min-h-0 flex-1">
            <aside
              aria-label="Library"
              aria-hidden={!libraryOpen}
              className={`shrink-0 overflow-hidden border-r border-hairline bg-chrome-1 transition-[width] duration-200 motion-reduce:transition-none print:hidden ${
                libraryOpen ? 'w-(--studio-library-rail)' : 'w-0 border-r-0'
              }`}
            >
              <div className="h-full w-(--studio-library-rail)">
                <LibraryRail />
              </div>
            </aside>

            <main className="flex min-w-0 flex-1 flex-col">
              <ScoreCanvasZone />
              <WaveformStrip />
            </main>

            <aside
              aria-label="Inspector"
              aria-hidden={!inspectorOpen}
              className={`shrink-0 overflow-hidden border-l border-hairline bg-chrome-1 transition-[width] duration-200 motion-reduce:transition-none print:hidden ${
                inspectorOpen ? 'w-(--studio-inspector-rail)' : 'w-0 border-l-0'
              }`}
            >
              <div className="h-full w-(--studio-inspector-rail)">
                <InspectorRail />
              </div>
            </aside>
          </div>

          <TransportBar />
        </div>
      </TimelineProvider>
    </StudioProvider>
  );
}
