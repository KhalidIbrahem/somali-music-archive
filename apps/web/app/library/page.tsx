/**
 * /library — Maktabadda, the shelf of scanned Somali music-sheet books.
 * The interactive shelf + upload lives in components/library/LibraryShelf.tsx.
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { LibraryShelf } from '@/components/library/LibraryShelf';

export const metadata: Metadata = {
  title: 'Library — Somali Music Archive',
  description:
    'The archive library: scanned books of Somali music sheets and songbooks, uploaded and preserved alongside the recordings.',
};

export default function LibraryPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-bg-primary text-ink-primary">
      <SiteHeader active="Library" />
      <LibraryShelf />
    </div>
  );
}
