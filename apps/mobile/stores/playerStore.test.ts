import { usePlayerStore } from './playerStore';
import type { PublicRecording } from '@sma/types';

const fakeRecording = { id: 'r-1', title: { somali: 'Balwo' } } as unknown as PublicRecording;

beforeEach(() => {
  usePlayerStore.setState({ current: null, isPlaying: false, positionMs: 0, durationMs: 0 });
});

describe('playerStore', () => {
  it('load sets the current recording and starts playing from 0', () => {
    usePlayerStore.setState({ positionMs: 5000 });
    usePlayerStore.getState().load(fakeRecording);
    const state = usePlayerStore.getState();
    expect(state.current?.id).toBe('r-1');
    expect(state.isPlaying).toBe(true);
    expect(state.positionMs).toBe(0);
  });

  it('setPlaying toggles transport state', () => {
    usePlayerStore.getState().setPlaying(true);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    usePlayerStore.getState().setPlaying(false);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it('setProgress records position and duration', () => {
    usePlayerStore.getState().setProgress(1200, 30000);
    const state = usePlayerStore.getState();
    expect(state.positionMs).toBe(1200);
    expect(state.durationMs).toBe(30000);
  });

  it('clear resets everything', () => {
    usePlayerStore.getState().load(fakeRecording);
    usePlayerStore.getState().setProgress(1000, 2000);
    usePlayerStore.getState().clear();
    const state = usePlayerStore.getState();
    expect(state.current).toBeNull();
    expect(state.isPlaying).toBe(false);
    expect(state.positionMs).toBe(0);
    expect(state.durationMs).toBe(0);
  });
});
