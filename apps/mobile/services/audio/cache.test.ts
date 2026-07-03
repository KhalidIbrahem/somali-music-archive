jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  readDirectoryAsync: jest.fn(),
  downloadAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

import * as FileSystem from 'expo-file-system';
import { audioCache } from './cache';

const DIR = 'file:///docs/audio-cache/';
const mocked = FileSystem as jest.Mocked<typeof FileSystem>;

beforeEach(() => jest.clearAllMocks());

describe('audioCache.download', () => {
  it('ensures the dir and downloads to a recording-keyed path', async () => {
    (mocked.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });
    (mocked.downloadAsync as jest.Mock).mockResolvedValue({
      uri: `${DIR}2026-07-03-001.wav`,
      status: 200,
    });

    const uri = await audioCache.download('2026-07-03-001', 'https://r2.test/x.wav?sig=abc');

    expect(mocked.makeDirectoryAsync).toHaveBeenCalledWith(DIR, { intermediates: true });
    expect(mocked.downloadAsync).toHaveBeenCalledWith(
      'https://r2.test/x.wav?sig=abc',
      `${DIR}2026-07-03-001.wav`,
    );
    expect(uri).toBe(`${DIR}2026-07-03-001.wav`);
  });

  it('throws when the download is rejected', async () => {
    (mocked.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
    (mocked.downloadAsync as jest.Mock).mockResolvedValue({ uri: '', status: 403 });
    await expect(audioCache.download('r1', 'https://r2.test/x.wav')).rejects.toThrow('403');
  });
});

describe('audioCache lookups', () => {
  it('detects a cached recording by base name (ignoring extension)', async () => {
    (mocked.readDirectoryAsync as jest.Mock).mockResolvedValue([
      '2026-07-03-001.wav',
      'other.webm',
    ]);
    expect(await audioCache.isCached('2026-07-03-001')).toBe(true);
    expect(await audioCache.getCachedUri('2026-07-03-001')).toBe(`${DIR}2026-07-03-001.wav`);
    expect(await audioCache.isCached('missing')).toBe(false);
    expect(await audioCache.getCachedUri('missing')).toBeNull();
  });

  it('returns not-cached when the directory does not exist yet', async () => {
    (mocked.readDirectoryAsync as jest.Mock).mockRejectedValue(new Error('ENOENT'));
    expect(await audioCache.isCached('r1')).toBe(false);
  });
});

describe('audioCache remove / totalSize', () => {
  it('deletes the cached file for a recording', async () => {
    (mocked.readDirectoryAsync as jest.Mock).mockResolvedValue(['r1.wav']);
    await audioCache.remove('r1');
    expect(mocked.deleteAsync).toHaveBeenCalledWith(`${DIR}r1.wav`, { idempotent: true });
  });

  it('sums the sizes of cached files', async () => {
    (mocked.readDirectoryAsync as jest.Mock).mockResolvedValue(['a.wav', 'b.webm']);
    (mocked.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      isDirectory: false,
      size: 100,
    });
    expect(await audioCache.totalSize()).toBe(200);
  });
});
