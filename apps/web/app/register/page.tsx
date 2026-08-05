'use client';

/**
 * Registration page (SESSION "web registration", ARCHITECTURE.md §12 AUTH).
 *
 * Posts to POST /auth/register through the shared API client. The server is the
 * source of truth for validation (registerSchema): this form mirrors those rules
 * for fast feedback, but every field is re-checked server-side. Date of birth is
 * required by the API's COPPA age gate (§11) even though it is a light touch here.
 * On success the visitor STAYS here: register returns tokens, we store them and
 * swap the form for a signed-in welcome card — no redirect.
 */

import { useState } from 'react';
import Link from 'next/link';
import { UI_LANGUAGES, type UiLanguage } from '@sma/constants';
import { register, ApiError } from '@/lib/api';
import { setToken } from '@/lib/auth';

const LANGUAGE_LABELS: Record<UiLanguage, string> = {
  so: 'Somali',
  ar: 'Arabic',
  en: 'English',
};

export default function Register(): React.JSX.Element {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [language, setLanguage] = useState<UiLanguage>('so');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Server-side VALIDATION_ERROR details, keyed by field path. */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /** Set once registration succeeds — holds the new member's name. */
  const [registered, setRegistered] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    // Client-side guards mirroring the server rules that plain HTML attributes
    // can't express (registerSchema stays the source of truth).
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setFieldErrors({ password: 'Include at least one letter and one number.' });
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!acceptedTerms) {
      setError('Please accept the terms of service to continue.');
      return;
    }

    setBusy(true);
    try {
      const { user, accessToken } = await register({
        displayName: displayName.trim(),
        email: email.trim(),
        password,
        language,
        dateOfBirth,
        acceptedTerms: true,
      });
      // Registration IS the sign-in: store the session and stay on this page.
      setToken(accessToken);
      setRegistered(user.displayName);
    } catch (err) {
      if (err instanceof ApiError && err.fields !== undefined && err.fields.length > 0) {
        // Attach each server message to its input; the banner stays for
        // anything that doesn't map to a visible field.
        const byPath: Record<string, string> = {};
        for (const f of err.fields) byPath[f.path] ??= f.message;
        setFieldErrors(byPath);
        const unmapped = err.fields.filter(
          (f) =>
            ![
              'displayName',
              'email',
              'password',
              'language',
              'dateOfBirth',
              'acceptedTerms',
            ].includes(f.path),
        );
        if (unmapped.length > 0) setError(unmapped.map((f) => f.message).join(' '));
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-bg-primary px-6 py-16 text-ink-primary">
      <div className="mx-auto flex w-full max-w-md flex-col gap-8">
        <div className="flex flex-col gap-2 text-center">
          <Link href="/" className="font-body text-sm uppercase tracking-[0.25em] text-amber">
            Somali Music Archive
          </Link>
          <h1 className="font-display text-4xl text-ink-primary">Create your account</h1>
          <p className="font-body text-sm text-ink-secondary">
            Join the effort to preserve Somali musical heritage.
          </p>
        </div>

        {registered ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-line-secondary bg-bg-secondary p-10 text-center">
            <span
              aria-hidden
              className="flex h-12 w-12 items-center justify-center rounded-full bg-amber/15 text-2xl text-amber"
            >
              ✓
            </span>
            <h2 className="font-display text-2xl text-ink-primary">
              Ku soo dhawoow, {registered}!
            </h2>
            <p className="max-w-sm font-body text-sm text-ink-secondary">
              Your account is ready and you are signed in on this device — no extra login needed.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-3">
              <Link
                href="/listen"
                className="rounded-lg bg-amber px-5 py-2.5 font-body text-sm font-semibold text-bg-primary transition-transform hover:-translate-y-0.5"
              >
                Enter the listening room
              </Link>
              <Link
                href="/generate"
                className="rounded-lg border border-amber/40 px-5 py-2.5 font-body text-sm font-semibold text-amber transition-colors hover:bg-amber hover:text-bg-primary"
              >
                Try the Generation Studio
              </Link>
            </div>
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            className="flex flex-col gap-5 rounded-2xl border border-line-secondary bg-bg-secondary p-8"
          >
            <Field label="Display name" error={fieldErrors['displayName']}>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                minLength={2}
                maxLength={60}
                autoComplete="name"
                className={inputClass}
              />
            </Field>

            <Field label="Email" error={fieldErrors['email']}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className={inputClass}
              />
            </Field>

            <Field
              label="Password"
              hint="At least 8 characters, including a letter and a number."
              error={fieldErrors['password']}
            >
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                className={inputClass}
              />
            </Field>

            <Field label="Confirm password">
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                className={inputClass}
              />
            </Field>

            <Field label="Preferred language">
              <div className="grid grid-cols-3 gap-2">
                {UI_LANGUAGES.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setLanguage(lang)}
                    aria-pressed={language === lang}
                    className={`rounded-lg border px-3 py-2 font-body text-sm transition-colors ${
                      language === lang
                        ? 'border-amber bg-amber/10 text-amber'
                        : 'border-line-primary text-ink-secondary hover:border-amber/40'
                    }`}
                  >
                    {LANGUAGE_LABELS[lang]}
                  </button>
                ))}
              </div>
            </Field>

            <Field
              label="Date of birth"
              hint="You must be at least 13 years old to register."
              error={fieldErrors['dateOfBirth']}
            >
              <input
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                required
                className={`${inputClass} [color-scheme:dark]`}
              />
            </Field>

            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 accent-amber"
              />
              <span className="font-body text-sm text-ink-secondary">
                I agree to the{' '}
                <Link href="/terms" className="text-amber hover:underline">
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link href="/privacy" className="text-amber hover:underline">
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
            {fieldErrors['acceptedTerms'] !== undefined && (
              <p role="alert" className="-mt-3 font-body text-sm text-red-400">
                {fieldErrors['acceptedTerms']}
              </p>
            )}

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
              {busy ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}

        <p className="text-center font-body text-sm text-ink-secondary">
          Already have an account?{' '}
          <Link href="/login" className="text-amber hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

const inputClass =
  'w-full rounded-lg border border-line-primary bg-bg-tertiary px-3 py-2 font-body text-ink-primary outline-none transition-colors focus:border-amber';

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  /** Server-side validation message for this field (VALIDATION_ERROR details). */
  error?: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-body text-sm text-ink-secondary">{label}</span>
      {children}
      {error !== undefined ? (
        <span role="alert" className="font-body text-xs text-red-400">
          {error}
        </span>
      ) : hint ? (
        <span className="font-body text-xs text-ink-tertiary">{hint}</span>
      ) : null}
    </label>
  );
}
