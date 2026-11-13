import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  title: "Créer un compte",
  description: "Créez votre compte ComptaPro Digital et testez gratuitement la formule de votre choix.",
  robots: { index: true, follow: true },
};

export default function Page() {
  return (
    <Suspense fallback={<AuthFormSkeleton />}>
      <RegisterForm />
    </Suspense>
  );
}
