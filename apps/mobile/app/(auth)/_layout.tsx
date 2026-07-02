/**
 * Auth stack layout. Screens here are shown when the user is not authenticated
 * (ARCHITECTURE.md §6 navigation). No header — each screen owns its own chrome.
 */

import { Stack } from 'expo-router';
import { colors } from '@/theme';

export default function AuthLayout(): React.JSX.Element {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg.primary },
      }}
    />
  );
}
