/**
 * Collection contracts (ARCHITECTURE.md §16 Phase 4, SESSION P4-05).
 *
 * A user-curated list of recordings, optionally public. The detailed view hydrates
 * its items to published recordings (unpublished/removed items are omitted).
 */

import type { IsoDateTimeString, Uuid } from './common';
import type { PublicRecording } from './recording';

export interface PublicCollection {
  readonly id: Uuid;
  readonly name: string;
  readonly description?: string;
  readonly isPublic: boolean;
  /** Number of recordings stored in the collection. */
  readonly itemCount: number;
  readonly owner: { readonly id: Uuid };
  readonly createdAt: IsoDateTimeString;
}

export interface CollectionWithItems extends PublicCollection {
  readonly items: readonly PublicRecording[];
}
