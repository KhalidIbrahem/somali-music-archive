'use client';

/**
 * TeachStudio (/teach) — where educators author lessons (SESSION "teaching").
 *
 * Role-gated: educators and admins get the composer + their lesson list; other
 * signed-in members get a card explaining how educator access is granted;
 * signed-out visitors are sent to /login?next=/teach.
 *
 * Attachment upload follows the platform's presigned flow (§8): ask the API
 * for a lessons/-prefixed PUT URL, send the bytes straight to R2, then attach
 * the returned fileKey — the file never passes through our servers.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  LessonAttachment,
  LessonAttachmentContentType,
  TeachingLesson,
  TeachingTrack,
} from '@sma/types';
import { LESSON_ATTACHMENT_CONTENT_TYPES, TEACHING_TRACKS } from '@sma/types';
import {
  ApiError,
  createTeachingLesson,
  deleteTeachingLesson,
  listMyTeachingLessons,
  requestLessonUploadUrl,
  updateTeachingLesson,
  uploadFileToR2,
} from '@/lib/api';
import { useSession } from '@/lib/session';

const TRACK_LABELS: Record<TeachingTrack, string> = {
  general: 'General',
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

const MAX_ATTACHMENTS = 10;

function asAttachmentContentType(mime: string): LessonAttachmentContentType | null {
  return (LESSON_ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(mime)
    ? (mime as LessonAttachmentContentType)
    : null;
}

export function TeachStudio(): React.JSX.Element {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session.status === 'signed-out') router.replace('/login?next=/teach');
  }, [session.status, router]);

  if (session.status !== 'signed-in') {
    return <p className="font-body text-sm text-ink-tertiary">Loading the teaching studio…</p>;
  }

  const { user } = session;
  if (user.role !== 'educator' && user.role !== 'admin') {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4 rounded-2xl border border-line-secondary bg-bg-secondary p-10 text-center">
        <h1 className="font-display text-3xl">The teaching studio is for educators</h1>
        <p className="font-body text-sm text-ink-secondary">
          You are signed in as <span className="text-ink-primary">{user.email}</span>. If you teach
          or research Somali music and want to publish lessons here, ask the archive team to grant
          your account educator access — then this page unlocks automatically.
        </p>
        <Link href="/learn" className="font-body text-sm text-amber hover:underline">
          Browse the published lessons →
        </Link>
      </div>
    );
  }

  return <EducatorWorkspace />;
}

// ── The educator's actual workspace ─────────────────────────────────────────

interface PendingAttachment extends LessonAttachment {
  /** Local-only flag while the bytes travel to R2. */
  uploading?: boolean;
}

function EducatorWorkspace(): React.JSX.Element {
  const [mine, setMine] = useState<readonly TeachingLesson[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listMyTeachingLessons()
      .then(setMine)
      .catch(() => setListError('Could not load your lessons.'));
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <div className="flex flex-col gap-12">
      <header className="flex max-w-2xl flex-col gap-3">
        <p className="font-body text-sm uppercase tracking-widest text-amber">Teaching studio</p>
        <h1 className="font-display text-4xl sm:text-5xl">Share what you know</h1>
        <p className="font-body text-ink-secondary">
          Write a lesson, attach readings or listening examples, and publish it to{' '}
          <Link href="/learn" className="text-amber hover:underline">
            the archive&rsquo;s Learn page
          </Link>
          . Drafts stay private until you publish them.
        </p>
      </header>

      <Composer onCreated={(lesson) => setMine((current) => [lesson, ...(current ?? [])])} />

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl">Your lessons</h2>
        {listError !== null ? (
          <p role="alert" className="font-body text-sm text-red-400">
            {listError}
          </p>
        ) : mine === null ? (
          <p className="font-body text-sm text-ink-tertiary">Loading…</p>
        ) : mine.length === 0 ? (
          <p className="font-body text-sm text-ink-tertiary">
            Nothing yet — your first lesson will appear here.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {mine.map((lesson) => (
              <MyLessonRow
                key={lesson.id}
                lesson={lesson}
                onChanged={(updated) =>
                  setMine((current) =>
                    (current ?? []).map((l) => (l.id === updated.id ? updated : l)),
                  )
                }
                onDeleted={(id) => setMine((current) => (current ?? []).filter((l) => l.id !== id))}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  onCreated,
}: {
  onCreated: (lesson: TeachingLesson) => void;
}): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [track, setTrack] = useState<TeachingTrack>('general');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [publishNow, setPublishNow] = useState(true);
  const [attachments, setAttachments] = useState<readonly PendingAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploading = attachments.some((a) => a.uploading === true);

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    setError(null);
    for (const file of Array.from(files)) {
      if (attachments.length >= MAX_ATTACHMENTS) {
        setError(`A lesson can carry at most ${MAX_ATTACHMENTS} files.`);
        break;
      }
      const contentType = asAttachmentContentType(file.type);
      if (contentType === null) {
        setError(
          `"${file.name}" is not a supported type — use PDF, JPEG/PNG, or MP3/WAV/M4A audio.`,
        );
        continue;
      }
      // Optimistic row while the bytes travel; replaced or removed on settle.
      const placeholderKey = `pending:${file.name}:${file.size}`;
      const pending: PendingAttachment = {
        fileKey: placeholderKey,
        name: file.name,
        contentType,
        sizeBytes: file.size,
        uploading: true,
      };
      setAttachments((current) => [...current, pending]);
      try {
        const presign = await requestLessonUploadUrl({
          filename: file.name,
          contentType,
          sizeBytes: file.size,
        });
        await uploadFileToR2(presign.uploadUrl, file, contentType);
        setAttachments((current) =>
          current.map((a) =>
            a.fileKey === placeholderKey
              ? { fileKey: presign.fileKey, name: file.name, contentType, sizeBytes: file.size }
              : a,
          ),
        );
      } catch (err) {
        setAttachments((current) => current.filter((a) => a.fileKey !== placeholderKey));
        setError(
          err instanceof ApiError
            ? `Upload of "${file.name}" failed: ${err.message}`
            : `Upload of "${file.name}" failed. Please try again.`,
        );
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (fileKey: string): void => {
    setAttachments((current) => current.filter((a) => a.fileKey !== fileKey));
  };

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (uploading) {
      setError('Wait for the file uploads to finish first.');
      return;
    }
    if (body.trim() === '' && summary.trim() === '' && attachments.length === 0) {
      setError('Add some lesson text or at least one file.');
      return;
    }
    setBusy(true);
    try {
      const lesson = await createTeachingLesson({
        title: title.trim(),
        summary: summary.trim(),
        body: body.trim(),
        track,
        attachments: attachments.map(({ uploading: _flag, ...attachment }) => attachment),
        status: publishNow ? 'published' : 'draft',
      });
      onCreated(lesson);
      setTitle('');
      setSummary('');
      setBody('');
      setTrack('general');
      setAttachments([]);
      setPublishNow(true);
      setNotice(
        lesson.status === 'published'
          ? 'Published — the lesson is live on the Learn page.'
          : 'Saved as a draft — publish it from the list below when it is ready.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the lesson.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-5 rounded-2xl border border-line-secondary bg-bg-secondary p-8"
    >
      <h2 className="font-display text-2xl">New lesson</h2>

      <label className="flex flex-col gap-1.5">
        <span className="font-body text-sm text-ink-secondary">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          minLength={3}
          maxLength={160}
          placeholder="e.g. Week 1 — Qaraami and the pentatonic scale"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-body text-sm text-ink-secondary">Track</span>
        <div className="flex flex-wrap gap-2">
          {TEACHING_TRACKS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTrack(t)}
              aria-pressed={track === t}
              className={`rounded-full border px-3.5 py-1.5 font-body text-sm transition-colors ${
                track === t
                  ? 'border-amber bg-amber/10 text-amber'
                  : 'border-line-primary text-ink-secondary hover:border-amber/40'
              }`}
            >
              {TRACK_LABELS[t]}
            </button>
          ))}
        </div>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-body text-sm text-ink-secondary">Summary (shown on the list)</span>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={500}
          placeholder="One or two sentences about what this lesson covers."
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-body text-sm text-ink-secondary">Lesson text</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          maxLength={50_000}
          placeholder={'Write the lesson here.\n\nBlank lines start new paragraphs.'}
          className={`${inputClass} resize-y leading-relaxed`}
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="font-body text-sm text-ink-secondary">
          Files — readings, slides, audio examples (PDF, JPEG/PNG, MP3/WAV/M4A)
        </span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={LESSON_ATTACHMENT_CONTENT_TYPES.join(',')}
          onChange={(e) => void addFiles(e.target.files)}
          className="font-body text-sm text-ink-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-amber file:px-3.5 file:py-2 file:font-body file:text-sm file:font-semibold file:text-bg-primary hover:file:opacity-90"
        />
        {attachments.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {attachments.map((attachment) => (
              <li
                key={attachment.fileKey}
                className="flex items-center justify-between gap-3 rounded-lg border border-line-primary px-3 py-2"
              >
                <span className="min-w-0 truncate font-body text-sm text-ink-primary">
                  {attachment.name}
                </span>
                {attachment.uploading === true ? (
                  <span className="shrink-0 font-body text-xs text-ink-tertiary">Uploading…</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.fileKey)}
                    aria-label={`Remove ${attachment.name}`}
                    className="shrink-0 font-body text-xs text-red-400 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={publishNow}
          onChange={(e) => setPublishNow(e.target.checked)}
          className="h-4 w-4 accent-amber"
        />
        <span className="font-body text-sm text-ink-secondary">
          Publish immediately (otherwise it is saved as a private draft)
        </span>
      </label>

      {error !== null ? (
        <p role="alert" className="font-body text-sm text-red-400">
          {error}
        </p>
      ) : null}
      {notice !== null ? (
        <p role="status" className="font-body text-sm text-amber">
          {notice}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || uploading}
        className="w-fit rounded-lg bg-amber px-5 py-2.5 font-body text-sm font-semibold text-bg-primary transition-opacity disabled:opacity-50"
      >
        {busy ? 'Saving…' : publishNow ? 'Publish lesson' : 'Save draft'}
      </button>
    </form>
  );
}

// ── One row in "Your lessons" ────────────────────────────────────────────────

function MyLessonRow({
  lesson,
  onChanged,
  onDeleted,
}: {
  lesson: TeachingLesson;
  onChanged: (lesson: TeachingLesson) => void;
  onDeleted: (id: string) => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const toggleStatus = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateTeachingLesson(lesson.id, {
        status: lesson.status === 'published' ? 'draft' : 'published',
      });
      onChanged(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the lesson.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await deleteTeachingLesson(lesson.id);
      onDeleted(lesson.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the lesson.');
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line-secondary bg-bg-secondary p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 font-body text-[11px] font-semibold uppercase tracking-wide ${
                lesson.status === 'published'
                  ? 'bg-amber/15 text-amber'
                  : 'border border-line-primary text-ink-tertiary'
              }`}
            >
              {lesson.status}
            </span>
            <span className="font-body text-xs text-ink-tertiary">
              {TRACK_LABELS[lesson.track]}
              {lesson.attachments.length > 0
                ? ` · ${lesson.attachments.length} ${lesson.attachments.length === 1 ? 'file' : 'files'}`
                : ''}
            </span>
          </div>
          <Link
            href={`/learn/${lesson.id}`}
            className="truncate font-display text-lg text-ink-primary hover:text-amber"
          >
            {lesson.title}
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void toggleStatus()}
            disabled={busy}
            className="rounded-lg border border-amber/40 px-3 py-1.5 font-body text-xs font-semibold text-amber transition-colors hover:bg-amber hover:text-bg-primary disabled:opacity-50"
          >
            {lesson.status === 'published' ? 'Unpublish' : 'Publish'}
          </button>
          {confirmingDelete ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="rounded-lg bg-red-400/90 px-3 py-1.5 font-body text-xs font-semibold text-bg-primary disabled:opacity-50"
              >
                Confirm remove
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="font-body text-xs text-ink-tertiary hover:text-ink-primary"
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              className="rounded-lg border border-line-primary px-3 py-1.5 font-body text-xs text-ink-secondary transition-colors hover:border-red-400/50 hover:text-red-400 disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {error !== null ? (
        <p role="alert" className="font-body text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </li>
  );
}

const inputClass =
  'w-full rounded-lg border border-line-primary bg-bg-tertiary px-3 py-2 font-body text-ink-primary outline-none transition-colors placeholder:text-ink-tertiary/60 focus:border-amber';
