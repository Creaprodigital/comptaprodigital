import type { Metadata } from "next";
import { Suspense } from "react";
import { getAppContext } from "@/server/auth/guards";
import { AppShell } from "@/components/app/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: { default: "Espace client", template: "%s — ComptaPro Digital" },
  robots: { index: false, follow: false },
};

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh flex-1" aria-busy="true" aria-label="Chargement de l'espace client">
      <div className="hidden w-64 shrink-0 bg-sidebar lg:block" />
      <div className="flex-1 p-6 lg:p-8">
        <Skeleton className="h-9 w-64" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="mt-6 h-80 rounded-2xl" />
      </div>
    </div>
  );
}

/** Lit la session (donnée de requête) : rendu derrière la frontière Suspense du layout. */
async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const { auth, companies, access } = await getAppContext();
  return (
    <AppShell
      user={{ firstName: auth.user.firstName, lastName: auth.user.lastName, email: auth.user.email }}
      companies={companies.map((c) => ({ id: c.id, name: c.name, roleName: c.roleName }))}
      activeCompanyId={access?.company.id ?? null}
    >
      {children}
    </AppShell>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}
