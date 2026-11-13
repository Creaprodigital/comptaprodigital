import { Suspense } from "react";
import { connection } from "next/server";
import { listActivePlans } from "@/server/modules/plans/service";
import { Skeleton } from "@/components/ui/skeleton";
import { PricingCards } from "@/components/marketing/pricing-cards";

/**
 * Grille tarifaire : les formules et leurs prix sont lus en base à chaque
 * requête, car ils sont modifiables depuis l'administration.
 */
async function PricingData({ showComparison }: { showComparison: boolean }) {
  await connection();
  const plans = await listActivePlans();
  if (plans.length === 0) {
    return (
      <p className="rounded-2xl border bg-card p-8 text-center text-muted-foreground">
        Les formules sont en cours de mise à jour. Contactez-nous pour obtenir une offre.
      </p>
    );
  }
  return <PricingCards plans={plans} showComparison={showComparison} />;
}

function PricingSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-3" aria-busy="true" aria-label="Chargement des tarifs">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[440px] rounded-2xl" />
      ))}
    </div>
  );
}

export function Pricing({ showComparison = false }: { showComparison?: boolean }) {
  return (
    <Suspense fallback={<PricingSkeleton />}>
      <PricingData showComparison={showComparison} />
    </Suspense>
  );
}
