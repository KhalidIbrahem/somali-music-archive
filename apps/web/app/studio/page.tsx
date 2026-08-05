/**
 * /studio — the Transcription Studio (Block 1 §2): four-zone desktop layout on
 * the studio chrome tokens. Top bar, collapsible library rail, score canvas on
 * paper, inspector rail, fixed transport. B1-02 ships the shell; the score
 * canvas, waveform, and timeline binding land in B1-03..06.
 */

import type { Metadata } from 'next';
import { StudioShell } from '@/components/studio/StudioShell';

export const metadata: Metadata = {
  title: 'Studio — Somali Music Archive',
  description:
    'Transcription studio: engraved score, source audio, and the AI pipeline’s confidence, side by side.',
};

export default function StudioPage(): React.JSX.Element {
  return <StudioShell />;
}
