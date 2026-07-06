/**
 * Offline audio cache (ARCHITECTURE.md §3 Principle 2, §6 Offline Strategy).
 *
 * Downloads recordings to the app's document directory (persistent, not evicted by
 * the OS like the cache directory) keyed by recording id, so a saved recording plays
 * with no network. All file access goes through here; the rest of the app treats it
 * as: "give me a local uri if we have one."
 */

// SDK 57: the classic callback API (documentDirectory, getInfoAsync, …) lives in
// the `legacy` entry point; the root export is now the new class-based API.
import * as FileSystem from 'expo-file-system/legacy';

const CACHE_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}audio-cache/`
  : null;

const AUDIO_EXTENSIONS = new Set(['.wav', '.webm', '.flac', '.m4a', '.mp3', '.aac']);

/** Filesystem-safe base name for a recording id (human ids are already safe). */
function safeName(recordingId: string): string {
  return recordingId.replace(/[^a-zA-Z0-9\-_]/g, '_');
}

/** Extract a known audio extension (incl. dot) from a URL, or '' if none. */
function extFromUrl(url: string): string {
  const path = url.split('?')[0] ?? url;
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
  return AUDIO_EXTENSIONS.has(ext) ? ext : '';
}

function baseOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(0, dot) : filename;
}

async function ensureDir(): Promise<void> {
  if (!CACHE_DIR) return;
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

async function readNames(): Promise<string[]> {
  if (!CACHE_DIR) return [];
  try {
    return await FileSystem.readDirectoryAsync(CACHE_DIR);
  } catch {
    return []; // directory not created yet
  }
}

async function cachedFilename(recordingId: string): Promise<string | null> {
  const target = safeName(recordingId);
  for (const name of await readNames()) {
    if (baseOf(name) === target) return name;
  }
  return null;
}

export interface CachedItem {
  recordingId: string;
  uri: string;
  size: number;
}

export const audioCache = {
  async isCached(recordingId: string): Promise<boolean> {
    return (await cachedFilename(recordingId)) !== null;
  },

  async getCachedUri(recordingId: string): Promise<string | null> {
    const name = await cachedFilename(recordingId);
    return name && CACHE_DIR ? `${CACHE_DIR}${name}` : null;
  },

  /** Download the audio at `remoteUrl` for offline playback; returns the local uri. */
  async download(recordingId: string, remoteUrl: string): Promise<string> {
    if (!CACHE_DIR) throw new Error('Offline cache unavailable on this platform');
    await ensureDir();
    const dest = `${CACHE_DIR}${safeName(recordingId)}${extFromUrl(remoteUrl)}`;
    const result = await FileSystem.downloadAsync(remoteUrl, dest);
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Download failed with status ${result.status}`);
    }
    return result.uri;
  },

  async remove(recordingId: string): Promise<void> {
    const name = await cachedFilename(recordingId);
    if (name && CACHE_DIR) {
      await FileSystem.deleteAsync(`${CACHE_DIR}${name}`, { idempotent: true });
    }
  },

  async list(): Promise<CachedItem[]> {
    if (!CACHE_DIR) return [];
    const items: CachedItem[] = [];
    for (const name of await readNames()) {
      const uri = `${CACHE_DIR}${name}`;
      const info = await FileSystem.getInfoAsync(uri);
      items.push({
        recordingId: baseOf(name),
        uri,
        size: info.exists && !info.isDirectory ? info.size : 0,
      });
    }
    return items;
  },

  async totalSize(): Promise<number> {
    return (await this.list()).reduce((sum, item) => sum + item.size, 0);
  },

  async clear(): Promise<void> {
    if (!CACHE_DIR) return;
    await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
  },
} as const;
