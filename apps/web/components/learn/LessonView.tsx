'use client';

/**
 * LessonView — one educator-authored lesson (/learn/[id]).
 *
 * Public for published lessons; the author (or an admin) also sees their drafts
 * because the API client sends the stored token when one exists. Attachments
 * are fetched through short-lived signed URLs minted per click (the bucket is
 * private); audio attachments play inline, documents open in a new tab.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { LessonAttachment, TeachingLesson, TeachingTrack } from '@sma/types';
import { ApiError, getLessonAttachmentUrl, getTeachingLesson } from '@/lib/api';

const TRACK_LABELS: Record<TeachingTrack, string> = {
  general: 'General',
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

function isAudio(attachment: LessonAttachment): boolean {
  return attachment.contentType.startsWith('audio/');
}

function formatSize(bytes: number | undefined): string | null {
  if (bytes === undefined) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LessonView({ id }: { id: string }): React.JSX.Element {
  const [lesson, setLesson] = useState<TeachingLesson | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTeachingLesson(id)
      .then((l) => {
        if (!cancelled) setLesson(l);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError && err.code === 'LESSON_NOT_FOUND'
            ? 'This lesson does not exist (or is not published yet).'
            : 'Could not load the lesson. Please try again in a moment.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error !== null) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="alert" className="font-body text-ink-secondary">
          {error}
        </p>
        <Link href="/learn" className="font-body text-sm text-amber hover:underline">
          ← Back to all lessons
        </Link>
      </div>
    );
  }
  if (lesson === null) {
    return <p className="font-body text-sm text-ink-tertiary">Loading lesson…</p>;
  }

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link href="/learn" className="font-body text-sm text-amber hover:underline">
          ← All lessons
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-amber/15 px-2.5 py-0.5 font-body text-[11px] font-semibold uppercase tracking-wide text-amber">
            {TRACK_LABELS[lesson.track]}
          </span>
          {lesson.status === 'draft' ? (
            <span className="rounded-full border border-line-primary px-2.5 py-0.5 font-body text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">
              Draft — only you can see this
            </span>
          ) : null}
        </div>
        <h1 className="font-display text-4xl leading-tight">{lesson.title}</h1>
        <p className="font-body text-sm text-ink-tertiary">
          {lesson.authorName} ·{' '}
          {new Date(lesson.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
        {lesson.summary ? (
          <p className="border-l-2 border-amber/50 pl-4 font-body text-lg text-ink-secondary">
            {lesson.summary}
          </p>
        ) : null}
      </header>

      {lesson.body ? (
        <div className="flex flex-col gap-4 font-body leading-relaxed text-ink-primary">
          {lesson.body.split(/\n{2,}/).map((paragraph, i) => (
            <p key={i} className="whitespace-pre-line">
              {paragraph}
            </p>
          ))}
        </div>
      ) : null}

      {lesson.attachments.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-2xl">Course material</h2>
          <ul className="flex flex-col gap-2">
            {lesson.attachments.map((attachment) => (
              <AttachmentRow
                key={attachment.fileKey}
                lessonId={lesson.id}
                attachment={attachment}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function AttachmentRow({
  lessonId,
  attachment,
}: {
  lessonId: string;
  attachment: LessonAttachment;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Signed URL for inline audio playback, fetched on first press. */
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const open = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await getLessonAttachmentUrl(lessonId, attachment.fileKey);
      if (isAudio(attachment)) {
        setAudioUrl(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      setError('Could not open this file. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const size = formatSize(attachment.sizeBytes);

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line-secondary bg-bg-secondary p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="text-lg">
            {isAudio(attachment) ? '🎧' : '📄'}
          </span>
          <div className="min-w-0">
            <p className="truncate font-body text-sm font-semibold text-ink-primary">
              {attachment.name}
            </p>
            <p className="font-body text-xs text-ink-tertiary">
              {attachment.contentType}
              {size ? ` · ${size}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          className="shrink-0 rounded-lg border border-amber/40 px-3.5 py-1.5 font-body text-sm font-semibold text-amber transition-colors hover:bg-amber hover:text-bg-primary disabled:opacity-50"
        >
          {busy ? 'Opening…' : isAudio(attachment) ? 'Play' : 'Open'}
        </button>
      </div>
      {audioUrl !== null ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- archival audio; no caption track exists
        <audio controls autoPlay src={audioUrl} className="w-full">
          Your browser cannot play this audio.
        </audio>
      ) : null}
      {error !== null ? (
        <p role="alert" className="font-body text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </li>
  );
}
