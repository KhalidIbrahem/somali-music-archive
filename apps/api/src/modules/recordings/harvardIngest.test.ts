import { describe, it, expect } from 'vitest';
import { recordingCompleteMetadataSchema } from '@sma/validators';
import {
  harvardFileKey,
  harvardPitchFileSchema,
  harvardRecordSchema,
  toAiPatch,
  toCompleteMetadata,
  toPitchPoints,
  type HarvardRecord,
} from './harvardIngest';

const base: HarvardRecord = {
  track_id: 42,
  filename: 'track_0042_Kaana_Siib_Ahmed_Ali_Egal.wav',
  title: 'Kaana Siib Kaana Saar',
  artists: 'Ahmed Ali Egal',
  duration_sec: 187.4,
  quality_score: 74.5,
  transcript_somali: 'hobalayow heedhe',
  transcript_english: 'oh singer, listen',
  is_singing: false,
  transcript_confidence: 0.71,
  dominant_notes: ['sol', 'la'],
  voiced_fraction: 0.63,
  pitch_data_file: 'pitch_data/track_0042_pitch.json',
  genre_predicted: null,
  era_estimated: null,
  metadata_source: 'csv:harvard_metadata.csv',
};

describe('harvardRecordSchema', () => {
  it('accepts a notebook record and tolerates unknown future fields', () => {
    const parsed = harvardRecordSchema.parse({ ...base, some_new_field: 1 });
    expect(parsed.track_id).toBe(42);
  });

  it('rejects structurally invalid records', () => {
    expect(() => harvardRecordSchema.parse({ ...base, track_id: 'x' })).toThrow();
    expect(() => harvardRecordSchema.parse({ ...base, quality_score: 101 })).toThrow();
  });
});

describe('toCompleteMetadata', () => {
  it('always produces metadata the platform schema accepts (round-trip guarantee)', () => {
    // Whatever the mapper emits must survive the SAME validator the API applies
    // on upload-complete — otherwise ingest would die at the repository door.
    expect(() => recordingCompleteMetadataSchema.parse(toCompleteMetadata(base))).not.toThrow();
    const sparse: HarvardRecord = {
      ...base,
      title: null,
      artists: null,
      genre_predicted: 'not-a-genre',
      era_estimated: 'the seventies',
    };
    expect(() => recordingCompleteMetadataSchema.parse(toCompleteMetadata(sparse))).not.toThrow();
  });

  it('never invents cultural labels: unverified genre → other, era dropped unless a decade', () => {
    const meta = toCompleteMetadata({ ...base, genre_predicted: 'jazz', era_estimated: 'old' });
    expect(meta.genre).toBe('other');
    expect(meta.era).toBeUndefined();

    const verified = toCompleteMetadata({
      ...base,
      genre_predicted: 'qaraami',
      era_estimated: '1960s',
    });
    expect(verified.genre).toBe('qaraami');
    expect(verified.era).toBe('1960s');
  });

  it('falls back explicitly for missing title/artist and records provenance', () => {
    const meta = toCompleteMetadata({ ...base, title: null, artists: null });
    expect(meta.title.somali).toBe('track_0042_Kaana_Siib_Ahmed_Ali_Egal');
    expect(meta.singerName).toBe('Unknown (Harvard AWM)');
    expect(meta.fieldNotes).toContain('track_id=42');
    expect(meta.fieldNotes).toContain('Harvard Archive of World Music');
  });
});

describe('toAiPatch / toPitchPoints', () => {
  const pitch = harvardPitchFileSchema.parse({
    voiced_fraction: 0.63,
    dominant_notes: ['sol', 'la', 'mi'],
    points: [
      {
        time_sec: 1.23,
        frequency_hz: 442.1,
        confidence: 0.91,
        note_label: 'sol',
        cents_deviation: 8.25,
      },
    ],
  });

  it('converts snake_case pitch points to platform camelCase', () => {
    expect(toPitchPoints(pitch)).toEqual([
      {
        timeSec: 1.23,
        frequencyHz: 442.1,
        confidence: 0.91,
        noteLabel: 'sol',
        centsDeviation: 8.25,
      },
    ]);
  });

  it('omits null fields instead of writing nulls (stage-merge semantics)', () => {
    const patch = toAiPatch({
      ...base,
      transcript_english: null,
      is_singing: null,
      voiced_fraction: null,
      dominant_notes: null,
    });
    expect(patch).toEqual({ transcriptSomali: 'hobalayow heedhe' });
  });

  it('embeds pitch points only when explicitly asked (dev-store size guard)', () => {
    const lean = toAiPatch(base, pitch);
    expect(lean.pitchData).toBeUndefined();
    expect(lean.dominantNotes).toEqual(['sol', 'la', 'mi']); // pitch file wins over record

    const full = toAiPatch(base, pitch, { includePitchPoints: true });
    expect(full.pitchData).toHaveLength(1);
  });
});

describe('harvardFileKey', () => {
  it('is stable and zero-padded so re-runs map to the same R2 object', () => {
    expect(harvardFileKey(42)).toBe('recordings/harvard/track_0042.wav');
    expect(harvardFileKey(42)).toBe(harvardFileKey(42));
  });
});
