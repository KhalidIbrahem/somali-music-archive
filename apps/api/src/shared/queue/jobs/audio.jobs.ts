/**
 * Audio processing job definition (ARCHITECTURE.md §8 Job Queue Architecture).
 *
 * Declares the `audio:process` job's name, payload, and BullMQ options: 3 retries
 * with exponential backoff, a 5-minute timeout, and failed jobs retained for the
 * dead-letter queue + Sentry inspection. Kept as plain config (no `bullmq` import)
 * so it can be shared by the worker and the enqueue layer without pulling a Redis
 * connection into every module that references it.
 */

/** The BullMQ queue name for the first-stage audio pipeline. */
export const AUDIO_QUEUE_NAME = 'audio:process';

/** Payload for an `audio:process` job. */
export interface AudioProcessJobData {
  recordingId: string;
  fileKey: string;
}

/** Default job options (BullMQ `JobsOptions` shape). */
export const AUDIO_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  /** Hard cap on a single attempt (AI jobs: 5 minutes max, §8). */
  timeout: 5 * 60 * 1000,
  /** Keep the last N successful jobs; retain ALL failed jobs for the DLQ. */
  removeOnComplete: 1_000,
  removeOnFail: false,
} as const;
