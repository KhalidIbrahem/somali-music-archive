/**
 * Auth store (Zustand) — the user session (ARCHITECTURE.md §6 state management).
 *
 * Holds the session in memory: who is signed in (`user`), the current
 * `accessToken`, and derived `isAuthenticated` / `isLoading` flags. Tokens are
 * PERSISTED only to expo-secure-store (hardware keychain) via `secureStorage` —
 * never AsyncStorage, never here on disk (CLAUDE.md hard rule). Server data
 * (recordings, lessons) belongs in React Query, not this store.
 */

import { create } from 'zustand';
import type { PublicUser } from '@sma/types';
import type { LoginInput, RegisterInput } from '@sma/validators';
import * as authApi from '@/services/api/auth';
import { setUnauthorizedHandler } from '@/services/api/client';
import { secureStorage } from '@/services/storage/secureStorage';

interface AuthState {
  user: PublicUser | null;
  /** In-memory copy of the current access token (source of truth is secure store). */
  accessToken: string | null;
  isAuthenticated: boolean;
  /** True while the session is being resolved from secure storage on cold start. */
  isLoading: boolean;

  /** Resolve the session from a stored token on app launch. */
  hydrate: () => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  updateUser: (patch: Partial<PublicUser>) => void;

  /** Set the authenticated session (used by login/register/biometric unlock). */
  setSession: (user: PublicUser, accessToken: string) => void;
  /** Clear the session locally WITHOUT calling the API (used on hard 401). */
  clearSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: true,

  hydrate: async () => {
    set({ isLoading: true });
    const token = await secureStorage.getAccessToken();
    if (!token) {
      set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
      return;
    }
    try {
      const user = await authApi.getMe();
      set({ user, accessToken: token, isAuthenticated: true, isLoading: false });
    } catch {
      await secureStorage.clear();
      set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
    }
  },

  login: async (input) => {
    const { user, accessToken, refreshToken } = await authApi.login(input);
    await secureStorage.setTokens(accessToken, refreshToken);
    get().setSession(user, accessToken);
  },

  register: async (input) => {
    const { user, accessToken, refreshToken } = await authApi.register(input);
    await secureStorage.setTokens(accessToken, refreshToken);
    get().setSession(user, accessToken);
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      // Even if the server call fails, we still clear the local session below.
    } finally {
      await get().clearSession();
    }
  },

  refreshToken: async () => {
    const tokens = await authApi.refreshToken();
    set({ accessToken: tokens.accessToken, isAuthenticated: true });
  },

  updateUser: (patch) => {
    const current = get().user;
    if (current) {
      set({ user: { ...current, ...patch } });
    }
  },

  setSession: (user, accessToken) => {
    set({ user, accessToken, isAuthenticated: true, isLoading: false });
  },

  clearSession: async () => {
    await secureStorage.clear();
    set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
  },
}));

// When the API client can no longer refresh a dead session, drop the local
// session so the router sends the user back to sign-in. Registered once here so
// the low-level client never needs to import the store (no import cycle).
setUnauthorizedHandler(() => {
  void useAuthStore.getState().clearSession();
});
