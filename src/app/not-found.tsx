import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <Logo />
      <p className="font-display text-7xl font-bold text-primary/20">404</p>
      <div>
        <h1 className="text-2xl font-bold">Page introuvable</h1>
        <p className="mt-2 text-muted-foreground">La page demandée n'existe pas ou a été déplacée.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/">Retour à l'accueil</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/contact">Nous contacter</Link>
        </Button>
      </div>
    </main>
  );
}
