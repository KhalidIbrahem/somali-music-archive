'use client';

/**
 * /account — the member dashboard (SESSION "teaching"; §7 Profile screen,
 * web form). Shows who is signed in (name, email, phone, role, member-since),
 * lets the member fix their display name, links each role to its workspace
 * (educators → /teach, admins → /admin), and carries the sign-out everyone
 * reaches for. Signed-out visitors are sent to /login?next=/account.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, logout, updateMyProfile } from '@/lib/api';
import { clearSession } from '@/lib/auth';
import { invalidateSessionCache, useSession } from '@/lib/session';
import { SiteHeader } from '@/components/SiteHeader';

const LANGUAGE_LABELS: Record<string, string> = { so: 'Somali', ar: 'Arabic', en: 'English' };

export default function AccountPage(): React.JSX.Element {
  const session = useSession();
  const router = useRouter();

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === 'signed-out') {
      router.replace('/login?next=/account');
    }
  }, [session.status, router]);

  if (session.status !== 'signed-in') {
    return (
      <div className="min-h-screen bg-bg-primary">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-24 text-center">
          <p className="font-body text-ink-secondary">Loading your account…</p>
        </main>
      </div>
    );
  }

  const { user } = session;
  const displayName = savedName ?? user.displayName;
  const initial = (displayName.trim()[0] ?? '?').toUpperCase();
  const canTeach = user.role === 'educator' || user.role === 'admin';
  const memberSince = new Date(user.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const saveName = async (): Promise<void> => {
    const trimmed = nameDraft.trim();
    if (trimmed.length < 2) {
      setNameError('Name is too short.');
      return;
    }
    setNameBusy(true);
    setNameError(null);
    try {
      const updated = await updateMyProfile({ displayName: trimmed });
      setSavedName(updated.displayName);
      invalidateSessionCache(); // next session read refetches the fresh profile
      setEditingName(false);
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : 'Could not save your name.');
    } finally {
      setNameBusy(false);
    }
  };

  const signOut = (): void => {
    void logout().catch(() => undefined);
    clearSession();
    invalidateSessionCache();
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-bg-primary text-ink-primary">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-1">
          <p className="font-body text-sm uppercase tracking-widest text-amber">My account</p>
          <h1 className="font-display text-4xl">Salaan, {displayName.split(' ')[0]}</h1>
        </header>

        {/* ── Profile ─────────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-6 rounded-2xl border border-line-secondary bg-bg-secondary p-8">
          <div className="flex items-start gap-5">
            <span
              aria-hidden
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-amber/15 font-display text-3xl text-amber"
            >
              {initial}
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              {editingName ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveName();
                  }}
                >
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    maxLength={60}
                    autoFocus
                    aria-label="Display name"
                    className="rounded-lg border border-line-primary bg-bg-tertiary px-3 py-1.5 font-body text-ink-primary outline-none focus:border-amber"
                  />
                  <button
                    type="submit"
                    disabled={nameBusy}
                    className="rounded-lg bg-amber px-3 py-1.5 font-body text-sm font-semibold text-bg-primary disabled:opacity-50"
                  >
                    {nameBusy ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingName(false)}
                    className="font-body text-sm text-ink-tertiary hover:text-ink-primary"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex items-center gap-3">
                  <h2 className="truncate font-display text-2xl">{displayName}</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setNameDraft(displayName);
                      setEditingName(true);
                    }}
                    className="font-body text-xs text-amber hover:underline"
                  >
                    Edit
                  </button>
                </div>
              )}
              {nameError ? (
                <p role="alert" className="font-body text-xs text-red-400">
                  {nameError}
                </p>
              ) : null}
              <span className="inline-flex w-fit items-center rounded-full bg-amber/15 px-2.5 py-0.5 font-body text-xs font-semibold uppercase tracking-wide text-amber">
                {user.role}
              </span>
            </div>
          </div>

          <dl className="grid gap-x-8 gap-y-3 font-body text-sm sm:grid-cols-2">
            <ProfileRow label="Email">
              <span className="break-all">{user.email}</span>
              {user.emailVerified ? (
                <span className="ml-2 text-xs text-ink-tertiary">verified</span>
              ) : (
                <span className="ml-2 text-xs text-ink-tertiary">not verified</span>
              )}
            </ProfileRow>
            <ProfileRow label="Phone">
              {user.phone ?? <span className="text-ink-tertiary">Not added</span>}
            </ProfileRow>
            <ProfileRow label="Preferred language">
              {LANGUAGE_LABELS[user.language] ?? user.language}
            </ProfileRow>
            <ProfileRow label="Member since">{memberSince}</ProfileRow>
          </dl>
        </section>

        {/* ── Teaching ────────────────────────────────────────────────────── */}
        {canTeach ? (
          <section className="flex flex-col gap-3 rounded-2xl border border-amber/30 bg-amber/5 p-8">
            <h2 className="font-display text-2xl">Teaching studio</h2>
            <p className="max-w-xl font-body text-sm text-ink-secondary">
              Publish lessons and share course material — readings, slides, and audio examples —
              with everyone learning from the archive.
            </p>
            <Link
              href="/teach"
              className="w-fit rounded-lg bg-amber px-5 py-2.5 font-body text-sm font-semibold text-bg-primary transition-transform hover:-translate-y-0.5"
            >
              Open the teaching studio
            </Link>
          </section>
        ) : null}

        {/* ── Places ──────────────────────────────────────────────────────── */}
        <section className="grid gap-3 sm:grid-cols-3">
          <PlaceCard href="/listen" title="Listening room" blurb="The archive's recordings." />
          <PlaceCard href="/learn" title="Lessons" blurb="Published teaching material." />
          <PlaceCard href="/library" title="Library" blurb="Scanned songbooks and scores." />
        </section>

        {/* ── Session ─────────────────────────────────────────────────────── */}
        <section className="flex items-center justify-between rounded-2xl border border-line-secondary p-6">
          <p className="font-body text-sm text-ink-secondary">
            Signed in on this device{user.lastLoginAt ? '' : ' since registration'}.
          </p>
          <button
            type="button"
            onClick={signOut}
            className="rounded-lg border border-red-400/40 px-4 py-2 font-body text-sm font-semibold text-red-400 transition-colors hover:bg-red-400/10"
          >
            Sign out
          </button>
        </section>
      </main>
    </div>
  );
}

function ProfileRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-ink-tertiary">{label}</dt>
      <dd className="text-ink-primary">{children}</dd>
    </div>
  );
}

function PlaceCard({
  href,
  title,
  blurb,
}: {
  href: string;
  title: string;
  blurb: string;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-xl border border-line-secondary bg-bg-secondary p-5 transition-colors hover:border-amber/50"
    >
      <span className="font-display text-lg text-ink-primary">{title}</span>
      <span className="font-body text-xs text-ink-tertiary">{blurb}</span>
    </Link>
  );
}
