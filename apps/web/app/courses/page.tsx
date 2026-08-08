import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { CoursesList } from '@/components/courses/CoursesList';

export const metadata: Metadata = {
  title: 'Courses — QaraamiGenAI',
  description: 'Structured instrument courses built on the qaraami repertoire.',
};

export default function CoursesPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-page text-hi">
      <SiteHeader active="Courses" />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
        <header className="max-w-2xl">
          <p className="numeric text-[11px] tracking-[0.2em] text-accent-state uppercase">
            Courses
          </p>
          <h1 className="mt-2 font-display text-4xl">Learn an instrument from the repertoire</h1>
          <p className="mt-3 leading-relaxed text-mid">
            Each course is built from real songs: engraved sheet music you can read, and a
            performance the studio plays for you, note by note.
          </p>
        </header>
        <CoursesList />
      </main>
    </div>
  );
}
