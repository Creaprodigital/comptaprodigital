import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { requireSuperAdmin } from "@/server/admin/guard";
import { AppError } from "@/server/http/errors";
import { getError } from "@/server/modules/admin/errors";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Erreur" };
export const instant = false;

type Props = { params: Promise<{ errorId: string }> };

export default async function AdminErrorPage({ params }: Props) {
  const [, { errorId }] = await Promise.all([requireSuperAdmin(), params]);
  const error = await getError(errorId).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  return (
    <>
      <Link href="/admin/erreurs" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4" /> Erreurs</Link>
      <h1 className="text-2xl font-bold">{error.method} {error.path ?? "—"}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{formatDateTime(error.createdAt)}</p>
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <p className="font-medium whitespace-pre-wrap">{error.message}</p>
          {error.stack ? <pre className="max-h-[32rem] overflow-auto rounded-xl bg-muted p-4 text-xs">{error.stack}</pre> : null}
        </CardContent>
      </Card>
    </>
  );
}
