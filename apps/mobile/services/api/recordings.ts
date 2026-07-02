/**
 * Recording API calls (ARCHITECTURE.md §12 RECORDINGS).
 */

import type {
  ApiResponse,
  Paginated,
  PublicRecording,
  SignedAudioUrl,
  PitchPoint,
} from '@sma/types';
import type { RecordingQueryInput } from '@sma/validators';
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
