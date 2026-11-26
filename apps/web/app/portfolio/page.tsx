/**
 * /portfolio — the ten-minute reviewer path (portfolio-v1): five stops with no
 * login and no setup (components/portfolio/PortfolioHub.tsx).
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { PortfolioHub } from '@/components/portfolio/PortfolioHub';

export const metadata: Metadata = {
  alternates: { canonical: '/portfolio' },
  title: 'Portfolio: QaraamiGen in ten minutes',
  description:
    'Transcription, generation and evaluation for Somali qaraami: listening pairs, live tools, scores, results and code, each one click away.',
};

export default function PortfolioPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-bg-primary text-ink-primary">
      <SiteHeader />
      <PortfolioHub />
      <SiteFooter />
    </div>
  );
}
