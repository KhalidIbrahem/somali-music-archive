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
} as const;

/** Route prefixes switched off by the flags; the page gate redirects them home. */
export function disabledRoutePrefixes(): string[] {
  const out: string[] = [];
  if (!flags.courses) out.push('/courses');
  if (!flags.learn) out.push('/learn');
  if (!flags.daw) out.push('/daw');
  return out;
}
