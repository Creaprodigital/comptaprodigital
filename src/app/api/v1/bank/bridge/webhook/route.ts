import { NextResponse, after, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { verifyBridgeSignature } from "@/server/modules/bank/bridge";
import { planWebhook } from "@/server/modules/bank/connections";

/**
 * Webhooks Bridge. Pas de session ni de contrôle d'origine : l'authenticité repose sur la signature
 * (en-tête BridgeApi-Signature) vérifiée sur le corps brut. L'accusé de réception est immédiat ; la
 * synchronisation s'exécute après la réponse.
 */
export async function POST(request: NextRequest) {
  const secret = env().BRIDGE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: { code: "BANK_SYNC_UNAVAILABLE", message: "Webhook non configuré." } }, { status: 503 });
  const body = await request.text();
  if (body.length > 100_000) return NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Corps trop volumineux." } }, { status: 413 });
  if (!verifyBridgeSignature(body, request.headers.get("bridgeapi-signature"), secret)) {
    return NextResponse.json({ error: { code: "INVALID_SIGNATURE", message: "Signature invalide." } }, { status: 400 });
  }
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Corps invalide." } }, { status: 400 });
  }
  const task = await planWebhook(event as Parameters<typeof planWebhook>[0]);
  if (task) {
    after(async () => {
      try {
        await task();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error("[bridge] traitement du webhook", err);
        await prisma.applicationError.create({ data: { message: `Webhook Bridge : ${err.message}`.slice(0, 5000), stack: err.stack?.slice(0, 20000), path: "/api/v1/bank/bridge/webhook", method: "POST" } }).catch(() => undefined);
      }
    });
  }
  return NextResponse.json({ received: true });
}
