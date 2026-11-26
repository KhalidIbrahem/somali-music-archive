/**
 * /results — the evaluation summary (portfolio-v1): one figure for the scaling
 * results with 95 % intervals, one table for the transcription pool
 * (components/results/ResultsSummary.tsx).
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { ResultsSummary } from '@/components/results/ResultsSummary';

export const metadata: Metadata = {
  alternates: { canonical: '/results' },
  title: 'Results: fine-tuning and transcription, measured',
  description:
    'Held-out gains of the fine-tuned Somali music models with 95 % intervals, blind listening results, and the transcription pool summary.',
};

export default function ResultsPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-bg-primary text-ink-primary">
      <SiteHeader active="Research" />
      <ResultsSummary />
      <SiteFooter />
    </div>
  );
}
