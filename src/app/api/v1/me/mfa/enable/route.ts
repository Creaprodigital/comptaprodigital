import { authRoute } from "@/server/http/api";
import { enableMfa } from "@/server/auth/auth-service";
import { totpCodeSchema } from "@/lib/schemas/auth";

export const POST = authRoute({ body: totpCodeSchema }, async ({ auth, body, meta }) => enableMfa(auth, body.code, meta));
