/**
 * User profile + saved-recordings API calls (ARCHITECTURE.md §12 USERS).
 */

import type { ApiResponse, PublicRecording, PublicUser } from '@sma/types';
import type { UpdateProfileInput } from '@sma/validators';
import { apiClient } from './client';
import { unwrap } from './unwrap';

export async function updateProfile(input: UpdateProfileInput): Promise<PublicUser> {
  const res = await apiClient.patch<ApiResponse<PublicUser>>('/users/me', input);
  return unwrap(res.data);
}

export async function getSaved(): Promise<PublicRecording[]> {
  const res = await apiClient.get<ApiResponse<PublicRecording[]>>('/users/me/saved');
  return unwrap(res.data);
}

export async function saveRecording(recordingId: string): Promise<void> {
  await apiClient.post<ApiResponse<{ saved: true }>>(`/users/me/saved/${recordingId}`);
}

export async function unsaveRecording(recordingId: string): Promise<void> {
  await apiClient.delete<ApiResponse<{ saved: false }>>(`/users/me/saved/${recordingId}`);
}
