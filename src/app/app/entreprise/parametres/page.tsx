import type { Metadata } from "next";
import { EyeIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { tenantDb } from "@/server/tenancy/tenant-db";
import { serializeCompany } from "@/server/modules/companies/service";
import { toIsoDate } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CompanyForm } from "@/components/app/company-form";
import { PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "Paramètres de l'entreprise" };

export default async function CompanySettingsPage() {
  const { access } = await requireCompany("company:read");
  const canEdit = access.permissions.has("company:update");
  const fiscalYears = await tenantDb(access.company.id).fiscalYear.findMany({ orderBy: { startDate: "desc" }, take: 5 });

  return (
    <>
      <PageHeader title="Paramètres de l'entreprise" description="Identité, statut juridique, régimes fiscaux et coordonnées." />
      {!canEdit ? (
        <Alert className="mb-6">
          <EyeIcon />
          <AlertDescription className="text-foreground">
            Votre rôle ({access.roleKey === "READ_ONLY" ? "lecture seule" : "accès restreint"}) permet de consulter ces
            informations, mais pas de les modifier.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardContent>
            <CompanyForm mode="edit" company={serializeCompany(access.company)} readOnly={!canEdit} />
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Exercices comptables</CardTitle>
            <CardDescription>
              Tenue : {access.company.accountingMode === "CASH_BOOK" ? "livre des recettes (micro-entreprise)" : "comptabilité en partie double"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3">
              {fiscalYears.map((year) => (
                <li key={year.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="block font-medium">{year.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(toIsoDate(year.startDate))} – {formatDate(toIsoDate(year.endDate))}
                    </span>
                  </span>
                  <Badge variant={year.status === "OPEN" ? "success" : "secondary"}>{year.status === "OPEN" ? "Ouvert" : "Clôturé"}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
