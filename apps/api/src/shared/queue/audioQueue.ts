/**
 * Audio job enqueue seam (ARCHITECTURE.md §8, ADR-0005).
 *
 * The recordings service depends on this interface, not on BullMQ directly, so the
 * upload flow runs and is testable with zero infrastructure. Phase 1 deploy swaps
 * in a BullMQ-backed implementation (connected to Redis, using AUDIO_JOB_OPTIONS)
 * behind the same interface — no service changes.
 */

import { logger } from '@/shared/logger';
import { AUDIO_QUEUE_NAME, type AudioProcessJobData } from './jobs/audio.jobs';

export interface AudioJobQueue {
  /** Enqueue the first-stage `audio:process` job for a freshly-uploaded recording. */
  enqueueProcess(data: AudioProcessJobData): Promise<void>;
}

/** Default implementation: logs the enqueue. Replaced by BullMQ in production. */
class LoggingAudioJobQueue implements AudioJobQueue {
  async enqueueProcess(data: AudioProcessJobData): Promise<void> {
    logger.info({ queue: AUDIO_QUEUE_NAME, recordingId: data.recordingId }, 'enqueue audio job');
  }
}

export const audioQueue: AudioJobQueue = new LoggingAudioJobQueue();
