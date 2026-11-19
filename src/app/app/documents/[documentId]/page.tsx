import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon, DownloadIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { AppError } from "@/server/http/errors";
import { companyHasModule } from "@/server/modules/plans/service";
import { getDocument } from "@/server/modules/documents/service";
import { listCategories } from "@/server/modules/bank/categories";
import { getExtraction } from "@/server/ai/documents";
import { aiStatus } from "@/server/ai/service";
import { DOCUMENT_CATEGORY_LABELS, documentContentUrl as contentUrl, formatFileSize } from "@/lib/bank";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExtractionPanel } from "@/components/app/ai/extraction-panel";
import { AiUnavailable } from "@/components/app/ai/ai-unavailable";

export const metadata: Metadata = { title: "Document" };
export const instant = false;

type Props = { params: Promise<{ documentId: string }> };

export default async function DocumentPage({ params }: Props) {
  const [{ access }, { documentId }] = await Promise.all([requireCompany("documents:read"), params]);
  if (!(await companyHasModule(access.company.id, "documents"))) redirect("/app/documents");
  const document = await getDocument(access, documentId).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const [extraction, categories, ai] = await Promise.all([getExtraction(access, documentId), listCategories(access.company.id), aiStatus(access.company)]);
  const purchaseLink = document.links.find((l) => l.entityType === "PURCHASE");
  const companyId = access.company.id;
  return (
    <>
      <Link href="/app/documents" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4" /> Documents</Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold sm:text-[28px]">{document.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {DOCUMENT_CATEGORY_LABELS[document.category]} · {formatFileSize(document.sizeBytes)}
            {document.documentDate ? ` · daté du ${formatDate(document.documentDate)}` : ""}
          </p>
        </div>
        <Button asChild variant="outline">
          <a href={contentUrl(companyId, document.id, true)} download><DownloadIcon /> Télécharger</a>
        </Button>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {document.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element -- fichier privé servi par l'API, hors optimisation d'images
              <img src={contentUrl(companyId, document.id)} alt={`Aperçu de ${document.name}`} className="mx-auto max-h-[75vh] w-auto object-contain" />
            ) : (
              <iframe src={contentUrl(companyId, document.id)} title={`Aperçu de ${document.name}`} className="h-[75vh] w-full bg-white" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Lecture automatique</CardTitle>
            <CardDescription>Les informations lues par l'IA sont des propositions : vérifiez-les et corrigez-les avant de les utiliser.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {!ai.usable && !extraction.extraction ? <AiUnavailable status={ai} compact /> : null}
            <ExtractionPanel
              companyId={companyId}
              documentId={document.id}
              state={extraction}
              categories={categories.filter((c) => c.isActive)}
              usable={ai.usable}
              canWrite={access.permissions.has("documents:write") && !document.locked}
              canCreatePurchase={access.permissions.has("purchases:write")}
              linkedPurchase={purchaseLink ? { id: purchaseLink.entityId, label: purchaseLink.label } : null}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
