/**
 * The AI service (apps/ai-service, FastAPI) as the browser sees it: the
 * transcription jobs and, through /demo, the local generation service. The
 * generation service's bearer token never reaches the browser; the AI service
 * holds it and proxies the call.
 */

export const AI_URL = process.env['NEXT_PUBLIC_AI_URL'] ?? 'http://localhost:8000';

export interface GenerationServiceStatus {
  readonly available: boolean;
  readonly adapters: readonly string[];
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
        .map((e) => (e && typeof e === 'object' && 'msg' in e ? String((e as { msg: unknown }).msg) : JSON.stringify(e)))
        .join('; ');
    }
  }
  return `HTTP ${status}`;
}

export async function getGenerationStatus(): Promise<GenerationServiceStatus> {
  const res = await fetch(`${AI_URL}/demo/config`);
  if (!res.ok) throw new ServiceError(`AI service answered HTTP ${res.status} for /demo/config`, res.status);
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
};

export interface AdapterCard {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly note: string;
}

/** One card per adapter the service is serving right now. */
export function adapterCards(status: GenerationServiceStatus): AdapterCard[] {
  const size = modelSizeLabel(status.base_model);
  return status.adapters.map((id) => ({
    id,
    title: `${size} — served`,
    subtitle: id === 'base' ? 'base model' : `${id} adapter`,
    note: ADAPTER_NOTES[id] ?? `Adapter "${id}"`,
  }));
}
