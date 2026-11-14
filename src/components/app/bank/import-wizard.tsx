"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, FileUpIcon, Loader2Icon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import type { BankAccountView } from "@/server/modules/bank/accounts";
import type { ImportPreview, ImportResult, ImportView } from "@/server/modules/bank/imports";
import { api, apiUpload, errorMessage } from "@/lib/api-client";
import { MAX_STATEMENT_BYTES, STATEMENT_ACCEPT, STATEMENT_FORMAT_LABELS, formatFileSize } from "@/lib/bank";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { useResetOnHide } from "@/lib/use-reset-on-hide";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Amount } from "@/components/app/bank/shared";

type Mapping = Partial<Record<"date" | "label" | "amount" | "debit" | "credit" | "valueDate" | "labelExtra", number>>;

const MAPPING_FIELDS: Array<{ key: keyof Mapping; label: string; required?: boolean }> = [
  { key: "date", label: "Date de l'opération", required: true },
  { key: "label", label: "Libellé", required: true },
  { key: "amount", label: "Montant (signé)" },
  { key: "debit", label: "Débit" },
  { key: "credit", label: "Crédit" },
  { key: "valueDate", label: "Date de valeur" },
  { key: "labelExtra", label: "Complément de libellé" },
];

const STATE_LABELS = { new: "Nouvelle", duplicate: "Déjà importée", suspect: "Doublon possible" } as const;
const STATE_VARIANTS = { new: "success", duplicate: "outline", suspect: "warning" } as const;

/** Import d'un relevé en trois temps : fichier, vérification (colonnes, doublons), import. */
export function ImportWizard({ companyId, accounts }: { companyId: string; accounts: BankAccountView[] }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, setPending] = useState<"preview" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setMapping({});
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
  }
  useResetOnHide(reset);

  function form(selected: File, account: string, columns?: Mapping): FormData {
    const data = new FormData();
    data.set("file", selected);
    data.set("bankAccountId", account);
    if (columns && Object.keys(columns).length > 0) data.set("mapping", JSON.stringify(columns));
    return data;
  }

  async function analyze(selected: File, account: string, columns?: Mapping) {
    setPending("preview");
    setError(null);
    setResult(null);
    try {
      const data = await apiUpload<ImportPreview>(`/companies/${companyId}/bank/imports/preview`, form(selected, account, columns));
      setPreview(data);
      if (data.csv) setMapping(data.csv.mapping);
    } catch (cause) {
      setPreview(null);
      setError(errorMessage(cause));
    } finally {
      setPending(null);
    }
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setPreview(null);
    setResult(null);
    setMapping({});
    if (!selected) return;
    if (selected.size > MAX_STATEMENT_BYTES) {
      setError(`Relevé trop volumineux (${formatFileSize(MAX_STATEMENT_BYTES)} au maximum) : importez-le par périodes plus courtes.`);
      return;
    }
    void analyze(selected, accountId);
  }

  function onAccount(value: string) {
    setAccountId(value);
    if (file && !result) void analyze(file, value, preview?.csv ? mapping : undefined);
  }

  function onMapping(key: keyof Mapping, value: string) {
    const next = { ...mapping };
    if (value === "") delete next[key];
    else next[key] = Number(value);
    setMapping(next);
    const complete = next.date !== undefined && next.label !== undefined && (next.amount !== undefined || next.debit !== undefined || next.credit !== undefined);
    if (file && complete) void analyze(file, accountId, next);
  }

  async function runImport() {
    if (!file || !preview) return;
    setPending("import");
    setError(null);
    try {
      const data = await apiUpload<ImportResult>(`/companies/${companyId}/bank/imports`, form(file, accountId, preview.csv ? mapping : undefined));
      setResult(data);
      setPreview(null);
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(null);
    }
  }

  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? "EUR";

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Compte et fichier</CardTitle>
          <CardDescription>
            Téléchargez le relevé depuis l'espace en ligne de votre banque, au format CSV, OFX ou camt.053 (XML). Le format est reconnu automatiquement.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="import-account" label="Compte de destination" required>
            <NativeSelect value={accountId} onChange={(e) => onAccount(e.target.value)} disabled={pending !== null}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.ibanMasked ? ` (${a.ibanMasked})` : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="import-file" label="Relevé bancaire" required hint={`CSV, OFX ou camt.053 — ${formatFileSize(MAX_STATEMENT_BYTES)} au maximum.`}>
            <Input ref={fileInput} type="file" accept={STATEMENT_ACCEPT} onChange={onFile} disabled={pending !== null} className="h-auto py-2 file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium" />
          </Field>
        </CardContent>
      </Card>

      {pending === "preview" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Analyse du relevé…
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Le relevé n'a pas pu être traité</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>2. Vérification</CardTitle>
            <CardDescription>
              Format reconnu : {STATEMENT_FORMAT_LABELS[preview.format]}
              {preview.period ? ` · opérations du ${formatDate(preview.period.from)} au ${formatDate(preview.period.to)}` : ""}. Rien n'est encore enregistré.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {preview.csv ? (
              <div className="grid gap-3">
                <p className="text-sm font-medium">Correspondance des colonnes {preview.ready ? "" : "— à compléter"}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {MAPPING_FIELDS.map((field) => (
                    <Field key={field.key} id={`mapping-${field.key}`} label={field.label} required={field.required}>
                      <NativeSelect value={mapping[field.key] ?? ""} onChange={(e) => onMapping(field.key, e.target.value)} disabled={pending !== null}>
                        <option value="">—</option>
                        {preview.csv!.headers.map((header, index) => (
                          <option key={index} value={index}>
                            {header}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  ))}
                </div>
                {!preview.ready ? (
                  <>
                    <p className="text-sm text-muted-foreground">Indiquez la colonne de la date, celle du libellé, et soit un montant signé, soit les colonnes débit et crédit. Premières lignes du fichier :</p>
                    <div className="overflow-x-auto rounded-xl border">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            {preview.csv.headers.map((header, index) => (
                              <TableHead key={index}>{header}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.csv.sampleRows.map((row, index) => (
                            <TableRow key={index}>
                              {row.map((cell, cellIndex) => (
                                <TableCell key={cellIndex} className="max-w-[16rem] truncate text-xs">{cell}</TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {preview.ready ? (
              <>
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: "Opérations à importer", value: String(preview.newCount) },
                    { label: "Déjà présentes (ignorées)", value: String(preview.duplicateCount) },
                    { label: "Encaissements", value: formatCurrency(preview.totalIn, { currency }) },
                    { label: "Décaissements", value: formatCurrency(preview.totalOut.replace("-", ""), { currency }) },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border px-4 py-3">
                      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{item.label}</dt>
                      <dd className="tabular mt-0.5 font-display text-xl font-bold">{item.value}</dd>
                    </div>
                  ))}
                </dl>
                {preview.alreadyImportedAt ? (
                  <Alert variant="warning">
                    <AlertTriangleIcon />
                    <AlertTitle>Ce fichier a déjà été importé sur ce compte</AlertTitle>
                    <AlertDescription>Import du {formatDateTime(preview.alreadyImportedAt)}. Les opérations déjà présentes ne seront pas ajoutées une seconde fois.</AlertDescription>
                  </Alert>
                ) : null}
                {preview.accountMismatch ? (
                  <Alert variant="warning">
                    <AlertTriangleIcon />
                    <AlertTitle>Ce relevé semble provenir d'un autre compte</AlertTitle>
                    <AlertDescription>L'IBAN indiqué dans le fichier ne correspond pas à celui du compte « {account?.name} ». Vérifiez le compte de destination avant d'importer.</AlertDescription>
                  </Alert>
                ) : null}
                {preview.suspectCount > 0 ? (
                  <Alert variant="warning">
                    <AlertTriangleIcon />
                    <AlertTitle>
                      {preview.suspectCount} doublon{preview.suspectCount > 1 ? "s" : ""} possible{preview.suspectCount > 1 ? "s" : ""}
                    </AlertTitle>
                    <AlertDescription>Une opération de même date et de même montant existe déjà sous un autre libellé. Elles seront importées et signalées : vous pourrez les confirmer ou les supprimer.</AlertDescription>
                  </Alert>
                ) : null}
                {preview.issueCount > 0 ? (
                  <Alert variant="warning">
                    <AlertTriangleIcon />
                    <AlertTitle>
                      {preview.issueCount} ligne{preview.issueCount > 1 ? "s" : ""} illisible{preview.issueCount > 1 ? "s" : ""}, non importée{preview.issueCount > 1 ? "s" : ""}
                    </AlertTitle>
                    <AlertDescription>
                      <ul className="mt-1 list-disc pl-4">
                        {preview.issues.slice(0, 8).map((issue, index) => (
                          <li key={index}>
                            {issue.line ? `Ligne ${issue.line} : ` : ""}
                            {issue.message}
                          </li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                ) : null}
                {preview.sample.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Date</TableHead>
                          <TableHead>Libellé</TableHead>
                          <TableHead>État</TableHead>
                          <TableHead className="text-right">Montant</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.sample.map((row, index) => (
                          <TableRow key={index}>
                            <TableCell className="tabular whitespace-nowrap text-muted-foreground">{formatDate(row.date)}</TableCell>
                            <TableCell className="max-w-[24rem] truncate">{row.label}</TableCell>
                            <TableCell><Badge variant={STATE_VARIANTS[row.state]}>{STATE_LABELS[row.state]}</Badge></TableCell>
                            <TableCell className="text-right"><Amount value={row.amount} currency={currency} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {preview.total > preview.sample.length ? <p className="border-t px-4 py-2 text-xs text-muted-foreground">Aperçu des {preview.sample.length} premières opérations sur {preview.total}.</p> : null}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={runImport} disabled={pending !== null || preview.newCount === 0}>
                    {pending === "import" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <FileUpIcon />}
                    {preview.newCount === 0 ? "Aucune opération nouvelle" : `Importer ${preview.newCount} opération${preview.newCount > 1 ? "s" : ""}`}
                  </Button>
                  <Button variant="ghost" onClick={reset} disabled={pending !== null}>Choisir un autre fichier</Button>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <Alert variant="success">
          <CheckCircle2Icon />
          <AlertTitle>
            {result.importedCount} opération{result.importedCount > 1 ? "s" : ""} importée{result.importedCount > 1 ? "s" : ""}
          </AlertTitle>
          <AlertDescription>
            <p>
              {result.duplicateCount > 0 ? `${result.duplicateCount} déjà présente${result.duplicateCount > 1 ? "s" : ""}, ignorée${result.duplicateCount > 1 ? "s" : ""}. ` : ""}
              {result.categorizedCount > 0 ? `${result.categorizedCount} catégorisée${result.categorizedCount > 1 ? "s" : ""} par vos règles. ` : ""}
              {result.suspectCount > 0 ? `${result.suspectCount} doublon${result.suspectCount > 1 ? "s" : ""} possible${result.suspectCount > 1 ? "s" : ""} à vérifier.` : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/app/banque?statut=TO_REVIEW">Traiter les opérations</Link>
              </Button>
              <Button variant="outline" size="sm" onClick={reset}>Importer un autre relevé</Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export function ImportsHistory({ companyId, imports, canWrite }: { companyId: string; imports: ImportView[]; canWrite: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function cancel(item: ImportView) {
    if (!window.confirm(`Annuler l'import de « ${item.fileName} » ? Ses ${item.remainingCount} opération(s) seront retirées, avec leur catégorisation.`)) return;
    setBusy(item.id);
    try {
      const { deleted } = await api<{ deleted: number }>(`/companies/${companyId}/bank/imports/${item.id}`, { method: "DELETE" });
      toast.success(`Import annulé : ${deleted} opération${deleted > 1 ? "s" : ""} retirée${deleted > 1 ? "s" : ""}.`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Fichier</TableHead>
          <TableHead className="hidden md:table-cell">Compte</TableHead>
          <TableHead className="hidden sm:table-cell">Importé le</TableHead>
          <TableHead className="text-right">Opérations</TableHead>
          {canWrite ? <TableHead className="text-right">Actions</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {imports.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <p className="max-w-[18rem] truncate font-medium">{item.fileName}</p>
              <p className="text-xs text-muted-foreground">{STATEMENT_FORMAT_LABELS[item.format]}{item.createdBy ? ` · ${item.createdBy}` : ""}</p>
            </TableCell>
            <TableCell className="hidden md:table-cell">{item.accountName}</TableCell>
            <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{formatDateTime(item.createdAt)}</TableCell>
            <TableCell className="tabular text-right">
              {item.importedCount}
              {item.duplicateCount > 0 ? <span className="text-xs text-muted-foreground"> (+{item.duplicateCount} ignorée{item.duplicateCount > 1 ? "s" : ""})</span> : null}
            </TableCell>
            {canWrite ? (
              <TableCell className="text-right">
                <Button variant="ghost" size="sm" disabled={busy === item.id} onClick={() => cancel(item)}>
                  <Undo2Icon /> Annuler l'import
                </Button>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
