import { SiteHeader } from '@/components/SiteHeader';
import { LessonView } from '@/components/learn/LessonView';

/** Lesson ids are runtime data (Mongo ObjectIds) — nothing to pre-render. */
export default async function LessonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  return (
    <div className="min-h-screen bg-bg-primary text-ink-primary">
      <SiteHeader active="Learn" />
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <LessonView id={id} />
      </main>
    </div>
  );
}
