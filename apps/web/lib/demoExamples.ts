/**
 * Examples shown on the Transcribe and Generate pages when no AI service is
 * attached (NEXT_PUBLIC_AI_SERVICE_MODE=off, the public site). Everything
 * here was produced by the same pipeline and the same adapters the pages call
 * when a service is attached; it was rendered ahead of time and copied into
 * public/demos/. No source recording is included: the scores are the
 * pipeline's output and the clips are model output.
 *
 * Numbers come from each score's pipeline JSON (`summary`); the clip
 * provenance from the run directories named below.
 */

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

export interface GeneratedExample {
  readonly id: string;
  readonly file: string;
  readonly model: string;
  readonly adapter: string;
  /** Run directory and checkpoint step under runs/. */
  readonly checkpoint: string;
  /** What the adapter was trained on. */
  readonly corpus: string;
  readonly prompt: string;
  /** torch.manual_seed before generation; the base-model clip for the same prompt used it too. */
  readonly seed: number;
  readonly durationSec: number;
}

const OUD_CORPUS = 'a private oud (kaban) qaraami collection, 28 songs';
const QARAAMI_CORPUS =
  'the held qaraami corpus, 43 hours: Harvard AWM Spec Coll 103 cassettes, a private oud collection and band recordings';

const PROMPT_VOICE =
  'qaraami, Somali traditional song, led by vocals, moderate at 110 BPM, pentatonic melody rooted on E, archival qaraami recording';
const PROMPT_OUD =
  'qaraami, Somali traditional song, led by the oud (kaban), lively at 156 BPM, pentatonic melody rooted on D#, archival qaraami recording';

export const GENERATED_EXAMPLES: readonly GeneratedExample[] = [
  {
    id: 'oud_000',
    file: '/demos/generated/oud_000_adapter.mp3',
    model: 'MusicGen-small (300 M)',
    adapter: 'oud adapter',
    checkpoint: 'oud_lora_r16_nodrop_20260809, step 500',
    corpus: OUD_CORPUS,
    prompt:
      'Somali qaraami led by the oud (kaban), lively at 121 BPM, pentatonic melody rooted on D, intimate home recording',
    durationSec: 10,
    seed: 42,
  },
  {
    id: 'oud_002',
    file: '/demos/generated/oud_002_adapter.mp3',
    model: 'MusicGen-small (300 M)',
    adapter: 'oud adapter',
    checkpoint: 'oud_lora_r16_nodrop_20260809, step 500',
    corpus: OUD_CORPUS,
    prompt:
      'Somali qaraami led by the oud (kaban), moderate at 110 BPM, pentatonic melody rooted on B, intimate home recording',
    durationSec: 10,
    seed: 44,
  },
  {
    id: 'medium_000',
    file: '/demos/generated/medium_000_adapter.mp3',
    model: 'MusicGen-medium (1.5 B)',
    adapter: 'qaraami adapter',
    checkpoint: 'qaraami_medium_r32, step 2750',
    corpus: QARAAMI_CORPUS,
    prompt: PROMPT_VOICE,
    durationSec: 15,
    seed: 42,
  },
  {
    id: 'large_000',
    file: '/demos/generated/large_000_adapter.mp3',
    model: 'MusicGen-large (3.3 B)',
    adapter: 'qaraami adapter',
    checkpoint: 'qaraami_large_r32, step 2750',
    corpus: QARAAMI_CORPUS,
    prompt: PROMPT_VOICE,
    durationSec: 15,
    seed: 42,
  },
  {
    id: 'medium_008',
    file: '/demos/generated/medium_008_adapter.mp3',
    model: 'MusicGen-medium (1.5 B)',
    adapter: 'qaraami adapter',
    checkpoint: 'qaraami_medium_r32, step 2750',
    corpus: QARAAMI_CORPUS,
    prompt: PROMPT_OUD,
    durationSec: 15,
    seed: 50,
  },
  {
    id: 'large_008',
    file: '/demos/generated/large_008_adapter.mp3',
    model: 'MusicGen-large (3.3 B)',
    adapter: 'qaraami adapter',
    checkpoint: 'qaraami_large_r32, step 2750',
    corpus: QARAAMI_CORPUS,
    prompt: PROMPT_OUD,
    durationSec: 15,
    seed: 50,
  },
];

export const NOT_DISTRIBUTED = 'The source recordings are not distributed.';

export function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The Listen page (website-v1): four clips from the served MusicGen-large
 * adapter, each with the numbers the project's own scorer gave it. Source:
 * data/ab_showcase_large/ab_scores.json — the top 16 of 256 samples drawn from
 * facebook/musicgen-large + qaraami_large_r32/ckpt_step_2750 during DPO round 1,
 * ranked by the composite reward, one clip per prompt; these are pairs 0, 4, 6
 * and 8 of that set, transcoded to mono MP3 (ffmpeg, 96 kb/s). Selected, not
 * random: say so on the page.
 *
 * PCS (apps/ai-service/scripts/pcs.py): the share of voiced 20 ms frames whose
 * pitch lies within ±50 cents of a degree of the pentatonic scale fitted to
 * the clip. Voiced: the share of frames with a confident pitch (torchcrepe).
 */
export interface ListenSample {
  readonly id: string;
  readonly file: string;
  /** Short title derived from the prompt. */
  readonly title: string;
  readonly prompt: string;
  readonly durationSec: number;
  readonly pcs: number;
  readonly voiced: number;
  /** Band-limited SNR of the clip in dB, from the same scorer run. */
  readonly bandSnrDb: number;
  /** Rank in the 16-clip showcase set (1 = highest composite reward). */
  readonly rank: number;
}

export const LISTEN_MODEL = {
  model: 'MusicGen-large (3.3 B)',
  adapter: 'qaraami adapter, LoRA r32',
  checkpoint: 'qaraami_large_r32, step 2750',
  corpus: QARAAMI_CORPUS,
  poolNote:
    'the 4 clips below are chosen from the 16 best of 256 samples the model produced for these prompts, ranked by an automatic score — a curated selection, not a random draw',
} as const;

export const LISTEN_SAMPLES: readonly ListenSample[] = [
  {
    id: 'showcase_large_000',
    file: '/demos/generated/showcase_large_000.mp3',
    title: 'Oud and hand drums, 92 BPM, rooted on E',
    prompt:
      'qaraami, Somali traditional song, led by the oud (kaban) and hand drums, moderate at 92 BPM, pentatonic melody rooted on E, intimate oud recording',
    durationSec: 15,
    pcs: 0.94,
    voiced: 0.357,
    bandSnrDb: 26.7,
    rank: 1,
  },
  {
    id: 'showcase_large_004',
    file: '/demos/generated/showcase_large_004.mp3',
    title: 'Solo oud, 108 BPM, rooted on C',
    prompt:
      'qaraami, Somali traditional song, led by the oud (kaban), moderate at 108 BPM, pentatonic melody rooted on C, intimate oud recording',
    durationSec: 15,
    pcs: 0.99,
    voiced: 0.666,
    bandSnrDb: 12.6,
    rank: 5,
  },
  {
    id: 'showcase_large_006',
    file: '/demos/generated/showcase_large_006.mp3',
    title: 'Oud and hand drums, lively at 150 BPM, rooted on G♯',
    prompt:
      'qaraami, Somali traditional song, led by the oud (kaban) and hand drums, lively at 150 BPM, pentatonic melody rooted on G#, intimate oud recording',
    durationSec: 15,
    pcs: 0.972,
    voiced: 0.706,
    bandSnrDb: 35.8,
    rank: 7,
  },
  {
    id: 'showcase_large_008',
    file: '/demos/generated/showcase_large_008.mp3',
    title: 'Solo oud, 100 BPM, rooted on C♯',
    prompt:
      'qaraami, Somali traditional song, led by the oud (kaban), moderate at 100 BPM, pentatonic melody rooted on C#, intimate oud recording',
    durationSec: 15,
    pcs: 0.968,
    voiced: 0.666,
    bandSnrDb: 25.1,
    rank: 9,
  },
];
