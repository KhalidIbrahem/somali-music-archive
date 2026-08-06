/**
 * /listen — Dhageyso, the listening room (B1-15): an archive reading of the
 * recordings, not a playlist. Track records carry their source-and-rights
 * lines; the persistent player lives in the root layout and survives
 * navigation; the transcribed sample exposes the synced engraving.
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { ListenShelf } from '@/components/listen/ListenShelf';

export const metadata: Metadata = {
  title: 'Listen — Somali Music Archive',
  description:
    'The listening room: digitised Somali recordings with their sources stated plainly, and a score that follows the one transcribed take.',
};

export default function ListenPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-page font-body text-hi">
      <SiteHeader active="Listen" />
      <ListenShelf />
    </div>
  );
}
