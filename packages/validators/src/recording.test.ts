import { describe, it, expect } from 'vitest';
import {
  uploadUrlRequestSchema,
  recordingMetadataSchema,
  recordingUpdateSchema,
  recordingQuerySchema,
} from './recording';

const OBJECT_ID = 'a'.repeat(24);

describe('uploadUrlRequestSchema', () => {
  it('rejects a disallowed content type', () => {
    const result = uploadUrlRequestSchema.safeParse({
      filename: 'song.mp3',
      contentType: 'audio/mpeg',
      sessionId: 's1',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an allowed audio type', () => {
    const result = uploadUrlRequestSchema.safeParse({
      filename: 'song.wav',
      contentType: 'audio/wav',
      sessionId: 's1',
    });
    expect(result.success).toBe(true);
  });
});

describe('recordingMetadataSchema', () => {
  const valid = {
    title: { somali: 'Balwo' },
    artistId: OBJECT_ID,
    genre: 'qaraami',
    instruments: ['oud', 'voice'],
    language: 'so',
    era: '1970s',
  };

  it('accepts valid cultural metadata', () => {
    expect(recordingMetadataSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an unknown genre', () => {
    expect(recordingMetadataSchema.safeParse({ ...valid, genre: 'jazz' }).success).toBe(false);
  });

  it('requires at least one instrument', () => {
    expect(recordingMetadataSchema.safeParse({ ...valid, instruments: [] }).success).toBe(false);
  });

  it('rejects a malformed era', () => {
    expect(recordingMetadataSchema.safeParse({ ...valid, era: '70s' }).success).toBe(false);
  });
});

describe('recordingUpdateSchema', () => {
  it('rejects an empty patch', () => {
    expect(recordingUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a single-field patch', () => {
    expect(recordingUpdateSchema.safeParse({ genre: 'heello' }).success).toBe(true);
  });
});

describe('recordingQuerySchema', () => {
  it('coerces pagination strings and applies defaults', () => {
    const parsed = recordingQuerySchema.parse({ page: '2', genre: 'dhaanto' });
    expect(parsed.page).toBe(2);
    expect(parsed.limit).toBe(20);
    expect(parsed.genre).toBe('dhaanto');
  });
});
