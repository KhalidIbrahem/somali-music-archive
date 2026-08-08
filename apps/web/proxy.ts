/**
 * Page gate proxy (SESSION "private access") — the platform is invite-only: without
 * a session, every page except the public landing page and the auth doors
 * redirects to /login. UX gating only: the marker cookie carries no secret and
 * proves nothing; every byte of member DATA still requires a bearer token at
 * the API. Static assets (any dotted path), _next internals, and Next data
 * requests are excluded by the matcher so the landing page's own audio/images
 * keep streaming.
 */

import { NextResponse, type NextRequest } from 'next/server';

const GATE_COOKIE = 'sma_session';

/** The only pages a signed-out visitor may see. */
const PUBLIC_PATHS = new Set(['/', '/login', '/register', '/admin/login']);

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
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
