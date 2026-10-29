/**
 * When the Studio may talk to the account server (/api/v1/studio/projects).
 *
 * The endpoints need a signed-in member, and a production build without
 * NEXT_PUBLIC_API_URL has no server at all (the public site): its fallback,
 * localhost:3001, would point at the visitor's own machine. In either case
 * the IndexedDB copy is the save and no request is made. Development builds
 * keep the localhost fallback so scripts/dev-up.sh works unconfigured.
 */

export interface SyncEnvironment {
  /** NEXT_PUBLIC_API_URL as inlined at build time. */
  apiUrl: string | undefined;
  /** process.env.NODE_ENV. */
  nodeEnv: string | undefined;
  /** The stored access token, or null when signed out. */
  token: string | null;
}

export function accountSyncEnabled(env: SyncEnvironment): boolean {
  const serverConfigured = (env.apiUrl ?? '') !== '' || env.nodeEnv !== 'production';
  return serverConfigured && env.token !== null;
}
