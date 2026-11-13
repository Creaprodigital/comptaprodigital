import "dotenv/config";
import { execSync } from "node:child_process";

/** Applique les migrations sur la base de test avant l'exécution des suites. */
export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL?.replace(/\/([^/?]+)(\?.*)?$/, "/$1_test$2");
  if (!url) throw new Error("DATABASE_URL (ou TEST_DATABASE_URL) est requis pour les tests");
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
