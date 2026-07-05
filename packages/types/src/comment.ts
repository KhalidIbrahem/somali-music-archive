/**
 * Community comment contracts (ARCHITECTURE.md §16 Phase 4, SESSION P4-05).
 *
 * A comment left by a signed-in user on a published recording. The author's display
 * name is a snapshot taken when the comment was written.
 */

import type { IsoDateTimeString, Uuid } from './common';

export interface PublicComment {
  readonly id: Uuid;
  /** The recording's ObjectId (`_id`). */
  readonly recordingId: string;
  readonly author: { readonly id: Uuid; readonly name: string };
  readonly body: string;
  readonly createdAt: IsoDateTimeString;
}
