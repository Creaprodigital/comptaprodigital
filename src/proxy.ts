import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_DEV, SESSION_COOKIE_SECURE } from "@/server/auth/constants";
import { validateSessionToken } from "@/server/auth/session-store";

/**
 * Premier filtre de l'espace client : sans cookie de session, redirection vers
 * la connexion. La validité réelle de la session (révocation, expiration,
 * second facteur) est vérifiée côté serveur à chaque rendu et à chaque appel API.
 *
 * Pour l'administration, la session est validée dès ce filtre : un compte qui
 * n'est pas super administrateur reçoit une vraie réponse 404 (l'espace
 * n'existe pas pour lui), avant tout rendu en flux. Les pages et l'API
 * de l'administration refont ces contrôles (défense en profondeur).
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_SECURE)?.value ?? request.cookies.get(SESSION_COOKIE_DEV)?.value;
  if (!token) {
    const loginUrl = new URL("/connexion", request.url);
    loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }
  if (request.nextUrl.pathname === "/admin" || request.nextUrl.pathname.startsWith("/admin/")) {
    const auth = await validateSessionToken(token);
    if (!auth) {
      const loginUrl = new URL("/connexion", request.url);
      loginUrl.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }
    if (!auth.user.isSuperAdmin) return NextResponse.rewrite(new URL("/introuvable-administration", request.url), { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*"],
};
