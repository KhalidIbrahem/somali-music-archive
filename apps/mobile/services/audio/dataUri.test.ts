jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' },
}));

import * as FileSystem from 'expo-file-system/legacy';
import { parseDataUri, resolvePlayableUri, writeDataUriToCache } from './dataUri';

const DIR = 'file:///cache/generated-audio/';
const mocked = FileSystem as jest.Mocked<typeof FileSystem>;

beforeEach(() => jest.clearAllMocks());

describe('parseDataUri', () => {
  it('parses mime type and payload from a base64 data URI', () => {
    expect(parseDataUri('data:audio/wav;base64,AQID')).toEqual({
      mimeType: 'audio/wav',
      base64: 'AQID',
    });
  });

  it('rejects non-data URIs and non-base64 encodings', () => {
    expect(parseDataUri('https://cdn.example/track.mp3')).toBeNull();
    expect(parseDataUri('data:audio/wav,rawtext')).toBeNull();
    expect(parseDataUri('data:;base64,AQID')).toBeNull();
  });
});

describe('writeDataUriToCache', () => {
  it('ensures the dir and writes the payload base64-decoded with a mime extension', async () => {
    (mocked.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });
    (mocked.writeAsStringAsync as jest.Mock).mockResolvedValue(undefined);

    const uri = await writeDataUriToCache('data:audio/mpeg;base64,AQID');

    expect(mocked.makeDirectoryAsync).toHaveBeenCalledWith(DIR, { intermediates: true });
    expect(mocked.writeAsStringAsync).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${DIR}.+\\.mp3$`)),
      'AQID',
      { encoding: 'base64' },
    );
    expect(uri.startsWith(DIR)).toBe(true);
    expect(uri.endsWith('.mp3')).toBe(true);
  });

  it('throws on a malformed uri without touching the filesystem', async () => {
    await expect(writeDataUriToCache('not-a-data-uri')).rejects.toThrow('data: URI');
    expect(mocked.writeAsStringAsync).not.toHaveBeenCalled();
  });
});

describe('resolvePlayableUri', () => {
  it('passes https urls through untouched', async () => {
    const url = 'https://cdn.suno.test/track.mp3';
    expect(await resolvePlayableUri(url)).toBe(url);
    expect(mocked.writeAsStringAsync).not.toHaveBeenCalled();
  });

  it('stages data: uris to a cache file', async () => {
    (mocked.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
    (mocked.writeAsStringAsync as jest.Mock).mockResolvedValue(undefined);
    const uri = await resolvePlayableUri('data:audio/wav;base64,AQID');
    expect(uri.startsWith(DIR)).toBe(true);
    expect(uri.endsWith('.wav')).toBe(true);
  });
});
