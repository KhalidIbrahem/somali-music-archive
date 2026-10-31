/**
 * /study — blind listening study for musicians (components/study/ListeningStudy.tsx).
 * Shared by link, not indexed: answers should come from the people it was sent to.
 */
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { ListeningStudy } from '@/components/study/ListeningStudy';

export const metadata: Metadata = {
  alternates: { canonical: '/study' },
  title: 'Listening Study',
  description:
    'A 10-minute blind listening study for musicians who know Somali music: which AI-generated clip sounds more Somali?',
  robots: { index: false, follow: false },
};

export default function StudyPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-bg-primary text-ink-primary">
      <SiteHeader />
      <ListeningStudy />
      <SiteFooter />
    </div>
  );
}
