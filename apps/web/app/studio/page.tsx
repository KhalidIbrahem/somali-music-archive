/**
 * /studio — the QaraamiGenAI Studio (v3): Logic-style panes — Library,
 * tracks area, Inspector, bottom editors — and five modes: Create, Play,
 * Learn, Listen, Record. The transcription score view lives at /studio/score.
 *
 * 2483a2d (SEO) swapped this route to the score shell by mistake, which left
 * the DAW unreachable; the SEO metadata is kept, the DAW restored.
 */

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DawApp } from '@/components/daw/DawApp';

export const metadata: Metadata = {
  alternates: { canonical: '/studio' },
  title: { absolute: 'Somali Music AI Studio: Kaban (Oud), Durbaan & DAW Online | QaraamiGenAI' },
  description:
    'A Logic-style studio for Somali music in the browser: create with a synthesised Kaban (oud), Durbaan grooves and the pentatonic scale lock; play an on-screen kaban; learn the scale, the rhythms and Beerdilaacshe with scored practice and a Somali music reverse dictionary; listen to every QaraamiGen generation; record and transcribe your own takes.',
  keywords: [
    'somali music ai',
    'Somali music studio',
    'Somali DAW',
    'virtual kaban',
    'Somali oud online',
    'durbaan online',
  ],
};

export default function StudioPage(): React.JSX.Element {
  return (
    // DawApp reads ?project= via useSearchParams — Suspense keeps the shell static.
    <Suspense fallback={null}>
      <DawApp />
    </Suspense>
  );
}
