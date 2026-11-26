/**
 * /separation — oud and voice pulled apart, and tape noise removed, each with
 * its spectrogram and measured score (portfolio-v1;
 * components/separation/SeparationDemo.tsx).
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { SeparationDemo } from '@/components/separation/SeparationDemo';
import dspDemo from '@/lib/dsp-demo.json';

export const metadata: Metadata = {
  // Unlisted while it runs on synthesised test signals: no link, no sitemap entry, no indexing.
  ...(dspDemo.source.kind === 'synthetic' ? { robots: { index: false, follow: false } } : {}),
  alternates: { canonical: '/separation' },
  title: 'Separation and restoration: oud, voice and tape noise',
  description:
    'A mixture split into oud and voice with non-negative matrix factorisation, and tape noise removed by spectral subtraction, each scored against a known answer.',
};

export default function SeparationPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-bg-primary text-ink-primary">
      <SiteHeader active="Research" />
      <SeparationDemo />
      <SiteFooter />
    </div>
  );
}
