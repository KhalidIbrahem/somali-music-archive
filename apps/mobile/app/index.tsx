/**
 * Entry route — the auth gate. Redirects to the main tabs when authenticated,
 * otherwise into the onboarding/auth flow. The heavy lifting (loading state) is
 * done in the root layout, so by the time this renders `status` is resolved.
 */

import { Redirect } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

export default function Index(): React.JSX.Element {
  const status = useAuthStore((s) => s.status);
  if (status === 'authenticated') {
    return <Redirect href="/(tabs)/discover" />;
  }
  return <Redirect href="/(auth)/welcome" />;
}
