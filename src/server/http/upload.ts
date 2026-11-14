import type { NextRequest } from "next/server";
import { AppError, errors } from "@/server/http/errors";

/**
 * Lecture d'un envoi de fichiers (multipart/form-data). La taille annoncée est
 * contrôlée avant toute lecture, puis la taille réelle de chaque fichier.
 */

export type UploadedFile = { name: string; bytes: Buffer };

export async function readUpload(
  request: NextRequest,
  options: { maxFileBytes: number; maxFiles?: number },
): Promise<{ files: UploadedFile[]; fields: Record<string, string> }> {
  const { maxFileBytes, maxFiles = 1 } = options;
  const tooLarge = () => new AppError(413, "FILE_TOO_LARGE", `Fichier trop volumineux (${Math.floor(maxFileBytes / 1024 / 1024)} Mo au maximum).`);

  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Un envoi de fichier (multipart/form-data) est attendu.");
  }
  const announced = Number(request.headers.get("content-length") ?? "0");
  if (announced > maxFileBytes * maxFiles + 64 * 1024) throw tooLarge();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw errors.badRequest("INVALID_UPLOAD", "L'envoi du fichier est illisible.");
  }

  const files: UploadedFile[] = [];
  const fields: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") {
      if (value.length > 20_000) throw errors.badRequest("INVALID_UPLOAD", "Champ trop long.");
      fields[name] = value;
      continue;
    }
    if (files.length >= maxFiles) throw errors.badRequest("TOO_MANY_FILES", `${maxFiles} fichier(s) au maximum par envoi.`);
    if (value.size > maxFileBytes) throw tooLarge();
    if (value.size === 0) throw errors.badRequest("EMPTY_FILE", "Le fichier est vide.");
    files.push({ name: sanitizeFileName(value.name), bytes: Buffer.from(await value.arrayBuffer()) });
  }
  if (files.length === 0) throw errors.badRequest("NO_FILE", "Aucun fichier reçu.");
  return { files, fields };
}

/** Nom de fichier débarrassé de tout chemin et des caractères de contrôle. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  return cleaned || "fichier";
}

/** Nom de fichier sûr pour l'en-tête Content-Disposition (ASCII + variante UTF-8). */
export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
