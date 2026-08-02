'use client';

/**
 * LibraryShelf — upload + browse scanned music-sheet books (/library).
 *
 * Upload flow (§8, same as recordings): presign → PUT straight to R2 → register
 * the shelf record. Requires a signed-in session; signed-out visitors get an
 * invitation instead of a broken form. Accepts PDF scans and page images.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { BookContentType, LibraryBook } from '@sma/types';
import {
  ApiError,
  createBook,
  getBookFileUrl,
  listBooks,
  requestBookUploadUrl,
  uploadFileToR2,
} from '@/lib/api';
import { getToken } from '@/lib/auth';
import { Reveal } from '@/components/Reveal';

const ACCEPTED: Record<string, BookContentType> = {
  'application/pdf': 'application/pdf',
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
};

type Phase = 'idle' | 'uploading' | 'registering';

/** localStorage token presence via the sanctioned external-store hook — the
 * server snapshot is null so SSR renders the neutral shell without mismatch. */
const emptySubscribe = (): (() => void) => () => undefined;
function useHasSession(): boolean | null {
  return useSyncExternalStore(
    emptySubscribe,
    () => Boolean(getToken()),
    () => null,
  );
}

export function LibraryShelf(): React.JSX.Element {
  const hasToken = useHasSession();
  const [authFailed, setAuthFailed] = useState(false);
  const [books, setBooks] = useState<readonly LibraryBook[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const shelf = await listBooks();
        if (!cancelled) setBooks(shelf);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code.startsWith('AUTH')) setAuthFailed(true);
        else setLoadError('Could not reach the library. Is the API running?');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasToken]);

  const acceptFile = useCallback((file: File | undefined) => {
    setUploadError(null);
    if (!file) return;
    if (!ACCEPTED[file.type]) {
      setUploadError('Please choose a PDF scan or a JPEG/PNG page image.');
      return;
    }
    setPendingFile(file);
    // Prefill a human title from the filename — the uploader can refine it.
    const stem = file.name
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim();
    setTitle((t) => t || stem);
  }, []);

  const submit = useCallback(async () => {
    if (!pendingFile || phase !== 'idle') return;
    const contentType = ACCEPTED[pendingFile.type];
    if (!contentType) return;
    setUploadError(null);
    try {
      setPhase('uploading');
      const presign = await requestBookUploadUrl({
        filename: pendingFile.name,
        contentType,
        sizeBytes: pendingFile.size,
      });
      await uploadFileToR2(presign.uploadUrl, pendingFile, contentType);
      setPhase('registering');
      const book = await createBook({
        fileKey: presign.fileKey,
        contentType,
        title: title.trim() || pendingFile.name,
        ...(author.trim() ? { author: author.trim() } : {}),
      });
      setBooks((prev) => [book, ...prev]);
      setPendingFile(null);
      setTitle('');
      setAuthor('');
    } catch (err) {
      setUploadError(
        err instanceof ApiError ? err.message : 'Upload failed — check the API and try again.',
      );
    } finally {
      setPhase('idle');
    }
  }, [pendingFile, phase, title, author]);

  const openBook = useCallback(async (id: string) => {
    try {
      const signed = await getBookFileUrl(id);
      window.open(signed.url, '_blank', 'noreferrer');
    } catch {
      setLoadError('Could not open the book — try again.');
    }
  }, []);

  return (
    <main className="pb-24">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-line-secondary">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[46rem] rounded-full bg-amber/10 blur-3xl animate-glow-drift"
        />
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-5 px-6 py-20 text-center">
          <Reveal>
            <p className="font-body text-sm uppercase tracking-[0.3em] text-amber">Maktabadda</p>
          </Reveal>
          <Reveal delay={90}>
            <h1 className="font-display text-5xl leading-tight text-ink-primary sm:text-6xl">
              The Library
            </h1>
          </Reveal>
          <Reveal delay={180}>
            <p className="max-w-2xl font-body text-lg leading-relaxed text-ink-secondary">
              Somali music was written down far less often than it was sung. When a book of music
              sheets surfaces — a songbook, a notation collection, a teacher&apos;s manuscript — it
              belongs here, scanned and preserved beside the recordings it describes.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-14">
        {hasToken === false || authFailed ? (
          <Reveal>
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-line-secondary bg-bg-secondary p-12 text-center">
              <h2 className="font-display text-2xl text-ink-primary">
                Sign in to add to the shelf
              </h2>
              <p className="max-w-md font-body text-ink-secondary">
                Uploading to the library is reserved for signed-in members so every book carries
                provenance — who contributed it, and when.
              </p>
              <Link
                href="/login"
                className="mt-2 rounded-xl bg-amber px-7 py-3 font-body font-semibold text-bg-primary transition-transform hover:-translate-y-0.5"
              >
                Sign in
              </Link>
            </div>
          </Reveal>
        ) : (
          <>
            {/* ── Upload well ─────────────────────────────────────────────── */}
            <Reveal>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  acceptFile(e.dataTransfer.files[0]);
                }}
                className={`flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
                  dragOver ? 'border-amber bg-amber/10' : 'border-line-primary bg-bg-secondary'
                }`}
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-amber/10 text-amber">
                  <BookGlyph />
                </span>
                <div>
                  <h2 className="font-display text-2xl text-ink-primary">
                    {pendingFile ? pendingFile.name : 'Drop a book of music sheets'}
                  </h2>
                  <p className="mt-1 font-body text-sm text-ink-secondary">
                    PDF scan or page images (JPEG/PNG), up to 200&nbsp;MB. It uploads straight to
                    the archive&apos;s storage.
                  </p>
                </div>

                {pendingFile ? (
                  <div className="flex w-full max-w-md flex-col gap-3">
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Book title"
                      className="w-full rounded-lg border border-line-primary bg-bg-tertiary px-3 py-2 font-body text-ink-primary outline-none transition-colors focus:border-amber"
                    />
                    <input
                      type="text"
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                      placeholder="Author / compiler (optional)"
                      className="w-full rounded-lg border border-line-primary bg-bg-tertiary px-3 py-2 font-body text-ink-primary outline-none transition-colors focus:border-amber"
                    />
                    <div className="flex justify-center gap-3">
                      <button
                        type="button"
                        onClick={() => void submit()}
                        disabled={phase !== 'idle' || !title.trim()}
                        className="rounded-xl bg-amber px-6 py-2.5 font-body font-semibold text-bg-primary transition-opacity disabled:opacity-50"
                      >
                        {phase === 'uploading'
                          ? 'Uploading…'
                          : phase === 'registering'
                            ? 'Shelving…'
                            : 'Add to the library'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingFile(null);
                          setUploadError(null);
                        }}
                        className="rounded-xl border border-line-primary px-5 py-2.5 font-body text-ink-secondary transition-colors hover:border-amber hover:text-amber"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-xl border border-amber/40 px-6 py-2.5 font-body font-semibold text-amber transition-colors hover:bg-amber hover:text-bg-primary"
                  >
                    Choose a file
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  className="hidden"
                  onChange={(e) => acceptFile(e.target.files?.[0])}
                />
                {uploadError ? (
                  <p role="alert" className="font-body text-sm text-red-400">
                    {uploadError}
                  </p>
                ) : null}
              </div>
            </Reveal>

            {/* ── Shelf ───────────────────────────────────────────────────── */}
            <div className="mt-14">
              <h2 className="mb-6 font-display text-2xl text-ink-primary">On the shelf</h2>
              {loadError ? <p className="font-body text-sm text-red-400">{loadError}</p> : null}
              {books.length === 0 && !loadError ? (
                <p className="rounded-xl border border-line-secondary bg-bg-secondary p-8 text-center font-body text-ink-secondary">
                  The shelf is waiting for its first book. The one you&apos;re hunting for — the
                  Somali music-sheets collection — has a place reserved right here.
                </p>
              ) : (
                <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {books.map((book, i) => (
                    <li key={book.id}>
                      <Reveal delay={i * 60}>
                        <article className="group flex h-full flex-col gap-3 rounded-2xl border border-line-secondary bg-bg-secondary p-6 transition-colors hover:border-amber/40">
                          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber/10 text-amber">
                            {book.contentType === 'application/pdf' ? <BookGlyph /> : <PageGlyph />}
                          </span>
                          <h3 className="font-display text-xl leading-snug text-ink-primary">
                            {book.title}
                          </h3>
                          {book.author ? (
                            <p className="font-body text-sm text-ink-secondary">{book.author}</p>
                          ) : null}
                          <p className="font-body text-xs text-ink-tertiary">
                            Added {new Date(book.createdAt).toLocaleDateString()}
                          </p>
                          <button
                            type="button"
                            onClick={() => void openBook(book.id)}
                            className="mt-auto self-start rounded-lg border border-amber/40 px-4 py-2 font-body text-sm font-semibold text-amber transition-colors group-hover:bg-amber group-hover:text-bg-primary"
                          >
                            Open
                          </button>
                        </article>
                      </Reveal>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function BookGlyph(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17.5H7.5A2.5 2.5 0 0 0 5 22V4.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M5 19.5A2.5 2.5 0 0 1 7.5 17H19" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 7h6M9 10.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PageGlyph(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="m7 15 3.2-3.6 2.6 2.8 1.8-1.9L17 15.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="8" r="1.4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
