'use client';

/**
 * Admin · Members (SESSION "private access") — see everyone on the platform,
 * search, and remove accounts. Removal is a soft delete server-side (nothing
 * is destroyed) and revokes the member's sessions. Admin accounts cannot be
 * removed here — demote them first (deliberate two-step).
 */

import { useCallback, useEffect, useState } from 'react';
import type { Paginated, PublicUser } from '@sma/types';
import { ApiError, getMe, listUsers, removeUser } from '@/lib/api';
import { AdminShell } from '@/components/AdminShell';

export default function AdminMembersPage(): React.JSX.Element {
  return (
    <AdminShell active="members">
      <MembersPanel />
    </AdminShell>
  );
}

function MembersPanel(): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Paginated<PublicUser> | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listUsers({ page, ...(query !== '' ? { q: query } : {}) })
      .then(setResult)
      .catch(() => setError('Could not load the member list.'));
  }, [page, query]);

  useEffect(refresh, [refresh]);
  useEffect(() => {
    getMe()
      .then((me) => setSelfId(me.id))
      .catch(() => undefined);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl text-ink-primary">
          Members{result ? ` · ${result.total}` : ''}
        </h2>
        <input
          value={query}
          onChange={(e) => {
            setPage(1);
            setQuery(e.target.value);
          }}
          placeholder="Search name, email, username…"
          aria-label="Search members"
          className="w-72 max-w-full rounded-lg border border-line-primary bg-bg-tertiary px-3 py-2 font-body text-sm text-ink-primary outline-none transition-colors placeholder:text-ink-tertiary/60 focus:border-amber"
        />
      </div>

      {error !== null ? (
        <p role="alert" className="font-body text-sm text-red-400">
          {error}
        </p>
      ) : result === null ? (
        <p className="font-body text-sm text-ink-tertiary">Loading…</p>
      ) : result.data.length === 0 ? (
        <p className="font-body text-sm text-ink-tertiary">No members match.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {result.data.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              isSelf={member.id === selfId}
              onRemoved={refresh}
            />
          ))}
        </ul>
      )}

      {result !== null && (page > 1 || result.hasMore) ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className={pagerClass}
          >
            ← Newer
          </button>
          <span className="font-body text-xs text-ink-tertiary">Page {page}</span>
          <button
            type="button"
            disabled={!result.hasMore}
            onClick={() => setPage((p) => p + 1)}
            className={pagerClass}
          >
            Older →
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MemberRow({
  member,
  isSelf,
  onRemoved,
}: {
  member: PublicUser;
  isSelf: boolean;
  onRemoved: () => void;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await removeUser(member.id);
      onRemoved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this member.');
      setBusy(false);
      setConfirming(false);
    }
  };

  const removable = !isSelf && member.role !== 'admin';

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line-secondary bg-bg-secondary px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber/15 font-body text-sm font-bold text-amber"
          >
            {(member.displayName.trim()[0] ?? '?').toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-body text-sm font-semibold text-ink-primary">
              {member.displayName}
              {isSelf ? <span className="ml-2 text-xs text-ink-tertiary">(you)</span> : null}
            </p>
            <p className="truncate font-body text-xs text-ink-tertiary">
              {member.username ? `@${member.username} · ` : ''}
              {member.email}
              {member.phone ? ` · ${member.phone}` : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span
            className={`rounded-full px-2 py-0.5 font-body text-[11px] font-semibold uppercase tracking-wide ${
              member.role === 'admin'
                ? 'bg-amber/15 text-amber'
                : 'border border-line-primary text-ink-tertiary'
            }`}
          >
            {member.role}
          </span>
          <span className="hidden font-body text-xs text-ink-tertiary sm:block">
            joined {new Date(member.createdAt).toLocaleDateString()}
          </span>
          {removable ? (
            confirming ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy}
                  className="rounded-lg bg-red-400/90 px-3 py-1.5 font-body text-xs font-semibold text-bg-primary disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="font-body text-xs text-ink-tertiary hover:text-ink-primary"
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-lg border border-line-primary px-3 py-1.5 font-body text-xs text-ink-secondary transition-colors hover:border-red-400/50 hover:text-red-400"
              >
                Remove
              </button>
            )
          ) : null}
        </div>
      </div>
      {error !== null ? (
        <p role="alert" className="font-body text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </li>
  );
}

const pagerClass =
  'rounded-lg border border-line-primary px-3 py-1.5 font-body text-xs text-ink-secondary transition-colors hover:border-amber/50 disabled:opacity-40';
