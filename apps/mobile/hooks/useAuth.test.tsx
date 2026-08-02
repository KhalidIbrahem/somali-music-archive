/**
 * Unit tests for the useAuth hook. Uses the REAL auth store (so biometric unlock
 * exercises the real hydrate path) with the leaf I/O modules mocked:
 * expo-local-authentication, secure storage, and the auth API.
 */

import { renderHook, act } from '@testing-library/react-native';
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
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  supportedAuthenticationTypesAsync: jest.fn(),
  authenticateAsync: jest.fn(),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
}));

import * as LocalAuthentication from 'expo-local-authentication';
import * as authApi from '@/services/api/auth';
import { secureStorage } from '@/services/storage/secureStorage';
import { useAuthStore } from '@/stores/authStore';
import { useAuth } from '@/hooks/useAuth';

const fakeUser = (): PublicUser =>
  ({
    id: 'u-1',
    email: 'elder@example.com',
    displayName: 'Ahmed Ali Egal',
    language: 'so',
    role: 'listener',
    emailVerified: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }) as unknown as PublicUser;

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    user: null,
    accessToken: null,
    isAuthenticated: false,
    isLoading: false,
  });
});

describe('useAuth — session state', () => {
  it('reflects the store session', async () => {
    useAuthStore.setState({ user: fakeUser(), accessToken: 't', isAuthenticated: true });
    const { result } = await renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.email).toBe('elder@example.com');
  });
});

describe('useAuth — checkBiometricAvailability', () => {
  it('is available when hardware, enrolment, and a stored token all exist', async () => {
    jest.mocked(LocalAuthentication.hasHardwareAsync).mockResolvedValue(true);
    jest.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValue(true);
    jest.mocked(secureStorage.getAccessToken).mockResolvedValue('stored-token');
    jest
      .mocked(LocalAuthentication.supportedAuthenticationTypesAsync)
      .mockResolvedValue([LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION]);

    const { result } = await renderHook(() => useAuth());
    const status = await result.current.checkBiometricAvailability();

    expect(status.available).toBe(true);
    expect(status.label.length).toBeGreaterThan(0);
  });

  it('is unavailable when no token is stored (nothing to unlock)', async () => {
    jest.mocked(LocalAuthentication.hasHardwareAsync).mockResolvedValue(true);
    jest.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValue(true);
    jest.mocked(secureStorage.getAccessToken).mockResolvedValue(null);

    const { result } = await renderHook(() => useAuth());
    const status = await result.current.checkBiometricAvailability();

    expect(status.available).toBe(false);
  });
});

describe('useAuth — loginWithBiometrics', () => {
  it('refuses when there is no stored credential', async () => {
    jest.mocked(secureStorage.getAccessToken).mockResolvedValue(null);
    const { result } = await renderHook(() => useAuth());

    let res: { success: boolean; error?: string } = { success: true };
    await act(async () => {
      res = await result.current.loginWithBiometrics();
    });

    expect(res.success).toBe(false);
    expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
  });

  it('unlocks the stored token and establishes the session on success', async () => {
    jest.mocked(secureStorage.getAccessToken).mockResolvedValue('stored-token');
    jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: true });
    jest.mocked(authApi.getMe).mockResolvedValue(fakeUser());

    const { result } = await renderHook(() => useAuth());

    let res: { success: boolean; error?: string } = { success: false };
    await act(async () => {
      res = await result.current.loginWithBiometrics();
    });

    expect(res.success).toBe(true);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user?.email).toBe('elder@example.com');
  });

  it('reports failure when the biometric prompt is cancelled', async () => {
    jest.mocked(secureStorage.getAccessToken).mockResolvedValue('stored-token');
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockResolvedValue({ success: false, error: 'user_cancel' });

    const { result } = await renderHook(() => useAuth());

    let res: { success: boolean; error?: string } = { success: true };
    await act(async () => {
      res = await result.current.loginWithBiometrics();
    });

    expect(res.success).toBe(false);
  });
});
