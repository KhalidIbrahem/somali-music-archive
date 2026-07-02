/**
 * Main tab bar (ARCHITECTURE.md §6 navigation).
 *
 * Five tabs: Discover, Learn, Search, Record, Profile. The Record tab is
 * role-gated — only `contributor` and `admin` users may make field recordings
 * (§7 "Record" screen, §11 Authorization) — so it is hidden for listeners.
 */

import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography } from '@/theme';
import { useAuthStore } from '@/stores/authStore';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export default function TabsLayout(): React.JSX.Element {
  const role = useAuthStore((s) => s.user?.role ?? 'listener');
  const canRecord = role === 'contributor' || role === 'admin';

  const icon =
    (name: IoniconName) =>
    ({ color, size }: { color: string; size: number }) => (
      <Ionicons name={name} color={color} size={size} />
    );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.amber.primary,
        tabBarInactiveTintColor: colors.text.secondary,
        tabBarStyle: {
          backgroundColor: colors.bg.secondary,
          borderTopColor: colors.border.secondary,
        },
        tabBarLabelStyle: typography.labelMedium,
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{ title: 'Discover', tabBarIcon: icon('compass-outline') }}
      />
      <Tabs.Screen
        name="learn"
        options={{ title: 'Learn', tabBarIcon: icon('school-outline') }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: 'Search', tabBarIcon: icon('search-outline') }}
      />
      <Tabs.Screen
        name="record"
        options={{
          title: 'Record',
          tabBarIcon: icon('mic-outline'),
          // Hide entirely for non-contributors; the route still exists but is
          // unreachable from the tab bar.
          href: canRecord ? '/(tabs)/record' : null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: icon('person-outline') }}
      />
    </Tabs>
  );
}
