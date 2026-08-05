/**
 * QaraamiGen branding layer — model tiers as USERS see them (mirror of the
 * web app's lib/brand.ts). Which engine serves a tier is a backend
 * implementation detail; wire `provider` ids are never displayed, and any
 * backend error text passes through brandMessage() before rendering.
 */

import type { MusicProvider } from '@sma/types';

export const MODEL_TIERS: ReadonlyArray<{ value: MusicProvider; label: string; note: string }> = [
  {
    value: 'lyria',
    label: 'QaraamiGen Lite',
    note: 'Fast instrumental sketches · ~30-second clips',
  },
  { value: 'suno', label: 'QaraamiGen Pro', note: 'Full-length songs with vocals · coming soon' },
  {
    value: 'local',
    label: 'QaraamiGen Base',
    note: 'Our foundation model, in training on the restored archive · coming soon',
  },
];

export function brandProviderName(id: string): string {
  return MODEL_TIERS.find((t) => t.value === id)?.label ?? 'QaraamiGen';
}

/** Rewrite backend/provider error text into brand terms before display. */
export function brandMessage(message: string): string {
  return (
    message
      // Specific phrasings first, then generic name scrubs.
      .replace(
        /The (suno|lyria|local) provider is not configured[^.]*/i,
        'This model is not available yet',
      )
      .replace(
        /OpenRouter credits exhausted[^.]*/i,
        'Generation credits are exhausted — please top up',
      )
      .replace(/openrouter\.ai\S*/gi, 'your account')
      .replace(/\bOpenRouter request failed\b/gi, 'The generation service failed')
      .replace(/\bOpenRouter\b/gi, 'the generation service')
      .replace(/\b(Google\s+)?Lyria(\s*3)?\b/g, 'QaraamiGen')
      .replace(/\bSuno\b/g, 'QaraamiGen')
      .replace(/\bGemini\b/g, 'the generation service')
  );
}
