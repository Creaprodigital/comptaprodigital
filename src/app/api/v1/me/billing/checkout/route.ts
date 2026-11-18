import { authRoute } from "@/server/http/api";
import { startCheckout } from "@/server/billing/service";
import { checkoutSchema } from "@/lib/schemas/billing";

/** Page de paiement Stripe pour souscrire une formule (titulaire de l'abonnement uniquement : c'est son compte). */
export const POST = authRoute<Record<string, never>, typeof checkoutSchema>({ body: checkoutSchema }, async ({ auth, body, meta }) => startCheckout(auth.user.id, body.plan, body.interval, meta));
