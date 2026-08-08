'use client';

/**
 * AuthMenu — the header's session corner, shared by the public SiteHeader and
 * the landing page nav (SESSION "teaching"; closes the "no way to see you are
 * signed in, no way out" gap — clearSession was previously reachable only
 * inside the admin shell).
 *
 * Signed out → "Sign in" link. Signed in → a chip with the member's initial and
 * name opening a menu: My account, Teaching studio (educators/admins), Admin
 * (admins), Sign out. SSR renders a same-size invisible placeholder so the
 * header never shifts on hydration.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { logout } from '@/lib/api';
import { clearSession } from '@/lib/auth';
import { invalidateSessionCache, useSession } from '@/lib/session';

const VARIANT_SIGN_IN: Record<AuthMenuVariant, string> = {
  site: 'rounded-lg border border-amber/40 px-4 py-2 font-body text-sm font-semibold text-amber transition-colors hover:bg-amber hover:text-bg-primary',
  landing:
    'rounded-[4px] text-sm text-mid transition-colors hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none',
};

export type AuthMenuVariant = 'site' | 'landing';

export function AuthMenu({ variant = 'site' }: { variant?: AuthMenuVariant }): React.JSX.Element {
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (session.status === 'unknown') {
    // Reserve the footprint; content arrives on the client without layout shift.
    return (
      <span aria-hidden className={`invisible ${VARIANT_SIGN_IN[variant]}`}>
        Sign in
      </span>
    );
  }

  if (session.status === 'signed-out') {
    return (
      <Link href="/login" className={VARIANT_SIGN_IN[variant]}>
        Sign in
      </Link>
    );
  }

  const user = session.status === 'signed-in' ? session.user : null;
  const name = user?.displayName ?? 'Account';
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const canTeach = user !== null && (user.role === 'educator' || user.role === 'admin');

  const signOut = (): void => {
    setOpen(false);
    // Best-effort server-side revocation; local sign-out never waits on it.
    void logout().catch(() => undefined);
    clearSession();
    invalidateSessionCache();
    router.push('/');
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={
          variant === 'site'
            ? 'flex items-center gap-2 rounded-lg border border-line-primary py-1.5 pl-1.5 pr-3 font-body text-sm text-ink-primary transition-colors hover:border-amber/60'
            : 'flex items-center gap-2 rounded-[4px] text-sm text-mid transition-colors hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none'
        }
      >
        <span
          aria-hidden
          className="flex h-7 w-7 items-center justify-center rounded-full bg-amber/15 font-body text-sm font-bold text-amber"
        >
          {initial}
        </span>
        <span className="hidden max-w-32 truncate sm:block">{name}</span>
        <span aria-hidden className="text-xs opacity-60">
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-60 overflow-hidden rounded-xl border border-line-secondary bg-bg-secondary shadow-xl shadow-black/30"
        >
          <div className="border-b border-line-secondary px-4 py-3">
            <p className="truncate font-body text-sm font-semibold text-ink-primary">{name}</p>
            {user ? (
              <p className="truncate font-body text-xs text-ink-tertiary">{user.email}</p>
            ) : null}
            {user && user.role !== 'listener' ? (
              <span className="mt-1.5 inline-block rounded-full bg-amber/15 px-2 py-0.5 font-body text-[11px] font-semibold uppercase tracking-wide text-amber">
                {user.role}
              </span>
            ) : null}
          </div>
          <nav className="flex flex-col py-1.5" aria-label="Account">
            <MenuLink href="/account" onNavigate={() => setOpen(false)}>
              My account
            </MenuLink>
            {canTeach ? (
              <MenuLink href="/teach" onNavigate={() => setOpen(false)}>
                Teaching studio
              </MenuLink>
            ) : null}
            {user?.role === 'admin' ? (
              <MenuLink href="/admin" onNavigate={() => setOpen(false)}>
                Admin dashboard
              </MenuLink>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              className="px-4 py-2 text-left font-body text-sm text-red-400 transition-colors hover:bg-bg-tertiary"
            >
              Sign out
            </button>
          </nav>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  href,
  onNavigate,
  children,
}: {
  href: string;
  onNavigate: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className="px-4 py-2 font-body text-sm text-ink-secondary transition-colors hover:bg-bg-tertiary hover:text-ink-primary"
    >
      {children}
    </Link>
  );
}
