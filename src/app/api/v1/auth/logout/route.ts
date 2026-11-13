import { publicRoute, noContent } from "@/server/http/api";
import { logout } from "@/server/auth/auth-service";
import { clearSessionCookie } from "@/server/auth/session";

export const POST = publicRoute({}, async ({ auth, meta }) => {
  if (auth) await logout(auth, meta);
  await clearSessionCookie();
  return noContent();
});
