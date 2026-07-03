/**
 * Unit tests for the auth store. The store's I/O dependencies (auth API, secure
 * storage, and the client's handler registration) are mocked, so these tests
 * exercise the store's own logic in isolation — no network, no device keychain.
 */

import type { PublicUser } from '@sma/types';

jest.mock('@/services/api/auth');
jest.mock('@/services/api/client', () => ({ setUnauthorizedHandler: jest.fn() }));
jest.mock('@/services/storage/secureStorage', () => ({
  secureStorage: {
    getAccessToken: jest.fn(),
    getRefreshToken: jest.fn(),
    setTokens: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  },
}));

import * as authApi from '@/services/api/auth';
import { secureStorage } from '@/services/storage/secureStorage';
import { useAuthStore } from '@/stores/authStore';

const fakeUser = (overrides: Partial<PublicUser> = {}): PublicUser =>
  ({
    id: 'u-1',
    email: 'elder@example.com',
    displayName: 'Ahmed Ali Egal',
    language: 'so',
    role: 'listener',
    emailVerified: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }) as unknown as PublicUser;

const TOKENS = { accessToken: 'access-1', refreshToken: 'refresh-1' };

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    user: null,
    accessToken: null,
    isAuthenticated: false,
    isLoading: true,
  });
});

describe('authStore.login', () => {
  it('persists tokens to secure storage and sets the session', async () => {
    jest.mocked(authApi.login).mockResolvedValue({ user: fakeUser(), ...TOKENS });

    await useAuthStore.getState().login({ email: 'e@x.co', password: 'pw' });

    expect(secureStorage.setTokens).toHaveBeenCalledWith('access-1', 'refresh-1');
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.user?.email).toBe('elder@example.com');
    expect(state.accessToken).toBe('access-1');
  });

  it('propagates errors and leaves the session unauthenticated', async () => {
    jest.mocked(authApi.login).mockRejectedValue(new Error('bad creds'));
    await expect(
      useAuthStore.getState().login({ email: 'e@x.co', password: 'pw' }),
    ).rejects.toThrow('bad creds');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe('authStore.register', () => {
  it('persists tokens and authenticates', async () => {
    jest.mocked(authApi.register).mockResolvedValue({ user: fakeUser(), ...TOKENS });

    await useAuthStore.getState().register({
      email: 'e@x.co',
      password: 'pw',
      displayName: 'A',
      dateOfBirth: '1950-01-01',
      acceptedTerms: true,
    });

    expect(secureStorage.setTokens).toHaveBeenCalledWith('access-1', 'refresh-1');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});

describe('authStore.logout', () => {
  it('calls the API then clears the session and secure storage', async () => {
    jest.mocked(authApi.logout).mockResolvedValue();
    useAuthStore.setState({ user: fakeUser(), accessToken: 'x', isAuthenticated: true });

    await useAuthStore.getState().logout();

    expect(authApi.logout).toHaveBeenCalled();
    expect(secureStorage.clear).toHaveBeenCalled();
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
  });

  it('still clears locally even if the API logout call fails', async () => {
    jest.mocked(authApi.logout).mockRejectedValue(new Error('network'));
    useAuthStore.setState({ user: fakeUser(), isAuthenticated: true });

    await useAuthStore.getState().logout();

    expect(secureStorage.clear).toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe('authStore.refreshToken', () => {
  it('updates the access token in state', async () => {
    jest.mocked(authApi.refreshToken).mockResolvedValue({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });

    await useAuthStore.getState().refreshToken();

    expect(useAuthStore.getState().accessToken).toBe('access-2');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});

describe('authStore.updateUser', () => {
  it('merges a patch into the current user', () => {
    useAuthStore.setState({ user: fakeUser({ displayName: 'Old' }) });
    useAuthStore.getState().updateUser({ displayName: 'New Name' });
    expect(useAuthStore.getState().user?.displayName).toBe('New Name');
  });

  it('is a no-op when there is no user', () => {
    useAuthStore.setState({ user: null });
    useAuthStore.getState().updateUser({ displayName: 'Nope' });
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe('authStore.hydrate', () => {
  it('marks unauthenticated when no token is stored', async () => {
    jest.mocked(secureStorage.getAccessToken).mockResolvedValue(null);

    await useAuthStore.getState().hydrate();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
  });

  it('restores the session when a token resolves to a user', async () => {
    jest.mocked(secureStorage.getAccessToken).mockResolvedValue('stored-token');
    jest.mocked(authApi.getMe).mockResolvedValue(fakeUser());

    await useAuthStore.getState().hydrate();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.email).toBe('elder@example.com');
    expect(state.accessToken).toBe('stored-token');
  });

  it('clears a stale token when the profile fetch fails', async () => {
    jest.mocked(secureStorage.getAccessToken).mockResolvedValue('stale-token');
    jest.mocked(authApi.getMe).mockRejectedValue(new Error('401'));

    await useAuthStore.getState().hydrate();

    expect(secureStorage.clear).toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
