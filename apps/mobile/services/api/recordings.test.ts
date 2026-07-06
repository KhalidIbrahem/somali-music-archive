import {
  getUploadUrl,
  getSimilarRecordings,
  uploadToR2,
  notifyComplete,
  contentTypeForUri,
  type RecordingMetadata,
} from './recordings';
import { apiClient } from './client';
import * as FileSystem from 'expo-file-system/legacy';

jest.mock('./client', () => ({ apiClient: { post: jest.fn(), get: jest.fn() } }));
jest.mock('expo-file-system/legacy', () => ({
  uploadAsync: jest.fn(),
  FileSystemUploadType: { BINARY_CONTENT: 'BINARY_CONTENT' },
}));

const presigned = {
  uploadUrl: 'https://r2.example.com/put',
  fileKey: 'recordings/ab/uuid.wav',
  recordingId: 'a'.repeat(24),
  expiresAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => jest.clearAllMocks());

describe('contentTypeForUri', () => {
  it('maps extensions to audio content types', () => {
    expect(contentTypeForUri('/tmp/take.wav')).toBe('audio/wav');
    expect(contentTypeForUri('/tmp/take.webm')).toBe('audio/webm');
    expect(contentTypeForUri('/tmp/take.flac')).toBe('audio/flac');
    expect(contentTypeForUri('/tmp/take')).toBe('audio/wav');
  });
});

describe('getUploadUrl', () => {
  it('POSTs the request and unwraps the presigned payload', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ data: { success: true, data: presigned } });
    const input = { filename: 'take.wav', contentType: 'audio/wav' as const, sessionId: 's1' };

    const result = await getUploadUrl(input);

    expect(apiClient.post).toHaveBeenCalledWith('/recordings/upload-url', input);
    expect(result).toEqual(presigned);
  });
});

describe('uploadToR2', () => {
  it('PUTs the file binary with the content type', async () => {
    (FileSystem.uploadAsync as jest.Mock).mockResolvedValue({ status: 200 });

    await uploadToR2(presigned.uploadUrl, 'file:///tmp/take.wav', 'audio/wav');

    expect(FileSystem.uploadAsync).toHaveBeenCalledWith(
      presigned.uploadUrl,
      'file:///tmp/take.wav',
      {
        httpMethod: 'PUT',
        uploadType: 'BINARY_CONTENT',
        headers: { 'Content-Type': 'audio/wav' },
      },
    );
  });

  it('throws when R2 rejects the upload', async () => {
    (FileSystem.uploadAsync as jest.Mock).mockResolvedValue({ status: 403 });
    await expect(uploadToR2('u', 'file:///x.wav', 'audio/wav')).rejects.toThrow('403');
  });
});

describe('getSimilarRecordings', () => {
  it('GETs the similarity endpoint and unwraps the list', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({ data: { success: true, data: [] } });
    const result = await getSimilarRecordings('2026-07-04-001');
    expect(apiClient.get).toHaveBeenCalledWith('/recordings/similar/2026-07-04-001');
    expect(result).toEqual([]);
  });
});

describe('notifyComplete', () => {
  it('POSTs recordingId, fileKey, and metadata to upload-complete', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ data: { success: true, data: {} } });
    const metadata: RecordingMetadata = {
      title: { somali: 'Balwo' },
      singerName: 'Ahmed Ali Egal',
      genre: 'qaraami',
      instruments: ['oud', 'voice'],
    };

    await notifyComplete(presigned.recordingId, presigned.fileKey, metadata);

    expect(apiClient.post).toHaveBeenCalledWith('/recordings/upload-complete', {
      recordingId: presigned.recordingId,
      fileKey: presigned.fileKey,
      metadata,
    });
  });
});
