import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCompany } from "@/server/auth/guards";
import { companyHasModule } from "@/server/modules/plans/service";
import { listCategories, listRules } from "@/server/modules/bank/categories";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { CategoriesPanel, RulesPanel } from "@/components/app/bank/rules-view";
import { BankTabs } from "@/components/app/bank/shared";

export const metadata: Metadata = { title: "Catégories et règles" };

export default async function BankRulesPage() {
  const { access } = await requireCompany("bank:read");
  if (!(await companyHasModule(access.company.id, "bank"))) redirect("/app/banque");
  const canWrite = access.permissions.has("bank:write");
  const [rules, categories] = await Promise.all([listRules(access), listCategories(access.company.id)]);

  return (
    <>
      <PageHeader title="Catégories et règles" description="Classez vos opérations, et laissez les règles catégoriser celles qui reviennent chaque mois." />
      <BankTabs current="regles" />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Règles automatiques</CardTitle>
            <CardDescription>Appliquées à chaque import, dans l'ordre de priorité. Chaque catégorisation automatique est inscrite dans l'historique de l'opération, où vous pouvez la corriger.</CardDescription>
          </CardHeader>
          <CardContent>
            <RulesPanel companyId={access.company.id} rules={rules} categories={categories} canWrite={canWrite} currency={access.company.currency} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Catégories</CardTitle>
            <CardDescription>Chaque catégorie porte un compte comptable suggéré, repris lors de la tenue de la comptabilité.</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoriesPanel companyId={access.company.id} categories={categories} canWrite={canWrite} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
