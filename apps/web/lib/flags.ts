/**
 * Feature flags for the public web app.
 *
 * Each NEXT_PUBLIC_* value is inlined into the bundle at build time, so every
 * variable is read here, literally, and nowhere else. Values are the strings
 * 'true' or 'false'; anything else falls back to the default given below.
 */

function read(value: string | undefined, fallback: boolean): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

/**
 * Where the AI service (transcription jobs, served generation) runs.
 * 'local': on this machine, at NEXT_PUBLIC_AI_URL. 'remote': somewhere else,
 * same calls. 'off': no live service; Transcribe and Generate show examples
 * rendered ahead of time. Unset: 'local' when NEXT_PUBLIC_AI_URL is given,
 * otherwise 'off' (a build without a service address must not point at
 * localhost).
 */
export type AiServiceMode = 'local' | 'remote' | 'off';

function readMode(value: string | undefined): AiServiceMode {
  if (value === 'local' || value === 'remote' || value === 'off') return value;
  return process.env['NEXT_PUBLIC_AI_URL'] ? 'local' : 'off';
}

export const flags = {
  /** Course pages, the Courses nav item and links to them. Hidden for now. */
  courses: read(process.env['NEXT_PUBLIC_ENABLE_COURSES'], false),
  /** Lesson pages, the Learn nav item and links to them. Hidden for now. */
  learn: read(process.env['NEXT_PUBLIC_ENABLE_LEARN'], false),
  /** The composition studio (DAW) at /daw, the "Studio" nav item and the home page links to it. Hidden: not part of the research demo. */
  daw: read(process.env['NEXT_PUBLIC_ENABLE_DAW'], false),
  /**
   * Generate page: list only the adapters the local generation service is
   * serving right now and call that service directly. 'false' restores the
   * earlier provider tiers routed through the Node API.
   */
  generateServedOnly: read(process.env['NEXT_PUBLIC_GENERATE_SERVED_ONLY'], true),
  /** See AiServiceMode above. */
  aiServiceMode: readMode(process.env['NEXT_PUBLIC_AI_SERVICE_MODE']),
  /**
   * The page gate. 'true' is the invite-only configuration: every page except
   * the landing page and the auth doors needs a session, and the header shows
   * Sign in and the account menu. 'false' (the default, the public site) opens
   * every page without an account; Sign in, Create account, the account menu
   * and the member-only pages are hidden, and Listen and Library list only
   * cleared demo material. The auth code stays in place either way.
   */
  requireAuth: read(process.env['NEXT_PUBLIC_REQUIRE_AUTH'], false),
} as const;

/** Pages that only make sense with a member session. */
const MEMBER_ROUTES = ['/login', '/register', '/account', '/dashboard', '/teach'];

/** Route prefixes switched off by the flags; the page gate redirects them home. */
export function disabledRoutePrefixes(): string[] {
  const out: string[] = [];
  if (!flags.courses) out.push('/courses');
  if (!flags.learn) out.push('/learn');
  if (!flags.daw) out.push('/daw');
  if (!flags.requireAuth) out.push(...MEMBER_ROUTES);
  return out;
}
