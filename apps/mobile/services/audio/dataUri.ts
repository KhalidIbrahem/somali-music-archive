/**
 * data: URI → cache file (for generated-track playback).
 *
 * In keyless/dev mode the generation API returns Lyria/fake audio as an inline
 * `data:` URI. expo-audio reliably plays https and file:// sources, but inline
 * base64 URIs are unproven on native — so we stage the bytes into the CACHE
 * directory (ephemeral previews; the OS may evict — unlike the document
 * directory used for user-saved offline copies) and hand the player a file://.
 */

// SDK 57: the classic callback API lives in the `legacy` entry point (see
// services/audio/cache.ts for the same note).
import * as FileSystem from 'expo-file-system/legacy';

const GENERATED_DIR = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}generated-audio/`
  : null;

const MIME_EXTENSION: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
};

export interface ParsedDataUri {
  mimeType: string;
  base64: string;
}

/** Pure parser (exported for tests): `data:<mime>;base64,<payload>` or null. */
export function parseDataUri(uri: string): ParsedDataUri | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(uri);
  if (!match) return null;
  const [, mimeType, base64] = match;
  if (!mimeType || !base64) return null;
  return { mimeType, base64 };
}

/**
 * Write a base64 `data:` audio URI into the cache and return its file:// uri.
 * Throws on a malformed URI or a platform without a cache directory.
 */
export async function writeDataUriToCache(dataUri: string): Promise<string> {
  const parsed = parseDataUri(dataUri);
  if (!parsed) throw new Error('Not a base64 data: URI');
  if (!GENERATED_DIR) throw new Error('No cache directory available');

  const info = await FileSystem.getInfoAsync(GENERATED_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(GENERATED_DIR, { intermediates: true });
  }

  const ext = MIME_EXTENSION[parsed.mimeType] ?? 'bin';
  const dest = `${GENERATED_DIR}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await FileSystem.writeAsStringAsync(dest, parsed.base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return dest;
}

/** Resolve a job track's audioUrl (https / signed R2 / data:) to a playable uri. */
export async function resolvePlayableUri(audioUrl: string): Promise<string> {
  return audioUrl.startsWith('data:') ? writeDataUriToCache(audioUrl) : audioUrl;
}
