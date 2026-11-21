import { NextResponse, after, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { einvoicingAvailable, handleEInvoiceWebhook, syncEInvoicing } from "@/server/modules/einvoicing/service";

/**
 * Webhook de la plateforme de facturation électronique. Pas de session : l'authenticité est vérifiée par
 * l'implémentation de la plateforme (signature) avant toute lecture des données.
 */
export async function POST(request: NextRequest) {
  if (!einvoicingAvailable()) return NextResponse.json({ error: { code: "EINVOICING_UNAVAILABLE", message: "Aucune plateforme raccordée." } }, { status: 503 });
  const body = await request.text();
  if (body.length > 1_000_000) return NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Corps trop volumineux." } }, { status: 413 });
  const result = await handleEInvoiceWebhook(body, request.headers);
  if (!result) return NextResponse.json({ error: { code: "INVALID_SIGNATURE", message: "Signature invalide." } }, { status: 400 });
  if (result.incomingAvailable) {
    after(async () => {
      await syncEInvoicing().catch(async (error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        await prisma.applicationError.create({ data: { message: `Réception de factures électroniques : ${err.message}`.slice(0, 5000), stack: err.stack?.slice(0, 20000), path: "/api/v1/einvoicing/webhook", method: "POST" } }).catch(() => undefined);
      });
    });
  }
  return NextResponse.json({ received: true, recorded: result.recorded });
}
