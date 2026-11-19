import "dotenv/config";
import { prisma } from "../src/server/db";
import { defaultMigrationsDir, productionCheck } from "../src/server/ops/production-check";

/**
 * Contrôle d'une installation de production (à lancer après chaque déploiement) :
 *   docker compose run --rm check        (ou : npm run check:production)
 * Code de sortie 1 si un point bloquant est détecté.
 */
async function main() {
  const items = await productionCheck({ migrationsDir: defaultMigrationsDir() });
  const symbol = { ok: "✔", warning: "⚠", error: "✖" } as const;
  for (const item of items) console.log(`${symbol[item.level]} ${item.label} — ${item.detail}`);
  const errors = items.filter((i) => i.level === "error").length;
  const warnings = items.filter((i) => i.level === "warning").length;
  console.log(`\n${errors} point(s) bloquant(s), ${warnings} avertissement(s).`);
  if (errors) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
