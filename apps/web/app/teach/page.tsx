import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { TeachStudio } from '@/components/teach/TeachStudio';

export const metadata: Metadata = {
  title: 'Teaching studio — QaraamiGenAI',
  description: 'Publish lessons and course material to the archive (educators).',
};

export default function TeachPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-bg-primary text-ink-primary">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12">
        <TeachStudio />
      </main>
    </div>
  );
}
