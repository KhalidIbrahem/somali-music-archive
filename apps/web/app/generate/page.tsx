/**
 * /generate — Abuur, the generation studio (server shell).
 * With NEXT_PUBLIC_GENERATE_SERVED_ONLY (the default) the page lists the
 * adapters the local generation service serves and calls it through the AI
 * service (components/generate/ServedGenerationStudio.tsx); with the flag off
 * it is the earlier provider-tier form through the Node API
 * (components/generate/GenerationStudio.tsx). With NEXT_PUBLIC_AI_SERVICE_MODE=off
 * (no service attached, the public site) it shows clips generated ahead of
 * time (components/generate/GenerateExamples.tsx).
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { GenerateExamples } from '@/components/generate/GenerateExamples';
import { GenerationStudio } from '@/components/generate/GenerationStudio';
import { ServedGenerationStudio } from '@/components/generate/ServedGenerationStudio';
import { flags } from '@/lib/flags';

export const metadata: Metadata = {
  title: 'Generate — QaraamiGenAI',
  description:
    'Generate with the fine-tuned MusicGen adapters served on the local generation service.',
};

export default function GeneratePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-bg-primary text-ink-primary">
      <SiteHeader active="Generate" />
      {flags.aiServiceMode === 'off' ? (
        <GenerateExamples />
      ) : flags.generateServedOnly ? (
        <ServedGenerationStudio />
      ) : (
        <GenerationStudio />
      )}
    </div>
  );
}
