#!/usr/bin/env node
/**
 * Garde-fou des migrations SQL (prisma/migrations) : Prisma 6.19 peut générer, pour MySQL,
 * une migration qui supprime une clé étrangère (pour remplacer l'index qui la couvre) puis
 * en « recrée » une autre, déjà existante. La base perdrait alors une contrainte d'intégrité.
 * Ce script refuse :
 *  - une clé étrangère supprimée et jamais recréée dans la même migration ;
 *  - une clé étrangère créée alors qu'elle existe déjà (créée par une migration antérieure).
 *   node scripts/check-migrations.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const dir = path.resolve("prisma/migrations");
const migrations = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const existing = new Set();
const problems = [];

for (const name of migrations) {
  const sql = await readFile(path.join(dir, name, "migration.sql"), "utf8");
  const dropped = [...sql.matchAll(/DROP FOREIGN KEY `([^`]+)`/g)].map((m) => m[1]);
  const added = [...sql.matchAll(/ADD CONSTRAINT `([^`]+)` FOREIGN KEY/g)].map((m) => m[1]);
  for (const fk of dropped) {
    if (!added.includes(fk)) problems.push(`${name} : la clé étrangère ${fk} est supprimée sans être recréée`);
    existing.delete(fk);
  }
  for (const fk of added) {
    if (existing.has(fk)) problems.push(`${name} : la clé étrangère ${fk} existe déjà (créée par une migration antérieure)`);
    existing.add(fk);
  }
  // Contraintes créées dans un CREATE TABLE.
  for (const m of sql.matchAll(/CONSTRAINT `([^`]+)` FOREIGN KEY/g)) if (!added.includes(m[1])) existing.add(m[1]);
}

if (problems.length) {
  console.error("Migrations à corriger (écrire la migration à la main, voir docs/ARCHITECTURE.md) :");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`${migrations.length} migration(s) vérifiée(s), ${existing.size} clé(s) étrangère(s) cohérente(s).`);
