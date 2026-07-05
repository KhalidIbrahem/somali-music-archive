'use client';

/**
 * Admin shell (SESSION P4-03) — the auth gate + section nav shared by every admin
 * page. Requires a stored token belonging to an `admin`; anyone else is bounced to
 * /admin/login. Children render only once admin access is confirmed, so each page
 * can assume it is authorised. (The login page lives outside this shell, so there
 * is no redirect loop.)
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getMe } from '@/lib/api';
import { getToken, clearToken } from '@/lib/auth';

export type AdminSection = 'recordings' | 'organizations';

const NAV: ReadonlyArray<{ key: AdminSection; label: string; href: string }> = [
  { key: 'recordings', label: 'Recordings', href: '/admin' },
  { key: 'organizations', label: 'Organizations', href: '/admin/organizations' },
];

export function AdminShell({
  active,
  children,
}: {
  active: AdminSection;
  children: React.ReactNode;
}): React.JSX.Element {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/admin/login');
      return;
    }
    getMe()
      .then((user) => {
        if (user.role !== 'admin') {
          clearToken();
          router.replace('/admin/login');
          return;
        }
        setReady(true);
      })
      .catch(() => {
        clearToken();
        router.replace('/admin/login');
      });
  }, [router]);

  const signOut = (): void => {
    clearToken();
    router.replace('/admin/login');
  };

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-primary">
        <p className="font-body text-ink-secondary">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <p className="font-body text-sm uppercase tracking-widest text-amber">Admin</p>
          <h1 className="font-display text-3xl text-ink-primary">Content management</h1>
        </div>
        <button
          onClick={signOut}
          className="rounded-lg border border-line-primary px-3 py-2 font-body text-sm text-ink-secondary transition-colors hover:text-ink-primary"
        >
          Sign out
        </button>
      </header>

      <nav className="flex gap-2 border-b border-line-secondary pb-3">
        {NAV.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={`rounded-full px-4 py-1.5 font-body text-sm ${
              active === item.key
                ? 'bg-amber text-bg-primary'
                : 'border border-line-primary text-ink-secondary hover:text-ink-primary'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {children}
    </main>
  );
}
