/**
 * The AI service (apps/ai-service, FastAPI) as the browser sees it: the
 * transcription jobs and, through /demo, the local generation service. The
 * generation service's bearer token never reaches the browser; the AI service
 * holds it and proxies the call.
 */

export const AI_URL = process.env['NEXT_PUBLIC_AI_URL'] ?? 'http://localhost:8000';

export interface AdapterTiming {
  readonly seconds_per_audio_second: number;
  readonly seconds_for_30s_clip: number;
  readonly n: number;
}

export interface AdapterDetail {
  readonly id: string;
  readonly base_model: string;
  /** The service's own size label for the adapter's base model, e.g. "Small 300M". */
  readonly size: string;
  readonly loaded: boolean;
  readonly timing?: AdapterTiming | null;
}

export interface GenerationServiceStatus {
  readonly available: boolean;
  readonly adapters: readonly string[];
  /** One entry per adapter the service reports as loaded. */
  readonly adapter_details?: readonly AdapterDetail[];
  readonly base_model?: string;
  readonly device?: string;
  readonly url?: string;
  readonly detail?: string;
}

export interface ServedGeneration {
  readonly id: string;
  readonly adapter: string;
  readonly duration: number;
  /** Path on the AI service that streams the wav. */
  readonly audio: string;
  readonly total_seconds?: number;
  readonly provenance?: string;
  readonly pcs?: {
    readonly pcs?: number;
    readonly voiced_fraction?: number;
    readonly tonic?: string;
  } | null;
}

/** The backend's own words for a failure, exactly as it sent them. */
export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

function detailOf(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) {
      return d
        .map((e) =>
          e && typeof e === 'object' && 'msg' in e
            ? String((e as { msg: unknown }).msg)
            : JSON.stringify(e),
        )
        .join('; ');
    }
  }
  return `HTTP ${status}`;
}

export async function getGenerationStatus(): Promise<GenerationServiceStatus> {
  const res = await fetch(`${AI_URL}/demo/config`);
  if (!res.ok)
    throw new ServiceError(`AI service answered HTTP ${res.status} for /demo/config`, res.status);
  const data = (await res.json()) as { generation: GenerationServiceStatus };
  return data.generation;
}

export async function generateServed(input: {
  prompt: string;
  adapter: string;
  duration: number;
  seed: number;
}): Promise<ServedGeneration> {
  const res = await fetch(`${AI_URL}/demo/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ServiceError(detailOf(body, res.status), res.status);
  return body as ServedGeneration;
}

/** The base model's size, from its Hugging Face id, in the words the cards use. */
export function modelSizeLabel(baseModel: string | undefined): string {
  const id = (baseModel ?? '').toLowerCase();
  if (id.includes('musicgen-small')) return 'Small (300M)';
  if (id.includes('musicgen-medium')) return 'Medium (1.5B)';
  if (id.includes('musicgen-large')) return 'Large (3.3B)';
  if (id.includes('musicgen-melody')) return 'Melody (1.5B)';
  return baseModel ?? 'Model';
}

/** What each known adapter was trained on; anything else is named as-is. */
const ADAPTER_NOTES: Readonly<Record<string, string>> = {
  base: 'The base model with no adapter, for comparison',
  oud: 'Adapter fine-tuned on the oud (kaban) qaraami collection',
  harvard_raw: 'Adapter fine-tuned on the Harvard cassette corpus, as recorded',
  harvard_denoised: 'Adapter fine-tuned on the denoised Harvard cassette corpus',
  harvard_restored: 'Adapter fine-tuned on the restored Harvard cassette corpus',
  large: 'Adapter fine-tuned on the held qaraami corpus: oud, band and cassette recordings',
};

export interface AdapterCard {
  readonly id: string;
  /** The base model's size, e.g. "Small 300M" or "Large 3.3B". */
  readonly title: string;
  readonly subtitle: string;
  readonly note: string;
  /** Measured by the service on its last generations; absent until the adapter has run. */
  readonly timing: string;
}

export function timingText(t: AdapterTiming | null | undefined): string {
  if (!t) return 'generation time not measured yet';
  return `about ${t.seconds_per_audio_second.toFixed(1)} s per second of audio (${Math.round(t.seconds_for_30s_clip)} s for a 30 s clip)`;
}

/**
 * Adapters trained on the Harvard cassettes are not offered on the web page,
 * whatever the service is serving: that material is held for research only.
 */
function listed(id: string): boolean {
  return !id.startsWith('harvard');
}

/** One card per adapter the service reports as loaded right now. */
export function adapterCards(status: GenerationServiceStatus): AdapterCard[] {
  const details = status.adapter_details?.filter((d) => d.loaded && listed(d.id));
  if (details && details.length > 0) {
    return details.map((d) => ({
      id: d.id,
      title: d.size,
      subtitle: d.id === 'base' ? 'base model, no adapter' : `${d.id} adapter`,
      note: ADAPTER_NOTES[d.id] ?? `Adapter "${d.id}"`,
      timing: timingText(d.timing),
    }));
  }
  // An older service without adapter_details: size from the base model id.
  const size = modelSizeLabel(status.base_model);
  return status.adapters.filter(listed).map((id) => ({
    id,
    title: size,
    subtitle: id === 'base' ? 'base model, no adapter' : `${id} adapter`,
    note: ADAPTER_NOTES[id] ?? `Adapter "${id}"`,
    timing: 'generation time not measured yet',
  }));
}
