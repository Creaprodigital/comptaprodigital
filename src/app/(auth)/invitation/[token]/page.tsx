import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton } from "@/components/auth/auth-shell";
import { InvitationCard } from "@/components/auth/invitation";

export const metadata: Metadata = {
  title: "Invitation",
  description: "Rejoignez une entreprise sur ComptaPro Digital.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense fallback={<AuthFormSkeleton />}>
      <InvitationCard />
    </Suspense>
  );
}
