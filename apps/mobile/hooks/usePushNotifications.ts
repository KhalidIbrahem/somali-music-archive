/**
 * usePushNotifications — registers this device for Expo push and forwards the token
 * to the API (ARCHITECTURE.md §5, §8). Expo delivers via FCM (Android) / APNs (iOS).
 *
 * Only runs when `enabled` (signed in + notifications preference on). Requests
 * permission on first run; if denied, it quietly does nothing. Foreground
 * notifications are shown via the handler set once at module load.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { registerPushToken } from '@/services/api/notifications';

// Show foreground notifications as a banner with sound (set once).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function platformTag(): 'ios' | 'android' | 'web' {
  if (Platform.OS === 'android') return 'android';
  if (Platform.OS === 'web') return 'web';
  return 'ios';
}

async function registerForPush(): Promise<void> {
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  const projectId = extra?.eas?.projectId;
  const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);

  await registerPushToken({ token: token.data, platform: platformTag() });
}

export function usePushNotifications(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    // Registration failures (denied permission, no projectId in Expo Go) are
    // non-fatal — the app works without push.
    registerForPush().catch(() => undefined);

    const received = Notifications.addNotificationReceivedListener(() => undefined);
    const response = Notifications.addNotificationResponseReceivedListener(() => undefined);
    return () => {
      received.remove();
      response.remove();
    };
  }, [enabled]);
}
