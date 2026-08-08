'use client';

/**
 * "Continue with Google" — renders the official GIS button, exchanges its
 * credential at POST /auth/google, stores the session, and hands the signed-in
 * user to the caller. Renders NOTHING when NEXT_PUBLIC_GOOGLE_CLIENT_ID is
 * unset, so deployments without Google configured show a clean password form.
 */

import { useEffect, useRef, useState } from 'react';
import type { PublicUser } from '@sma/types';
import { ApiError, loginWithGoogle } from '@/lib/api';
import { setSession } from '@/lib/auth';
import { invalidateSessionCache } from '@/lib/session';
import { GOOGLE_CLIENT_ID, renderGoogleButton } from '@/lib/googleSignIn';

export function GoogleSignInButton({
  onSignedIn,
  onError,
}: {
  onSignedIn: (user: PublicUser) => void;
  onError: (message: string) => void;
}): React.JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!GOOGLE_CLIENT_ID || !container) return;
    let cancelled = false;
    renderGoogleButton(container, (credential) => {
      void (async () => {
        try {
          const { user, accessToken, refreshToken } = await loginWithGoogle(credential);
          if (cancelled) return;
          setSession({ accessToken, refreshToken });
          invalidateSessionCache();
          onSignedIn(user);
        } catch (err) {
          if (cancelled) return;
          onError(
            err instanceof ApiError ? err.message : 'Google sign-in failed. Please try again.',
          );
        }
      })();
    }).catch(() => {
      // Script blocked (offline, content blocker) — hide the section entirely.
      if (!cancelled) setUnavailable(true);
    });
    return () => {
      cancelled = true;
    };
    // onSignedIn/onError are stable page-level handlers; re-rendering the GIS
    // button for a new closure identity would flicker the iframe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!GOOGLE_CLIENT_ID || unavailable) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-line-secondary" />
        <span className="font-body text-xs uppercase tracking-widest text-ink-tertiary">or</span>
        <span className="h-px flex-1 bg-line-secondary" />
      </div>
      <div ref={containerRef} className="flex min-h-11 justify-center" />
    </div>
  );
}
