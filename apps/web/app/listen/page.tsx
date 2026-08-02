/**
 * /listen — Dhageyso, the listening room (server shell).
 * The interactive player lives in components/listen/ListeningRoom.tsx; this
 * wrapper provides metadata and the static frame around it.
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { ListeningRoom } from '@/components/listen/ListeningRoom';

export const metadata: Metadata = {
  title: 'Listen — Somali Music Archive',
  description:
    'The listening room: archived Somali songs from digitised cassettes, 1964–1976. Restored, catalogued, and streaming.',
};

export default function ListenPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-bg-primary text-ink-primary">
      <SiteHeader active="Listen" />
      <ListeningRoom />
    </div>
  );
}
