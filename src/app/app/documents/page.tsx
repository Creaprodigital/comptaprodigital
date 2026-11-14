import type { Metadata } from "next";
import Link from "next/link";
import { ArchiveIcon } from "lucide-react";
import { requireCompany } from "@/server/auth/guards";
import { companyHasModule } from "@/server/modules/plans/service";
import { listDocuments } from "@/server/modules/documents/service";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS, formatFileSize } from "@/lib/bank";
import { isIsoDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import { ModuleLocked } from "@/components/app/bank/shared";
import { EmptyState, Pagination } from "@/components/app/billing/shared";
import { DocumentsTable, UploadDocumentsButton } from "@/components/app/documents/documents-view";

export const metadata: Metadata = { title: "Documents" };

type Search = { q?: string; categorie?: string; association?: string; du?: string; au?: string; page?: string };
type Props = { searchParams: Promise<Search> };

export default async function DocumentsPage({ searchParams }: Props) {
  const [{ access }, params] = await Promise.all([requireCompany("documents:read"), searchParams]);
  if (!(await companyHasModule(access.company.id, "documents"))) {
    return (
      <>
        <PageHeader title="Documents" description="Justificatifs et pièces de l'entreprise." />
        <ModuleLocked title="La gestion documentaire fait partie de la formule Pro" description="Conservez vos justificatifs, classez-les et associez-les à vos opérations en passant à la formule Pro." />
      </>
    );
  }

  const companyId = access.company.id;
  const canWrite = access.permissions.has("documents:write");
  const category = DOCUMENT_CATEGORIES.find((c) => c === params.categorie);
  const link = params.association === "linked" ? ("linked" as const) : params.association === "unlinked" ? ("unlinked" as const) : undefined;
  const query = {
    q: params.q?.slice(0, 100) || undefined,
    category,
    link,
    from: params.du && isIsoDate(params.du) ? params.du : undefined,
    to: params.au && isIsoDate(params.au) ? params.au : undefined,
    page: Math.max(1, Number(params.page) || 1),
  };
  const result = await listDocuments(access, query);
  const filtered = Boolean(query.q || query.category || query.link || query.from || query.to);
  const urlParams = { q: query.q, categorie: query.category, association: query.link, du: query.from, au: query.to };
  const exportQuery = new URLSearchParams(Object.entries({ q: query.q, category: query.category, link: query.link, from: query.from, to: query.to }).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const categoryHref = (value?: string) => {
    const search = new URLSearchParams(Object.entries({ ...urlParams, categorie: value }).filter((entry): entry is [string, string] => Boolean(entry[1])));
    return search.size ? `/app/documents?${search}` : "/app/documents";
  };
  const uploadButton = canWrite ? <UploadDocumentsButton companyId={companyId} /> : undefined;

  return (
    <>
      <PageHeader
        title="Documents"
        description={
          result.summary.total > 0
            ? `${result.summary.total} document${result.summary.total > 1 ? "s" : ""} (${formatFileSize(result.summary.sizeBytes)}), dont ${result.summary.unlinked} non associé${result.summary.unlinked > 1 ? "s" : ""}.`
            : "Justificatifs et pièces de l'entreprise, chiffrés et classés."
        }
        actions={
          <>
            {result.total > 0 ? (
              <Button asChild variant="outline">
                <a href={`/api/v1/companies/${companyId}/documents/export${exportQuery.size ? `?${exportQuery}` : ""}`} download>
                  <ArchiveIcon /> Exporter (ZIP)
                </a>
              </Button>
            ) : null}
            {uploadButton}
          </>
        }
      />

      <nav aria-label="Filtrer par catégorie" className="mb-4 flex flex-wrap gap-1 rounded-xl border bg-card p-1 shadow-xs">
        {[{ value: undefined, label: "Tous", count: result.summary.total }, ...DOCUMENT_CATEGORIES.filter((c) => result.summary.byCategory[c]).map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABELS[c], count: result.summary.byCategory[c]! }))].map((option) => (
          <Link
            key={option.value ?? "all"}
            href={categoryHref(option.value)}
            aria-current={query.category === option.value ? "true" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              query.category === option.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {option.label} <span className="tabular opacity-70">{option.count}</span>
          </Link>
        ))}
      </nav>

      <form action="/app/documents" method="get" role="search" className="mb-4 grid gap-2 rounded-2xl border bg-card p-3 shadow-xs sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_auto_auto_auto]">
        {query.category ? <input type="hidden" name="categorie" value={query.category} /> : null}
        <Input name="q" type="search" defaultValue={query.q} placeholder="Nom du document" aria-label="Rechercher un document" />
        <NativeSelect name="association" defaultValue={query.link ?? ""} aria-label="Association">
          <option value="">Associés ou non</option>
          <option value="unlinked">Non associés</option>
          <option value="linked">Associés à un élément</option>
        </NativeSelect>
        <Input name="du" type="date" defaultValue={query.from} aria-label="Document daté à partir du" />
        <Input name="au" type="date" defaultValue={query.to} aria-label="Document daté jusqu'au" />
        <div className="flex gap-2">
          <Button type="submit" variant="outline">Filtrer</Button>
          {filtered ? (
            <Button asChild variant="ghost">
              <Link href="/app/documents">Effacer</Link>
            </Button>
          ) : null}
        </div>
      </form>

      {result.items.length === 0 ? (
        <EmptyState
          title={filtered ? "Aucun document ne correspond à ces critères" : "Aucun document pour l'instant"}
          description={filtered ? "Modifiez ou effacez les filtres." : "Ajoutez vos factures d'achat, reçus et autres pièces : vous pourrez les associer à vos opérations bancaires."}
          action={!filtered ? uploadButton : undefined}
        />
      ) : (
        <Card>
          <CardContent className="px-2 py-2 sm:px-4">
            <DocumentsTable companyId={companyId} documents={result.items} canWrite={canWrite} canDelete={access.permissions.has("documents:delete")} />
          </CardContent>
        </Card>
      )}
      <Pagination basePath="/app/documents" page={result.page} pageSize={result.pageSize} total={result.total} params={urlParams} />
    </>
  );
}
