/**
 * Studio (DAW) project schemas (SESSION "studio master plan", Stage 5).
 *
 * The project document itself is an evolving plain-data format
 * (docs/DAW-PROJECT-FORMAT.md) owned by the studio; the API validates the
 * envelope it stores — name, bpm, and a bounded JSON payload — without
 * pinning every interior field (additive format evolution must not require
 * an API deploy).
 */

import { z } from 'zod';

/** Transport range of the Tier-1 studio. */
export const DAW_BPM_MIN = 60;
export const DAW_BPM_MAX = 140;

/** Hard cap on a serialised project document (1 MB is ~thousands of notes). */
export const MAX_PROJECT_BYTES = 1024 * 1024;

export const studioProjectSaveSchema = z.object({
  name: z.string().trim().min(1, 'Give the project a name').max(80),
  bpm: z.coerce.number().int().min(DAW_BPM_MIN).max(DAW_BPM_MAX),
  data: z.unknown().refine(
    (value) => {
      try {
        return JSON.stringify(value).length <= MAX_PROJECT_BYTES;
      } catch {
        return false;
      }
    },
    { message: 'Project document is too large' },
  ),
});

export type StudioProjectSaveInput = z.infer<typeof studioProjectSaveSchema>;
