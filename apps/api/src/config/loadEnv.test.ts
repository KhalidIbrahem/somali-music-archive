import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile, parseEnvFile } from './loadEnv';

describe('parseEnvFile', () => {
  it('parses simple KEY=VALUE pairs', () => {
    expect(parseEnvFile('A=1\nB=two')).toEqual({ A: '1', B: 'two' });
  });

  it('ignores comments and blank lines', () => {
    expect(parseEnvFile('# comment\n\nA=1\n   \n# another')).toEqual({ A: '1' });
  });

  it('keeps values that contain spaces and other = signs', () => {
    const redis = 'redis-cli --tls -u redis://default:tok==@host:6379';
    expect(parseEnvFile(`REDIS_URL=${redis}`)).toEqual({ REDIS_URL: redis });
  });

  it('strips a single pair of surrounding quotes', () => {
    expect(parseEnvFile('A="quoted"\nB=\'single\'')).toEqual({ A: 'quoted', B: 'single' });
  });

  it('tolerates a leading export and trims the key', () => {
    expect(parseEnvFile('export A=1\n  B =2')).toEqual({ A: '1', B: '2' });
  });

  it('skips stray lines with no = sign', () => {
    expect(parseEnvFile('A=1\n49USUSVo2LZUmpcu\nB=2')).toEqual({ A: '1', B: '2' });
  });

  it('does not strip inline # (values may contain #)', () => {
    expect(parseEnvFile('PW=p@ss#word')).toEqual({ PW: 'p@ss#word' });
  });
});

describe('loadEnvFile', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    delete process.env['SMA_TEST_NEW'];
    delete process.env['SMA_TEST_EXISTING'];
  });

  it('sets missing vars but never overrides an existing one', () => {
    dir = mkdtempSync(join(tmpdir(), 'sma-env-'));
    const file = join(dir, '.env');
    writeFileSync(file, 'SMA_TEST_NEW=fromfile\nSMA_TEST_EXISTING=fromfile');
    process.env['SMA_TEST_EXISTING'] = 'preset';

    loadEnvFile(file);

    expect(process.env['SMA_TEST_NEW']).toBe('fromfile');
    expect(process.env['SMA_TEST_EXISTING']).toBe('preset'); // real env wins
  });

  it('is a no-op when the file does not exist', () => {
    expect(() => loadEnvFile(join(tmpdir(), 'definitely-missing-.env'))).not.toThrow();
  });
});
