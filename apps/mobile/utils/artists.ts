/**
 * Derive a "featured artists" summary from a page of recordings. Until a dedicated
 * artists endpoint exists, the Discover tab surfaces artists by grouping the
 * recordings we already have. Pure and unit-tested.
 */

import type { PublicRecording } from '@sma/types';

export interface ArtistSummary {
  id: string;
  name: string;
  recordingCount: number;
}

export function deriveFeaturedArtists(
  recordings: readonly PublicRecording[],
  limit = 10,
): ArtistSummary[] {
  const byId = new Map<string, ArtistSummary>();
  for (const recording of recordings) {
    const { id, name } = recording.artist;
    const existing = byId.get(id);
    if (existing) {
      existing.recordingCount += 1;
    } else {
      byId.set(id, { id, name, recordingCount: 1 });
    }
  }
  return [...byId.values()].sort((a, b) => b.recordingCount - a.recordingCount).slice(0, limit);
}
