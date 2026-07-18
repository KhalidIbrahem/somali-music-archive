/**
 * /transcribe — Qormada, audio to sheet music (server shell).
 * The interactive studio lives in components/transcribe/TranscribeStudio.tsx.
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { TranscribeStudio } from '@/components/transcribe/TranscribeStudio';

export const metadata: Metadata = {
  title: 'Transcribe — Somali Music Archive',
  description:
    'Pentatonic-aware transcription: upload a recording, get sheet music that respects the Somali scale system instead of forcing Western keys.',
};

export default function TranscribePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-bg-primary text-ink-primary">
      <SiteHeader active="Transcribe" />
      <TranscribeStudio />
    </div>
  );
}
