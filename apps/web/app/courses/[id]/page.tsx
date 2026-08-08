import { SiteHeader } from '@/components/SiteHeader';
import { CourseView } from '@/components/courses/CourseView';

/** Course ids are runtime data — render on demand. */
export default async function CoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  return (
    <div className="min-h-screen bg-page text-hi">
      <SiteHeader active="Courses" />
      <main className="mx-auto w-full max-w-4xl px-6 py-12">
        <CourseView id={id} />
      </main>
    </div>
  );
}
