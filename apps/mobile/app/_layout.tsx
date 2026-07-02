/**
 * Root layout — the app shell (ARCHITECTURE.md §6).
 *
 * Responsibilities that must happen exactly once, above every screen:
 *   • load the Playfair Display + Nunito fonts referenced by the theme,
 *   • provide React Query (all server state) and the safe-area + gesture roots,
 *   • hydrate the auth session from secure storage before revealing the UI,
 *   • hold the native splash screen until fonts + session are ready.
 */

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useFonts,
  PlayfairDisplay_400Regular,
  PlayfairDisplay_500Medium,
  PlayfairDisplay_700Bold,
} from '@expo-google-fonts/playfair-display';
import {
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
} from '@expo-google-fonts/nunito';
import { colors } from '@/theme';
import { useAuthStore } from '@/stores/authStore';

// Keep the splash visible until we explicitly hide it below.
void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Diaspora users are often on slow/unreliable networks (Principle 2): serve
      // cached data eagerly and avoid aggressive refetching.
      staleTime: 60_000,
      retry: 2,
    },
  },
});

export default function RootLayout(): React.JSX.Element | null {
  const [fontsLoaded, fontError] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_500Medium,
    PlayfairDisplay_700Bold,
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
  });

  const hydrate = useAuthStore((s) => s.hydrate);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const ready = (fontsLoaded || fontError !== null) && status !== 'loading';

  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg.primary },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="archive/[id]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="artist/[id]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="lesson/[id]" options={{ presentation: 'modal' }} />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
