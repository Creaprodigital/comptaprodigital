#!/usr/bin/env node
/**
 * Vérifie qu'aucun secret ne figure dans les fichiers servis au navigateur (.next/static)
 * ni dans les pages prérendues : noms des variables sensibles, formats de clés connus et,
 * s'ils sont définis, valeurs réelles des secrets de l'environnement.
 *   node scripts/check-client-bundle.mjs   (après `next build`)
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const SECRET_VARS = ["APP_ENCRYPTION_KEY", "APP_ENCRYPTION_KEY_PREVIOUS", "DATABASE_URL", "SMTP_PASSWORD", "S3_SECRET_ACCESS_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "ANTHROPIC_API_KEY", "INSEE_API_KEY", "SEED_ADMIN_PASSWORD"];
const PATTERNS = [/sk_(live|test)_[A-Za-z0-9]{8,}/, /whsec_[A-Za-z0-9]{8,}/, /sk-ant-[A-Za-z0-9_-]{8,}/, /mysql:\/\/[^"'\s]*:[^"'\s]*@/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

const roots = [".next/static", ".next/server/app"].filter(Boolean);
const values = SECRET_VARS.map((name) => process.env[name]).filter((v) => typeof v === "string" && v.length >= 12);

async function* files(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (/\.(js|html|rsc|json|css|txt|body)$/.test(entry.name)) yield full;
  }
}

const problems = [];
let scanned = 0;
for (const root of roots) {
  const clientOnly = root === ".next/static";
  for await (const file of files(root)) {
    // Côté serveur, seules les pages prérendues (HTML/RSC envoyés tels quels) sont examinées.
    if (!clientOnly && !/\.(html|rsc|body)$/.test(file)) continue;
    scanned++;
    const content = await readFile(file, "utf8");
    // Un nom de variable dans un texte d'aide n'est pas un secret : seules ses formes à risque sont signalées
    // (lecture de l'environnement, ou clé d'un objet sérialisé qui transporterait la valeur).
    for (const name of SECRET_VARS) {
      if (clientOnly && (content.includes(`env.${name}`) || content.includes(`"${name}":`) || content.includes(`${name}:"`))) problems.push(`${file} : référence à ${name}`);
    }
    for (const pattern of PATTERNS) if (pattern.test(content)) problems.push(`${file} : motif sensible ${pattern}`);
    for (const value of values) if (content.includes(value)) problems.push(`${file} : contient la valeur d'un secret de l'environnement`);
  }
}

if (scanned === 0) {
  console.error("Aucun fichier examiné : lancez d'abord `next build`.");
  process.exit(1);
}
if (problems.length) {
  console.error(`Secrets potentiellement exposés (${problems.length}) :`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Aucun secret détecté dans ${scanned} fichier(s) servis au navigateur ou prérendus.`);
