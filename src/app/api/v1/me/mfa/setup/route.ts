import { authRoute } from "@/server/http/api";
import { beginMfaSetup } from "@/server/auth/auth-service";

export const POST = authRoute({}, async ({ auth }) => beginMfaSetup(auth));
