/**
 * useGeneration — start a generation job and poll it to a terminal state.
 *
 * Mutation submits POST /generate; the query then polls GET /generate/:jobId
 * every 3s (the API-documented minimum) via react-query's refetchInterval,
 * stopping automatically once the job succeeds or fails. The submit response
 * may itself already be terminal (sync providers like Lyria in-budget), which
 * the interval callback handles by never starting.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GenerationJob } from '@sma/types';
import { getGenerationJob, startGeneration } from '@/services/api/generation';

export const GENERATION_POLL_MS = 3_000;

export function isTerminalJob(job: GenerationJob | null | undefined): boolean {
  return job?.state === 'succeeded' || job?.state === 'failed';
}

export function useGeneration(options?: { pollMs?: number }) {
  const pollMs = options?.pollMs ?? GENERATION_POLL_MS;
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: startGeneration,
    onSuccess: (job) => {
      // Seed the poll query with the submit response so the UI reflects it
      // immediately (it may already be terminal for sync providers).
      queryClient.setQueryData(['generation', job.id], job);
      setJobId(job.id);
    },
  });

  const jobQuery = useQuery({
    queryKey: ['generation', jobId],
    queryFn: () => {
      if (!jobId) throw new Error('No generation job to poll');
      return getGenerationJob(jobId);
    },
    enabled: Boolean(jobId),
    // The seeded submit response counts as fresh: polling is driven purely by
    // refetchInterval below. staleTime 0 would add a pointless extra fetch on
    // mount — visible as a double-hit for jobs that are already terminal.
    staleTime: Infinity,
    refetchInterval: (query) => (isTerminalJob(query.state.data) ? false : pollMs),
  });

  const job: GenerationJob | null = jobQuery.data ?? start.data ?? null;

  function reset(): void {
    setJobId(null);
    start.reset();
  }

  return {
    /** Kick off a generation (mutation object — use .mutate / .isPending). */
    start,
    /** The latest job snapshot, or null before the first submit. */
    job,
    /** True from submit until the job reaches succeeded/failed. */
    isWorking: start.isPending || (Boolean(jobId) && !isTerminalJob(job)),
    reset,
  };
}
