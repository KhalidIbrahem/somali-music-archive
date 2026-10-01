/**
 * Examples shown on the Transcribe and Generate pages when no AI service is
 * attached (NEXT_PUBLIC_AI_SERVICE_MODE=off, the public site). Everything
 * here was produced by the project's own pipeline and adapters on the research
 * workstation; it was rendered ahead of time and copied into public/demos/. No source recording is included: the scores are the
 * pipeline's output and the clips are model output.
 *
 * Numbers come from each score's pipeline JSON (`summary`); the clip
 * provenance from the run directories named below.
 */

import publishedClips from './published-clips.json';

export interface TranscriptionExample {
  readonly slug: string;
  readonly title: string;
  /** What was transcribed, without naming performers. */
  readonly source: string;
  readonly durationSec: number;
  readonly pdf: string;
  readonly preview: { readonly src: string; readonly width: number; readonly height: number };
  readonly tonic: string;
  /** The five scale degrees the pipeline fitted, in cents above the tonic. */
  readonly scaleCents: readonly number[];
  readonly bpm: number;
  readonly notes: number;
  /** Notes outside the fitted scale, kept in the score and marked. */
  readonly marked: number;
  readonly staves: readonly string[];
}

export const TRANSCRIPTION_EXAMPLES: readonly TranscriptionExample[] = [
  {
    slug: 'oud_02_aha_aha',
    title: 'Aha aha',
    source: 'solo oud (kaban), a private qaraami collection, full recording',
    durationSec: 242,
    pdf: '/demos/scores/oud_02_aha_aha.pdf',
    preview: { src: '/demos/scores/oud_02_aha_aha.png', width: 1400, height: 1812 },
    tonic: 'A',
    scaleCents: [0, 302, 496, 800, 1005],
    bpm: 83,
    notes: 575,
    marked: 55,
    staves: ['Oud (kaban)'],
  },
  {
    slug: 'oud_04_kaban_wadada',
    title: 'Kaban wadada',
    source: 'solo oud (kaban), a private qaraami collection, full recording',
    durationSec: 372,
    pdf: '/demos/scores/oud_04_kaban_wadada.pdf',
    preview: { src: '/demos/scores/oud_04_kaban_wadada.png', width: 1400, height: 1812 },
    tonic: 'A',
    scaleCents: [0, 313, 503, 709, 1016],
    bpm: 117,
    notes: 1002,
    marked: 54,
    staves: ['Oud (kaban)'],
  },
  {
    slug: 'band_e0e0a1425885_seg000',
    title: 'Band recording with voice',
    source: 'voice and oud separated first (Demucs), 30-second excerpt of a band recording',
    durationSec: 30,
    pdf: '/demos/scores/band_e0e0a1425885_seg000.pdf',
    preview: { src: '/demos/scores/band_e0e0a1425885_seg000.png', width: 1400, height: 1812 },
    tonic: 'F',
    scaleCents: [0, 199, 403, 703, 904],
    bpm: 112,
    notes: 87,
    marked: 3,
    staves: ['Voice', 'Oud (kaban)'],
  },
];

/** One published clip of model output, as written to published-clips.json. */
export interface GeneratedExample {
  readonly id: string;
  readonly file: string;
  readonly model: string;
  readonly adapter: string;
  /** Adapter name in the rights manifest / model card (docs/eval/MODEL_CARD_<id>.md). */
  readonly adapterId: string;
  /** Run directory and checkpoint under runs/. */
  readonly checkpoint: string;
  /** What the adapter was trained on. */
  readonly corpus: string;
  readonly prompt: string;
  /** Generation seed; the base-model clip for the same prompt used it too. */
  readonly seed: number;
  readonly durationSec: number;
  /** Pentatonic conformity (apps/ai-service/scripts/pcs.py), 0–1. */
  readonly pcs: number;
  /** Share of 20 ms frames with a confident pitch (torchcrepe), 0–1. */
  readonly voiced: number;
}

/*
 * Rights: only adapters whose model card says `releasable` may appear here.
 * Adapters trained on the Harvard collection (harvard_raw, medium, large,
 * qaraami_all and the DPO rounds on them) are research-only and are never
 * published; apps/web/scripts/check-public-audio-rights.mjs fails the build
 * if a public audio file or a /demos/generated/ reference breaks this.
 *
 * The clips themselves are listed in published-clips.json, written by
 * `apps/ai-service/scripts/clip_chooser.py publish` from the clips Khalid
 * picks in the chooser page; provenance and scores travel with each entry.
 */
const PUBLISHED: PublishedClips = publishedClips;

export const GENERATED_EXAMPLES: readonly GeneratedExample[] = PUBLISHED.generate;

export const NOT_DISTRIBUTED = 'The source recordings are not distributed.';

export function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The Listen page (website-v1): the clips in published-clips.json `listen`,
 * each with its own model, adapter and the numbers the project's own scorer
 * gave it. Selected, not random: `selectionNote` says how, and the page shows it.
 *
 * PCS (apps/ai-service/scripts/pcs.py): the share of voiced 20 ms frames whose
 * pitch lies within ±50 cents of a degree of the pentatonic scale fitted to
 * the clip. Voiced: the share of frames with a confident pitch (torchcrepe).
 */
export interface ListenSample extends GeneratedExample {
  /** Short title derived from the prompt. */
  readonly title: string;
  /** Band-limited SNR of the clip in dB, when the scorer measured it. */
  readonly bandSnrDb?: number;
  /** Rank in the scored pool (1 = best by the automatic score), when ranked. */
  readonly rank?: number;
  readonly rankOf?: number;
}

interface PublishedClips {
  readonly generate: readonly GeneratedExample[];
  readonly listen: { readonly selectionNote: string; readonly clips: readonly ListenSample[] };
}

export const LISTEN_SELECTION_NOTE: string = PUBLISHED.listen.selectionNote;

export const LISTEN_SAMPLES: readonly ListenSample[] = PUBLISHED.listen.clips;
