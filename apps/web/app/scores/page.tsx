/**
 * /scores — the transcription showcase (portfolio-v1): three automatic scores
 * beside playback of their own notes, PCS, and the tuning findings in plain
 * words. No recording is served (components/scores/ScoreShowcase.tsx).
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { ScoreShowcase } from '@/components/scores/ScoreShowcase';

export const metadata: Metadata = {
  alternates: { canonical: '/scores' },
  title: 'Scores: Somali qaraami transcribed from recordings',
  description:
    'Three automatic transcriptions of Somali qaraami with playback, the pentatonic conformity score, and what the measured tuning shows.',
};

export default function ScoresPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-bg-primary text-ink-primary">
      <SiteHeader active="Transcribe" />
      <ScoreShowcase />
      <SiteFooter />
    </div>
  );
}
