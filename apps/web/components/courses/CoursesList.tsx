'use client';

/**
 * CoursesList (/courses) — the course catalogue with the caller's progress.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { listCourses, type CourseSummary } from '@/lib/api';
import { useSession } from '@/lib/session';

export function CoursesList(): React.JSX.Element {
  const session = useSession();
  const router = useRouter();
  const [courses, setCourses] = useState<readonly CourseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === 'signed-out') router.replace('/login?next=/courses');
  }, [session.status, router]);

  useEffect(() => {
    if (session.status !== 'signed-in') return;
    let cancelled = false;
    listCourses()
      .then((list) => {
        if (!cancelled) setCourses(list);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the courses. Please try again in a moment.');
      });
    return () => {
      cancelled = true;
    };
  }, [session.status]);

  if (error !== null) {
    return (
      <p role="alert" className="text-sm text-mid">
        {error}
      </p>
    );
  }
  if (courses === null) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-44 animate-pulse rounded-[4px] bg-chrome-1" />
        <div className="h-44 animate-pulse rounded-[4px] bg-chrome-1" />
      </div>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {courses.map((course) => {
        const pct =
          course.lessonCount > 0
            ? Math.round((course.completedCount / course.lessonCount) * 100)
            : 0;
        return (
          <li key={course.id}>
            <Link
              href={`/courses/${course.id}`}
              className="flex h-full flex-col gap-3 rounded-[4px] border border-hairline bg-chrome-1 p-6 transition-colors hover:border-accent-state focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
            >
              <span className="numeric w-fit rounded-full border border-hairline px-2.5 py-0.5 text-[11px] tracking-[0.14em] text-low uppercase">
                {course.instrument}
              </span>
              <h2 className="font-display text-2xl text-hi">{course.title}</h2>
              <p className="text-sm leading-relaxed text-mid">{course.description}</p>
              <div className="mt-auto pt-2">
                <div className="flex items-center justify-between">
                  <span className="numeric text-[11px] text-low">
                    {course.completedCount}/{course.lessonCount} lessons ·{' '}
                    {course.lessonCount === 1 ? 'first lesson: Beerdilaacshe' : `${pct}% complete`}
                  </span>
                  <span className="numeric text-[11px] text-accent-state">{pct}%</span>
                </div>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-chrome-2">
                  <div
                    className="h-full rounded-full bg-accent-state transition-[width] duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
