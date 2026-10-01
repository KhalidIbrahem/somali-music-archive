/**
 * Undo/redo history (Studio v2) — a bounded stack of whole-document
 * snapshots. The studio's edit path never mutates a published project (every
 * edit is a `cloneProject` draft), so a snapshot is simply the previous
 * document object: no diffing, no reverse operations, and an undo can never
 * drift from what the engine played.
 *
 * Coalescing: edits that share a `coalesceKey` and land within `windowMs` of
 * each other replace the current snapshot instead of pushing a new one — a
 * region drag that commits sixty times a second is ONE undo step. Each drag
 * gesture uses its own key, so two separate drags stay two steps.
 */

export const HISTORY_LIMIT = 100;
export const COALESCE_WINDOW_MS = 1500;

export interface HistoryState<T> {
  /** Oldest first. */
  past: readonly T[];
  present: T;
  /** Nearest redo first. */
  future: readonly T[];
  /** Key of the last commit, null after undo/redo or a non-coalescing commit. */
  coalesceKey: string | null;
  lastCommitAt: number;
}

export interface CommitOptions {
  coalesceKey?: string | undefined;
  /** Clock override (tests). */
  now?: number | undefined;
  limit?: number | undefined;
  windowMs?: number | undefined;
}

export function initHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [], coalesceKey: null, lastCommitAt: 0 };
}

export function commit<T>(
  history: HistoryState<T>,
  next: T,
  options: CommitOptions = {},
): HistoryState<T> {
  const now = options.now ?? Date.now();
  const limit = Math.max(1, options.limit ?? HISTORY_LIMIT);
  const windowMs = options.windowMs ?? COALESCE_WINDOW_MS;
  const key = options.coalesceKey ?? null;
  const coalesce =
    key !== null && key === history.coalesceKey && now - history.lastCommitAt <= windowMs;
  if (coalesce) {
    return { past: history.past, present: next, future: [], coalesceKey: key, lastCommitAt: now };
  }
  const past = [...history.past, history.present];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    present: next,
    future: [],
    coalesceKey: key,
    lastCommitAt: now,
  };
}

export function canUndo<T>(history: HistoryState<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: HistoryState<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: HistoryState<T>): HistoryState<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    coalesceKey: null,
    lastCommitAt: 0,
  };
}

export function redo<T>(history: HistoryState<T>): HistoryState<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
    coalesceKey: null,
    lastCommitAt: 0,
  };
}

/** Replace the present without creating a step (e.g. re-stamping updatedAt). */
export function replacePresent<T>(history: HistoryState<T>, present: T): HistoryState<T> {
  return { ...history, present };
}
