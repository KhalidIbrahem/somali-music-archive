'use client';

/**
 * LessonList — the public reading list of educator-authored lessons (/learn).
 * Public endpoint: no session required. Track chips filter client-side; the
 * list is small enough that a single fetch is the right amount of machinery.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { TeachingLesson, TeachingTrack } from '@sma/types';
import { TEACHING_TRACKS } from '@sma/types';
import { listTeachingLessons } from '@/lib/api';

const TRACK_LABELS: Record<TeachingTrack, string> = {
  general: 'General',
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

type Filter = TeachingTrack | 'all';

export function LessonList(): React.JSX.Element {
  const [lessons, setLessons] = useState<readonly TeachingLesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let cancelled = false;
    listTeachingLessons()
      .then((list) => {
        if (!cancelled) setLessons(list);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the lessons. Please try again in a moment.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(
    () => (lessons ?? []).filter((l) => filter === 'all' || l.track === filter),
    [lessons, filter],
  );

  if (error !== null) {
    return (
      <p role="alert" className="font-body text-sm text-red-400">
        {error}
      </p>
    );
  }
  if (lessons === null) {
    return <p className="font-body text-sm text-ink-tertiary">Loading lessons…</p>;
  }
  if (lessons.length === 0) {
    return (
      <div className="rounded-2xl border border-line-secondary bg-bg-secondary p-10 text-center">
        <p className="font-display text-xl text-ink-primary">The first lessons are on their way</p>
        <p className="mx-auto mt-2 max-w-md font-body text-sm text-ink-secondary">
          Educators are preparing course material on qaraami, the pentatonic scale, and the
          archive&rsquo;s recordings. Check back soon.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by track">
        {(['all', ...TEACHING_TRACKS] as const).map((track) => (
          <button
            key={track}
            type="button"
            onClick={() => setFilter(track)}
            aria-pressed={filter === track}
            className={`rounded-full border px-3.5 py-1.5 font-body text-sm transition-colors ${
              filter === track
                ? 'border-amber bg-amber/10 text-amber'
                : 'border-line-primary text-ink-secondary hover:border-amber/40'
            }`}
          >
            {track === 'all' ? 'All' : TRACK_LABELS[track]}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="font-body text-sm text-ink-tertiary">No lessons on this track yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {visible.map((lesson) => (
            <li key={lesson.id}>
              <Link
                href={`/learn/${lesson.id}`}
                className="flex h-full flex-col gap-3 rounded-2xl border border-line-secondary bg-bg-secondary p-6 transition-colors hover:border-amber/50"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-amber/15 px-2.5 py-0.5 font-body text-[11px] font-semibold uppercase tracking-wide text-amber">
                    {TRACK_LABELS[lesson.track]}
                  </span>
                  {lesson.attachments.length > 0 ? (
                    <span className="font-body text-xs text-ink-tertiary">
                      {lesson.attachments.length}{' '}
                      {lesson.attachments.length === 1 ? 'file' : 'files'}
                    </span>
                  ) : null}
                </div>
                <h2 className="font-display text-xl text-ink-primary">{lesson.title}</h2>
                {lesson.summary ? (
                  <p className="line-clamp-3 font-body text-sm text-ink-secondary">
                    {lesson.summary}
                  </p>
                ) : null}
                <p className="mt-auto font-body text-xs text-ink-tertiary">
                  {lesson.authorName} ·{' '}
                  {new Date(lesson.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
