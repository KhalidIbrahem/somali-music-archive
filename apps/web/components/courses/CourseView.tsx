'use client';

/**
 * CourseView (/courses/[id]) — one course: ordered lessons, each with its
 * media, embedded sheet music (the Beerdilaacshe pattern: PDF object with a
 * download fallback + the shared oud/durbaan engine performing the parsed
 * notes), and a per-user mark-complete toggle.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  getCourse,
  setCourseLessonProgress,
  type CourseDetail,
  type CourseLessonView,
} from '@/lib/api';
import { useSession } from '@/lib/session';
import { ScorePlayer, type ScoreData } from '@/components/scores/ScorePlayer';

export function CourseView({ id }: { id: string }): React.JSX.Element {
  const session = useSession();
  const router = useRouter();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === 'signed-out') router.replace(`/login?next=/courses/${id}`);
  }, [session.status, router, id]);

  useEffect(() => {
    if (session.status !== 'signed-in') return;
    let cancelled = false;
    getCourse(id)
      .then((c) => {
        if (!cancelled) setCourse(c);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError && err.code === 'NOT_FOUND'
            ? 'This course does not exist.'
            : 'Could not load the course. Please try again in a moment.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [session.status, id]);

  if (error !== null) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="alert" className="text-mid">
          {error}
        </p>
        <Link href="/courses" className="text-sm text-accent-state hover:underline">
          ← All courses
        </Link>
      </div>
    );
  }
  if (course === null) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-8 w-72 animate-pulse rounded bg-chrome-1" />
        <div className="h-40 animate-pulse rounded-[4px] bg-chrome-1" />
      </div>
    );
  }

  return (
    <article className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <Link href="/courses" className="text-sm text-accent-state hover:underline">
          ← All courses
        </Link>
        <span className="numeric w-fit rounded-full border border-hairline px-2.5 py-0.5 text-[11px] tracking-[0.14em] text-low uppercase">
          {course.instrument} · {course.completedCount}/{course.lessonCount} complete
        </span>
        <h1 className="font-display text-4xl leading-tight">{course.title}</h1>
        <p className="max-w-2xl leading-relaxed text-mid">{course.description}</p>
      </header>

      <ol className="flex flex-col gap-8">
        {course.lessons.map((lesson) => (
          <LessonCard
            key={lesson.id}
            courseId={course.id}
            lesson={lesson}
            onChanged={(updated) =>
              setCourse((current) =>
                current
                  ? {
                      ...current,
                      completedCount: current.completedCount + (updated.completed ? 1 : -1),
                      lessons: current.lessons.map((l) => (l.id === updated.id ? updated : l)),
                    }
                  : current,
              )
            }
          />
        ))}
      </ol>
    </article>
  );
}

function LessonCard({
  courseId,
  lesson,
  onChanged,
}: {
  courseId: string;
  lesson: CourseLessonView;
  onChanged: (lesson: CourseLessonView) => void;
}): React.JSX.Element {
  const [score, setScore] = useState<ScoreData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (lesson.notesUrl === null) return;
    let cancelled = false;
    void fetch(lesson.notesUrl)
      .then((res) => (res.ok ? (res.json() as Promise<ScoreData>) : null))
      .then((data) => {
        if (!cancelled && data) setScore(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lesson.notesUrl]);

  const toggleComplete = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { completed } = await setCourseLessonProgress(courseId, lesson.id, !lesson.completed);
      onChanged({ ...lesson, completed });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your progress.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-[4px] border border-hairline bg-chrome-1 p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-2xl text-hi">{lesson.title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mid">{lesson.description}</p>
        </div>
        <button
          type="button"
          onClick={() => void toggleComplete()}
          disabled={busy}
          aria-pressed={lesson.completed}
          className={`numeric shrink-0 rounded-full border px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase transition-colors disabled:opacity-50 ${
            lesson.completed
              ? 'border-accent-state bg-accent-state text-page'
              : 'border-hairline text-mid hover:border-accent-state hover:text-accent-state'
          }`}
        >
          {lesson.completed ? '✓ Completed' : 'Mark complete'}
        </button>
      </div>
      {error !== null ? (
        <p role="alert" className="mt-2 text-xs text-mid">
          {error}
        </p>
      ) : null}

      {lesson.mediaUrl !== null && lesson.mediaKind === 'audio' ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- archival audio; no caption track exists
        <audio controls src={lesson.mediaUrl} className="mt-6 w-full" />
      ) : null}
      {lesson.mediaUrl !== null && lesson.mediaKind === 'video' ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- course video; captions land with the media pipeline
        <video controls src={lesson.mediaUrl} className="mt-6 w-full rounded-[4px]" />
      ) : null}

      {score !== null ? (
        <div className="mt-6">
          <ScorePlayer data={score} />
        </div>
      ) : null}

      {lesson.pdfUrl !== null ? (
        <div className="mt-6">
          <object
            data={lesson.pdfUrl}
            type="application/pdf"
            className="h-[70vh] w-full rounded-[2px] bg-paper ring-1 ring-paper-edge"
          >
            <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-[4px] border border-dashed border-hairline">
              <p className="text-sm text-mid">Your browser does not display PDFs inline.</p>
              <a
                href={lesson.pdfUrl}
                download
                className="rounded-[4px] bg-accent-state px-4 py-2 text-sm font-semibold text-page"
              >
                Download the sheet music
              </a>
            </div>
          </object>
          <p className="numeric mt-2 text-[11px] tracking-[0.14em] text-low uppercase">
            Sheet music ·{' '}
            <a href={lesson.pdfUrl} download className="hover:text-accent-state">
              download PDF
            </a>
          </p>
        </div>
      ) : null}
    </li>
  );
}
