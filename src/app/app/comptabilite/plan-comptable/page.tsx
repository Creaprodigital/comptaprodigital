import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { listAccounts } from "@/server/modules/accounting/chart";
import { accountingPageAccess } from "@/server/modules/accounting/page-access";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { SearchForm } from "@/components/app/billing/shared";
import { AccountingTabs } from "@/components/app/accounting/shared";
import { AccountsTable } from "@/components/app/accounting/accounts-view";

export const metadata: Metadata = { title: "Plan comptable" };

type Props = { searchParams: Promise<{ q?: string }> };

export default async function ChartPage({ searchParams }: Props) {
  const [{ access, state }, params] = await Promise.all([accountingPageAccess(), searchParams]);
  if (state !== "ok") redirect("/app/comptabilite");
  const accounts = await listAccounts(access, { q: params.q?.slice(0, 60) || undefined });
  return (
    <>
      <PageHeader title="Plan comptable" description="Comptes de référence issus du plan comptable général et comptes propres à l'entreprise. Soldes des exercices ouverts." />
      <AccountingTabs current="plan-comptable" />
      <div className="mb-4"><SearchForm action="/app/comptabilite/plan-comptable" query={params.q} placeholder="Numéro ou intitulé" /></div>
      <Card>
        <CardContent className="px-2 py-2 sm:px-4">
          <AccountsTable companyId={access.company.id} accounts={accounts} canWrite={access.permissions.has("accounting:write")} currency={access.company.currency} />
        </CardContent>
      </Card>
    </>
  );
}
