import { describe, it, expect } from 'vitest';
import { generateRequestSchema, generationJobParamsSchema } from './generation';

const valid = {
  provider: 'suno',
  prompt: 'A gentle qaraami love song with solo oud, 1960s Mogadishu style',
};

describe('generateRequestSchema', () => {
  it('accepts a minimal valid request and defaults instrumental to false', () => {
    const result = generateRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.instrumental).toBe(false);
  });

  it('accepts every known provider', () => {
    for (const provider of ['suno', 'lyria', 'local']) {
      expect(generateRequestSchema.safeParse({ ...valid, provider }).success).toBe(true);
    }
  });

  it('rejects an unknown provider', () => {
    expect(generateRequestSchema.safeParse({ ...valid, provider: 'udio' }).success).toBe(false);
  });

  it('strips control characters and trims the prompt', () => {
    const result = generateRequestSchema.safeParse({
      ...valid,
      prompt: '  dhaanto\u0000 rhythm\u001f with drums\u007f  ',
    });
    expect(result.success).toBe(true);
    // Each control char becomes a space; outer whitespace is trimmed.
    if (result.success) expect(result.data.prompt).toBe('dhaanto  rhythm  with drums');
  });

  it('rejects a prompt that is too short after trimming', () => {
    expect(generateRequestSchema.safeParse({ ...valid, prompt: '  ab ' }).success).toBe(false);
  });

  it('rejects a prompt over 500 characters', () => {
    expect(generateRequestSchema.safeParse({ ...valid, prompt: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('bounds durationSec to 5–180 whole seconds', () => {
    expect(generateRequestSchema.safeParse({ ...valid, durationSec: 30 }).success).toBe(true);
    expect(generateRequestSchema.safeParse({ ...valid, durationSec: 4 }).success).toBe(false);
    expect(generateRequestSchema.safeParse({ ...valid, durationSec: 181 }).success).toBe(false);
    expect(generateRequestSchema.safeParse({ ...valid, durationSec: 12.5 }).success).toBe(false);
  });

  it('rejects an over-long title', () => {
    expect(generateRequestSchema.safeParse({ ...valid, title: 'x'.repeat(81) }).success).toBe(
      false,
    );
  });
});

describe('generationJobParamsSchema', () => {
  it('accepts a UUID and rejects anything else', () => {
    expect(
      generationJobParamsSchema.safeParse({ jobId: '8f1e2ab0-1c2d-4e3f-9a4b-5c6d7e8f9a0b' })
        .success,
    ).toBe(true);
    expect(generationJobParamsSchema.safeParse({ jobId: 'not-a-uuid' }).success).toBe(false);
  });
});
