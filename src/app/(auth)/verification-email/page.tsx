import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton } from "@/components/auth/auth-shell";
import { VerifyEmail } from "@/components/auth/verify-email";

export const metadata: Metadata = {
  title: "Confirmation de l'adresse e-mail",
  description: "Confirmation de votre adresse e-mail.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense fallback={<AuthFormSkeleton />}>
      <VerifyEmail />
    </Suspense>
  );
}
