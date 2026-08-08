'use client';

/**
 * Admin · Invites (SESSION "private access") — mint, hand out, and revoke the
 * codes that gate registration. Codes are shown in full with one-tap copy
 * (they grant registration only, nothing else); every redemption lists who
 * came in on which code.
 */

import { useCallback, useEffect, useState } from 'react';
import type { InviteCodeView, InviteStatus } from '@sma/types';
import { ApiError, createInvite, listInvites, revokeInvite } from '@/lib/api';
import { AdminShell } from '@/components/AdminShell';

const STATUS_STYLES: Record<InviteStatus, string> = {
  active: 'bg-amber/15 text-amber',
  revoked: 'border border-line-primary text-ink-tertiary',
  expired: 'border border-line-primary text-ink-tertiary',
  exhausted: 'border border-line-primary text-ink-tertiary',
};

export default function AdminInvitesPage(): React.JSX.Element {
  return (
    <AdminShell active="invites">
      <InvitesPanel />
    </AdminShell>
  );
}

function InvitesPanel(): React.JSX.Element {
  const [invites, setInvites] = useState<readonly InviteCodeView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listInvites()
      .then(setInvites)
      .catch(() => setLoadError('Could not load invite codes.'));
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <div className="flex flex-col gap-8">
      <CreateInviteForm onCreated={refresh} />

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-2xl text-ink-primary">All codes</h2>
        {loadError !== null ? (
          <p role="alert" className="font-body text-sm text-red-400">
            {loadError}
          </p>
        ) : invites === null ? (
          <p className="font-body text-sm text-ink-tertiary">Loading…</p>
        ) : invites.length === 0 ? (
          <p className="font-body text-sm text-ink-tertiary">
            No invite codes yet — mint the first one above and send it to your first guest.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {invites.map((invite) => (
              <InviteRow key={invite.id} invite={invite} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CreateInviteForm({ onCreated }: { onCreated: () => void }): React.JSX.Element {
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState('1');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<InviteCodeView | null>(null);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const invite = await createInvite({
        ...(label.trim() !== '' ? { label: label.trim() } : {}),
        maxUses: Number(maxUses) || 1,
        ...(expiresInDays !== '' ? { expiresInDays: Number(expiresInDays) } : {}),
      });
      setMinted(invite);
      setLabel('');
      setMaxUses('1');
      setExpiresInDays('');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the invite.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-2xl border border-line-secondary bg-bg-secondary p-6"
    >
      <h2 className="font-display text-2xl text-ink-primary">New invite</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 sm:col-span-1">
          <span className="font-body text-sm text-ink-secondary">For (note to self)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
            placeholder="e.g. MIT faculty — Prof. Kashogi"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-body text-sm text-ink-secondary">Uses</span>
          <input
            type="number"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            min={1}
            max={500}
            required
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-body text-sm text-ink-secondary">Expires in (days)</span>
          <input
            type="number"
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            min={1}
            max={365}
            placeholder="never"
            className={inputClass}
          />
        </label>
      </div>

      {error !== null ? (
        <p role="alert" className="font-body text-sm text-red-400">
          {error}
        </p>
      ) : null}
      {minted !== null ? (
        <p role="status" className="font-body text-sm text-amber">
          Minted <span className="font-numeric font-semibold">{minted.code}</span> — copy it below
          and send it to your guest.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="w-fit rounded-lg bg-amber px-5 py-2.5 font-body text-sm font-semibold text-bg-primary transition-opacity disabled:opacity-50"
      >
        {busy ? 'Minting…' : 'Mint invite code'}
      </button>
    </form>
  );
}

function InviteRow({
  invite,
  onChanged,
}: {
  invite: InviteCodeView;
  onChanged: () => void;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy — select the code manually.');
    }
  };

  const revoke = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await revokeInvite(invite.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke the code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line-secondary bg-bg-secondary p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              title="Copy code"
              className="font-numeric rounded-md bg-bg-tertiary px-2.5 py-1 text-sm font-semibold tracking-wider text-ink-primary transition-colors hover:text-amber"
            >
              {invite.code}
            </button>
            {copied ? <span className="font-body text-xs text-amber">Copied</span> : null}
            <span
              className={`rounded-full px-2 py-0.5 font-body text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLES[invite.status]}`}
            >
              {invite.status}
            </span>
            <span className="font-body text-xs text-ink-tertiary">
              {invite.usedCount}/{invite.maxUses} used
              {invite.expiresAt
                ? ` · expires ${new Date(invite.expiresAt).toLocaleDateString()}`
                : ''}
            </span>
          </div>
          {invite.label ? (
            <p className="truncate font-body text-sm text-ink-secondary">{invite.label}</p>
          ) : null}
          {invite.redemptions.length > 0 ? (
            <p className="font-body text-xs text-ink-tertiary">
              Redeemed by{' '}
              {invite.redemptions.map((r) => `${r.displayName} (${r.email})`).join(', ')}
            </p>
          ) : null}
        </div>
        {invite.status === 'active' ? (
          <button
            type="button"
            onClick={() => void revoke()}
            disabled={busy}
            className="shrink-0 rounded-lg border border-line-primary px-3 py-1.5 font-body text-xs text-ink-secondary transition-colors hover:border-red-400/50 hover:text-red-400 disabled:opacity-50"
          >
            Revoke
          </button>
        ) : null}
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
