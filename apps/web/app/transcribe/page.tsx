/**
 * /transcribe — Qormada, audio to sheet music (server shell).
 * The interactive studio lives in components/transcribe/TranscribeStudio.tsx.
 * With NEXT_PUBLIC_AI_SERVICE_MODE=off (no service attached, the public site)
 * the page shows scores rendered ahead of time (TranscribeExamples.tsx).
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { TranscribeExamples } from '@/components/transcribe/TranscribeExamples';
import { TranscribeStudio } from '@/components/transcribe/TranscribeStudio';
import { flags } from '@/lib/flags';

export const metadata: Metadata = {
  title: 'Transcribe — QaraamiGenAI',
  description:
    'Pentatonic-aware transcription: upload a recording, get sheet music that respects the Somali scale system instead of forcing Western keys.',
};

export default function TranscribePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-bg-primary text-ink-primary">
      <SiteHeader active="Transcribe" />
      {flags.aiServiceMode === 'off' ? <TranscribeExamples /> : <TranscribeStudio />}
    </div>
  );
}
