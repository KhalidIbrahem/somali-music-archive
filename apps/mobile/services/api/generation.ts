/**
 * AI music generation API calls (POST /generate, GET /generate/:jobId).
 *
 * Provider-agnostic by contract: the `provider` field selects a model tier and
 * the backend routes it to the right engine server-side, so this file never
 * changes when engines are swapped. Submit, then poll the returned job (≥3s
 * apart) until `state` is `succeeded` or `failed`.
 */

import type { ApiResponse, GenerationJob, GenerationRequest } from '@sma/types';
import { apiClient } from './client';
import { unwrap } from './unwrap';

export async function startGeneration(input: GenerationRequest): Promise<GenerationJob> {
  const res = await apiClient.post<ApiResponse<GenerationJob>>('/generate', input);
  return unwrap(res.data);
}

export async function getGenerationJob(jobId: string): Promise<GenerationJob> {
  const res = await apiClient.get<ApiResponse<GenerationJob>>(
    `/generate/${encodeURIComponent(jobId)}`,
  );
  return unwrap(res.data);
}
