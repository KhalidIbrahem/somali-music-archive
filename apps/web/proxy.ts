/**
 * Page gate proxy (SESSION "private access"). In the invite-only configuration
 * (NEXT_PUBLIC_REQUIRE_AUTH=true) every page except the public landing page
 * and the auth doors redirects to /login without a session; on the public
 * site (the default) the gate is off and only the feature-flag redirects run. UX gating only: the marker cookie carries no secret and
 * proves nothing; every byte of member DATA still requires a bearer token at
 * the API. Static assets (any dotted path), _next internals, and Next data
 * requests are excluded by the matcher so the landing page's own audio/images
 * keep streaming.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { disabledRoutePrefixes, flags } from '@/lib/flags';

const GATE_COOKIE = 'sma_session';

/** The only pages a signed-out visitor may see. */
const PUBLIC_PATHS = new Set(['/', '/login', '/register', '/admin/login']);

/**
 * Local demo switch: with NEXT_PUBLIC_GATE_BYPASS=1 in a development build the
 * gate stands open, so the transcribe page can be shown without the API and
 * its databases running. Ignored in production builds.
 */
const GATE_BYPASS =
  process.env.NODE_ENV === 'development' && process.env['NEXT_PUBLIC_GATE_BYPASS'] === '1';

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  // Sections switched off by feature flags go home, whatever the session.
  if (disabledRoutePrefixes().some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const home = request.nextUrl.clone();
    home.pathname = '/';
    home.search = '';
    return NextResponse.redirect(home);
  }
  // Public site (NEXT_PUBLIC_REQUIRE_AUTH=false): no gate at all. The
  // member-only pages are already in the disabled prefixes above.
  if (!flags.requireAuth) return NextResponse.next();
  if (GATE_BYPASS) return NextResponse.next();
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (request.cookies.has(GATE_COOKIE)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = `next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip _next internals and anything with a file extension (static assets).
  matcher: ['/((?!_next|.*\\..*).*)'],
};
