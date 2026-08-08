import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DawApp } from '@/components/daw/DawApp';

export const metadata: Metadata = {
  title: 'Studio — QaraamiGenAI',
  description:
    'The QaraamiGenAI studio: compose with oud, durbaan, bass, and keys — qaraami scale lock, Somali grooves, and WAV export. Built by Khalid Ibrahim.',
};

export default function DawPage(): React.JSX.Element {
  return (
    // DawApp reads ?project= via useSearchParams — Suspense keeps the shell static.
    <Suspense fallback={null}>
      <DawApp />
    </Suspense>
  );
}
