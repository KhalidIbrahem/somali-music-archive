/**
 * /library — Maktabadda, the shelf of scanned Somali music-sheet books.
 * The interactive shelf + upload lives in components/library/LibraryShelf.tsx
 * (members only); the public site shows components/library/PublicLibraryShelf.tsx.
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { LibraryShelf } from '@/components/library/LibraryShelf';
import { PublicLibraryShelf } from '@/components/library/PublicLibraryShelf';
import { flags } from '@/lib/flags';

export const metadata: Metadata = {
  title: 'Library — QaraamiGenAI',
  description:
    'The archive library: scanned books of Somali music sheets and songbooks, uploaded and preserved alongside the recordings.',
};

export default function LibraryPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-bg-primary text-ink-primary">
      <SiteHeader active="Library" />
      {flags.requireAuth ? <LibraryShelf /> : <PublicLibraryShelf />}
    </div>
  );
}
