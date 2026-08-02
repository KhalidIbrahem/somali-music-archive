/**
 * Where generated audio bytes live (ADR-0005 interface-first).
 *
 * Providers hand back either a hosted URL (Suno — stays external, untouched)
 * or raw bytes (Lyria, local model). Bytes must NOT be stored inline in
 * production: the Redis job store rides Upstash (1MB request cap) and Vercel
 * buffers responses (~4.5MB cap), while a 30s MP3 is ~1.4MB as base64 and a
 * Lyria-Pro WAV ~40MB. So:
 *
 *   • InlineAudioStore — dev/test/memory mode: data: URI inside the job. Zero
 *     infrastructure, survives nothing, perfect for the keyless demo.
 *   • R2AudioStore — production: one server-side PutObject into the private
 *     bucket under generated/ (the documented, user-approved exception to the
 *     "audio never uploads through Node" rule — see r2.uploadObject), with the
 *     job holding only the tiny fileKey.
 *
 * resolveAudioUrl() is shared: r2 refs get a FRESH signed URL on every poll
 * (signed URLs live 1h; jobs live 24h — re-signing keeps old jobs playable).
 */

import { generateDownloadUrl, uploadObject } from '@/shared/storage/r2';
import { useRedisBackend } from '@/shared/cache/redisClient';
import type { GeneratedAudioPayload } from './providers/provider';

export type StoredAudioRef =
  | { readonly kind: 'inline'; readonly dataUri: string }
  | { readonly kind: 'r2'; readonly fileKey: string }
  | { readonly kind: 'external'; readonly url: string };

export interface GeneratedAudioStore {
  persist(audio: GeneratedAudioPayload): Promise<StoredAudioRef>;
}

export class InlineAudioStore implements GeneratedAudioStore {
  async persist(audio: GeneratedAudioPayload): Promise<StoredAudioRef> {
    if (audio.kind === 'url') return { kind: 'external', url: audio.url };
    const base64 = Buffer.from(audio.data).toString('base64');
    return { kind: 'inline', dataUri: `data:${audio.mimeType};base64,${base64}` };
  }
}

export class R2AudioStore implements GeneratedAudioStore {
  async persist(audio: GeneratedAudioPayload): Promise<StoredAudioRef> {
    if (audio.kind === 'url') return { kind: 'external', url: audio.url };
    const { fileKey } = await uploadObject(audio.data, audio.mimeType, 'generated');
    return { kind: 'r2', fileKey };
  }
}

/** Resolve a stored ref to something a client can play RIGHT NOW. */
export async function resolveAudioUrl(ref: StoredAudioRef): Promise<string> {
  switch (ref.kind) {
    case 'inline':
      return ref.dataUri;
    case 'external':
      return ref.url;
    case 'r2': {
      const { url } = await generateDownloadUrl(ref.fileKey);
      return url;
    }
  }
}

/** Paired with the job store's switch: Redis jobs ⇒ R2 audio (both mean "real
 * multi-instance deployment"); memory jobs ⇒ inline audio. */
export function selectAudioStore(): GeneratedAudioStore {
  return useRedisBackend() ? new R2AudioStore() : new InlineAudioStore();
}
