'use client';

/**
 * Sign-in page (ARCHITECTURE.md §12 AUTH). The general member login — distinct
 * from the admin dashboard login (/admin/login), which additionally gates on the
 * `admin` role. One identifier field accepts email OR phone (+2526…); Google
 * sign-in appears when the deployment has NEXT_PUBLIC_GOOGLE_CLIENT_ID. On
 * success the full token pair is stored and the visitor returns to ?next= (or
 * the landing page). Shows a confirmation when arriving straight from
 * registration (?registered=1).
 */

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { login, ApiError } from '@/lib/api';
import { setSession } from '@/lib/auth';
import { invalidateSessionCache } from '@/lib/session';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

/** Shown when arriving straight from registration (?registered=1). Reads the
 * query string via useSearchParams, so it must live under a Suspense boundary
 * to keep the rest of the page fully static. */
function RegisteredBanner(): React.JSX.Element | null {
  const justRegistered = useSearchParams().get('registered') === '1';
  if (!justRegistered) return null;
  return (
    <p
      role="status"
      className="rounded-lg border border-amber/40 bg-amber/10 px-4 py-3 text-center font-body text-sm text-amber"
    >
      Account created. Please sign in to continue.
    </p>
  );
}

/** Where to land after a successful sign-in. Only same-site paths are honoured
 * so ?next can never bounce a member to another origin. */
function useNextPath(): string {
  const next = useSearchParams().get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function LoginForm(): React.JSX.Element {
  const router = useRouter();
  const nextPath = useNextPath();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = (): void => {
    invalidateSessionCache();
    router.push(nextPath);
  };

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { accessToken, refreshToken } = await login(identifier.trim(), password);
      setSession({ accessToken, refreshToken });
      finish();
    } catch (err) {
      // Only bad credentials get the canned line; locked/rate-limited/network
      // errors carry actionable messages of their own.
      if (err instanceof ApiError) {
        setError(
          err.code === 'AUTH_INVALID_CREDENTIALS'
            ? 'Invalid email/phone or password.'
            : err.message,
        );
      } else {
        setError('Something went wrong.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-5 rounded-2xl border border-line-secondary bg-bg-secondary p-8"
      >
        <label className="flex flex-col gap-1.5">
          <span className="font-body text-sm text-ink-secondary">Email or phone</span>
          <input
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            autoComplete="username"
            placeholder="you@example.com or +252 61 234 5678"
            className="w-full rounded-lg border border-line-primary bg-bg-tertiary px-3 py-2 font-body text-ink-primary outline-none transition-colors placeholder:text-ink-tertiary/60 focus:border-amber"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-body text-sm text-ink-secondary">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-line-primary bg-bg-tertiary px-3 py-2 font-body text-ink-primary outline-none transition-colors focus:border-amber"
          />
        </label>

        {error ? (
          <p role="alert" className="font-body text-sm text-red-400">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-amber px-4 py-3 font-body font-semibold text-bg-primary transition-opacity disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <GoogleSignInButton onSignedIn={finish} onError={setError} />
      </form>
    </>
  );
}

export default function LoginPage(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-bg-primary px-6 py-16 text-ink-primary">
      <div className="mx-auto flex w-full max-w-md flex-col gap-8">
        <div className="flex flex-col gap-2 text-center">
          <Link href="/" className="font-display text-lg tracking-wide text-ink-primary">
            Qaraami<span className="text-amber">GenAI</span>
          </Link>
          <h1 className="font-display text-4xl text-ink-primary">Welcome back</h1>
        </div>

        <Suspense fallback={null}>
          <RegisteredBanner />
        </Suspense>

        {/* The form reads ?next= via useSearchParams, so it renders inside the
            same Suspense pattern as the banner to keep the page static. */}
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>

        <p className="text-center font-body text-sm text-ink-secondary">
          New here?{' '}
          <Link href="/register" className="text-amber hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
