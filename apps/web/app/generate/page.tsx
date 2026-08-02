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
    'Describe a song and let AI compose in the spirit of the Somali tradition — Suno, Google Lyria, and (soon) the archive’s own fine-tuned model.',
};

export default function GeneratePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-bg-primary text-ink-primary">
      <SiteHeader active="Generate" />
      <GenerationStudio />
    </div>
  );
}
