import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSuperAdmin } from "@/server/admin/guard";
import { AdminShell } from "@/components/admin/admin-shell";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: { default: "Administration", template: "%s — Administration" },
  robots: { index: false, follow: false },
};

async function GuardedShell({ children }: { children: React.ReactNode }) {
  const auth = await requireSuperAdmin();
  return <AdminShell admin={{ name: `${auth.user.firstName} ${auth.user.lastName}`, email: auth.user.email }}>{children}</AdminShell>;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh flex-1" aria-busy="true" aria-label="Chargement de l'administration">
          <div className="hidden w-64 shrink-0 bg-sidebar lg:block" />
          <div className="flex-1 p-8">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="mt-8 h-80 rounded-2xl" />
          </div>
        </div>
      }
    >
      <GuardedShell>{children}</GuardedShell>
    </Suspense>
  );
}
