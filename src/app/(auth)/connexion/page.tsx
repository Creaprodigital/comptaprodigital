import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Connexion",
  description: "Connectez-vous à votre espace ComptaPro Digital.",
  robots: { index: true, follow: true },
};

export default function Page() {
  return (
    <Suspense fallback={<AuthFormSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}
