/**
 * useAuth — the single hook screens use for authentication (ARCHITECTURE.md §6, §11).
 *
 * Wraps the Zustand auth store (session state + login/logout/register/refresh/
 * updateUser) and adds biometric helpers built on expo-local-authentication.
 *
 * Biometrics NEVER store or transmit biometric data (CLAUDE.md security rule):
 * Face ID / Touch ID merely unlocks the access token already held in the hardware
 * keychain (expo-secure-store). If no token is stored (never signed in on this
 * device), biometric sign-in is unavailable and the user must use a password.
 *
 * Automatic token refresh on 401 is handled transparently by the Axios response
 * interceptor (services/api/client.ts); `refresh()` here exposes a manual trigger.
 */

import { useCallback } from 'react';
import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAuthStore } from '@/stores/authStore';
import { secureStorage } from '@/services/storage/secureStorage';

export interface BiometricStatus {
  /** Hardware present, a biometric is enrolled, AND a token is stored to unlock. */
  available: boolean;
  /** Human label for the enrolled method, e.g. "Face ID" / "Touch ID". */
  label: string;
}

export interface BiometricResult {
  success: boolean;
  error?: string;
}

/** Map the device's supported biometric types to a friendly, OS-appropriate label. */
function labelForTypes(types: readonly LocalAuthentication.AuthenticationType[]): string {
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return Platform.OS === 'ios' ? 'Face ID' : 'Face Unlock';
  }
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return Platform.OS === 'ios' ? 'Touch ID' : 'Fingerprint';
  }
  return 'Biometrics';
}

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const logout = useAuthStore((s) => s.logout);
  const refresh = useAuthStore((s) => s.refreshToken);
  const updateUser = useAuthStore((s) => s.updateUser);
  const hydrate = useAuthStore((s) => s.hydrate);

  /**
   * Report whether biometric sign-in can be offered right now: the device must
   * have biometric hardware enrolled AND a token must already be stored to unlock.
   */
  const checkBiometricAvailability = useCallback(async (): Promise<BiometricStatus> => {
    const [hasHardware, isEnrolled, storedToken] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      secureStorage.getAccessToken(),
    ]);
    if (!hasHardware || !isEnrolled || !storedToken) {
      return { available: false, label: 'Biometrics' };
    }
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    return { available: true, label: labelForTypes(types) };
  }, []);

  /**
   * Prompt for the device biometric; on success, unlock the stored token and
   * establish the session. Returns `{ success:false }` (never throws) so the
   * caller can show a friendly message.
   */
  const loginWithBiometrics = useCallback(async (): Promise<BiometricResult> => {
    const storedToken = await secureStorage.getAccessToken();
    if (!storedToken) {
      return { success: false, error: 'Sign in with your password first to enable biometrics.' };
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Somali Music Archive',
      cancelLabel: 'Use password',
      disableDeviceFallback: false,
    });
    if (!result.success) {
      return { success: false, error: 'Biometric authentication was cancelled or failed.' };
    }
    // Re-establish the session from the unlocked, stored token.
    await hydrate();
    if (!useAuthStore.getState().isAuthenticated) {
      return { success: false, error: 'Your saved session has expired. Please sign in again.' };
    }
    return { success: true };
  }, [hydrate]);

  return {
    // state
    user,
    accessToken,
    isAuthenticated,
    isLoading,
    // actions
    login,
    register,
    logout,
    refresh,
    updateUser,
    hydrate,
    // biometrics
    checkBiometricAvailability,
    loginWithBiometrics,
  };
}
