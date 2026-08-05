/**
 * /generate — Abuur, the generation studio (server shell).
 * The interactive form/poller lives in components/generate/GenerationStudio.tsx;
 * this wrapper provides metadata and the static frame around it.
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { GenerationStudio } from '@/components/generate/GenerationStudio';

export const metadata: Metadata = {
  title: 'Generate — Somali Music Archive',
  description:
    'Describe a song and let the QaraamiGen models compose in the spirit of the Somali musical tradition.',
};

export default function GeneratePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-bg-primary text-ink-primary">
      <SiteHeader active="Generate" />
      <GenerationStudio />
    </div>
  );
}
