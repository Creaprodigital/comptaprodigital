import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ArrowLeftIcon, LockKeyholeIcon } from "lucide-react";
import { requireSuperAdmin } from "@/server/admin/guard";
import { AppError } from "@/server/http/errors";
import { getCompanyAdmin } from "@/server/modules/admin/companies";
import { activeGrant, financialSnapshot, listGrants } from "@/server/modules/admin/access-grants";
import { getSetting } from "@/server/modules/admin/settings";
import { formatCurrency, formatDate, formatDateTime, formatSiren } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionDialog } from "@/components/admin/action-dialog";
import { SubscriptionBadge } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Entreprise" };
export const instant = false;

type Props = { params: Promise<{ companyId: string }> };

const STANDING: Record<string, string> = { trial: "TRIALING", active: "ACTIVE", grace: "PAST_DUE", inactive: "EXPIRED" };

export default async function AdminCompanyPage({ params }: Props) {
  const [auth, { companyId }] = await Promise.all([requireSuperAdmin(), params]);
  const company = await getCompanyAdmin(companyId).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const [grant, grants, maxHours] = await Promise.all([activeGrant(auth.user.id, companyId), listGrants(companyId), getSetting("admin.access_grant_max_hours")]);
  // La synthèse n'est chargée (et la consultation journalisée) que pendant un accès justifié.
  let snapshot: Awaited<ReturnType<typeof financialSnapshot>> | null = null;
  if (grant) {
    const h = await headers();
    snapshot = await financialSnapshot(auth.user.id, companyId, { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: h.get("user-agent") });
  }
  const endpoint = `/admin/companies/${company.id}`;
  return (
    <>
      <Link href="/admin/entreprises" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4" /> Entreprises</Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-[28px]">{company.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {company.siren ? `SIREN ${formatSiren(company.siren)}` : "SIREN non renseigné"} · créée le {formatDate(company.createdAt)}
            {company.status === "SUSPENDED" ? <Badge variant="destructive">Suspendue</Badge> : company.status === "ARCHIVED" ? <Badge variant="secondary">Archivée</Badge> : <Badge variant="success">Active</Badge>}
          </p>
        </div>
        {company.status === "ACTIVE" ? (
          <ActionDialog
            trigger="Suspendre l'entreprise"
            variant="destructive"
            destructive
            title="Suspendre cette entreprise ?"
            description="Ses membres ne pourront plus y accéder. Les données sont conservées et l'entreprise peut être réactivée."
            endpoint={endpoint}
            fixed={{ status: "SUSPENDED" }}
            fields={[{ name: "reason", label: "Motif", type: "textarea", required: true, hint: "10 caractères au moins ; inscrit au journal d'audit." }]}
            success="Entreprise suspendue."
          />
        ) : company.status === "SUSPENDED" ? (
          <ActionDialog trigger="Réactiver l'entreprise" title="Réactiver cette entreprise ?" endpoint={endpoint} fixed={{ status: "ACTIVE" }} success="Entreprise réactivée." />
        ) : null}
      </div>
      {company.status === "SUSPENDED" && company.suspendedReason ? <p className="mb-6 rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">Motif de la suspension : {company.suspendedReason}</p> : null}

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Fiche</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Forme juridique</dt><dd>{company.legalForm}</dd>
              <dt className="text-muted-foreground">Régime d'imposition</dt><dd>{company.taxRegime}</dd>
              <dt className="text-muted-foreground">Régime de TVA</dt><dd>{company.vatRegime}</dd>
              <dt className="text-muted-foreground">Tenue</dt><dd>{company.accountingMode}</dd>
              <dt className="text-muted-foreground">Ville</dt><dd>{company.city ?? "—"}</dd>
              <dt className="text-muted-foreground">Abonnement du titulaire</dt><dd>{company.ownerStanding ? <SubscriptionBadge status={STANDING[company.ownerStanding] ?? null} /> : "—"}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Membres</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y rounded-xl border text-sm">
              {company.members.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <Link href={`/admin/clients/${m.userId}`} className="hover:underline">{m.name} <span className="text-muted-foreground">({m.email})</span></Link>
                  <Badge variant={m.owner ? "accent" : "secondary"}>{m.role}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><LockKeyholeIcon className="size-5" aria-hidden="true" /> Données financières</CardTitle>
            <CardDescription>
              Consultables uniquement sur accès justifié, en lecture seule, pour {maxHours} heures au plus. Le titulaire est prévenu par e-mail et notification, peut révoquer l'accès, et chaque consultation est inscrite au journal d'audit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {grant && snapshot ? (
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
                  <span>Accès ouvert jusqu'au {formatDateTime(grant.expiresAt)} — motif : {grant.reason}</span>
                  <ActionDialog trigger="Clore l'accès" title="Clore l'accès maintenant ?" endpoint={`/admin/access-grants/${grant.id}`} method="DELETE" success="Accès clos." confirmLabel="Clore" />
                </div>
                <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ["CA de l'exercice (HT)", snapshot.kpis.revenueFiscalYear],
                    ["Trésorerie", snapshot.kpis.bankBalance],
                    ["Impayés clients", `${snapshot.kpis.unpaid.amount}`],
                    ["Dettes fournisseurs", snapshot.kpis.supplierDebt],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border p-3">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(value)}</dd>
                    </div>
                  ))}
                </dl>
                {snapshot.alerts.length ? <ul className="list-disc pl-5 text-sm text-muted-foreground">{snapshot.alerts.map((a) => <li key={a}>{a}</li>)}</ul> : null}
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Dernières factures émises</h3>
                  {snapshot.invoices.length === 0 ? <p className="text-sm text-muted-foreground">Aucune facture émise.</p> : (
                    <ul className="divide-y rounded-xl border text-sm">
                      {snapshot.invoices.map((i) => (
                        <li key={i.number ?? i.issueDate} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                          <span>{i.number} · {i.customer} · {i.issueDate ? formatDate(i.issueDate) : "—"}</span>
                          <span className="tabular-nums">{formatCurrency(i.total)} (réglé {formatCurrency(i.paid)})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Comptes bancaires</h3>
                  {snapshot.bankAccounts.length === 0 ? <p className="text-sm text-muted-foreground">Aucun compte bancaire.</p> : (
                    <ul className="text-sm">{snapshot.bankAccounts.map((b) => <li key={`${b.name}-${b.ibanLast4}`}>{b.name}{b.bankName ? ` — ${b.bankName}` : ""}{b.ibanLast4 ? ` (…${b.ibanLast4})` : ""}{b.isActive ? "" : " — inactif"}</li>)}</ul>
                  )}
                </div>
              </div>
            ) : (
              <ActionDialog
                trigger="Demander un accès justifié"
                title="Ouvrir un accès justifié"
                description="Le titulaire de l'entreprise en est informé immédiatement. N'ouvrez un accès que lorsque c'est nécessaire (instruction d'une demande de support, par exemple)."
                endpoint={`${endpoint}/access`}
                fields={[
                  { name: "reason", label: "Justification", type: "textarea", required: true, hint: "20 caractères au moins : référence de la demande de support, objet de la vérification…" },
                  { name: "hours", label: "Durée (heures)", type: "number", min: 1, max: maxHours, defaultValue: String(Math.min(2, maxHours)), required: true },
                ]}
                success="Accès ouvert ; le titulaire a été prévenu."
                confirmLabel="Ouvrir l'accès"
              />
            )}
            {grants.length > 0 ? (
              <div className="mt-6">
                <h3 className="mb-2 text-sm font-semibold">Historique des accès</h3>
                <ul className="divide-y rounded-xl border text-sm">
                  {grants.map((g) => (
                    <li key={g.id} className="grid gap-1 px-4 py-2.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{g.admin}</span>
                        {g.active ? <Badge variant="warning">En cours</Badge> : g.revokedAt ? <Badge variant="secondary">Révoqué</Badge> : <Badge variant="secondary">Expiré</Badge>}
                        <span className="text-muted-foreground">{formatDateTime(g.createdAt)} → {formatDateTime(g.revokedAt ?? g.expiresAt)} · {g.views} consultation(s)</span>
                      </span>
                      <span className="text-muted-foreground">{g.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
