/**
 * /listen — Dhageyso: where the research is now (website-v1). Four clips of
 * model output with their scorer numbers; no source recordings, ever. The
 * persistent player lives in the root layout and survives navigation.
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { ListenShelf } from '@/components/listen/ListenShelf';

export const metadata: Metadata = {
  alternates: { canonical: '/listen' },
  title: {
    absolute: 'Listen to AI Somali Music — Qaraami & Radio Hargeisa Masters | QaraamiGenAI',
  },
  description:
    'Listen to AI-generated Somali Qaraami music and explore historical archives from Radio Hargeisa. Hear neural model outputs with verified pentatonic score metrics.',
  keywords: [
    'somali music ai',
    'listen to Somali music',
    'Somali AI songs',
    'qaraami ai',
    'Radio Hargeisa audio',
    'Somali oud ai',
  ],
};

export default function ListenPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-page font-body text-hi">
      <SiteHeader active="Listen" />
      <div className="flex-1">
        <ListenShelf />
      </div>
      <SiteFooter />
    </div>
  );
}
