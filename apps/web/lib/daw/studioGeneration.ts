/**
 * Which generation adapters the Studio may offer.
 *
 * A Studio project can be exported and shared, so only adapters whose output
 * is releasable under docs/DATA_PROVENANCE.md are offered: the oud adapter
 * (the owner's own recordings) and the base model with no adapter. Adapters
 * trained on Harvard or mixed-rights rows (harvard_raw, large, …) are research
 * artifacts and never enter a Studio project, whatever the service reports.
 * The allowlist is deliberate: a new adapter appears here only after its model
 * card says "releasable".
 */

import type { GenerationServiceStatus } from '@/lib/aiService';

export const STUDIO_RELEASABLE_ADAPTERS: ReadonlySet<string> = new Set(['oud', 'base']);

export interface StudioAdapterOption {
  id: string;
  label: string;
}

export const STUDIO_ADAPTER_LABELS: Record<string, string> = {
  oud: 'Somali oud (fine-tuned)',
  base: 'Base model, no Somali fine-tuning',
};

/** Adapters to offer, in allowlist order; research-only ones are never included. */
export function studioAdapters(
  status: Pick<GenerationServiceStatus, 'available' | 'adapters'> & {
    adapters_research_only?: readonly string[];
  },
): StudioAdapterOption[] {
  if (!status.available) return [];
  const researchOnly = new Set(status.adapters_research_only ?? []);
  const served = new Set(status.adapters);
  return [...STUDIO_RELEASABLE_ADAPTERS]
    .filter((id) => served.has(id) && !researchOnly.has(id))
    .map((id) => ({ id, label: STUDIO_ADAPTER_LABELS[id] ?? id }));
}

export const GENERATION_DURATION_MIN = 3;
export const GENERATION_DURATION_MAX = 30;

/** Mirror of the AI service's request schema (routers/demo.py GenerateBody). */
export function validateGenerationRequest(input: {
  prompt: string;
  duration: number;
  seed: number;
}): string | null {
  const prompt = input.prompt.trim();
  if (prompt.length < 3) return 'Describe the music in at least 3 characters.';
  if (prompt.length > 400) return 'Keep the description under 400 characters.';
  if (
    !Number.isInteger(input.duration) ||
    input.duration < GENERATION_DURATION_MIN ||
    input.duration > GENERATION_DURATION_MAX
  )
    return `Length must be ${GENERATION_DURATION_MIN}–${GENERATION_DURATION_MAX} seconds.`;
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 2 ** 31 - 1)
    return 'Seed must be a whole number from 0 to 2147483647.';
  return null;
}
