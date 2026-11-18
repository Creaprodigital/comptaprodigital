import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { requireSuperAdmin } from "@/server/admin/guard";
import { AppError } from "@/server/http/errors";
import { getUserAdmin } from "@/server/modules/admin/users";
import { listAdminPlans } from "@/server/modules/admin/plans";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionDialog } from "@/components/admin/action-dialog";
import { SubscriptionBadge } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Compte client" };
export const instant = false;

type Props = { params: Promise<{ userId: string }> };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

export default async function AdminUserPage({ params }: Props) {
  const [auth, { userId }] = await Promise.all([requireSuperAdmin(), params]);
  const [user, plans] = await Promise.all([
    getUserAdmin(userId).catch((error) => {
      if (error instanceof AppError && error.status === 404) notFound();
      throw error;
    }),
    listAdminPlans(),
  ]);
  const s = user.subscription;
  const stripeManaged = Boolean(s?.stripeSubscriptionId && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(s.status));
  const endpoint = `/admin/users/${user.id}`;
  return (
    <>
      <Link href="/admin/clients" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4" /> Comptes</Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-[28px]">{user.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {user.email}
            {user.status === "SUSPENDED" ? <Badge variant="destructive">Suspendu</Badge> : <Badge variant="success">Actif</Badge>}
            {user.isSuperAdmin ? <Badge variant="warning">Administrateur</Badge> : null}
          </p>
        </div>
        {!user.isSuperAdmin && user.id !== auth.user.id ? (
          user.status === "SUSPENDED" ? (
            <ActionDialog trigger="Réactiver le compte" title="Réactiver ce compte ?" description="Le titulaire pourra de nouveau se connecter." endpoint={endpoint} fixed={{ suspended: false }} success="Compte réactivé." />
          ) : (
            <ActionDialog
              trigger="Suspendre le compte"
              variant="destructive"
              destructive
              title="Suspendre ce compte ?"
              description="Ses sessions sont fermées immédiatement et il ne peut plus se connecter. Ses données sont conservées."
              endpoint={endpoint}
              fixed={{ suspended: true }}
              fields={[{ name: "reason", label: "Motif", type: "textarea", required: true, hint: "10 caractères au moins ; inscrit au journal d'audit." }]}
              success="Compte suspendu."
            />
          )
        ) : null}
      </div>
      {user.status === "SUSPENDED" && user.suspendedReason ? <p className="mb-6 rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">Motif de la suspension : {user.suspendedReason}</p> : null}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Compte</CardTitle></CardHeader>
          <CardContent>
            <dl className="divide-y">
              <Row label="Inscription">{formatDateTime(user.createdAt)}</Row>
              <Row label="Dernière connexion">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "—"}</Row>
              <Row label="E-mail vérifié">{user.verified ? "Oui" : "Non"}</Row>
              <Row label="Double authentification">{user.mfa ? "Activée" : "Non activée"}</Row>
              <Row label="Sessions actives">{user.activeSessions}</Row>
              <Row label="Demandes de support">{user.tickets}</Row>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Abonnement</CardTitle>
            {stripeManaged ? <CardDescription>Géré par Stripe : le titulaire change de formule ou résilie depuis sa page Abonnement.</CardDescription> : null}
          </CardHeader>
          <CardContent>
            {s ? (
              <>
                <dl className="divide-y">
                  <Row label="Formule">{s.planName} ({s.interval === "YEARLY" ? "annuel" : "mensuel"})</Row>
                  <Row label="Statut"><SubscriptionBadge status={s.status} /></Row>
                  {s.trialEndsAt ? <Row label="Fin d'essai">{formatDate(s.trialEndsAt)}</Row> : null}
                  {s.currentPeriodEnd ? <Row label="Fin de période">{formatDate(s.currentPeriodEnd)}{s.cancelAtPeriodEnd ? " (résiliation programmée)" : ""}</Row> : null}
                  {s.priceAmount ? <Row label="Tarif appliqué">{formatCurrency(s.priceAmount)}</Row> : null}
                  <Row label="Client Stripe">{s.stripeCustomerId ?? "—"}</Row>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  {!stripeManaged ? (
                    <>
                      <ActionDialog
                        trigger="Prolonger l'essai"
                        title="Prolonger la période d'essai"
                        endpoint={`${endpoint}/subscription`}
                        fixed={{ action: "extend_trial" }}
                        fields={[
                          { name: "days", label: "Nombre de jours", type: "number", min: 1, max: 90, defaultValue: "14", required: true },
                          { name: "reason", label: "Motif", type: "textarea", required: true },
                        ]}
                        success="Essai prolongé."
                      />
                      <ActionDialog
                        trigger="Changer la formule"
                        title="Changer la formule (sans facturation)"
                        description="Réservé aux comptes sans abonnement Stripe (essai, geste commercial). Aucun paiement n'est déclenché."
                        endpoint={`${endpoint}/subscription`}
                        fixed={{ action: "set_plan" }}
                        fields={[
                          { name: "planKey", label: "Formule", type: "select", defaultValue: s.planKey, options: plans.map((p) => ({ value: p.key, label: p.name })) },
                          { name: "reason", label: "Motif", type: "textarea", required: true },
                        ]}
                        success="Formule modifiée."
                      />
                    </>
                  ) : null}
                  {s.stripeSubscriptionId ? <ActionDialog trigger="Resynchroniser depuis Stripe" title="Relire l'abonnement chez Stripe ?" endpoint={`${endpoint}/subscription`} fixed={{ action: "resync" }} success="Abonnement synchronisé." confirmLabel="Synchroniser" /> : null}
                </div>
                {s.payments.length > 0 ? (
                  <ul className="mt-4 divide-y rounded-xl border text-sm">
                    {s.payments.map((p) => (
                      <li key={p.id} className="flex items-center justify-between px-3 py-2">
                        <span>{formatDate(p.date)}</span>
                        <span className="flex items-center gap-2">
                          <Badge variant={p.status === "paid" ? "success" : p.status === "failed" ? "destructive" : "secondary"}>{p.status === "paid" ? "Payée" : p.status === "failed" ? "Échec" : p.status}</Badge>
                          <span className="tabular-nums">{formatCurrency(p.amount)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Aucun abonnement.</p>
            )}
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Entreprises</CardTitle></CardHeader>
          <CardContent>
            {user.companies.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune entreprise.</p>
            ) : (
              <ul className="divide-y rounded-xl border text-sm">
                {user.companies.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <Link href={`/admin/entreprises/${c.id}`} className="font-medium hover:text-primary hover:underline">{c.name}</Link>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {c.role}
                      {c.status !== "ACTIVE" ? <Badge variant="secondary">{c.status === "SUSPENDED" ? "Suspendue" : "Archivée"}</Badge> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
