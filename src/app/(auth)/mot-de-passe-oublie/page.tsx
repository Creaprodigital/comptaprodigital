import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/password-reset-forms";

export const metadata: Metadata = {
  title: "Mot de passe oublié",
  description: "Réinitialisez le mot de passe de votre compte ComptaPro Digital.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense fallback={<AuthFormSkeleton />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
