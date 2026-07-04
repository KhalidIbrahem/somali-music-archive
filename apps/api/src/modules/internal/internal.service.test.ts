import { describe, it, expect, beforeEach } from 'vitest';
import { MERT_EMBEDDING_DIM } from '@sma/validators';
import { AppError } from '@/shared/errors/AppError';
import { InMemoryRecordingRepository } from '@/modules/recordings/recordings.repository';
import { InMemorySearchIndex } from '@/modules/search/searchIndex';
import { InMemoryEmbeddingRepository } from './embeddings.repository';
import { createInternalService, type InternalService } from './internal.service';

let recordings: InMemoryRecordingRepository;
let embeddings: InMemoryEmbeddingRepository;
let search: InMemorySearchIndex;
let service: InternalService;
let recordingId: string;

const unitValue = 1 / Math.sqrt(MERT_EMBEDDING_DIM);
const embedding = new Array<number>(MERT_EMBEDDING_DIM).fill(unitValue);

beforeEach(async () => {
  recordings = new InMemoryRecordingRepository();
  embeddings = new InMemoryEmbeddingRepository();
  search = new InMemorySearchIndex();
  service = createInternalService({ recordings, embeddings, search });

  const draft = await recordings.createDraft({ fileKey: 'k', format: 'wav', sessionId: 's' });
  recordingId = draft.recordingId;
  await recordings.complete(recordingId, {
    title: { somali: 'Balwo' },
    singerName: 'Ahmed Ali Egal',
    genre: 'qaraami',
    instruments: ['voice'],
  });
});

describe('transcription results', () => {
  it('persists transcripts + singing flag and marks ai complete', async () => {
    await service.applyAiResult(recordingId, {
      kind: 'transcription',
      job_id: 'j1',
      somali_text: 'Waa maxay heesta?',
      english_text: 'What is this song?',
      segments: [{ start: 0, end: 4.2, text: 'Waa maxay heesta?', confidence: 0.78 }],
      detected_language: 'so',
      is_singing: true,
      duration_sec: 4.2,
    });

    const recording = await recordings.findById(recordingId);
    expect(recording?.ai.transcriptSomali).toBe('Waa maxay heesta?');
    expect(recording?.ai.transcriptEnglish).toBe('What is this song?');
    expect(recording?.ai.isSinging).toBe(true);
    expect(recording?.ai.status).toBe('complete');
    expect(recording?.ai.processedAt).toBeDefined();
  });
});

describe('pitch results', () => {
  it('maps snake_case points to camelCase PitchPoints + analytics', async () => {
    await service.applyAiResult(recordingId, {
      kind: 'pitch',
      job_id: 'j2',
      pitch_data: [
        {
          time_sec: 0.5,
          frequency_hz: 293.66,
          confidence: 0.95,
          note_label: 'do',
          cents_deviation: 0,
        },
      ],
      dominant_notes: ['do'],
      note_statistics: { do: { count: 1, share: 1, mean_cents: 0 } },
      voiced_fraction: 0.9,
      duration_sec: 12,
    });

    const recording = await recordings.findById(recordingId);
    expect(recording?.ai.pitchData?.[0]).toEqual({
      timeSec: 0.5,
      frequencyHz: 293.66,
      confidence: 0.95,
      noteLabel: 'do',
      centsDeviation: 0,
    });
    expect(recording?.ai.dominantNotes).toEqual(['do']);
    expect(recording?.ai.voicedFraction).toBe(0.9);
  });

  it('stages merge — pitch does not clobber an earlier transcript', async () => {
    await service.applyAiResult(recordingId, {
      kind: 'transcription',
      job_id: 'j1',
      somali_text: 'Hooyo',
      english_text: 'Mother',
      segments: [],
      detected_language: 'so',
      is_singing: false,
      duration_sec: 3,
    });
    await service.applyAiResult(recordingId, {
      kind: 'pitch',
      job_id: 'j2',
      pitch_data: [],
      dominant_notes: [],
      note_statistics: {},
      voiced_fraction: 0,
      duration_sec: 3,
    });

    const recording = await recordings.findById(recordingId);
    expect(recording?.ai.transcriptSomali).toBe('Hooyo');
    expect(recording?.ai.dominantNotes).toEqual([]);
  });
});

describe('embedding results', () => {
  const embeddingInput = {
    kind: 'embedding' as const,
    job_id: 'j3',
    embedding,
    model_version: 'mert-v1-95m',
    dim: MERT_EMBEDDING_DIM as 768,
  };

  it('stores the vector and links its row id onto the recording', async () => {
    await service.applyAiResult(recordingId, embeddingInput);

    const stored = await embeddings.get(recordingId);
    expect(stored?.embedding).toHaveLength(MERT_EMBEDDING_DIM);
    expect(stored?.modelVersion).toBe('mert-v1-95m');

    const recording = await recordings.findById(recordingId);
    expect(recording?.ai.embeddingId).toBe(stored?.id);
  });

  it('re-running the pipeline refreshes the vector but keeps the row id stable', async () => {
    await service.applyAiResult(recordingId, embeddingInput);
    const first = await embeddings.get(recordingId);

    await service.applyAiResult(recordingId, {
      ...embeddingInput,
      embedding: embedding.map((v) => -v),
    });
    const second = await embeddings.get(recordingId);

    expect(second?.id).toBe(first?.id); // embeddingId references never dangle
    expect(second?.embedding[0]).toBe(-unitValue);
    expect(await embeddings.count()).toBe(1);
  });
});

describe('search re-indexing', () => {
  const transcript = {
    kind: 'transcription' as const,
    job_id: 'j-idx',
    somali_text: 'Waa hees jaceyl',
    english_text: 'It is a love song',
    segments: [],
    detected_language: 'so' as const,
    is_singing: true,
    duration_sec: 6,
  };

  it('re-indexes a published recording so its new transcript is searchable', async () => {
    await recordings.updateModeration(recordingId, { status: 'published' });

    await service.applyAiResult(recordingId, transcript);

    const res = await search.search({ page: 1, limit: 20, q: 'jaceyl' });
    expect(res.ids).toEqual([recordingId]);
  });

  it('does not index a recording that is still in review', async () => {
    // No publish step — the recording sits in "review" from the beforeEach.
    await service.applyAiResult(recordingId, transcript);
    expect(await search.count()).toBe(0);
  });
});

describe('unknown recordings', () => {
  it('404s instead of silently dropping a result', async () => {
    await expect(
      service.applyAiResult('f'.repeat(24), {
        kind: 'transcription',
        job_id: 'j9',
        somali_text: 'x',
        english_text: 'x',
        segments: [],
        detected_language: 'so',
        is_singing: false,
        duration_sec: 11,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
