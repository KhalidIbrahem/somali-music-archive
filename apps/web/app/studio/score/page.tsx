/**
 * /studio/score — the Transcription Studio: engraved score, source-free
 * synthesised audio, and the AI pipeline's confidence, side by side. The
 * Tracks view (the DAW) lives at /studio.
 */

import type { Metadata } from 'next';
import { StudioShell } from '@/components/studio/StudioShell';

export const metadata: Metadata = {
  title: 'Score — Studio — QaraamiGenAI',
  description:
    'Transcription studio: engraved score, audio, and the AI pipeline’s confidence, side by side.',
};

export default function StudioScorePage(): React.JSX.Element {
  return <StudioShell />;
}
