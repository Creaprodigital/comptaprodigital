import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { runControls } from "@/server/modules/controls/service";
import { formatCurrency, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Contrôles" };

export default async function ControlsPage() {
  const { access } = await requireCompany("company:read");
  const findings = await runControls(access);
  return (
    <>
      <PageHeader title="Contrôles" description="Vérifications automatiques de vos données : doublons possibles, justificatifs manquants, montants et TVA inhabituels. Ce sont des signalements à examiner, pas des erreurs certaines ; rien n'est modifié." />
      {findings.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-sm">
            <CheckCircle2Icon className="size-5 text-success-foreground" aria-hidden="true" /> Aucun point à signaler pour le moment.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {findings.map((f) => (
            <Card key={f.code}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {f.severity === "warning" ? <AlertTriangleIcon className="size-5 text-warning-foreground" aria-hidden="true" /> : <InfoIcon className="size-5 text-muted-foreground" aria-hidden="true" />}
                  {f.title}
                  <Badge variant={f.severity === "warning" ? "warning" : "secondary"}>{f.count}</Badge>
                </CardTitle>
                <CardDescription>{f.detail}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y rounded-xl border text-sm">
                  {f.items.map((item, i) => (
                    <li key={`${item.href}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                      <Link href={item.href} className="min-w-0 flex-1 truncate hover:text-primary hover:underline">{item.label}</Link>
                      <span className="text-muted-foreground tabular-nums">
                        {item.date ? formatDate(item.date) : ""}
                        {item.amount ? ` · ${formatCurrency(item.amount)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                {f.count > f.items.length ? <p className="mt-2 text-xs text-muted-foreground">{f.items.length} premiers éléments sur {f.count}.</p> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
