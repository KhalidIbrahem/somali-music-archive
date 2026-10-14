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
import { SiteFooter } from '@/components/SiteFooter';
import { GenerateExamples } from '@/components/generate/GenerateExamples';
import { GenerationStudio } from '@/components/generate/GenerationStudio';
import { ServedGenerationStudio } from '@/components/generate/ServedGenerationStudio';
import { flags } from '@/lib/flags';

export const metadata: Metadata = {
  alternates: { canonical: '/generate' },
  title: 'Somali Music AI Generator — Create Qaraami & Somali Songs | QaraamiGenAI',
  description:
    'Generate authentic Somali music and Qaraami melodies with AI. Fine-tuned neural audio models rooted in traditional Somali pentatonic scales and Kaban acoustics.',
  keywords: [
    'somali music ai',
    'Somali AI music generator',
    'generate somali music',
    'Somali music AI generator',
    'qaraami ai',
  ],
};

export default function GeneratePage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-bg-primary text-ink-primary">
      <SiteHeader active="Generate" />
      {flags.aiServiceMode === 'off' ? (
        <GenerateExamples />
      ) : flags.generateServedOnly ? (
        <ServedGenerationStudio />
      ) : (
        <GenerationStudio />
      )}
      <SiteFooter />
    </div>
  );
}
