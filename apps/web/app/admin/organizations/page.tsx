'use client';

/**
 * Admin → Organizations (SESSION P4-03) — manage the institutional licenses from
 * P4-02. Issue a license (returning the shareable key ONCE), then look one up to see
 * seat usage and the member roster, and remove members. The license key is never
 * returned again by the API (GET /organizations/:id omits it), so it is surfaced only
 * at issuance here.
 */

import { useState } from 'react';
import type { CreatedOrganization, OrganizationMemberView, PublicOrganization } from '@sma/types';
import {
  ApiError,
  createOrganization,
  getOrganization,
  listOrgMembers,
  removeOrgMember,
} from '@/lib/api';
import { AdminShell } from '@/components/AdminShell';

export default function AdminOrganizations(): React.JSX.Element {
  return (
    <AdminShell active="organizations">
      <OrganizationsPanel />
    </AdminShell>
  );
}

function OrganizationsPanel(): React.JSX.Element {
  // Issue form
  const [name, setName] = useState('');
  const [seats, setSeats] = useState('10');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<CreatedOrganization | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);

  // Manage
  const [lookupId, setLookupId] = useState('');
  const [org, setOrg] = useState<PublicOrganization | null>(null);
  const [members, setMembers] = useState<OrganizationMemberView[]>([]);
  const [manageError, setManageError] = useState<string | null>(null);

  const loadOrg = async (id: string): Promise<void> => {
    setManageError(null);
    try {
      const [details, roster] = await Promise.all([getOrganization(id), listOrgMembers(id)]);
      setOrg(details);
      setMembers(roster);
      setLookupId(id);
    } catch (err) {
      setOrg(null);
      setMembers([]);
      setManageError(err instanceof ApiError ? err.message : 'Could not load that organization.');
    }
  };

  const onIssue = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setIssueError(null);
    const seatCount = Number(seats);
    if (!Number.isInteger(seatCount) || seatCount < 1) {
      setIssueError('Seats must be a whole number of at least 1.');
      return;
    }
    setIssuing(true);
    try {
      const created = await createOrganization({
        name: name.trim(),
        seats: seatCount,
        ...(expiresInDays ? { expiresInDays: Number(expiresInDays) } : {}),
      });
      setIssued(created);
      setName('');
      await loadOrg(created.id);
    } catch (err) {
      setIssueError(err instanceof ApiError ? err.message : 'Could not issue the license.');
    } finally {
      setIssuing(false);
    }
  };

  const onRemove = async (userId: string): Promise<void> => {
    if (!org) return;
    await removeOrgMember(org.id, userId).catch(() => undefined);
    void loadOrg(org.id);
  };

  return (
    <div className="flex flex-col gap-10">
      {/* Issue a license */}
      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl text-ink-primary">Issue a license</h2>
        <form onSubmit={onIssue} className="grid gap-4 sm:grid-cols-3">
          <Field label="Institution name" className="sm:col-span-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={input}
            />
          </Field>
          <Field label="Seats">
            <input
              type="number"
              min={1}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              required
              className={input}
            />
          </Field>
          <Field label="Expires in days (optional)">
            <input
              type="number"
              min={1}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className={input}
            />
          </Field>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={issuing}
              className="w-full rounded-lg bg-amber px-4 py-2 font-body font-semibold text-bg-primary disabled:opacity-50"
            >
              {issuing ? 'Issuing…' : 'Issue license'}
            </button>
          </div>
        </form>

        {issueError ? <p className="font-body text-sm text-red-400">{issueError}</p> : null}

        {issued ? (
          <div className="rounded-xl border border-amber/40 bg-amber/10 p-4">
            <p className="font-body text-sm text-ink-secondary">
              License issued for <span className="text-ink-primary">{issued.name}</span> —{' '}
              {issued.seats} seats. Copy the key now; it is shown only once.
            </p>
            <code className="mt-2 block break-all font-mono text-lg text-amber">
              {issued.licenseKey}
            </code>
          </div>
        ) : null}
      </section>

      {/* Manage an organization */}
      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl text-ink-primary">Manage an organization</h2>
        <div className="flex gap-2">
          <input
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="Organization id"
            className={`${input} flex-1`}
          />
          <button
            onClick={() => void loadOrg(lookupId.trim())}
            className="rounded-lg border border-line-primary px-4 py-2 font-body text-sm text-ink-primary"
          >
            Look up
          </button>
        </div>

        {manageError ? <p className="font-body text-sm text-red-400">{manageError}</p> : null}

        {org ? (
          <div className="flex flex-col gap-4 rounded-xl border border-line-secondary bg-bg-secondary p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-xl text-ink-primary">{org.name}</h3>
              <span className="font-body text-sm capitalize text-ink-secondary">{org.status}</span>
            </div>
            <p className="font-body text-sm text-ink-secondary">
              <span className="text-ink-primary">
                {org.seatsUsed}/{org.seats}
              </span>{' '}
              seats used
              {org.expiresAt
                ? ` · expires ${new Date(org.expiresAt).toLocaleDateString()}`
                : ' · no expiry'}
            </p>

            <div className="overflow-x-auto rounded-lg border border-line-secondary">
              <table className="w-full min-w-[480px] border-collapse">
                <thead>
                  <tr className="border-b border-line-secondary text-left">
                    <Th>Member (user id)</Th>
                    <Th>Joined</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.userId} className="border-b border-line-secondary">
                      <Td>
                        <span className="font-mono text-xs text-ink-secondary">{m.userId}</span>
                      </Td>
                      <Td>{new Date(m.joinedAt).toLocaleDateString()}</Td>
                      <Td>
                        <button
                          onClick={() => void onRemove(m.userId)}
                          className="rounded-md border border-line-primary px-3 py-1 font-body text-sm text-ink-secondary"
                        >
                          Remove
                        </button>
                      </Td>
                    </tr>
                  ))}
                  {members.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-4 py-6 text-center font-body text-sm text-ink-secondary"
                      >
                        No members yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

const input =
  'rounded-lg border border-line-primary bg-bg-tertiary px-3 py-2 font-body text-ink-primary outline-none transition-colors focus:border-amber';

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <span className="font-body text-sm text-ink-secondary">{label}</span>
      {children}
    </label>
  );
}

function Th({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <th className="px-4 py-3 font-body text-xs uppercase tracking-wide text-ink-tertiary">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <td className="px-4 py-3 font-body text-sm text-ink-primary">{children}</td>;
}
