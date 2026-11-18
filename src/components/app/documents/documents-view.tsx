"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DownloadIcon, EyeIcon, FileImageIcon, FileTextIcon, FolderSearchIcon, Link2OffIcon, Loader2Icon, LockIcon, PencilIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import type { DocumentView } from "@/server/modules/documents/service";
import { api, ApiError, apiUpload, errorMessage } from "@/lib/api-client";
import { DOCUMENT_ACCEPT, DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS, MAX_DOCUMENT_BYTES, formatFileSize, type DocumentCategoryKey } from "@/lib/bank";
import { formatDate } from "@/lib/format";
import { useResetOnHide } from "@/lib/use-reset-on-hide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type EntityLink = { entityType: "BANK_TRANSACTION" | "INVOICE" | "QUOTE" | "PURCHASE"; entityId: string };

const contentUrl = (companyId: string, documentId: string, download = false) => `/api/v1/companies/${companyId}/documents/${documentId}/content${download ? "?download=1" : ""}`;

function FileIcon({ mimeType }: { mimeType: string }) {
  const Icon = mimeType.startsWith("image/") ? FileImageIcon : FileTextIcon;
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

/** Aperçu d'un document : le fichier est servi par l'API, après contrôle des droits. */
export function DocumentPreviewDialog({ companyId, document, onClose }: { companyId: string; document: DocumentView | null; onClose: () => void }) {
  return (
    <Dialog open={document !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl">
        {document ? (
          <>
            <DialogHeader>
              <DialogTitle className="truncate pr-6">{document.name}</DialogTitle>
              <DialogDescription>
                {DOCUMENT_CATEGORY_LABELS[document.category]} · {formatFileSize(document.sizeBytes)}
                {document.documentDate ? ` · daté du ${formatDate(document.documentDate)}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="overflow-hidden rounded-xl border bg-muted">
              {document.mimeType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element -- fichier privé servi par l'API, hors optimisation d'images
                <img src={contentUrl(companyId, document.id)} alt={`Aperçu de ${document.name}`} className="mx-auto max-h-[65vh] w-auto object-contain" />
              ) : (
                <iframe src={contentUrl(companyId, document.id)} title={`Aperçu de ${document.name}`} className="h-[65vh] w-full bg-white" />
              )}
            </div>
            <DialogFooter>
              <Button asChild variant="outline">
                <a href={contentUrl(companyId, document.id)} target="_blank" rel="noopener noreferrer">Ouvrir dans un nouvel onglet</a>
              </Button>
              <Button asChild>
                <a href={contentUrl(companyId, document.id, true)} download>
                  <DownloadIcon /> Télécharger
                </a>
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Ajout d'un ou plusieurs fichiers, éventuellement associés d'emblée à un élément. */
export function UploadDocumentsButton({
  companyId,
  link,
  defaultCategory = "OTHER",
  label = "Ajouter des documents",
  variant = "default",
}: {
  companyId: string;
  link?: EntityLink;
  defaultCategory?: DocumentCategoryKey;
  label?: string;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  useResetOnHide(() => setOpen(false));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    setFormError(null);
    if (files.length === 0) {
      setFormError("Choisissez au moins un fichier.");
      return;
    }
    const tooLarge = files.find((file) => file.size > MAX_DOCUMENT_BYTES);
    if (tooLarge) {
      setFormError(`« ${tooLarge.name} » dépasse ${formatFileSize(MAX_DOCUMENT_BYTES)}.`);
      return;
    }
    setPending(true);
    let added = 0;
    let duplicates = 0;
    const failures: string[] = [];
    for (const [index, file] of files.entries()) {
      setProgress(`Envoi ${index + 1} sur ${files.length}…`);
      const data = new FormData();
      data.set("file", file);
      data.set("category", String(form.get("category") ?? defaultCategory));
      if (form.get("documentDate")) data.set("documentDate", String(form.get("documentDate")));
      if (link) {
        data.set("entityType", link.entityType);
        data.set("entityId", link.entityId);
      }
      try {
        const result = await apiUpload<{ duplicate: boolean }>(`/companies/${companyId}/documents`, data);
        if (result.duplicate) duplicates++;
        else added++;
      } catch (error) {
        failures.push(`${file.name} : ${errorMessage(error)}`);
      }
    }
    setPending(false);
    setProgress(null);
    if (added > 0) toast.success(`${added} document${added > 1 ? "s" : ""} ajouté${added > 1 ? "s" : ""}.`);
    if (duplicates > 0) toast.info(`${duplicates} fichier${duplicates > 1 ? "s" : ""} déjà présent${duplicates > 1 ? "s" : ""} dans vos documents${link ? " : associé à cet élément" : ", non ajouté une seconde fois"}.`);
    if (failures.length > 0) setFormError(failures.join("\n"));
    else setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <UploadIcon /> {label}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>PDF, JPEG ou PNG, {formatFileSize(MAX_DOCUMENT_BYTES)} au maximum par fichier. Les fichiers sont chiffrés avant d'être stockés.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} noValidate className="grid gap-5">
            {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm whitespace-pre-line">{formError}</p> : null}
            <Field id="upload-files" label="Fichiers" required>
              <Input name="files" type="file" multiple required accept={DOCUMENT_ACCEPT} className="h-auto py-2 file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="upload-category" label="Catégorie">
                <NativeSelect name="category" defaultValue={defaultCategory}>
                  {DOCUMENT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {DOCUMENT_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="upload-date" label="Date du document" hint="Facultative.">
                <Input name="documentDate" type="date" />
              </Field>
            </div>
            <DialogFooter>
              {progress ? <p className="mr-auto self-center text-sm text-muted-foreground" role="status">{progress}</p> : null}
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={pending}>Annuler</Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                Envoyer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditDocumentDialog({ companyId, document, onClose }: { companyId: string; document: DocumentView | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!document) return;
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await api(`/companies/${companyId}/documents/${document.id}`, { method: "PATCH", body: Object.fromEntries(new FormData(event.currentTarget).entries()) });
      toast.success("Document enregistré.");
      onClose();
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setErrors(error.fieldErrors);
      else setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={document !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Classer le document</DialogTitle>
          <DialogDescription>Fichier d'origine : {document?.originalFileName}</DialogDescription>
        </DialogHeader>
        {document ? (
          <form onSubmit={onSubmit} noValidate className="grid gap-5" key={document.id}>
            {formError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{formError}</p> : null}
            <Field id="document-name" label="Nom" error={errors.name} required>
              <Input name="name" required maxLength={255} defaultValue={document.name} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="document-category" label="Catégorie" error={errors.category}>
                <NativeSelect name="category" defaultValue={document.category}>
                  {DOCUMENT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {DOCUMENT_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="document-date" label="Date du document" error={errors.documentDate}>
                <Input name="documentDate" type="date" defaultValue={document.documentDate ?? ""} />
              </Field>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Annuler</Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Bibliothèque des documents de l'entreprise. */
export function DocumentsTable({ companyId, documents, canWrite, canDelete }: { companyId: string; documents: DocumentView[]; canWrite: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [preview, setPreview] = useState<DocumentView | null>(null);
  const [editing, setEditing] = useState<DocumentView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useResetOnHide(() => {
    setPreview(null);
    setEditing(null);
  });

  async function remove(document: DocumentView) {
    const linked = document.links.length > 0 ? ` Il ne sera plus associé à ${document.links.length} élément${document.links.length > 1 ? "s" : ""}.` : "";
    if (!window.confirm(`Supprimer « ${document.name} » ?${linked}`)) return;
    setBusy(document.id);
    try {
      await api(`/companies/${companyId}/documents/${document.id}`, { method: "DELETE" });
      toast.success("Document supprimé.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Document</TableHead>
            <TableHead className="hidden md:table-cell">Catégorie</TableHead>
            <TableHead className="hidden lg:table-cell">Associé à</TableHead>
            <TableHead className="hidden sm:table-cell">Ajouté le</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((document) => (
            <TableRow key={document.id}>
              <TableCell className="max-w-[20rem]">
                <button type="button" onClick={() => setPreview(document)} className="flex max-w-full items-center gap-2 text-left font-medium hover:text-primary hover:underline">
                  <FileIcon mimeType={document.mimeType} />
                  <span className="truncate">{document.name}</span>
                </button>
                <p className="pl-6 text-xs text-muted-foreground">
                  {formatFileSize(document.sizeBytes)}
                  {document.documentDate ? ` · daté du ${formatDate(document.documentDate)}` : ""}
                  {document.locked ? (
                    <span className="ml-2 inline-flex items-center gap-1">
                      <LockIcon className="size-3" aria-hidden="true" /> Original archivé
                    </span>
                  ) : null}
                </p>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Badge variant="secondary">{DOCUMENT_CATEGORY_LABELS[document.category]}</Badge>
              </TableCell>
              <TableCell className="hidden max-w-[18rem] lg:table-cell">
                {document.links.length === 0 ? (
                  <span className="text-sm text-muted-foreground">Non associé</span>
                ) : (
                  <ul className="grid gap-0.5 text-sm">
                    {document.links.map((link) => (
                      <li key={link.id} className="truncate">
                        {link.href ? <Link href={link.href} className="hover:text-primary hover:underline">{link.label}</Link> : link.label}
                      </li>
                    ))}
                  </ul>
                )}
              </TableCell>
              <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                {formatDate(document.createdAt.slice(0, 10))}
                {document.uploadedBy ? <p className="text-xs">{document.uploadedBy}</p> : null}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <Button variant="ghost" size="icon-sm" onClick={() => setPreview(document)} aria-label={`Aperçu de ${document.name}`}>
                  <EyeIcon />
                </Button>
                <Button asChild variant="ghost" size="icon-sm">
                  <a href={contentUrl(companyId, document.id, true)} download aria-label={`Télécharger ${document.name}`}>
                    <DownloadIcon />
                  </a>
                </Button>
                {canWrite && !document.locked ? (
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing(document)} aria-label={`Classer ${document.name}`}>
                    <PencilIcon />
                  </Button>
                ) : null}
                {canDelete && !document.locked ? (
                  <Button variant="ghost" size="icon-sm" disabled={busy === document.id} onClick={() => remove(document)} aria-label={`Supprimer ${document.name}`}>
                    <Trash2Icon />
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <DocumentPreviewDialog companyId={companyId} document={preview} onClose={() => setPreview(null)} />
      <EditDocumentDialog companyId={companyId} document={editing} onClose={() => setEditing(null)} />
    </>
  );
}

/** Choix d'un document déjà présent dans la bibliothèque, pour l'associer à un élément. */
function ExistingDocumentPicker({ companyId, link, open, onOpenChange }: { companyId: string; link: EntityLink; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DocumentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ pageSize: "20" });
      if (query.trim()) params.set("q", query.trim());
      else params.set("link", "unlinked");
      api<{ items: DocumentView[] }>(`/companies/${companyId}/documents?${params}`, { signal: controller.signal })
        .then((data) => {
          setItems(data.items);
          setError(null);
        })
        .catch((cause) => {
          if (!controller.signal.aborted) setError(errorMessage(cause));
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, companyId]);

  async function attach(document: DocumentView) {
    setBusy(document.id);
    try {
      await api(`/companies/${companyId}/documents/${document.id}/links`, { method: "POST", body: link });
      toast.success("Justificatif associé.");
      onOpenChange(false);
      router.refresh();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Choisir dans mes documents</DialogTitle>
          <DialogDescription>Sans recherche, seuls les documents qui ne sont encore associés à rien sont proposés.</DialogDescription>
        </DialogHeader>
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher par nom" aria-label="Rechercher un document" />
        {error ? <p role="alert" className="text-sm text-destructive-foreground">{error}</p> : null}
        {items === null && !error ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Chargement…</p>
        ) : items && items.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Aucun document à proposer.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border">
            {(items ?? []).map((document) => (
              <li key={document.id} className="flex items-center gap-3 px-3 py-2">
                <FileIcon mimeType={document.mimeType} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{document.name}</p>
                  <p className="text-xs text-muted-foreground">{DOCUMENT_CATEGORY_LABELS[document.category]} · ajouté le {formatDate(document.createdAt.slice(0, 10))}</p>
                </div>
                <Button size="sm" variant="outline" disabled={busy === document.id} onClick={() => attach(document)}>Associer</Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Justificatifs associés à un élément (opération bancaire, facture, devis). */
export function AttachedDocuments({
  companyId,
  link,
  documents,
  canWrite,
  defaultCategory = "PURCHASE_INVOICE",
}: {
  companyId: string;
  link: EntityLink;
  documents: DocumentView[];
  canWrite: boolean;
  defaultCategory?: DocumentCategoryKey;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<DocumentView | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useResetOnHide(() => {
    setPreview(null);
    setPicking(false);
  });

  async function detach(document: DocumentView) {
    const target = document.links.find((l) => l.entityType === link.entityType && l.entityId === link.entityId);
    if (!target) return;
    setBusy(document.id);
    try {
      await api(`/companies/${companyId}/documents/${document.id}/links/${target.id}`, { method: "DELETE" });
      toast.success("Justificatif dissocié. Il reste disponible dans vos documents.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3">
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun justificatif associé.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center gap-2 px-3 py-2">
              <FileIcon mimeType={document.mimeType} />
              <button type="button" onClick={() => setPreview(document)} className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-primary hover:underline">
                {document.name}
              </button>
              <Button asChild variant="ghost" size="icon-sm">
                <a href={contentUrl(companyId, document.id, true)} download aria-label={`Télécharger ${document.name}`}>
                  <DownloadIcon />
                </a>
              </Button>
              {canWrite && !document.locked ? (
                <Button variant="ghost" size="icon-sm" disabled={busy === document.id} onClick={() => detach(document)} aria-label={`Dissocier ${document.name}`}>
                  <Link2OffIcon />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <UploadDocumentsButton companyId={companyId} link={link} defaultCategory={defaultCategory} label="Ajouter un justificatif" variant="outline" />
          <Button variant="ghost" onClick={() => setPicking(true)}>
            <FolderSearchIcon /> Choisir dans mes documents
          </Button>
        </div>
      ) : null}
      <DocumentPreviewDialog companyId={companyId} document={preview} onClose={() => setPreview(null)} />
      <ExistingDocumentPicker companyId={companyId} link={link} open={picking} onOpenChange={setPicking} />
    </div>
  );
}
