import { Loader2Icon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function AuthHeading({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
      {description ? <p className="mt-2 text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription className="col-span-2 text-foreground">{message}</AlertDescription>
    </Alert>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full">
      {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
      {children}
    </Button>
  );
}

export function AuthFormSkeleton() {
  return (
    <div className="grid gap-5" aria-busy="true">
      <div className="h-9 w-2/3 animate-pulse rounded-md bg-muted" />
      <div className="h-10 animate-pulse rounded-lg bg-muted" />
      <div className="h-10 animate-pulse rounded-lg bg-muted" />
      <div className="h-12 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

/** N'autorise que les redirections internes vers l'espace client ou une invitation. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/app";
  return next.startsWith("/app") || next.startsWith("/invitation/") ? next : "/app";
}
