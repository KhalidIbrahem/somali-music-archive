/**
 * Recording API calls (ARCHITECTURE.md §12 RECORDINGS, §8 upload flow).
 */

import * as FileSystem from 'expo-file-system';
import type {
  ApiResponse,
  Paginated,
  PublicRecording,
  SignedAudioUrl,
  PitchPoint,
} from '@sma/types';
import type { Genre, Instrument, Region } from '@sma/constants';
import type { RecordingQueryInput, UploadUrlRequestInput } from '@sma/validators';
import { apiClient } from './client';
import { unwrap } from './unwrap';

export async function listRecordings(
  query: Partial<RecordingQueryInput> = {},
): Promise<Paginated<PublicRecording>> {
  const res = await apiClient.get<ApiResponse<Paginated<PublicRecording>>>('/recordings', {
    params: query,
  });
  return unwrap(res.data);
}

export async function getRecording(id: string): Promise<PublicRecording> {
  const res = await apiClient.get<ApiResponse<PublicRecording>>(`/recordings/${id}`);
  return unwrap(res.data);
}

/** Fetch a short-lived signed URL to stream a recording (§11 Threat 1). */
export async function getAudioUrl(id: string): Promise<SignedAudioUrl> {
  const res = await apiClient.get<ApiResponse<SignedAudioUrl>>(`/recordings/${id}/audio`);
  return unwrap(res.data);
}

export async function getPitchData(id: string): Promise<readonly PitchPoint[]> {
  const res = await apiClient.get<ApiResponse<readonly PitchPoint[]>>(`/recordings/${id}/pitch`);
  return unwrap(res.data);
}

// ── Upload flow (direct-to-R2 presigned URL, ARCHITECTURE.md §8) ──────────────

/** Cultural metadata captured on the record screen for a new take. */
export interface RecordingMetadata {
  title: { somali: string };
  singerName: string;
  poetName?: string;
  genre: Genre;
  occasion?: string;
  region?: Region;
  era?: string;
  instruments: readonly Instrument[];
  fieldNotes?: string;
}

/** Response from `POST /recordings/upload-url` (contract; backend completes in P1-04). */
export interface PresignedUpload {
  uploadUrl: string;
  fileKey: string;
  recordingId: string;
  expiresAt: string;
}

/** Step 1 — ask the API for a short-lived presigned R2 upload URL. */
export async function getUploadUrl(input: UploadUrlRequestInput): Promise<PresignedUpload> {
  const res = await apiClient.post<ApiResponse<PresignedUpload>>('/recordings/upload-url', input);
  return unwrap(res.data);
}

/**
 * Step 2 — upload the local audio file DIRECTLY to R2 via the presigned URL.
 * Uses expo-file-system's binary upload (streams the file; no giant in-memory
 * blob). Audio bytes never pass through our own API (CLAUDE.md hard rule).
 */
export async function uploadToR2(
  uploadUrl: string,
  fileUri: string,
  contentType: string,
): Promise<void> {
  const result = await FileSystem.uploadAsync(uploadUrl, fileUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': contentType },
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed with status ${result.status}`);
  }
}

/**
 * Step 3 — tell the API the upload finished. The captured metadata rides along so
 * the server can attach it to the recording (persisted server-side in P1-04).
 */
export async function notifyComplete(
  recordingId: string,
  fileKey: string,
  metadata: RecordingMetadata,
): Promise<void> {
  await apiClient.post<ApiResponse<{ fileKey: string; status: string }>>(
    '/recordings/upload-complete',
    { recordingId, fileKey, metadata },
  );
}

/** File extension → content type for the presigned-URL request. */
export function contentTypeForUri(uri: string): 'audio/wav' | 'audio/webm' | 'audio/flac' {
  if (uri.endsWith('.webm')) return 'audio/webm';
  if (uri.endsWith('.flac')) return 'audio/flac';
  return 'audio/wav';
}
