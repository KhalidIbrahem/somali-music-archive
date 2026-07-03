import { useSettingsStore } from './settingsStore';

beforeEach(() => {
  useSettingsStore.setState({
    playbackQuality: 'high',
    offlineDownloads: false,
    notifications: true,
  });
});

describe('settingsStore', () => {
  it('has sensible defaults', () => {
    const s = useSettingsStore.getState();
    expect(s.playbackQuality).toBe('high');
    expect(s.offlineDownloads).toBe(false);
    expect(s.notifications).toBe(true);
  });

  it('updates playback quality', () => {
    useSettingsStore.getState().setPlaybackQuality('standard');
    expect(useSettingsStore.getState().playbackQuality).toBe('standard');
  });

  it('toggles device preferences', () => {
    useSettingsStore.getState().setOfflineDownloads(true);
    useSettingsStore.getState().setNotifications(false);
    const s = useSettingsStore.getState();
    expect(s.offlineDownloads).toBe(true);
    expect(s.notifications).toBe(false);
  });
});
