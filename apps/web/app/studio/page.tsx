/**
 * /studio — the QaraamiGenAI Studio: tracks (MIDI instruments and audio),
 * mixer with effects, QaraamiGen loop browser, recording, MIDI and audio
 * import/export. The transcription score view lives at /studio/score.
 */

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DawApp } from '@/components/daw/DawApp';

export const metadata: Metadata = {
  title: 'Studio — QaraamiGenAI',
  description:
    'Compose qaraami in the browser: oud, durbaan, bass and keys with scale lock and Somali grooves, audio tracks and recording, a mixer with EQ, compression and reverb, and the QaraamiGen loop browser.',
};

export default function StudioPage(): React.JSX.Element {
  return (
    // DawApp reads ?project= via useSearchParams — Suspense keeps the shell static.
    <Suspense fallback={null}>
      <DawApp />
    </Suspense>
  );
}
