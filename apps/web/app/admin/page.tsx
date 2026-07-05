'use client';

/**
 * Admin → Recordings (SESSION P2-08, extended P4-03). The moderation queue: list
 * recordings by status and publish/archive them via PATCH /recordings/:id. The auth
 * gate and section nav now live in AdminShell.
 */

import { useCallback, useEffect, useState } from 'react';
import type { PublicRecording, RecordingStatus } from '@sma/types';
import { GENRE_LABELS } from '@sma/constants';
import { listModeration, updateRecording } from '@/lib/api';
import { AdminShell } from '@/components/AdminShell';

const TABS: readonly RecordingStatus[] = ['review', 'published', 'archived'];

export default function AdminRecordings(): React.JSX.Element {
  return (
    <AdminShell active="recordings">
      <RecordingsPanel />
    </AdminShell>
  );
}

function RecordingsPanel(): React.JSX.Element {
  const [status, setStatus] = useState<RecordingStatus>('review');
  const [items, setItems] = useState<readonly PublicRecording[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (s: RecordingStatus): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const page = await listModeration(s);
      setItems(page.data);
    } catch {
      setError('Could not load recordings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [status, load]);

  const moderate = async (
    id: string,
    patch: Parameters<typeof updateRecording>[1],
  ): Promise<void> => {
    await updateRecording(id, patch).catch(() => undefined);
    void load(status);
  };

  return (
    <>
      <nav className="flex gap-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setStatus(tab)}
            className={`rounded-full px-4 py-1.5 font-body text-sm capitalize ${
              status === tab
                ? 'bg-amber text-bg-primary'
                : 'border border-line-primary text-ink-secondary'
            }`}
          >
            {tab}
          </button>
        ))}
      </nav>

      {error ? <p className="font-body text-sm text-red-400">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-line-secondary">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="border-b border-line-secondary text-left">
              <Th>Title</Th>
              <Th>Artist</Th>
              <Th>Genre</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-line-secondary">
                <Td>
                  <span className="font-display text-ink-primary">{r.title.somali || '—'}</span>
                </Td>
                <Td>{r.artist.name || '—'}</Td>
                <Td>{GENRE_LABELS[r.genre]}</Td>
                <Td>
                  <span className="capitalize text-ink-secondary">{r.status}</span>
                </Td>
                <Td>
                  <div className="flex gap-2">
                    {r.status !== 'published' ? (
                      <ActionButton
                        onClick={() =>
                          moderate(r.id, { status: 'published', visibility: 'public' })
                        }
                      >
                        Publish
                      </ActionButton>
                    ) : null}
                    {r.status !== 'archived' ? (
                      <ActionButton onClick={() => moderate(r.id, { status: 'archived' })} muted>
                        Archive
                      </ActionButton>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))}
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center font-body text-ink-secondary">
                  No {status} recordings.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
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

function ActionButton({
  children,
  onClick,
  muted,
}: {
  children: React.ReactNode;
  onClick: () => void;
  muted?: boolean;
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1 font-body text-sm ${
        muted ? 'border border-line-primary text-ink-secondary' : 'bg-amber text-bg-primary'
      }`}
    >
      {children}
    </button>
  );
}
