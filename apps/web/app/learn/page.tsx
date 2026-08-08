import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { LessonList } from '@/components/learn/LessonList';

export const metadata: Metadata = {
  title: 'Learn — QaraamiGenAI',
  description:
    'Lessons and course material on Somali traditional music, written by the educators and researchers working with the archive.',
};

export default function LearnPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-bg-primary text-ink-primary">
      <SiteHeader active="Learn" />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12">
        <header className="flex max-w-2xl flex-col gap-3">
          <p className="font-body text-sm uppercase tracking-widest text-amber">Learn</p>
          <h1 className="font-display text-4xl sm:text-5xl">Lessons from the archive</h1>
          <p className="font-body text-ink-secondary">
            Course material on Somali traditional music — lectures, readings, and listening examples
            — written by the educators and researchers working with the archive.
          </p>
        </header>
        <LessonList />
      </main>
    </div>
  );
}
