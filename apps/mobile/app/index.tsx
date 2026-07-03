/**
 * Entry route — the auth gate. Redirects to the main tabs when authenticated,
 * otherwise into the onboarding/auth flow. The heavy lifting (loading state) is
 * done in the root layout, so by the time this renders the session is resolved.
 */

import { Redirect } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

export default function Index(): React.JSX.Element {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (isAuthenticated) {
    return <Redirect href="/(tabs)/discover" />;
  }
  return <Redirect href="/(auth)/welcome" />;
}
