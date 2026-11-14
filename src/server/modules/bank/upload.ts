import type { NextRequest } from "next/server";
import { validate } from "@/server/http/api";
import { errors } from "@/server/http/errors";
import { readUpload } from "@/server/http/upload";
import { MAX_STATEMENT_BYTES } from "@/lib/bank";
import { csvMappingSchema } from "@/lib/schemas/bank";
import type { ImportInput } from "./imports";

/** Lit l'envoi d'un relevé : fichier, compte de destination et, pour un CSV, correspondance des colonnes. */
export async function readStatementUpload(request: NextRequest): Promise<ImportInput> {
  const { files, fields } = await readUpload(request, { maxFileBytes: MAX_STATEMENT_BYTES });
  if (!fields.bankAccountId || fields.bankAccountId.length > 40) throw errors.validation([{ path: "bankAccountId", message: "Choisissez le compte bancaire" }]);
  let mapping;
  if (fields.mapping) {
    let json: unknown;
    try {
      json = JSON.parse(fields.mapping);
    } catch {
      throw errors.badRequest("INVALID_MAPPING", "La correspondance des colonnes est illisible.");
    }
    mapping = validate(csvMappingSchema, json);
  }
  return { bankAccountId: fields.bankAccountId, fileName: files[0].name, bytes: files[0].bytes, mapping };
}
