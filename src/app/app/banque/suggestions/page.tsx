import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCompany } from "@/server/auth/guards";
import { companyHasModule } from "@/server/modules/plans/service";
import { listCategories } from "@/server/modules/bank/categories";
import { aiStatus } from "@/server/ai/service";
import { listCategorySuggestions } from "@/server/ai/categorization";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { BankTabs } from "@/components/app/bank/shared";
import { AiUnavailable } from "@/components/app/ai/ai-unavailable";
import { CategorySuggestions, RequestSuggestionsButton } from "@/components/app/ai/category-suggestions";

export const metadata: Metadata = { title: "Suggestions de catégories" };

export default async function BankSuggestionsPage() {
  const { access } = await requireCompany("bank:read");
  if (!(await companyHasModule(access.company.id, "bank"))) redirect("/app/banque");
  const companyId = access.company.id;
  const canWrite = access.permissions.has("bank:write");
  const [ai, suggestions, categories, uncategorized] = await Promise.all([
    aiStatus(access.company),
    listCategorySuggestions(access),
    listCategories(companyId),
    access.db.bankTransaction.count({ where: { categoryId: null } }),
  ]);
  return (
    <>
      <PageHeader
        title="Banque"
        description="L'IA propose une catégorie pour vos opérations non catégorisées. Rien n'est appliqué sans votre accord."
        actions={canWrite && ai.usable ? <RequestSuggestionsButton companyId={companyId} disabled={uncategorized === 0} /> : undefined}
      />
      <BankTabs current="suggestions" />
      {!ai.usable ? <div className="mb-6"><AiUnavailable status={ai} /></div> : null}
      {suggestions.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {uncategorized === 0 ? "Toutes vos opérations sont catégorisées." : `${uncategorized} opération(s) non catégorisée(s). ${ai.usable && canWrite ? "Lancez une demande de suggestions (40 opérations au plus par demande)." : ""}`}
          </CardContent>
        </Card>
      ) : (
        <CategorySuggestions companyId={companyId} suggestions={suggestions} categories={categories.filter((c) => c.isActive)} canWrite={canWrite} />
      )}
    </>
  );
}
