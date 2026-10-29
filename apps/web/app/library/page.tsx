/**
 * /library — Maktabadda, the resources shelf (scores, transcriptions, books).
 * The interactive shelf + upload lives in components/library/LibraryShelf.tsx
 * (members only); the public site shows components/library/PublicLibraryShelf.tsx.
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { LibraryShelf } from '@/components/library/LibraryShelf';
import { PublicLibraryShelf } from '@/components/library/PublicLibraryShelf';
import { flags } from '@/lib/flags';

export const metadata: Metadata = {
  alternates: { canonical: '/library' },
  title: { absolute: 'Somali Music Library: Scores and Songbooks — QaraamiGenAI' },
  description:
    'Resources for reading and playing Somali music: the Beerdilaacshe engraving with its PDF, MIDI and LilyPond source, the pipeline’s automatic transcriptions, and the shelf where books will go.',
};

export default function LibraryPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-bg-primary text-ink-primary">
      <SiteHeader active="Library" />
      {flags.requireAuth ? <LibraryShelf /> : <PublicLibraryShelf />}
      <SiteFooter />
    </div>
  );
}
