import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Accès refusé" };

export default function AccessDeniedPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-warning-soft text-warning-foreground">
        <ShieldAlertIcon className="size-7" aria-hidden="true" />
      </span>
      <h1 className="mt-6 text-2xl font-bold">Accès refusé</h1>
      <p className="mt-3 text-muted-foreground">
        Votre rôle dans cette entreprise ne vous permet pas d'accéder à cette page. Rapprochez-vous du propriétaire ou
        d'un administrateur.
      </p>
      <Button asChild className="mt-8">
        <Link href="/app">Retour à l'espace client</Link>
      </Button>
    </div>
  );
}
