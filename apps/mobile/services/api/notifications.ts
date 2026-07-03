/**
 * Push notification API calls (ARCHITECTURE.md §8).
 */

import type { ApiResponse } from '@sma/types';
import type { RegisterPushTokenInput } from '@sma/validators';
import { apiClient } from './client';
import { unwrap } from './unwrap';

export async function registerPushToken(input: RegisterPushTokenInput): Promise<void> {
  await apiClient.post<ApiResponse<{ registered: true }>>('/notifications/register-token', input);
}

/** Ask the server to push a test notification to this account's devices. */
export async function sendTestNotification(): Promise<number> {
  const res = await apiClient.post<ApiResponse<{ sent: number }>>('/notifications/test');
  return unwrap(res.data).sent;
}
