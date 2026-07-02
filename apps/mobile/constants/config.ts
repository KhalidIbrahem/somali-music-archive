/**
 * Runtime configuration read from the Expo public env at build time.
 *
 * Only `EXPO_PUBLIC_*` vars exist in the client bundle. We validate them once here
 * and fail loudly in development if the API URL is missing, so a misconfigured
 * build is caught immediately rather than as a confusing network error later.
 */

const apiUrl = process.env['EXPO_PUBLIC_API_URL'];

if (!apiUrl && __DEV__) {
  // eslint-disable-next-line no-console
  console.warn('[config] EXPO_PUBLIC_API_URL is not set — API calls will fail. See .env.example.');
}

export const config = {
  /** Base URL of the backend API, including the /api/v1 version prefix. */
  apiUrl: apiUrl ?? 'http://localhost:3001/api/v1',
  sentryDsn: process.env['EXPO_PUBLIC_SENTRY_DSN'] ?? '',
  posthogKey: process.env['EXPO_PUBLIC_POSTHOG_KEY'] ?? '',
} as const;
