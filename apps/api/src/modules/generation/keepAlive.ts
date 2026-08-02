/**
 * Keep background work alive after the HTTP response is sent.
 *
 * On Vercel, a function instance may be frozen the moment the response goes
 * out — @vercel/functions' waitUntil() tells the platform to keep it warm
 * until the promise settles (requires Fluid Compute, default-on for current
 * projects). Outside Vercel (local dev server, Docker) the long-lived Node
 * process keeps promises running anyway, so this becomes a no-op that merely
 * guards against unhandled rejections.
 *
 * Injected into the service (tests pass a collector so background completions
 * are awaitable and deterministic).
 */

import { waitUntil } from '@vercel/functions';
import { logger } from '@/shared/logger';

export type KeepAlive = (work: Promise<unknown>) => void;

export const keepAlive: KeepAlive = (work) => {
  // Never let a background failure become an unhandled rejection; the service
  // already recorded the job as failed before rethrowing/logging.
  const guarded = work.catch((err: unknown) => {
    logger.error({ err, module: 'generation' }, 'background generation work failed');
  });
  try {
    waitUntil(guarded);
  } catch {
    // Not running on Vercel — nothing to do; the process holds the promise.
  }
};
