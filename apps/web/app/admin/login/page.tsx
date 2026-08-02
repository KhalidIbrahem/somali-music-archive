'use client';

/**
 * Admin login (SESSION P2-08). Authenticates against the API and, only for
 * `admin` accounts, stores the access token and enters the dashboard (§11 admin-only).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, ApiError } from '@/lib/api';
import { setToken } from '@/lib/auth';

export default function AdminLogin(): React.JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { user, accessToken } = await login(email, password);
      if (user.role !== 'admin') {
        setError('This account is not an administrator.');
        return;
      }
      setToken(accessToken);
      router.push('/admin');
    } catch (err) {
      // Only bad credentials get the canned line; locked/rate-limited/network
      // errors carry actionable messages of their own.
      if (err instanceof ApiError) {
        setError(
          err.code === 'AUTH_INVALID_CREDENTIALS' ? 'Invalid email or password.' : err.message,
        );
      } else {
        setError('Something went wrong.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-2">
        <p className="font-body text-sm uppercase tracking-widest text-amber">Admin</p>
        <h1 className="font-display text-3xl text-ink-primary">Content dashboard</h1>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="font-body text-sm text-ink-secondary">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            className="rounded-lg border border-line-primary bg-bg-secondary px-3 py-2 font-body text-ink-primary outline-none focus:border-amber"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-sm text-ink-secondary">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="rounded-lg border border-line-primary bg-bg-secondary px-3 py-2 font-body text-ink-primary outline-none focus:border-amber"
          />
        </label>

        {error ? <p className="font-body text-sm text-red-400">{error}</p> : null}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-amber px-4 py-2 font-body font-semibold text-bg-primary disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
