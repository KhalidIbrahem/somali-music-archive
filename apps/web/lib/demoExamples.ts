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
 */
const OUD_CORPUS = 'a private oud (kaban) qaraami collection, 28 songs';
const CLEAN_OUD_CORPUS =
  'isolated oud stems from one performer’s own recordings in a private collection, 5.7 hours; no archival or internet audio';

const ACE_MODEL = 'ACE-Step 1.5 xl-sft (4 B)';
const ACE_ADAPTER = 'clean-oud LoRA';
const ACE_CHECKPOINT = 'v3_ace_xlsft, final';

/*
 * The four ACE-Step clips are the adapter side of pairs 1, 4, 11 and 12 of the
 * 16-pair blind set data/ab_stage3_acelora_vs_acebase (held-out captions,
 * seeds 2000 + pair), picked as the top four of 16 by z(PCS) + z(voiced);
 * PCS and voiced come from that set's ab_scores.json. The oud clips were
 * scored with the same scorer on the published MP3s (2026-09-30).
 */
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
    pcs: 0.991,
    voiced: 0.468,
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
    pcs: 0.842,
    voiced: 0.813,
  },
  {
    id: 'ace_oud_final_004',
    file: '/demos/generated/ace_oud_final_004.mp3',
    model: ACE_MODEL,
    adapter: ACE_ADAPTER,
    checkpoint: ACE_CHECKPOINT,
    corpus: CLEAN_OUD_CORPUS,
    prompt:
      'qaraami, Somali traditional song, led by the oud (kaban), solo oud, moderate at 110 BPM, pentatonic melody rooted on G, studio recording, clean, solo instrumental, no vocals',
    durationSec: 30,
    seed: 2004,
    pcs: 0.974,
    voiced: 0.774,
  },
  {
    id: 'ace_oud_final_001',
    file: '/demos/generated/ace_oud_final_001.mp3',
    model: ACE_MODEL,
    adapter: ACE_ADAPTER,
    checkpoint: ACE_CHECKPOINT,
    corpus: CLEAN_OUD_CORPUS,
    prompt:
      'qaraami, Somali traditional song, led by the oud (kaban), solo oud, moderate at 110 BPM, pentatonic melody rooted on C, studio recording, clean, solo instrumental, no vocals',
    durationSec: 30,
    seed: 2001,
    pcs: 0.901,
    voiced: 0.841,
  },
  {
    id: 'ace_oud_final_011',
    file: '/demos/generated/ace_oud_final_011.mp3',
    model: ACE_MODEL,
    adapter: ACE_ADAPTER,
    checkpoint: ACE_CHECKPOINT,
    corpus: CLEAN_OUD_CORPUS,
    prompt:
      'qaraami, Somali traditional song, led by the oud (kaban), solo oud, moderate at 107 BPM, pentatonic melody rooted on E, studio recording, clean, solo instrumental, no vocals',
    durationSec: 30,
    seed: 2011,
    pcs: 0.983,
    voiced: 0.678,
  },
  {
    id: 'ace_oud_final_012',
    file: '/demos/generated/ace_oud_final_012.mp3',
    model: ACE_MODEL,
    adapter: ACE_ADAPTER,
    checkpoint: ACE_CHECKPOINT,
    corpus: CLEAN_OUD_CORPUS,
    prompt:
      'qaraami, Somali traditional song, led by the oud (kaban), solo oud, lively at 150 BPM, pentatonic melody rooted on G, tuned 41 cents flat of A440, studio recording, clean, solo instrumental, no vocals',
    durationSec: 30,
    seed: 2012,
    pcs: 0.983,
    voiced: 0.673,
  },
];

export const NOT_DISTRIBUTED = 'The source recordings are not distributed.';

export function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
