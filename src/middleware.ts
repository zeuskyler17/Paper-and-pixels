import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session';

/**
 * Front door: only checks that the visitor is logged in. What each user may open is decided on
 * every page / action from their role's permissions (lib/auth.ts), which are read from the database.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === '/login') {
    return session ? NextResponse.redirect(new URL('/', req.url)) : NextResponse.next();
  }
  if (!session) {
    // Serve the login page at "/" directly (200, not a redirect) so health checks see the app as up.
    if (pathname === '/') return NextResponse.rewrite(new URL('/login', req.url));
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = {
  // Skip Next internals and static image files (logo, icons) so they load on the login page too.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|webp|svg|ico|m4a|mp3|crt)$|phone-setup\.html).*)'],
};
