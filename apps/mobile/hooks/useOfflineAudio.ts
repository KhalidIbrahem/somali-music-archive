/**
 * useOfflineAudio — offline state + actions for one recording (ARCHITECTURE.md §6).
 *
 * `resolvePlaybackUri` returns the local cached file when present (so playback works
 * with no network), otherwise a fresh signed URL. `download`/`remove` manage the
 * offline copy.
 */

import { useCallback, useEffect, useState } from 'react';
import { audioCache } from '@/services/audio/cache';
import { getAudioUrl } from '@/services/api/recordings';

export interface UseOfflineAudio {
  isDownloaded: boolean;
  downloading: boolean;
  download: () => Promise<void>;
  remove: () => Promise<void>;
  /** A local uri if cached, else a fresh signed streaming URL. */
  resolvePlaybackUri: () => Promise<string>;
}

export function useOfflineAudio(recordingId: string): UseOfflineAudio {
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    void audioCache.isCached(recordingId).then((cached) => {
      if (active) setIsDownloaded(cached);
    });
    return () => {
      active = false;
    };
  }, [recordingId]);

  const download = useCallback(async () => {
    setDownloading(true);
    try {
      const { url } = await getAudioUrl(recordingId);
      await audioCache.download(recordingId, url);
      setIsDownloaded(true);
    } finally {
      setDownloading(false);
    }
  }, [recordingId]);

  const remove = useCallback(async () => {
    await audioCache.remove(recordingId);
    setIsDownloaded(false);
  }, [recordingId]);

  const resolvePlaybackUri = useCallback(async (): Promise<string> => {
    const cached = await audioCache.getCachedUri(recordingId);
    if (cached) return cached;
    const { url } = await getAudioUrl(recordingId);
    return url;
  }, [recordingId]);

  return { isDownloaded, downloading, download, remove, resolvePlaybackUri };
}
