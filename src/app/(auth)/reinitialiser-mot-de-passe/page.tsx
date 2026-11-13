import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/password-reset-forms";

export const metadata: Metadata = {
  title: "Nouveau mot de passe",
  description: "Choisissez un nouveau mot de passe.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense fallback={<AuthFormSkeleton />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
