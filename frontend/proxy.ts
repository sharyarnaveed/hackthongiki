import { NextResponse, type NextRequest } from "next/server";

/**
 * Route guard, based only on whether the session cookie is present:
 * - pages that need an account redirect to /signin when there's no cookie;
 * - auth pages (sign in / sign up / verify) redirect signed-in users to /dashboard.
 *
 * This is only a fast first check — the cookie is HttpOnly and set by the API
 * (cookies are shared across ports on the same host), and the backend verifies
 * the session on every request. A stale cookie can't cause a redirect loop:
 * the API clears it when it answers 401, before the client goes to /signin.
 */
const SESSION_COOKIE = "session";
const AUTH_PAGES = ["/signin", "/signup", "/verify-email"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = request.cookies.has(SESSION_COOKIE);

  if (AUTH_PAGES.includes(pathname)) {
    return signedIn ? NextResponse.redirect(new URL("/dashboard", request.url)) : NextResponse.next();
  }

  if (signedIn) return NextResponse.next();
  const url = new URL("/signin", request.url);
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // /verify-email/success is left out: it's shown right after verifying, when the user is already signed in.
  matcher: ["/signin", "/signup", "/verify-email", "/dashboard/:path*", "/onboarding/:path*", "/office/:path*"],
};
