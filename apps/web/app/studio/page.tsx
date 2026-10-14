/**
 * /studio — the Transcription Studio (Block 1 §2): four-zone desktop layout on
 * the studio chrome tokens. Top bar, collapsible library rail, score canvas on
 * paper, inspector rail, fixed transport. B1-02 ships the shell; the score
 * canvas, waveform, and timeline binding land in B1-03..06.
 */

import type { Metadata } from 'next';
import { StudioShell } from '@/components/studio/StudioShell';

export const metadata: Metadata = {
  alternates: { canonical: '/studio' },
  title: 'Somali Music AI Studio: Kaban (Oud), Durbaan & DAW Online | QaraamiGenAI',
  description:
    'Compose Somali music online with AI-assisted tools, authentic Kaban (oud) instruments, Durbaan rhythms, pentatonic scale locks, and browser-based mixing.',
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
  return <StudioShell />;
}
