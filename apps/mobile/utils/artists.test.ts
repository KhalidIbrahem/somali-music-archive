import { deriveFeaturedArtists } from './artists';
import type { PublicRecording } from '@sma/types';

const rec = (artistId: string, artistName: string): PublicRecording =>
  ({
    id: `r-${Math.random()}`,
    artist: { id: artistId, name: artistName },
  }) as unknown as PublicRecording;

describe('deriveFeaturedArtists', () => {
  it('groups recordings by artist and counts them', () => {
    const featured = deriveFeaturedArtists([
      rec('a1', 'Ahmed Ali Egal'),
      rec('a1', 'Ahmed Ali Egal'),
      rec('a2', 'Hibo Nuura'),
    ]);
    expect(featured).toHaveLength(2);
    expect(featured[0]).toEqual({ id: 'a1', name: 'Ahmed Ali Egal', recordingCount: 2 });
    expect(featured[1]?.recordingCount).toBe(1);
  });

  it('sorts by recording count descending', () => {
    const featured = deriveFeaturedArtists([
      rec('a1', 'One'),
      rec('a2', 'Two'),
      rec('a2', 'Two'),
      rec('a2', 'Two'),
    ]);
    expect(featured[0]?.id).toBe('a2');
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => rec(`a${i}`, `Artist ${i}`));
    expect(deriveFeaturedArtists(many, 5)).toHaveLength(5);
  });

  it('returns an empty list for no recordings', () => {
    expect(deriveFeaturedArtists([])).toEqual([]);
  });
});
