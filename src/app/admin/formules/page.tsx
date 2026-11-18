import type { Metadata } from "next";
import { requireSuperAdmin } from "@/server/admin/guard";
import { listAdminPlans } from "@/server/modules/admin/plans";
import { isStripeConfigured } from "@/server/billing/stripe";
import { PageHeader } from "@/components/app/page-header";
import { PlanEditor } from "@/components/admin/plan-editor";

export const metadata: Metadata = { title: "Formules" };

export default async function AdminPlansPage() {
  await requireSuperAdmin();
  const plans = await listAdminPlans();
  return (
    <>
      <PageHeader
        title="Formules"
        description="Tarifs HT, durée d'essai, arguments, limites et modules. Les modifications s'appliquent immédiatement au site et aux nouveaux abonnements ; les abonnés existants conservent leur tarif jusqu'à leur prochain changement de formule."
      />
      <div className="grid gap-6">
        {plans.map((plan) => <PlanEditor key={plan.id} plan={plan} stripeEnabled={isStripeConfigured()} />)}
      </div>
    </>
  );
}
