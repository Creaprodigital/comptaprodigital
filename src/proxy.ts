import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_DEV, SESSION_COOKIE_SECURE } from "@/server/auth/constants";

/**
 * Premier filtre de l'espace client : sans cookie de session, redirection vers
 * la connexion. La validité réelle de la session (révocation, expiration,
 * second facteur) est vérifiée côté serveur à chaque rendu et à chaque appel API.
 */
export function proxy(request: NextRequest) {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_SECURE) || request.cookies.has(SESSION_COOKIE_DEV);
  if (!hasSessionCookie) {
    const loginUrl = new URL("/connexion", request.url);
    loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
