import type { Metadata } from "next";
import { requireAuth } from "@/server/auth/guards";
import { getBillingOverview } from "@/server/billing/service";
import { PageHeader } from "@/components/app/page-header";
import { BillingView } from "@/components/app/billing-plan/billing-view";

export const metadata: Metadata = { title: "Abonnement" };

type Props = { searchParams: Promise<{ retour?: string; session_id?: string }> };

export default async function SubscriptionPage({ searchParams }: Props) {
  const [auth, params] = await Promise.all([requireAuth(), searchParams]);
  const overview = await getBillingOverview(auth.user.id);
  const returnState = params.retour === "succes" ? "succes" : params.retour === "annule" ? "annule" : null;
  return (
    <>
      <PageHeader title="Abonnement" description="Votre formule, son paiement et vos factures d'abonnement. L'abonnement couvre toutes les entreprises dont vous êtes titulaire." />
      <BillingView overview={overview} returnState={returnState} sessionId={params.session_id && /^cs_[A-Za-z0-9_]+$/.test(params.session_id) ? params.session_id : null} />
    </>
  );
}
