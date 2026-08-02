jest.mock('@/services/api/generation', () => ({
  startGeneration: jest.fn(),
  getGenerationJob: jest.fn(),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { GenerationJob } from '@sma/types';
import { getGenerationJob, startGeneration } from '@/services/api/generation';
import { isTerminalJob, useGeneration } from './useGeneration';

const runningJob: GenerationJob = {
  id: 'job-1',
  provider: 'suno',
  state: 'running',
  prompt: 'a qaraami song',
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
};

const succeededJob: GenerationJob = {
  ...runningJob,
  state: 'succeeded',
  track: { audioUrl: 'data:audio/wav;base64,AQID', mimeType: 'audio/wav' },
};

function wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  // gcTime 0 so cache-eviction timers don't outlive the test process.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => jest.clearAllMocks());

describe('isTerminalJob', () => {
  it('is true only for succeeded/failed', () => {
    expect(isTerminalJob(runningJob)).toBe(false);
    expect(isTerminalJob(succeededJob)).toBe(true);
    expect(isTerminalJob({ ...runningJob, state: 'failed' })).toBe(true);
    expect(isTerminalJob(null)).toBe(false);
  });
});

describe('useGeneration', () => {
  it('surfaces the submit response immediately and polls to the terminal state', async () => {
    (startGeneration as jest.Mock).mockResolvedValue(runningJob);
    (getGenerationJob as jest.Mock).mockResolvedValue(succeededJob);

    // Poll slowly enough that the 'running' assertions can't race the refetch.
    const { result } = await renderHook(() => useGeneration({ pollMs: 150 }), { wrapper });
    expect(result.current.job).toBeNull();

    await act(async () => {
      result.current.start.mutate({ provider: 'suno', prompt: 'a qaraami song' });
    });

    await waitFor(() => expect(result.current.job?.state).toBe('running'));
    expect(result.current.isWorking).toBe(true);

    await waitFor(() => expect(result.current.job?.state).toBe('succeeded'));
    expect(result.current.isWorking).toBe(false);
    expect(getGenerationJob).toHaveBeenCalledWith('job-1');
  });

  it('does not poll when the submit response is already terminal', async () => {
    (startGeneration as jest.Mock).mockResolvedValue(succeededJob);

    const { result } = await renderHook(() => useGeneration({ pollMs: 20 }), { wrapper });
    await act(async () => {
      result.current.start.mutate({ provider: 'lyria', prompt: 'an oud instrumental' });
    });

    await waitFor(() => expect(result.current.job?.state).toBe('succeeded'));
    // Give a would-be poll a moment to fire, then assert it never did.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(getGenerationJob).not.toHaveBeenCalled();
  });

  it('reset clears the tracked job', async () => {
    (startGeneration as jest.Mock).mockResolvedValue(succeededJob);
    const { result } = await renderHook(() => useGeneration({ pollMs: 20 }), { wrapper });

    await act(async () => {
      result.current.start.mutate({ provider: 'lyria', prompt: 'an oud instrumental' });
    });
    await waitFor(() => expect(result.current.job?.state).toBe('succeeded'));

    await act(async () => result.current.reset());
    expect(result.current.job).toBeNull();
    expect(result.current.isWorking).toBe(false);
  });
});
