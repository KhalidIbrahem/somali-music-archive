'use client';

/**
 * Dashboard (Stage 3, "high-class dashboard redesign") — the signed-in home.
 *
 * Four sections per the master plan: My Studio (DAW projects) · Courses ·
 * Library · Admin (admin only), on the studio token system (chrome surfaces,
 * hairlines, one amber accent, IBM Plex numerics) rather than the marketing
 * palette — this is a workroom, not a brochure. Every section owns its
 * loading skeleton and a designed empty state; failures degrade to quiet
 * placeholders, never error walls.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { LibraryBook, PublicUser, TeachingLesson } from '@sma/types';
import {
  ApiError,
  listBooks,
  listCourses,
  listInvites,
  listStudioProjects,
  listTeachingLessons,
  listUsers,
  logout,
  updateMyProfile,
  type CourseSummary,
  type StudioProjectSummary,
} from '@/lib/api';
import { clearSession } from '@/lib/auth';
import { invalidateSessionCache, useSession } from '@/lib/session';

/** 'loading' → skeleton; null → quiet unavailable state; data → render. */
type Loadable<T> = 'loading' | T | null;

export function Dashboard(): React.JSX.Element {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session.status === 'signed-out') router.replace('/login?next=/account');
  }, [session.status, router]);

  if (session.status !== 'signed-in') {
    return (
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <HeaderSkeleton />
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <SectionSkeleton />
          <SectionSkeleton />
          <SectionSkeleton />
          <SectionSkeleton />
        </div>
      </main>
    );
  }

  return <DashboardBody user={session.user} />;
}

function DashboardBody({ user }: { user: PublicUser }): React.JSX.Element {
  const router = useRouter();
  const isAdmin = user.role === 'admin';
  const canTeach = isAdmin || user.role === 'educator';

  const [projects, setProjects] = useState<Loadable<readonly StudioProjectSummary[]>>('loading');
  const [courses, setCourses] = useState<Loadable<readonly CourseSummary[]>>('loading');
  const [lessons, setLessons] = useState<Loadable<readonly TeachingLesson[]>>('loading');
  const [books, setBooks] = useState<Loadable<readonly LibraryBook[]>>('loading');
  const [memberCount, setMemberCount] = useState<Loadable<number>>('loading');
  const [inviteActive, setInviteActive] = useState<Loadable<number>>('loading');

  useEffect(() => {
    let cancelled = false;
    const guard = <T,>(set: (v: Loadable<T>) => void) => ({
      ok: (v: T) => {
        if (!cancelled) set(v);
      },
      fail: () => {
        if (!cancelled) set(null);
      },
    });

    const p = guard<readonly StudioProjectSummary[]>(setProjects);
    listStudioProjects().then(p.ok).catch(p.fail);
    const c = guard<readonly CourseSummary[]>(setCourses);
    listCourses().then(c.ok).catch(c.fail);
    const l = guard<readonly TeachingLesson[]>(setLessons);
    listTeachingLessons().then(l.ok).catch(l.fail);
    const b = guard<readonly LibraryBook[]>(setBooks);
    listBooks().then(b.ok).catch(b.fail);
    if (isAdmin) {
      const m = guard<number>(setMemberCount);
      listUsers({ page: 1 })
        .then((r) => m.ok(r.total))
        .catch(m.fail);
      const i = guard<number>(setInviteActive);
      listInvites()
        .then((list) => i.ok(list.filter((inv) => inv.status === 'active').length))
        .catch(i.fail);
    }
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const signOut = (): void => {
    void logout().catch(() => undefined);
    clearSession();
    invalidateSessionCache();
    router.push('/');
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <DashboardHeader user={user} onSignOut={signOut} />

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        {/* ── My Studio ─────────────────────────────────────────────────── */}
        <Section
          eyebrow="My Studio"
          title="Compositions"
          action={{ href: '/daw', label: 'Open the studio' }}
          wide={projects !== 'loading' && projects !== null && projects.length > 0}
        >
          {projects === 'loading' ? (
            <RowSkeletons rows={2} />
          ) : projects === null || projects.length === 0 ? (
            <EmptyState
              glyph="◫"
              title="No projects yet"
              body="Open the studio and start with the Beerdilaacshe demo project — oud, durbaan, and the qaraami scale, ready to edit."
              cta={{ href: '/daw', label: 'Start composing' }}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {projects.slice(0, 5).map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/daw?project=${project.id}`}
                    className="group flex items-center justify-between rounded-[4px] border border-hairline bg-chrome-2 px-4 py-3 transition-colors hover:border-accent-state focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
                  >
                    <span className="min-w-0 truncate text-sm text-hi">{project.name}</span>
                    <span className="numeric shrink-0 pl-4 text-[11px] text-low group-hover:text-accent-state">
                      {project.bpm} BPM · {new Date(project.updatedAt).toLocaleDateString()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ── Courses ───────────────────────────────────────────────────── */}
        <Section
          eyebrow="Courses"
          title="Learning"
          action={{ href: '/courses', label: 'All courses' }}
        >
          {courses === 'loading' ? (
            <RowSkeletons rows={2} />
          ) : courses === null || courses.length === 0 ? (
            <EmptyState
              glyph="♪"
              title="Courses are being prepared"
              body="Structured lessons — oud, piano, and more — with playable sheet music. The first course starts with Beerdilaacshe."
              cta={{ href: '/learn', label: 'Browse lessons meanwhile' }}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {courses.slice(0, 4).map((course) => (
                <li key={course.id}>
                  <Link
                    href={`/courses/${course.id}`}
                    className="group block rounded-[4px] border border-hairline bg-chrome-2 px-4 py-3 transition-colors hover:border-accent-state focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
                  >
                    <div className="flex items-center justify-between">
                      <span className="min-w-0 truncate text-sm text-hi">{course.title}</span>
                      <span className="numeric shrink-0 pl-4 text-[11px] text-low">
                        {course.completedCount}/{course.lessonCount} done
                      </span>
                    </div>
                    <ProgressBar
                      value={
                        course.lessonCount > 0 ? course.completedCount / course.lessonCount : 0
                      }
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ── Library ───────────────────────────────────────────────────── */}
        <Section
          eyebrow="Library"
          title="Sheet music & sources"
          action={{ href: '/library', label: 'Open the library' }}
        >
          {books === 'loading' ? (
            <RowSkeletons rows={2} />
          ) : books === null ? (
            <Unavailable label="The library shelf is unreachable right now." />
          ) : books.length === 0 ? (
            <EmptyState
              glyph="▤"
              title="The shelf is empty"
              body="Upload scanned songbooks and notation — PDFs or page images — and they are kept for good."
              cta={{ href: '/library', label: 'Upload the first scan' }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <Stat value={String(books.length)} label="documents on the shelf" />
              <ul className="flex flex-col gap-1.5">
                {books.slice(0, 3).map((book) => (
                  <li key={book.id} className="truncate text-sm text-mid">
                    <span className="text-low">·</span> {book.title}
                    {book.author ? <span className="text-low"> — {book.author}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        {/* ── Teaching / lessons for members ────────────────────────────── */}
        <Section
          eyebrow={canTeach ? 'Teaching' : 'Lessons'}
          title={canTeach ? 'Your material' : 'From the educators'}
          action={
            canTeach
              ? { href: '/teach', label: 'Teaching studio' }
              : { href: '/learn', label: 'All lessons' }
          }
        >
          {lessons === 'loading' ? (
            <RowSkeletons rows={2} />
          ) : lessons === null || lessons.length === 0 ? (
            <EmptyState
              glyph="✎"
              title={canTeach ? 'Nothing published yet' : 'No lessons yet'}
              body={
                canTeach
                  ? 'Write a lesson, attach readings or listening examples, and publish it to the Learn page.'
                  : 'Lessons written by the platform’s educators will appear here.'
              }
              cta={canTeach ? { href: '/teach', label: 'Write a lesson' } : undefined}
            />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {lessons.slice(0, 4).map((lesson) => (
                <li key={lesson.id} className="truncate">
                  <Link
                    href={`/learn/${lesson.id}`}
                    className="text-sm text-mid transition-colors hover:text-hi"
                  >
                    <span className="text-low">·</span> {lesson.title}
                    <span className="numeric pl-2 text-[11px] text-low">{lesson.authorName}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ── Admin ─────────────────────────────────────────────────────── */}
        {isAdmin ? (
          <section className="lg:col-span-2">
            <div className="rounded-[4px] border border-accent-state/30 bg-chrome-1 p-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="numeric text-[11px] tracking-[0.2em] text-accent-state uppercase">
                    Admin
                  </p>
                  <h2 className="mt-1 font-display text-2xl text-hi">Run the platform</h2>
                </div>
                <div className="flex gap-6">
                  <Stat
                    value={
                      memberCount === 'loading' || memberCount === null ? '—' : String(memberCount)
                    }
                    label="members"
                  />
                  <Stat
                    value={
                      inviteActive === 'loading' || inviteActive === null
                        ? '—'
                        : String(inviteActive)
                    }
                    label="live invite codes"
                  />
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <AdminLink href="/admin/invites" label="Invite codes" />
                <AdminLink href="/admin/members" label="Members" />
                <AdminLink href="/admin" label="Recordings" />
                <AdminLink href="/admin/organizations" label="Organizations" />
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function DashboardHeader({
  user,
  onSignOut,
}: {
  user: PublicUser;
  onSignOut: () => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const displayName = savedName ?? user.displayName;

  const save = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (trimmed.length < 2) {
      setError('Name is too short.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await updateMyProfile({ displayName: trimmed });
      setSavedName(updated.displayName);
      invalidateSessionCache();
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your name.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-6">
      <div className="min-w-0">
        <p className="numeric text-[11px] tracking-[0.2em] text-accent-state uppercase">
          Dashboard
        </p>
        {editing ? (
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={60}
              autoFocus
              aria-label="Display name"
              className="rounded-[4px] border border-hairline bg-chrome-2 px-3 py-1.5 text-hi outline-none focus:border-accent-state"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-[4px] bg-accent-state px-3 py-1.5 text-sm font-semibold text-page disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-sm text-low hover:text-hi"
            >
              Cancel
            </button>
          </form>
        ) : (
          <h1 className="mt-1 flex items-center gap-3 font-display text-3xl text-hi sm:text-4xl">
            <span className="truncate">Salaan, {displayName.split(' ')[0]}</span>
            <button
              type="button"
              onClick={() => {
                setDraft(displayName);
                setEditing(true);
              }}
              className="numeric text-[11px] tracking-[0.14em] text-low uppercase transition-colors hover:text-accent-state"
            >
              edit
            </button>
          </h1>
        )}
        {error !== null ? (
          <p role="alert" className="mt-1 text-xs text-mid">
            {error}
          </p>
        ) : null}
        <p className="numeric mt-2 truncate text-xs text-low">
          {user.username ? `@${user.username} · ` : ''}
          {user.email}
          {user.phone ? ` · ${user.phone}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="numeric rounded-full border border-accent-state/40 px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] text-accent-state uppercase">
          {user.role}
        </span>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded-[4px] border border-hairline px-3.5 py-1.5 text-sm text-mid transition-colors hover:border-hi hover:text-hi"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

// ── Building blocks ───────────────────────────────────────────────────────────

function Section({
  eyebrow,
  title,
  action,
  wide = false,
  children,
}: {
  eyebrow: string;
  title: string;
  action?: { href: string; label: string };
  wide?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className={wide ? 'lg:col-span-2' : undefined}>
      <div className="flex h-full flex-col rounded-[4px] border border-hairline bg-chrome-1 p-6">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <p className="numeric text-[11px] tracking-[0.2em] text-accent-state uppercase">
              {eyebrow}
            </p>
            <h2 className="mt-1 font-display text-2xl text-hi">{title}</h2>
          </div>
          {action ? (
            <Link
              href={action.href}
              className="numeric shrink-0 text-[11px] tracking-[0.14em] text-low uppercase transition-colors hover:text-accent-state"
            >
              {action.label} →
            </Link>
          ) : null}
        </div>
        <div className="mt-5 flex-1">{children}</div>
      </div>
    </section>
  );
}

function EmptyState({
  glyph,
  title,
  body,
  cta,
}: {
  glyph: string;
  title: string;
  body: string;
  cta?: { href: string; label: string } | undefined;
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-2 rounded-[4px] border border-dashed border-hairline px-5 py-6">
      <span aria-hidden className="text-2xl text-low">
        {glyph}
      </span>
      <p className="text-sm font-semibold text-hi">{title}</p>
      <p className="max-w-md text-sm leading-relaxed text-mid">{body}</p>
      {cta ? (
        <Link
          href={cta.href}
          className="mt-2 rounded-[4px] bg-accent-state px-4 py-2 text-sm font-semibold text-page transition-transform hover:-translate-y-0.5 motion-reduce:transition-none"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}

function Unavailable({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center rounded-[4px] border border-dashed border-hairline px-5 py-6">
      <p className="text-sm text-low">{label}</p>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <div>
      <p className="numeric text-2xl text-hi">{value}</p>
      <p className="mt-0.5 text-[11px] text-low">{label}</p>
    </div>
  );
}

function ProgressBar({ value }: { value: number }): React.JSX.Element {
  return (
    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-chrome-2">
      <div
        className="h-full rounded-full bg-accent-state transition-[width] duration-500"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
    </div>
  );
}

function AdminLink({ href, label }: { href: string; label: string }): React.JSX.Element {
  return (
    <Link
      href={href}
      className="rounded-[4px] border border-hairline bg-chrome-2 px-4 py-2 text-sm text-mid transition-colors hover:border-accent-state hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
    >
      {label}
    </Link>
  );
}

function HeaderSkeleton(): React.JSX.Element {
  return (
    <div className="border-b border-hairline pb-6">
      <div className="h-3 w-24 animate-pulse rounded bg-chrome-2" />
      <div className="mt-3 h-9 w-64 animate-pulse rounded bg-chrome-2" />
      <div className="mt-3 h-3 w-80 animate-pulse rounded bg-chrome-2" />
    </div>
  );
}

function SectionSkeleton(): React.JSX.Element {
  return (
    <div className="rounded-[4px] border border-hairline bg-chrome-1 p-6">
      <div className="h-3 w-20 animate-pulse rounded bg-chrome-2" />
      <div className="mt-3 h-7 w-40 animate-pulse rounded bg-chrome-2" />
      <RowSkeletons rows={2} />
    </div>
  );
}

function RowSkeletons({ rows }: { rows: number }): React.JSX.Element {
  return (
    <div className="mt-5 flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-11 animate-pulse rounded-[4px] bg-chrome-2" />
      ))}
    </div>
  );
}
