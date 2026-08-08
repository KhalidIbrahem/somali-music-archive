'use client';

/**
 * useSession — reactive view of the signed-in member for client components.
 *
 * Token presence comes from lib/auth via useSyncExternalStore (SSR snapshot is
 * `unknown`, so server HTML stays neutral and hydration never mismatches). When
 * a token exists the profile is fetched from GET /users/me once and cached per
 * token, so the header menu and the account page share a single request.
 * Auth-shaped failures (expired/invalid token) clear the stale token; network
 * failures do NOT — a flaky connection must not sign people out.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PublicUser } from '@sma/types';
import { ApiError, getMe } from '@/lib/api';
import { clearSession, getToken, subscribeToken } from '@/lib/auth';

export type Session =
  /** Server render / first client paint — render a neutral shell. */
  | { readonly status: 'unknown' }
  | { readonly status: 'signed-out' }
  /** Token present, profile fetch in flight. */
  | { readonly status: 'loading' }
  | { readonly status: 'signed-in'; readonly user: PublicUser };

/** One profile fetch per token value, shared across every subscribed component. */
let cache: { token: string; promise: Promise<PublicUser | null> } | null = null;

function fetchUserFor(token: string): Promise<PublicUser | null> {
  if (cache?.token !== token) {
    cache = {
      token,
      promise: getMe().catch((err: unknown) => {
        if (err instanceof ApiError && err.code.startsWith('AUTH')) {
          // Stale session even after the client's auto-refresh attempt — drop
          // it so the UI returns to signed-out.
          clearSession();
          return null;
        }
        // Network/server hiccup: forget the attempt so a retry can happen,
        // but keep the token.
        cache = null;
        return null;
      }),
    };
  }
  return cache.promise;
}

export function useSession(): Session {
  const token = useSyncExternalStore(
    subscribeToken,
    () => getToken(),
    () => null,
  );
  const [hydrated, setHydrated] = useState(false);
  const [user, setUser] = useState<PublicUser | null>(null);

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (token === null) {
      setUser(null);
      return;
    }
    let cancelled = false;
    void fetchUserFor(token).then((u) => {
      if (!cancelled) setUser(u);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!hydrated) return { status: 'unknown' };
  if (token === null) return { status: 'signed-out' };
  if (user === null) return { status: 'loading' };
  return { status: 'signed-in', user };
}

/** Drop the per-token profile cache (used by sign-out so a re-login refetches). */
export function invalidateSessionCache(): void {
  cache = null;
}
