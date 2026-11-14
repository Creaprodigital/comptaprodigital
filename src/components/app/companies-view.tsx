"use client";

import { useState } from "react";
import { Building2Icon, CheckIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { LEGAL_FORM_LABELS } from "@/config/legal";
import type { CompanySummary } from "@/server/modules/companies/service";
import { useResetOnHide } from "@/lib/use-reset-on-hide";
import { api, errorMessage } from "@/lib/api-client";
import { formatSiren } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CompanyForm } from "@/components/app/company-form";
import { PageHeader } from "@/components/app/page-header";

export function CompaniesView({
  companies,
  activeCompanyId,
  plan,
  openCreate,
}: {
  companies: CompanySummary[];
  activeCompanyId: string | null;
  plan: { name: string; maxCompanies: number | null; owned: number } | null;
  openCreate: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(openCreate && companies.length > 0);
  useResetOnHide(() => setDialogOpen(false));
  const limitReached = plan !== null && plan.maxCompanies !== null && plan.owned >= plan.maxCompanies;

  async function activate(companyId: string) {
    try {
      await api("/me/active-company", { method: "PUT", body: { companyId } });
      window.location.assign("/app/tableau-de-bord");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  // Premier accès : le formulaire de création est présenté directement.
  if (companies.length === 0) {
    return (
      <>
        <PageHeader
          title="Bienvenue ! Ajoutons votre entreprise"
          description="Recherchez-la par son SIREN pour pré-remplir ses informations, puis précisez vos régimes."
        />
        <Card>
          <CardContent>
            <CompanyForm mode="create" />
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Mes entreprises"
        description={
          plan
            ? `Formule ${plan.name} : ${plan.owned} entreprise${plan.owned > 1 ? "s" : ""} détenue${plan.owned > 1 ? "s" : ""}${plan.maxCompanies !== null ? ` sur ${plan.maxCompanies}` : ""}.`
            : "Entreprises auxquelles vous avez accès."
        }
        actions={
          <Button onClick={() => setDialogOpen(true)} disabled={limitReached} title={limitReached ? "Limite de votre formule atteinte" : undefined}>
            <PlusIcon /> Ajouter une entreprise
          </Button>
        }
      />
      {limitReached ? (
        <p className="mb-6 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm">
          Votre formule {plan!.name} est limitée à {plan!.maxCompanies} entreprise{plan!.maxCompanies! > 1 ? "s" : ""}. La
          formule Business permet d'en gérer plusieurs.
        </p>
      ) : null}

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {companies.map((company) => {
          const active = company.id === activeCompanyId;
          return (
            <li key={company.id}>
              <Card className={active ? "border-primary ring-1 ring-primary" : undefined}>
                <CardContent className="flex h-full flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                      <Building2Icon className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate font-sans text-base font-semibold tracking-normal">{company.name}</h2>
                      <p className="text-sm text-muted-foreground">
                        {LEGAL_FORM_LABELS[company.legalForm]}
                        {company.siren ? ` · SIREN ${formatSiren(company.siren)}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{company.roleName}</Badge>
                    {company.status === "SUSPENDED" ? <Badge variant="destructive">Suspendue</Badge> : null}
                    {active ? (
                      <Badge variant="success">
                        <CheckIcon /> Active
                      </Badge>
                    ) : null}
                  </div>
                  {!active ? (
                    <Button variant="outline" size="sm" className="mt-auto self-start" onClick={() => activate(company.id)}>
                      Ouvrir cette entreprise
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Ajouter une entreprise</DialogTitle>
            <DialogDescription>Ses données seront strictement séparées de celles de vos autres entreprises.</DialogDescription>
          </DialogHeader>
          <CompanyForm mode="create" onCancel={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
