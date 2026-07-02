/**
 * Secure token storage — the ONLY place auth tokens are persisted on device.
 *
 * CLAUDE.md hard rule: never use AsyncStorage for tokens — always expo-secure-store
 * (hardware-backed Keychain / Keystore). This wrapper is the single choke point so
 * that rule is enforced by imports, not by discipline.
 */

import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'sma.accessToken';
const REFRESH_TOKEN_KEY = 'sma.refreshToken';

export const secureStorage = {
  async getAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  },
  async getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  },
  async setTokens(accessToken: string, refreshToken: string): Promise<void> {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
    ]);
  },
  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    ]);
  },
} as const;
