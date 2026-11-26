import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import dspDemo from '../dsp-demo.json';

const WEB = path.resolve(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(path.join(WEB, 'public-audio-rights.json'), 'utf8')) as {
  files: Record<string, { kind: string; performer?: string; consent?: string }>;
};
const clips = [...dspDemo.separation.clips, ...dspDemo.restoration.clips];

describe('separation page data', () => {
  it('has every clip and its spectrogram on disk', () => {
    expect(clips).toHaveLength(8);
    for (const c of clips) {
      expect(existsSync(path.join(WEB, 'public', c.file)), c.file).toBe(true);
      expect(existsSync(path.join(WEB, 'public', c.image)), c.image).toBe(true);
    }
  });

  it('lists every clip in the rights manifest under the kind its source says', () => {
    const kind = dspDemo.source.kind === 'synthetic' ? 'synthesised' : 'own_recording';
    for (const c of clips) {
      const entry = manifest.files[`apps/web/public${c.file}`];
      expect(entry?.kind, c.file).toBe(kind);
      if (kind === 'own_recording') {
        expect(entry?.performer).toBeTruthy();
        expect(entry?.consent).toBeTruthy();
      }
    }
  });

  it('never calls synthesised signals a recording', () => {
    if (dspDemo.source.kind === 'synthetic')
      expect(dspDemo.source.label).toMatch(/not a recording/);
  });
});
