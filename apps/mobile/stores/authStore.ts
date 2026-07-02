/**
 * Auth store (Zustand) — the user session (ARCHITECTURE.md §6 state management).
 *
 * Zustand holds the *session* (who is logged in + status). Tokens themselves live
 * in expo-secure-store, never here and never in AsyncStorage (CLAUDE.md hard rule).
 * Server data (recordings, lessons) belongs in React Query, not this store.
 */

import { create } from 'zustand';
import type { PublicUser } from '@sma/types';
import type { LoginInput, RegisterInput } from '@sma/validators';
import * as authApi from '@/services/api/auth';
import { secureStorage } from '@/services/storage/secureStorage';

/** Where the app is in resolving the session on cold start. */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: PublicUser | null;
  /** Resolve the session from a stored token on app launch. */
  hydrate: () => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  user: null,

  hydrate: async () => {
    const token = await secureStorage.getAccessToken();
    if (!token) {
      set({ status: 'unauthenticated', user: null });
      return;
    }
    try {
      const user = await authApi.getMe();
      set({ status: 'authenticated', user });
    } catch {
      await secureStorage.clear();
      set({ status: 'unauthenticated', user: null });
    }
  },

  login: async (input) => {
    const { user, accessToken, refreshToken } = await authApi.login(input);
    await secureStorage.setTokens(accessToken, refreshToken);
    set({ status: 'authenticated', user });
  },

  register: async (input) => {
    const { user, accessToken, refreshToken } = await authApi.register(input);
    await secureStorage.setTokens(accessToken, refreshToken);
    set({ status: 'authenticated', user });
  },

  logout: async () => {
    try {
      await authApi.logout();
    } finally {
      await secureStorage.clear();
      set({ status: 'unauthenticated', user: null });
    }
  },
}));
